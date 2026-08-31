import test from "node:test";
import assert from "node:assert/strict";
import { assessPromotion, governanceDigest, REVIEW_LEVELS, standingGovernanceQueries, validateGovernedAtom, validateGovernanceBundle } from "../src/index.mjs";

const atom = (overrides = {}) => ({
  id: "contract-review",
  version: 1,
  statement: "Every handoff satisfies the named output contract.",
  reviewLevel: REVIEW_LEVELS.CONTRACT,
  enforcementPoints: ["compile", "invoke"],
  requiredEvidence: ["accepted-output"],
  blastRadius: "low",
  humanFloorRequired: false,
  authorityMode: "NARROW_ONLY",
  status: "ACTIVE",
  ...overrides
});

const bundle = () => ({ version: 1, atoms: [atom()], requiredAtomIds: ["contract-review"], authorityMode: "NARROW_ONLY" });

test("governed atoms are closed, levelled, and enforcement-bound", () => {
  assert.deepEqual(validateGovernedAtom(atom()), atom());
  assert.deepEqual(validateGovernanceBundle(bundle()), bundle());
  assert.match(governanceDigest(bundle()), /^sha256:[a-f0-9]{64}$/);
});

test("standing queries expose missing evidence and composition defects", () => {
  const missing = standingGovernanceQueries({ bundle: bundle(), evidence: [] });
  assert.equal(missing.clean, false);
  assert.deepEqual(missing.unenforcedBindings, [{ atomId: "contract-review", kind: "accepted-output" }]);
  const clean = standingGovernanceQueries({ bundle: bundle(), evidence: [{ atomId: "contract-review", specialistId: "reviewer", kind: "accepted-output", passed: true, workflowDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-1" }] });
  assert.equal(clean.clean, true);
  const defect = standingGovernanceQueries({ bundle: bundle(), evidence: [{ atomId: "contract-review", kind: "composition-defect", passed: true, workflowDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-2" }] });
  assert.equal(defect.compositionDefects.length, 1);
  const unbound = { ...bundle(), atoms: [...bundle().atoms, atom({ id: "unbound-rule", enforcementPoints: [], requiredEvidence: [] })] };
  assert.deepEqual(standingGovernanceQueries({ bundle: unbound, evidence: [] }).unenforcedRules, ["unbound-rule"]);
});

test("promotion is eligible only on measured evidence and never grants authority", () => {
  const governance = { bundle: bundle(), evidence: [{ atomId: "contract-review", kind: "accepted-output", passed: true, workflowDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-1" }] };
  const result = assessPromotion({ specialistId: "reviewer", currentLevel: REVIEW_LEVELS.CONTRACT, targetLevel: REVIEW_LEVELS.DOMAIN, outcomes: { completedRuns: 10, acceptedOutputs: 10, rejectedOutputs: 0, contractViolations: 0, identityMismatches: 0, costOverruns: 0 }, governance, thresholds: { minCompletedRuns: 5, minAcceptanceRate: 0.95 } });
  assert.equal(result.eligible, true);
  assert.equal(result.authorityChange, "FLOOR_APPROVAL_REQUIRED");
  assert.equal(result.humanFloorRequired, false);
});

test("high-blast atoms retain a human floor and weakening evidence fails closed", () => {
  assert.throws(() => validateGovernedAtom(atom({ id: "live-deploy", reviewLevel: REVIEW_LEVELS.EXECUTION, blastRadius: "high", humanFloorRequired: false })), /human floor/);
  const governance = { bundle: bundle(), evidence: [{ atomId: "contract-review", kind: "accepted-output", passed: true, workflowDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-1" }, { atomId: "contract-review", kind: "composition-defect", passed: true, workflowDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", runId: "run-2", details: { acceptanceCriteriaWeakened: true } }] };
  const result = assessPromotion({ specialistId: "reviewer", currentLevel: 1, targetLevel: 2, outcomes: { completedRuns: 10, acceptedOutputs: 10, rejectedOutputs: 0, contractViolations: 0, identityMismatches: 0, costOverruns: 0 }, governance, thresholds: { minCompletedRuns: 5, minAcceptanceRate: 0.95 } });
  assert.equal(result.eligible, false);
});
