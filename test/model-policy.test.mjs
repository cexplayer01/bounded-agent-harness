import test from "node:test";
import assert from "node:assert/strict";
import { selectModelTier } from "../src/model-policy.mjs";

test("forks downgrade local/reversible work to the economy tier", () => {
  const result = selectModelTier({ riskClass: "B", requestedTier: "frontier", fork: true, maxCostUnits: 1 });
  assert.deepEqual(result, { decision: "CONTINUE", selectedTier: "economy", reason: "FORK_LOWEST_REASONABLE", riskClass: "B", fork: true, estimatedCostUnits: 1, maxCostUnits: 1 });
});

test("non-fork local work may use the requested tier within budget", () => {
  assert.equal(selectModelTier({ riskClass: "A", requestedTier: "standard", maxCostUnits: 2 }).selectedTier, "standard");
  assert.throws(() => selectModelTier({ riskClass: "A", requestedTier: "frontier", maxCostUnits: 2 }), /exceeds the available budget/);
});

test("high-blast classes always escalate and cannot be downgraded", () => {
  assert.deepEqual(selectModelTier({ riskClass: "C", requestedTier: "economy", fork: false, maxCostUnits: 1 }), { decision: "ESCALATE", selectedTier: null, reason: "HUMAN_FLOOR_REQUIRED", riskClass: "C", fork: false, estimatedCostUnits: 0, maxCostUnits: 1 });
  assert.throws(() => selectModelTier({ riskClass: "D", fork: true, maxCostUnits: 1 }), /limited to Class A\/B/);
});

test("invalid tiers and classes fail closed", () => {
  assert.throws(() => selectModelTier({ riskClass: "A", requestedTier: "tiny", maxCostUnits: 1 }), /requestedTier/);
  assert.throws(() => selectModelTier({ riskClass: "X", maxCostUnits: 1 }), /riskClass/);
});
