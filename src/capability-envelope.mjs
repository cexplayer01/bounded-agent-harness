import { assert } from "./errors.mjs";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function text(value, label) {
  assert(typeof value === "string" && value.length > 0, "INVALID_CAPABILITY_ENVELOPE", `${label} is required`);
  return value;
}

export function buildCapabilityEnvelope({ runId, workflowDigest, step, attempt = 1, expiresAt }) {
  text(runId, "runId");
  text(workflowDigest, "workflowDigest");
  assert(step && typeof step === "object", "INVALID_CAPABILITY_ENVELOPE", "step is required");
  assert(Number.isSafeInteger(attempt) && attempt >= 1, "INVALID_CAPABILITY_ENVELOPE", "attempt must be a positive integer");
  text(expiresAt, "expiresAt");

  return {
    format: "agent-harness.adapter-invocation.v1",
    runId,
    stepId: text(step.id, "step.id"),
    attempt,
    workflowDigest,
    authorization: {
      allowedCapability: text(step.capability, "step.capability"),
      allowedAuthority: text(step.authority, "step.authority"),
      allowedAdapter: text(step.adapter, "step.adapter"),
      allowedEffect: text(step.effect, "step.effect"),
      maxEffects: step.effect === "read" ? 0 : 1,
      expiresAt
    },
    idempotencyKey: step.idempotencyKey
  };
}

export function validateCapabilityEnvelope(envelope, { handoff, adapterId, now = () => Date.now() } = {}) {
  assert(envelope?.format === "agent-harness.adapter-invocation.v1", "INVALID_CAPABILITY_ENVELOPE", "adapter invocation envelope v1 is required");
  text(envelope.runId, "envelope.runId");
  text(envelope.stepId, "envelope.stepId");
  text(envelope.workflowDigest, "envelope.workflowDigest");
  assert(Number.isSafeInteger(envelope.attempt) && envelope.attempt >= 1, "INVALID_CAPABILITY_ENVELOPE", "envelope.attempt must be a positive integer");
  assert(envelope.authorization && typeof envelope.authorization === "object" && !Array.isArray(envelope.authorization), "INVALID_CAPABILITY_ENVELOPE", "authorization is required");
  const auth = envelope.authorization;
  for (const key of Object.keys(auth)) {
    assert(["allowedCapability", "allowedAuthority", "allowedAdapter", "allowedEffect", "maxEffects", "expiresAt"].includes(key), "INVALID_CAPABILITY_ENVELOPE", `authorization.${key} is not allowed`);
  }
  text(auth.allowedCapability, "authorization.allowedCapability");
  text(auth.allowedAuthority, "authorization.allowedAuthority");
  text(auth.allowedAdapter, "authorization.allowedAdapter");
  assert(["read", "local", "external"].includes(auth.allowedEffect), "INVALID_CAPABILITY_ENVELOPE", "authorization.allowedEffect must be read, local, or external");
  assert(Number.isSafeInteger(auth.maxEffects) && auth.maxEffects >= 0 && auth.maxEffects <= 1, "INVALID_CAPABILITY_ENVELOPE", "authorization.maxEffects must be 0 or 1");
  assert(typeof auth.expiresAt === "string" && ISO_INSTANT.test(auth.expiresAt), "INVALID_CAPABILITY_ENVELOPE", "authorization.expiresAt must be an ISO instant");
  assert(Date.parse(auth.expiresAt) > now(), "CAPABILITY_EXPIRED", "adapter invocation envelope is expired");

  if (handoff) {
    assert(envelope.runId === handoff.runId, "CAPABILITY_MISMATCH", "envelope runId does not match handoff");
    assert(envelope.stepId === handoff.stepId, "CAPABILITY_MISMATCH", "envelope stepId does not match handoff");
    assert(envelope.workflowDigest === handoff.workflowDigest, "CAPABILITY_MISMATCH", "envelope workflowDigest does not match handoff");
    assert(auth.allowedCapability === handoff.capability, "CAPABILITY_MISMATCH", "envelope capability does not match handoff");
    assert(auth.allowedAuthority === handoff.authority, "CAPABILITY_MISMATCH", "envelope authority does not match handoff");
  }
  if (adapterId) assert(auth.allowedAdapter === adapterId, "CAPABILITY_MISMATCH", "envelope adapter does not match invocation adapter");
  if (auth.allowedEffect === "read") assert(auth.maxEffects === 0, "CAPABILITY_MISMATCH", "read-only invocations must allow zero effects");
  if (auth.allowedEffect === "external") assert(typeof envelope.idempotencyKey === "string" && envelope.idempotencyKey.length >= 8, "CAPABILITY_MISMATCH", "external invocations require an idempotency key");
  return envelope;
}
