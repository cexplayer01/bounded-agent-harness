#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpCompatibilityDemo } from "../src/mcp-compatibility-demo.mjs";

const root = await mkdtemp(join(tmpdir(), "agent-harness-mcp-demo-"));
try {
  const demo = await runMcpCompatibilityDemo({ memoryRoot: root });
  console.log(JSON.stringify({
    status: demo.result.status,
    workflowDigest: demo.workflow.digest,
    spentCostUnits: demo.result.spentCostUnits,
    specialists: demo.calls.map((call) => ({ provider: call.provider, stepId: call.handoff.stepId, authority: call.handoff.authority })),
    evidenceEvents: demo.events.length
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
