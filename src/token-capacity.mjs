import { assert } from "./errors.mjs";
import { canonicalize } from "./canonical-json.mjs";

export const TOKEN_CAPACITY_FORMAT = "agent-harness.token-capacity.v1";

export const DEFAULT_TOKEN_CAPACITY_POLICY = Object.freeze({
  charsPerToken: 4,
  safetyMarginRatio: 0.2,
  minimumHeadroomTokens: 256,
  redZoneTokens: 4_096,
  maxObservationAgeMs: 120_000
});

function nonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, "INVALID_TOKEN_CAPACITY", `${label} must be a non-negative integer`);
}

function positiveNumber(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value > 0, "INVALID_TOKEN_CAPACITY", `${label} must be a positive number`);
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), "INVALID_TOKEN_CAPACITY", `${label} must be an ISO timestamp`);
  return parsed;
}

function normalizedPolicy(policy = {}) {
  const result = { ...DEFAULT_TOKEN_CAPACITY_POLICY, ...policy };
  positiveNumber(result.charsPerToken, "policy.charsPerToken");
  assert(typeof result.safetyMarginRatio === "number" && Number.isFinite(result.safetyMarginRatio) && result.safetyMarginRatio >= 0, "INVALID_TOKEN_CAPACITY", "policy.safetyMarginRatio must be a non-negative number");
  nonNegativeInteger(result.minimumHeadroomTokens, "policy.minimumHeadroomTokens");
  nonNegativeInteger(result.redZoneTokens, "policy.redZoneTokens");
  nonNegativeInteger(result.maxObservationAgeMs, "policy.maxObservationAgeMs");
  return result;
}

/**
 * Estimate tokens without pretending that a provider tokenizer is available.
 * The byte-based estimate plus a safety margin is intentionally conservative;
 * provider adapters may replace it with an observed/provider-specific count.
 */
export function estimateTokenCount(text, policy = {}) {
  assert(typeof text === "string", "INVALID_TOKEN_INPUT", "text must be a string");
  const normalized = normalizedPolicy(policy);
  const raw = Math.ceil(Buffer.byteLength(text, "utf8") / normalized.charsPerToken);
  return Math.ceil(raw * (1 + normalized.safetyMarginRatio));
}

/**
 * Build the upper-bound token reservation for one provider request.
 * maxOutputTokens is required so an agent cannot start an unbounded response.
 */
export function estimateTokenRequest({ prompt, request, promptTokens, maxOutputTokens, reserveTokens = 0 }, policy = {}) {
  const normalized = normalizedPolicy(policy);
  assert(prompt !== undefined || request !== undefined || promptTokens !== undefined, "TOKEN_PROMPT_REQUIRED", "prompt, request, or promptTokens is required");
  if (promptTokens !== undefined) nonNegativeInteger(promptTokens, "promptTokens");
  assert(prompt === undefined || typeof prompt === "string", "INVALID_TOKEN_INPUT", "prompt must be a string");
  if (request !== undefined) assert(request && typeof request === "object", "INVALID_TOKEN_INPUT", "request must be an object or array");
  nonNegativeInteger(maxOutputTokens, "maxOutputTokens");
  assert(maxOutputTokens > 0, "TOKEN_RESPONSE_BUDGET_REQUIRED", "maxOutputTokens must be greater than zero");
  nonNegativeInteger(reserveTokens, "reserveTokens");

  const source = promptTokens !== undefined
    ? "provider-estimate"
    : prompt !== undefined
      ? "conservative-text-estimate"
      : "conservative-structured-estimate";
  const estimatedPromptTokens = promptTokens ?? estimateTokenCount(prompt ?? canonicalize(request), normalized);
  return {
    format: TOKEN_CAPACITY_FORMAT,
    estimatedPromptTokens,
    reservedResponseTokens: maxOutputTokens,
    reserveTokens,
    requiredTokens: estimatedPromptTokens + maxOutputTokens + reserveTokens,
    promptSource: source,
    estimator: source === "provider-estimate" ? "provider-supplied" : "utf8-byte-heuristic-v1"
  };
}

function validateAvailability(availability) {
  assert(availability && typeof availability === "object" && !Array.isArray(availability), "INVALID_TOKEN_CAPACITY", "availability must be an object");
  assert(typeof availability.provider === "string" && availability.provider.length > 0, "INVALID_TOKEN_CAPACITY", "availability.provider is required");
  assert(typeof availability.windowId === "string" && availability.windowId.length > 0, "INVALID_TOKEN_CAPACITY", "availability.windowId is required");
  if (availability.remainingTokens !== null && availability.remainingTokens !== undefined) nonNegativeInteger(availability.remainingTokens, "availability.remainingTokens");
  if (availability.windowTokens !== undefined) {
    nonNegativeInteger(availability.windowTokens, "availability.windowTokens");
    assert(availability.windowTokens > 0, "INVALID_TOKEN_CAPACITY", "availability.windowTokens must be greater than zero");
  }
  if (availability.redZoneTokens !== undefined) nonNegativeInteger(availability.redZoneTokens, "availability.redZoneTokens");
  const observedAt = timestamp(availability.observedAt, "availability.observedAt");
  const resetsAt = timestamp(availability.resetsAt, "availability.resetsAt");
  return { ...availability, observedAt, resetsAt };
}

/**
 * Decide whether a request may begin. The caller must obtain availability
 * from the provider/account host; this function never guesses a quota.
 */
export function evaluateTokenCapacity({ availability, request, policy = {}, now = Date.now() }) {
  const normalized = normalizedPolicy(policy);
  const observed = validateAvailability(availability);
  const estimate = estimateTokenRequest(request, normalized);
  nonNegativeInteger(now, "now");
  const redZoneTokens = observed.redZoneTokens ?? (observed.windowTokens
    ? Math.max(normalized.redZoneTokens, Math.ceil(observed.windowTokens * 0.1))
    : normalized.redZoneTokens);
  const redZone = observed.remainingTokens === null || observed.remainingTokens === undefined
    ? true
    : observed.remainingTokens <= redZoneTokens;
  const stale = now - observed.observedAt > normalized.maxObservationAgeMs;
  const resetPassed = observed.resetsAt <= now;
  const error = (code, reason) => ({
    format: TOKEN_CAPACITY_FORMAT,
    decision: "ERROR",
    status: stale || resetPassed ? "UNKNOWN" : redZone ? "RED" : "GREEN",
    code,
    reason,
    provider: observed.provider,
    windowId: observed.windowId,
    observedAt: new Date(observed.observedAt).toISOString(),
    resetsAt: new Date(observed.resetsAt).toISOString(),
    remainingTokens: observed.remainingTokens ?? null,
    redZoneTokens,
    redZone,
    estimate
  });

  if (stale) return error("TOKEN_CAPACITY_STALE", "provider capacity observation is older than the freshness window");
  if (resetPassed) return error("TOKEN_CAPACITY_REFRESH_REQUIRED", "provider capacity window has reset and must be re-read");
  if (observed.remainingTokens === null || observed.remainingTokens === undefined) return error("TOKEN_CAPACITY_UNKNOWN", "provider did not report remaining token capacity");

  const requiredWithHeadroom = estimate.requiredTokens + normalized.minimumHeadroomTokens;
  if (observed.remainingTokens < estimate.requiredTokens) return error("TOKEN_CAPACITY_INSUFFICIENT", "request prompt, response ceiling, and reserve exceed remaining capacity");
  if (observed.remainingTokens < requiredWithHeadroom) return error("TOKEN_HEADROOM_INSUFFICIENT", "request fits only by consuming the protected capacity headroom");

  return {
    format: TOKEN_CAPACITY_FORMAT,
    decision: "CONTINUE",
    status: redZone ? "RED" : "GREEN",
    code: redZone ? "TOKEN_CAPACITY_RED_ZONE" : "TOKEN_CAPACITY_AVAILABLE",
    reason: redZone ? "request fits inside the red zone with protected headroom" : "request fits with protected headroom",
    provider: observed.provider,
    windowId: observed.windowId,
    observedAt: new Date(observed.observedAt).toISOString(),
    resetsAt: new Date(observed.resetsAt).toISOString(),
    remainingTokens: observed.remainingTokens,
    remainingAfterReservation: observed.remainingTokens - estimate.requiredTokens,
    redZoneTokens,
    redZone,
    estimate
  };
}

/**
 * Wrap a provider adapter so capacity is checked immediately before its call.
 * The host supplies the account/window reader and may replace the structured
 * request estimate with a provider-specific prompt/token estimate.
 */
export function withTokenCapacityGate(adapter, { readCapacity, reserveCapacity, requestFromInvocation, policy = {}, now = Date.now } = {}) {
  assert(typeof adapter?.invoke === "function", "INVALID_ADAPTER", "adapter must expose invoke(request)");
  assert(typeof readCapacity === "function", "TOKEN_CAPACITY_READER_REQUIRED", "readCapacity(request) is required");
  assert(typeof reserveCapacity === "function", "TOKEN_CAPACITY_RESERVATION_REQUIRED", "reserveCapacity(request) is required");
  const buildRequest = requestFromInvocation || ((request) => ({
    request: { handoff: request.handoff, invocation: request.invocation, input: request.input, context: request.context },
    ...request.tokenBudget
  }));
  assert(typeof buildRequest === "function", "INVALID_TOKEN_CAPACITY", "requestFromInvocation must be a function");
  return {
    async invoke(request) {
      const availability = await readCapacity(request);
      const tokenRequest = await buildRequest(request);
      const decision = evaluateTokenCapacity({ availability, request: tokenRequest, policy, now: typeof now === "function" ? now() : now });
      assert(decision.decision === "CONTINUE", decision.code, decision.reason, { capacity: decision });
      const reservation = await reserveCapacity({ availability, request: tokenRequest, decision });
      assert(typeof reservation?.reservationId === "string" && reservation.reservationId.length > 0, "TOKEN_CAPACITY_RESERVATION_FAILED", "reserveCapacity must return a reservationId");
      return adapter.invoke({ ...request, tokenCapacity: decision, tokenReservation: reservation });
    }
  };
}
