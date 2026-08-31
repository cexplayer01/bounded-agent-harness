import test from "node:test";
import assert from "node:assert/strict";
import { createContinuationFork, resolveContinuationFork, validateContinuationFork } from "../src/continuation-fork.mjs";

const floor = { format: "usb.autonomous-floor.v1", version: 1, project: "usb-website-platform", goal: "local work", allowedEffects: ["read", "local-test", "local-reversible-artifact"], forbiddenEffects: ["deploy", "dns", "payment"], requiredReviewRoles: ["contract", "domain", "consistency", "reconciliation"], maxCostUnits: 8, timeoutPolicy: { forkAfterMinutes: 30, localOnly: true }, authorityMode: "NARROW_ONLY" };
const inputs = { parentRunId: "run-1", parentWorkflowDigest: "sha256:" + "a".repeat(64), checkpointDigest: "sha256:" + "b".repeat(64), floor };

test("timeout fork is deterministic, local-only, and separately budgeted", () => {
  const first = createContinuationFork({ ...inputs, now: new Date("2026-08-29T01:00:00Z") });
  const second = createContinuationFork({ ...inputs, now: new Date("2026-08-29T02:00:00Z"), existingForks: [first.fork] });
  assert.equal(first.created, true);
  assert.equal(first.fork.status, "RUNNABLE");
  assert.equal(first.fork.parentStatus, "PAUSED_FOR_OWNER");
  assert.equal(first.fork.authorityCeiling, "local-reversible-only");
  assert.equal(first.fork.modelPolicy, "lowest-reasonable-within-budget");
  assert.equal(first.fork.budget.maxCostUnits, 4);
  assert.equal(second.created, false);
  assert.deepEqual(second.fork, first.fork);
});

test("fork requires local-only floor and rejects tampering", () => {
  assert.throws(() => createContinuationFork({ ...inputs, floor: { ...floor, timeoutPolicy: { ...floor.timeoutPolicy, localOnly: false } } }), /localOnly floor/);
  const { fork } = createContinuationFork(inputs);
  assert.throws(() => validateContinuationFork({ ...fork, authorityCeiling: "deploy" }), /local-reversible-only/);
  assert.throws(() => validateContinuationFork({ ...fork, parentStatus: "RUNNING" }), /paused for owner/);
});

test("owner fork decisions are explicit and reversible", () => {
  const { fork } = createContinuationFork(inputs);
  assert.equal(resolveContinuationFork({ fork, decision: "ACCEPT" }).status, "ACCEPTED");
  assert.equal(resolveContinuationFork({ fork, decision: "REJECT" }).status, "REJECTED");
  assert.equal(resolveContinuationFork({ fork, decision: "RESUME_PARENT" }).status, "PARENT_RESUMED");
  assert.throws(() => resolveContinuationFork({ fork, decision: "MERGE" }), /decision must be/);
});
