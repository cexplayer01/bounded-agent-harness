import test from "node:test";
import assert from "node:assert/strict";
import { validateSandyReview, verifySandyReviewScope } from "../src/sandy-review.mjs";

const digest = "sha256:" + "a".repeat(64);
const review = {
  format: "agent-harness.sandy-review.v1",
  version: 1,
  status: "RECEIVED",
  reviewerId: "sandy-ux-reviewer",
  authority: "READ_ONLY_REVIEW",
  scope: { paths: ["src/site/index.html"], maxLines: 300, workflowDigest: digest },
  findings: [{ id: "contrast-check", severity: "medium", category: "visual", summary: "Check contrast.", evidence: "Scoped screenshot.", recommendation: "Confirm against source and accessibility tests." }]
};

test("Sandy results are closed, bounded, and read-only", () => {
  assert.equal(validateSandyReview(review), review);
  const verified = verifySandyReviewScope({ result: review, expectedWorkflowDigest: digest, allowedPaths: ["src/site/index.html"] });
  assert.equal(verified.verified, true);
  assert.equal(verified.findings[0].id, "contrast-check");
});

test("scope binding rejects a stale workflow or undeclared path", () => {
  assert.throws(() => verifySandyReviewScope({ result: review, expectedWorkflowDigest: "sha256:" + "b".repeat(64), allowedPaths: ["src/site/index.html"] }), /different workflow/);
  assert.throws(() => verifySandyReviewScope({ result: review, expectedWorkflowDigest: digest, allowedPaths: ["src/site/other.html"] }), /outside its declared scope/);
});

test("unavailable Sandy is an explicit non-blocking outcome", () => {
  const unavailable = { ...review, status: "UNAVAILABLE", findings: [] };
  const result = verifySandyReviewScope({ result: unavailable, expectedWorkflowDigest: digest, allowedPaths: ["src/site/index.html"] });
  assert.deepEqual(result, { available: false, verified: true, findings: [] });
});

test("unknown fields and broad paths fail closed", () => {
  assert.throws(() => validateSandyReview({ ...review, extra: true }), /not allowed/);
  assert.throws(() => validateSandyReview({ ...review, scope: { ...review.scope, paths: ["C:\\repo\\secret"] } }), /relative repository path/);
});
