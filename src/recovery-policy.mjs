import { assert } from "./errors.mjs";

const NEVER_RETRY = new Set([
  "AUTHORITY_ESCALATION",
  "BUDGET_EXCEEDED",
  "CONTRACT_REJECTED",
  "CONTRACT_REGISTRY_MISMATCH",
  "MCP_IDENTITY_MISMATCH",
  "STEP_COST_EXCEEDED"
]);

export function decideRecovery({ step, attempts, maxAttempts, failureCode }) {
  assert(step && typeof step === "object", "INVALID_RECOVERY_INPUT", "step is required");
  assert(Number.isSafeInteger(attempts) && attempts >= 1, "INVALID_RECOVERY_INPUT", "attempts must be a positive integer");
  assert(Number.isSafeInteger(maxAttempts) && maxAttempts >= 1, "INVALID_RECOVERY_INPUT", "maxAttempts must be a positive integer");
  assert(typeof failureCode === "string" && failureCode.length > 0, "INVALID_RECOVERY_INPUT", "failureCode is required");
  if (NEVER_RETRY.has(failureCode)) return { action: "park", reason: "non-retryable-policy-failure" };
  if (step.effect === "external" && !step.idempotencyKey) return { action: "owner-review", reason: "ambiguous-external-effect" };
  if (attempts >= maxAttempts) return { action: "park", reason: "attempt-limit-reached" };
  return {
    action: "retry",
    reason: step.effect === "external" ? "idempotency-key-present" : "no-external-side-effect",
    nextAttempt: attempts + 1,
    remainingAttempts: maxAttempts - attempts
  };
}
