import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildCapabilityEnvelope } from "../src/capability-envelope.mjs";
import { canonicalize, sha256 } from "../src/canonical-json.mjs";
import { buildProviderCompatibilityReceipt, providerCompatibilityPayload, verifyProviderCompatibilityReceipt } from "../src/provider-compatibility-proof.mjs";

const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
const workflowDigest = "sha256:" + "a".repeat(64);
const step = { id: "provider-proof", capability: "research.primary-sources", authority: "read.external", adapter: "mcp.research", effect: "read" };
const invocation = buildCapabilityEnvelope({ runId: "proof-run", workflowDigest, step, expiresAt: "2099-01-01T00:00:00.000Z" });
const handoff = { runId: "proof-run", workflowDigest, stepId: step.id, capability: step.capability, authority: step.authority, adapter: step.adapter };
const result = { output: { sources: ["https://example.test/primary"] }, usage: { costUnits: 2, source: "provider-reported" }, provider: { name: "trusted-research", version: "1.0.0", identity: "pinned", assuranceLevel: "configuration-only" } };

function receipt(overrides = {}) {
  return buildProviderCompatibilityReceipt({ sourceCommit, observedAt: "2026-09-26T06:00:00.000Z", runId: "proof-run", workflowDigest, adapterId: step.adapter, server: "research", tool: "find-primary-sources", invocation, handoff, input: { question: "one bounded question" }, context: {}, result, ...overrides });
}

test("synthetic compatibility evidence is valid but never publishable as real-provider proof", () => {
  const verification = verifyProviderCompatibilityReceipt(receipt());
  assert.deepEqual(verification, { valid: true, publishable: false, status: "REHEARSAL_ONLY", findings: [] });
});

test("a trusted host attestation can promote a pinned read-only provider result", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const draft = receipt({ executionMode: "HOST_OBSERVED", attestation: { format: "bounded-agent-harness-provider-compatibility.v1.attestation", keyId: "host-key-1", algorithm: "ed25519", signature: "pending" } });
  const payload = providerCompatibilityPayload(draft);
  const attestation = { format: "bounded-agent-harness-provider-compatibility.v1.attestation", keyId: "host-key-1", algorithm: "ed25519", payloadDigest: "sha256:" + sha256(payload), signature: sign(null, Buffer.from(canonicalize(payload)), privateKey).toString("base64") };
  const verified = verifyProviderCompatibilityReceipt(receipt({ executionMode: "HOST_OBSERVED", attestation }), { trustedPublicKeys: { "host-key-1": publicKey } });
  assert.deepEqual(verified, { valid: true, publishable: true, status: "REAL_PROVIDER_VERIFIED", findings: [] });
});

test("tampering or an unknown trust root blocks external-provider proof", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const draft = receipt({ executionMode: "HOST_OBSERVED", attestation: { format: "bounded-agent-harness-provider-compatibility.v1.attestation", keyId: "host-key-1", algorithm: "ed25519", signature: "pending" } });
  const payload = providerCompatibilityPayload(draft);
  const attestation = { format: "bounded-agent-harness-provider-compatibility.v1.attestation", keyId: "host-key-1", algorithm: "ed25519", payloadDigest: "sha256:" + sha256(payload), signature: sign(null, Buffer.from(canonicalize(payload)), privateKey).toString("base64") };
  const blocked = verifyProviderCompatibilityReceipt({ ...receipt({ executionMode: "HOST_OBSERVED", attestation }), responseDigest: "sha256:" + "b".repeat(64) }, { trustedPublicKeys: {} });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.publishable, false);
  assert.equal(blocked.status, "BLOCKED");
});

test("proof builder rejects any non-read effect", () => {
  assert.throws(() => receipt({ result: { ...result }, invocation: { ...invocation, authorization: { ...invocation.authorization, allowedEffect: "external", maxEffects: 1 } } }), /must use read authority/);
});
