import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContinuationGate, validateReviewRecord } from "../src/continuation-gate.mjs";

const workflowDigest = "sha256:" + "a".repeat(64);
const floorDigest = "sha256:" + "b".repeat(64);
const roles = ["contract", "domain", "consistency", "reconciliation"];
const review = (role, status = "PASS") => ({
  format: "agent-harness.review-record.v1", version: 1, role, reviewerId: `${role}-reviewer`, status,
  workflowDigest, floorDigest, scope: "local continuation", evidence: `${role} evidence`,
  findings: status === "PASS" ? [] : [`${role} defect`], checkedAt: "2026-08-29T00:00:00Z"
});

test("four distinct passing roles permit continuation", () => {
  const result = evaluateContinuationGate({ workflowDigest, floorDigest, reviews: roles.map((role) => review(role)) });
  assert.equal(result.decision, "CONTINUE");
  assert.deepEqual(result.passedRoles, roles);
  assert.deepEqual(result.reasons, []);
});

test("missing, failed, stale, and duplicate reviews escalate", () => {
  const result = evaluateContinuationGate({ workflowDigest, floorDigest, reviews: [review("contract"), review("domain", "FAIL"), { ...review("consistency"), floorDigest: "sha256:" + "c".repeat(64) }, review("contract")] });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.missingRoles, ["reconciliation"]);
  assert.deepEqual(result.duplicateRoles, ["contract"]);
  assert.deepEqual(result.staleRoles, ["consistency"]);
  assert.deepEqual(result.failedRoles, ["domain"]);
});

test("review records are closed and cannot hide findings in a PASS", () => {
  assert.doesNotThrow(() => validateReviewRecord(review("contract")));
  assert.throws(() => validateReviewRecord({ ...review("contract"), extra: true }), /not allowed/);
  assert.throws(() => validateReviewRecord({ ...review("contract"), findings: ["hidden issue"] }), /passing review cannot contain findings/);
  assert.throws(() => validateReviewRecord({ ...review("contract", "FAIL"), findings: [] }), /failing review must identify/);
});
