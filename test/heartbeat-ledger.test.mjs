import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileMemoryStore } from "../src/memory-store.mjs";
import { recordHeartbeat, summarizeHeartbeats } from "../src/heartbeat.mjs";

test("heartbeat ledger tracks liveness and cumulative cost", async () => {
  const root = await mkdtemp(join(tmpdir(), "heartbeat-"));
  try {
    const memory = new FileMemoryStore(root);
    await recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:one", spentCostUnits: 1, at: 1000 });
    await recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:one", spentCostUnits: 2, at: 2000 });
    const alive = summarizeHeartbeats(await memory.events(), { now: 2500, leaseMs: 1000 });
    assert.equal(alive[0].state, "alive");
    assert.equal(alive[0].spentCostUnits, 2);
    const expired = summarizeHeartbeats(await memory.events(), { now: 4000, leaseMs: 1000 });
    assert.equal(expired[0].recoveryRequired, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("heartbeat ledger rejects identity, time, and cost regressions", async () => {
  const root = await mkdtemp(join(tmpdir(), "heartbeat-"));
  try {
    const memory = new FileMemoryStore(root);
    await recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:one", spentCostUnits: 2, at: 2000 });
    await assert.rejects(() => recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:two", spentCostUnits: 2, at: 3000 }), /changed workflow identity/);
    await assert.rejects(() => recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:one", spentCostUnits: 2, at: 1000 }), /backward in time/);
    await assert.rejects(() => recordHeartbeat(memory, { runId: "run-1", workerId: "reviewer", workflowDigest: "sha256:one", spentCostUnits: 1, at: 3000 }), /reduced cumulative cost/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
