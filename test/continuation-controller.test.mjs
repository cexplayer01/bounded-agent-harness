import test from "node:test";
import assert from "node:assert/strict";
import { decideContinuation } from "../src/continuation-controller.mjs";
import { floorDigest as manifestDigest } from "../src/floor-policy.mjs";

const workflowDigest = "sha256:" + "a".repeat(64);
const checkpointDigest = "sha256:" + "c".repeat(64);
const floor = { format: "usb.autonomous-floor.v1", version: 1, project: "usb-website-platform", goal: "local work", allowedEffects: ["read", "local-test", "local-reversible-artifact"], forbiddenEffects: ["deploy", "dns", "payment"], requiredReviewRoles: ["contract", "domain", "consistency", "reconciliation"], maxCostUnits: 8, timeoutPolicy: { forkAfterMinutes: 30, localOnly: true }, authorityMode: "NARROW_ONLY" };
const reviews = ["contract", "domain", "consistency", "reconciliation"].map((role) => ({ format: "agent-harness.review-record.v1", version: 1, role, reviewerId: `${role}-reviewer`, status: "PASS", workflowDigest, floorDigest: manifestDigest(floor), scope: "local continuation", evidence: `${role} evidence`, findings: [], checkedAt: "2026-08-29T00:00:00Z" }));

test("controller continues mainline when owner is available and reviews pass", () => {
  const result = decideContinuation({ workflowDigest, floor, reviews, ownerAvailable: true, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:01:00Z", parentRunId: "run-1", checkpointDigest, riskClass: "A" });
  assert.equal(result.decision, "CONTINUE_MAIN");
  assert.equal(result.model.selectedTier, "standard");
});

test("controller waits before timeout and creates one economy fork after timeout", () => {
  const first = decideContinuation({ workflowDigest, floor, reviews, ownerAvailable: false, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:10:00Z", parentRunId: "run-1", checkpointDigest, riskClass: "B" });
  assert.equal(first.decision, "WAIT_OWNER");
  const second = decideContinuation({ workflowDigest, floor, reviews, ownerAvailable: false, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:31:00Z", parentRunId: "run-1", checkpointDigest, riskClass: "B" });
  assert.equal(second.decision, "CONTINUE_FORK");
  assert.equal(second.model.selectedTier, "economy");
  const repeat = decideContinuation({ workflowDigest, floor, reviews, ownerAvailable: false, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:32:00Z", parentRunId: "run-1", checkpointDigest, existingForks: [second.fork], riskClass: "B" });
  assert.equal(repeat.forkCreated, false);
  assert.equal(repeat.fork.id, second.fork.id);
});

test("controller escalates on review disagreement or high-blast work", () => {
  const failed = reviews.map((review) => review.role === "domain" ? { ...review, status: "FAIL", findings: ["defect"] } : review);
  assert.equal(decideContinuation({ workflowDigest, floor, reviews: failed, ownerAvailable: false, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T01:00:00Z", parentRunId: "run-1", checkpointDigest, riskClass: "B" }).decision, "ESCALATE_OWNER");
  assert.equal(decideContinuation({ workflowDigest, floor, reviews, ownerAvailable: false, lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T01:00:00Z", parentRunId: "run-1", checkpointDigest, riskClass: "C" }).decision, "ESCALATE_OWNER");
});
