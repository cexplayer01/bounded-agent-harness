import test from "node:test";
import assert from "node:assert/strict";
import { mcpAdapter } from "../src/adapters.mjs";

const request = {
  handoff: { format: "agent-harness.handoff.v1", stepId: "review" },
  input: { target: "module.mjs" },
  context: {},
  idempotencyKey: undefined,
  resumed: false
};

test("MCP adapter accepts provider list shapes and returns only structured content", async () => {
  for (const listResult of [[{ name: "review" }], { tools: ["review"] }]) {
    let received;
    const adapter = mcpAdapter({
      listTools: async () => listResult,
      callTool: async (value) => { received = value; return { content: [{ type: "text", text: "ignored" }], structuredContent: { findings: [] } }; }
    }, { server: "review-server", tool: "review" });
    assert.deepEqual(await adapter.invoke({ ...request, reservedCostUnits: 3 }), { format: "agent-harness.adapter-result.v1", output: { findings: [] }, usage: { costUnits: 3, source: "reserved-ceiling" }, provider: { name: "review-server", version: null, identity: "configuration-only" } });
    assert.equal(received.arguments.handoff.stepId, "review");
  }
});

test("MCP adapter pins provider identity before invoking a tool", async () => {
  let calls = 0;
  const client = {
    getServerInfo: async () => ({ name: "trusted-review", version: "1.2.0" }),
    callTool: async () => { calls += 1; return { structuredContent: { findings: [] } }; }
  };
  const adapter = mcpAdapter(client, { server: "review", tool: "check", expectedServer: { name: "trusted-review", version: "1.2.0" } });
  const result = await adapter.invoke({ ...request, reservedCostUnits: 1 });
  assert.deepEqual(result.provider, { name: "trusted-review", version: "1.2.0", identity: "pinned" });
  assert.equal(calls, 1);

  const impostor = mcpAdapter({ getServerInfo: async () => ({ name: "impostor", version: "1.2.0" }), callTool: async () => { calls += 1; } }, { server: "review", tool: "check", expectedServer: { name: "trusted-review", version: "1.2.0" } });
  await assert.rejects(() => impostor.invoke({ ...request, reservedCostUnits: 1 }), /expected MCP server trusted-review/);
  assert.equal(calls, 1);
});

test("MCP adapter preserves valid provider usage for executor enforcement", async () => {
  const adapter = mcpAdapter({ callTool: async () => ({ structuredContent: { findings: [] }, _meta: { costUnits: 2 } }) }, { server: "s", tool: "review" });
  const result = await adapter.invoke({ ...request, reservedCostUnits: 5 });
  assert.deepEqual(result.usage, { costUnits: 2, source: "provider-reported" });
});

test("MCP adapter fails closed on missing tools, tool errors, and prose-only output", async () => {
  const missing = mcpAdapter({ listTools: async () => ({ tools: [] }), callTool: async () => ({}) }, { server: "s", tool: "review" });
  await assert.rejects(() => missing.invoke(request), /was not advertised/);

  const failed = mcpAdapter({ callTool: async () => ({ isError: true, content: [] }) }, { server: "s", tool: "review" });
  await assert.rejects(() => failed.invoke(request), /returned an error/);

  const prose = mcpAdapter({ callTool: async () => ({ content: [{ type: "text", text: "looks good" }] }) }, { server: "s", tool: "review" });
  await assert.rejects(() => prose.invoke(request), /must return structuredContent/);
});
