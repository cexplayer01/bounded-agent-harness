import test from "node:test";
import assert from "node:assert/strict";
import { assignSpecialists, recordSpecialistOutcome, selectSpecialist } from "../src/specialist-router.mjs";

const profile = (id, accepted, rejected, authority = ["read.workspace"]) => ({
  id, version: 1, description: id, strengths: ["bounded review"], limitations: ["read only"],
  capabilities: ["review.code"], authority, adapter: `mcp.${id}`,
  evidence: { completedRuns: accepted + rejected, acceptedOutputs: accepted, rejectedOutputs: rejected }
});

test("routing uses eligibility first and verified outcomes second", () => {
  const result = selectSpecialist({ capability: "review.code", authority: "read.workspace", specialists: [profile("beta", 8, 2), profile("alpha", 3, 0), profile("writer", 99, 0, ["write.workspace"])] });
  assert.equal(result.specialist, "alpha");
  assert.equal(result.basis, "verified-accepted-output-rate");
  assert.deepEqual(result.limitations, ["read only"]);
});

test("unproven specialists are labeled honestly and selection is deterministic", () => {
  const result = selectSpecialist({ capability: "review.code", authority: "read.workspace", specialists: [profile("beta", 0, 0), profile("alpha", 0, 0)] });
  assert.equal(result.specialist, "alpha");
  assert.equal(result.basis, "declared-capability-no-outcome-history");
});

test("automatic assignments preserve an inspectable rationale", () => {
  const plan = { steps: [{ id: "review", specialist: "auto", capability: "review.code", authority: "read.workspace" }] };
  const result = assignSpecialists({ plan, specialists: [profile("reviewer", 2, 0)] });
  assert.equal(result.plan.steps[0].specialist, "reviewer");
  assert.equal(result.assignments[0].stepId, "review");
  assert.equal(plan.steps[0].specialist, "auto");
});

test("routing fails closed when capability and authority do not coexist", () => {
  assert.throws(() => selectSpecialist({ capability: "review.code", authority: "write.workspace", specialists: [profile("reviewer", 2, 0)] }), /no specialist/);
});

test("specialist outcomes update evidence immutably without inventing review results", () => {
  const original = profile("reviewer", 2, 1);
  const accepted = recordSpecialistOutcome(original, "accepted");
  assert.deepEqual(accepted.evidence, { completedRuns: 4, acceptedOutputs: 3, rejectedOutputs: 1 });
  const unreviewed = recordSpecialistOutcome(accepted, "completed-unreviewed");
  assert.deepEqual(unreviewed.evidence, { completedRuns: 5, acceptedOutputs: 3, rejectedOutputs: 1 });
  assert.deepEqual(original.evidence, { completedRuns: 3, acceptedOutputs: 2, rejectedOutputs: 1 });
  assert.throws(() => recordSpecialistOutcome(original, "probably-good"), /outcome must be/);
});
