import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEvents } from "../src/observability.mjs";

test("run summaries expose state, cost variance, provider identity, and failure", () => {
  const provider = { name: "review", version: "1", identity: "pinned" };
  const summaries = summarizeEvents([
    { type: "run.started", runId: "good", workflowDigest: "sha256:a", at: "2026-01-01T00:00:00Z" },
    { type: "step.completed", runId: "good", costUnits: 2, reservedCostUnits: 4, provider, at: "2026-01-01T00:00:01Z" },
    { type: "step.completed", runId: "good", costUnits: 1, reservedCostUnits: 1, provider, at: "2026-01-01T00:00:02Z" },
    { type: "run.completed", runId: "good", at: "2026-01-01T00:00:03Z" },
    { type: "run.started", runId: "bad", workflowDigest: "sha256:b", at: "2026-01-01T00:00:00Z" },
    { type: "run.failed", runId: "bad", code: "CONTRACT_REJECTED", message: "invalid", at: "2026-01-01T00:00:01Z" }
  ]);
  const good = summaries.find((run) => run.runId === "good");
  assert.equal(good.status, "completed");
  assert.equal(good.spentCostUnits, 3);
  assert.equal(good.reservedCostUnits, 5);
  assert.equal(good.savedCostUnits, 2);
  assert.deepEqual(good.providers, [provider]);
  const bad = summaries.find((run) => run.runId === "bad");
  assert.equal(bad.status, "failed");
  assert.equal(bad.failure.code, "CONTRACT_REJECTED");
});

test("run summaries remain deterministic regardless of input run order", () => {
  const summaries = summarizeEvents([
    { type: "run.started", runId: "zeta", at: "2026-01-01T00:00:00Z" },
    { type: "run.started", runId: "alpha", at: "2026-01-01T00:00:00Z" }
  ]);
  assert.deepEqual(summaries.map((run) => run.runId), ["alpha", "zeta"]);
});
