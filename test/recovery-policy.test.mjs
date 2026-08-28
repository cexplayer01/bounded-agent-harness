import test from "node:test";
import assert from "node:assert/strict";
import { decideRecovery } from "../src/recovery-policy.mjs";

test("read and local failures can retry inside an explicit attempt ceiling", () => {
  assert.deepEqual(decideRecovery({ step: { effect: "read" }, attempts: 1, maxAttempts: 3, failureCode: "TEMPORARY_PROVIDER_FAILURE" }), {
    action: "retry", reason: "no-external-side-effect", nextAttempt: 2, remainingAttempts: 2
  });
});

test("external retries require an idempotency key", () => {
  assert.deepEqual(decideRecovery({ step: { effect: "external" }, attempts: 1, maxAttempts: 3, failureCode: "CONNECTION_LOST" }), {
    action: "owner-review", reason: "ambiguous-external-effect"
  });
  assert.equal(decideRecovery({ step: { effect: "external", idempotencyKey: "stable-key" }, attempts: 1, maxAttempts: 3, failureCode: "CONNECTION_LOST" }).action, "retry");
});

test("policy failures and exhausted attempts park instead of looping", () => {
  assert.deepEqual(decideRecovery({ step: { effect: "read" }, attempts: 1, maxAttempts: 3, failureCode: "CONTRACT_REJECTED" }), {
    action: "park", reason: "non-retryable-policy-failure"
  });
  assert.deepEqual(decideRecovery({ step: { effect: "read" }, attempts: 3, maxAttempts: 3, failureCode: "TEMPORARY_PROVIDER_FAILURE" }), {
    action: "park", reason: "attempt-limit-reached"
  });
});
