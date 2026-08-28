import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpCompatibilityDemo } from "../src/mcp-compatibility-demo.mjs";

test("two differentiated MCP providers complete one deterministic workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-demo-"));
  try {
    const demo = await runMcpCompatibilityDemo({ memoryRoot: root });
    assert.equal(demo.result.status, "completed");
    assert.equal(demo.result.spentCostUnits, 5);
    assert.deepEqual(demo.result.outputs.review, { findings: [] });
    assert.deepEqual(demo.calls.map((call) => call.provider), ["research-provider", "review-provider"]);
    const completed = demo.events.filter((event) => event.type === "step.completed");
    assert.deepEqual(completed.map((event) => event.provider.identity), ["pinned", "pinned"]);
    assert.deepEqual(completed.map((event) => event.usageSource), ["provider-reported", "provider-reported"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
