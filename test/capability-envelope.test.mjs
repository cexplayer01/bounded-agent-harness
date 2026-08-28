import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityEnvelope, validateCapabilityEnvelope } from "../src/capability-envelope.mjs";

const step = {
  id: "update-customer",
  capability: "crm.contact.update",
  authority: "tenant.acme.contact.status",
  adapter: "crm",
  effect: "external",
  idempotencyKey: "stable-123"
};

const handoff = {
  runId: "run-1",
  workflowDigest: "sha256:abc",
  stepId: "update-customer",
  capability: "crm.contact.update",
  authority: "tenant.acme.contact.status"
};

test("capability envelope binds step, workflow, adapter, effect, expiry, and idempotency", () => {
  const envelope = buildCapabilityEnvelope({
    runId: "run-1",
    workflowDigest: "sha256:abc",
    step,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  assert.equal(envelope.authorization.maxEffects, 1);
  assert.equal(validateCapabilityEnvelope(envelope, { handoff, adapterId: "crm" }), envelope);
});

test("read-only capability envelopes allow zero effects only", () => {
  const envelope = buildCapabilityEnvelope({
    runId: "run-1",
    workflowDigest: "sha256:abc",
    step: { ...step, id: "read-customer", effect: "read", idempotencyKey: undefined },
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  assert.equal(envelope.authorization.maxEffects, 0);
});

test("capability envelope rejects broad, stale, or mismatched adapter authority", () => {
  const envelope = buildCapabilityEnvelope({
    runId: "run-1",
    workflowDigest: "sha256:abc",
    step,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  assert.throws(
    () => validateCapabilityEnvelope({ ...envelope, authorization: { ...envelope.authorization, maxEffects: 2 } }, { handoff, adapterId: "crm" }),
    (error) => error?.code === "INVALID_CAPABILITY_ENVELOPE"
  );
  assert.throws(
    () => validateCapabilityEnvelope({ ...envelope, authorization: { ...envelope.authorization, expiresAt: "2000-01-01T00:00:00.000Z" } }, { handoff, adapterId: "crm" }),
    (error) => error?.code === "CAPABILITY_EXPIRED"
  );
  assert.throws(
    () => validateCapabilityEnvelope(envelope, { handoff, adapterId: "other-adapter" }),
    (error) => error?.code === "CAPABILITY_MISMATCH"
  );
});
