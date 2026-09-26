#!/usr/bin/env node
import { createDeepSeekFunctionClient } from "../src/deepseek-function-client.mjs";
import { buildCapabilityEnvelope } from "../src/capability-envelope.mjs";
import { mcpAdapter } from "../src/adapters.mjs";
import { sha256 } from "../src/canonical-json.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
if (!args.prompt) throw new Error("Usage: node bin/deepseek-readonly-probe.mjs --prompt \"one bounded task\" [--max-tokens 512]");

const tool = {
  name: "bounded_readonly_work",
  description: "Return a concise analysis of the supplied task without modifying files, contacting other services, or claiming completion.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      next_step: { type: "string" }
    },
    required: ["answer", "risks", "next_step"]
  }
};
const runId = `deepseek-probe-${Date.now()}`;
const workflowDigest = `sha256:${sha256({ runId, tool: tool.name, prompt: args.prompt })}`;
const step = { id: "deepseek-readonly-probe", capability: "review.readonly", authority: "read.external", adapter: "mcp.deepseek-function", effect: "read" };
const invocation = buildCapabilityEnvelope({ runId, workflowDigest, step, expiresAt: new Date(Date.now() + 300_000).toISOString() });
const client = createDeepSeekFunctionClient({ model: args.model, tools: [tool] });
const adapter = mcpAdapter(client, { server: "deepseek", tool: tool.name, expectedServer: { name: "deepseek-function-calling", version: args.model || process.env.DEEPSEEK_MODEL || "deepseek-flash" } });
const result = await adapter.invoke({
  handoff: { format: "agent-harness.handoff.v1", runId, workflowDigest, stepId: step.id, capability: step.capability, authority: step.authority, adapter: step.adapter },
  invocation,
  input: { task: args.prompt },
  context: {},
  tokenBudget: { maxOutputTokens: Number(args["max-tokens"] || 256) },
  reservedCostUnits: Number(args["budget-tokens"] || 1024),
  now: () => Date.now()
});
console.log(JSON.stringify({ provider: result.provider, usage: result.usage, output: result.output, externalState: "NOT_EXECUTED" }, null, 2));
