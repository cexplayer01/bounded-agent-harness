import assert from "node:assert/strict";
import test from "node:test";
import { createDeepSeekFunctionClient } from "../src/deepseek-function-client.mjs";

const tool = { name: "bounded_readonly_work", description: "Return structured read-only work.", parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } };

test("DeepSeek function client converts one structured function call to the MCP client shape", async () => {
  let request;
  const client = createDeepSeekFunctionClient({ apiKey: "test-key", model: "deepseek-flash", tools: [tool], fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, async json() { return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool.name, arguments: JSON.stringify({ answer: "bounded result" }) } }] } }], usage: { total_tokens: 23 } }; } };
  } });
  assert.deepEqual(await client.getServerInfo(), { name: "deepseek-function-calling", version: "deepseek-flash" });
  assert.deepEqual(await client.listTools(), [{ name: tool.name }]);
  const result = await client.callTool({ name: tool.name, arguments: { input: { task: "inspect" }, context: {}, invocation: { authorization: { allowedEffect: "read", maxEffects: 0 } } } });
  assert.deepEqual(result, { structuredContent: { answer: "bounded result" }, _meta: { costUnits: 23, source: "provider-reported-tokens" } });
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.match(request.options.body, /bounded_readonly_work/);
});

test("DeepSeek function client rejects missing keys and non-read-only calls before network", () => {
  assert.throws(() => createDeepSeekFunctionClient({ apiKey: "", tools: [tool] }), /DEEPSEEK_API_KEY is required/);
  const client = createDeepSeekFunctionClient({ apiKey: "test-key", tools: [tool], fetchImpl: async () => { throw new Error("network should not run"); } });
  return assert.rejects(() => client.callTool({ name: tool.name, arguments: { invocation: { authorization: { allowedEffect: "external", maxEffects: 1 } } } }), /read-only invocations only/);
});

test("DeepSeek function client fails closed on prose or multiple tool calls", async () => {
  const prose = createDeepSeekFunctionClient({ apiKey: "test-key", tools: [tool], fetchImpl: async () => ({ ok: true, status: 200, async json() { return { choices: [{ message: { content: "done" } }] }; } }) });
  await assert.rejects(() => prose.callTool({ name: tool.name, arguments: { invocation: { authorization: { allowedEffect: "read", maxEffects: 0 } } } }), /exactly one function call/);
  const multiple = createDeepSeekFunctionClient({ apiKey: "test-key", tools: [tool], fetchImpl: async () => ({ ok: true, status: 200, async json() { return { choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool.name, arguments: "{}" } }, { type: "function", function: { name: tool.name, arguments: "{}" } }] } }] }; } }) });
  await assert.rejects(() => multiple.callTool({ name: tool.name, arguments: { invocation: { authorization: { allowedEffect: "read", maxEffects: 0 } } } }), /exactly one function call/);
});
