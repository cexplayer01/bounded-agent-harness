import { verify as verifySignature } from "node:crypto";
import { assert } from "./errors.mjs";
import { canonicalize, sha256 } from "./canonical-json.mjs";

export const PROVIDER_COMPATIBILITY_FORMAT = "bounded-agent-harness-provider-compatibility.v1";
export const PROVIDER_COMPATIBILITY_EXECUTION_MODES = Object.freeze(["SYNTHETIC_REHEARSAL", "HOST_OBSERVED"]);

const SOURCE_COMMIT = /^[0-9a-f]{40}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function text(value, label) {
  assert(typeof value === "string" && value.length > 0, "INVALID_PROVIDER_PROOF", `${label} is required`);
  return value;
}

function digest(value, label) {
  assert(typeof value === "string" && DIGEST.test(value), "INVALID_PROVIDER_PROOF", `${label} must be a sha256 digest`);
  return value;
}

function taggedDigest(value) {
  return `sha256:${sha256(value)}`;
}

function providerRecord(provider) {
  assert(provider && typeof provider === "object", "INVALID_PROVIDER_PROOF", "provider result is required");
  return {
    name: text(provider.name, "provider.name"),
    version: provider.version ?? null,
    identity: text(provider.identity, "provider.identity"),
    assuranceLevel: text(provider.assuranceLevel, "provider.assuranceLevel")
  };
}

function usageRecord(usage) {
  assert(usage && Number.isSafeInteger(usage.costUnits) && usage.costUnits >= 0, "INVALID_PROVIDER_PROOF", "provider usage must contain non-negative integer costUnits");
  return { costUnits: usage.costUnits, source: text(usage.source, "usage.source") };
}

function payloadFrom(receipt) {
  const { attestation: _attestation, receiptDigest: _receiptDigest, ...payload } = receipt;
  return payload;
}

export function providerCompatibilityPayload(receipt) {
  assert(receipt && typeof receipt === "object", "INVALID_PROVIDER_PROOF", "receipt is required");
  return payloadFrom(receipt);
}

export function buildProviderCompatibilityReceipt({
  sourceCommit,
  observedAt,
  runId,
  workflowDigest,
  adapterId,
  server,
  tool,
  invocation,
  handoff,
  input = null,
  context = null,
  result,
  executionMode = "SYNTHETIC_REHEARSAL",
  attestation = null
}) {
  assert(typeof sourceCommit === "string" && SOURCE_COMMIT.test(sourceCommit), "INVALID_PROVIDER_PROOF", "sourceCommit must be a full Git commit SHA");
  assert(typeof observedAt === "string" && ISO_INSTANT.test(observedAt), "INVALID_PROVIDER_PROOF", "observedAt must be an ISO instant");
  text(runId, "runId");
  digest(workflowDigest, "workflowDigest");
  text(adapterId, "adapterId");
  text(server, "server");
  text(tool, "tool");
  assert(PROVIDER_COMPATIBILITY_EXECUTION_MODES.includes(executionMode), "INVALID_PROVIDER_PROOF", `unsupported executionMode ${executionMode}`);
  assert(invocation?.authorization?.allowedEffect === "read", "PROVIDER_PROOF_NOT_READ_ONLY", "provider proof must use read authority");
  assert(invocation.authorization.maxEffects === 0, "PROVIDER_PROOF_NOT_READ_ONLY", "provider proof must allow zero effects");
  const provider = providerRecord(result?.provider);
  if (executionMode === "HOST_OBSERVED") {
    assert(provider.identity === "pinned", "PROVIDER_PROOF_IDENTITY_REQUIRED", "host-observed proof requires a pinned provider identity");
    assert(attestation && attestation.format === `${PROVIDER_COMPATIBILITY_FORMAT}.attestation`, "INVALID_PROVIDER_PROOF", "host-observed proof requires a signed attestation");
    assert(attestation.algorithm === "ed25519", "INVALID_PROVIDER_PROOF", "provider attestation must use ed25519");
    text(attestation.keyId, "attestation.keyId");
    text(attestation.signature, "attestation.signature");
  } else {
    assert(attestation === null, "INVALID_PROVIDER_PROOF", "synthetic rehearsal cannot carry a host attestation");
  }
  const receipt = {
    format: PROVIDER_COMPATIBILITY_FORMAT,
    version: 1,
    executionMode,
    status: executionMode === "HOST_OBSERVED" ? "ATTESTATION_PENDING" : "REHEARSAL_ONLY",
    sourceCommit: sourceCommit.toLowerCase(),
    observedAt,
    runId,
    workflowDigest,
    adapterId,
    server,
    tool,
    boundary: {
      capability: text(invocation.authorization.allowedCapability, "authorization.allowedCapability"),
      authority: text(invocation.authorization.allowedAuthority, "authorization.allowedAuthority"),
      effect: "read",
      maxEffects: 0
    },
    provider,
    requestDigest: taggedDigest({ handoff, invocation, input, context }),
    responseDigest: taggedDigest({ output: result?.output, provider, usage: result?.usage }),
    usage: usageRecord(result?.usage),
    attestation: executionMode === "HOST_OBSERVED" ? { ...attestation } : null,
  };
  if (executionMode === "HOST_OBSERVED") {
    const payloadDigest = taggedDigest(providerCompatibilityPayload(receipt));
    if (attestation.payloadDigest !== undefined) assert(attestation.payloadDigest === payloadDigest, "INVALID_PROVIDER_PROOF", "attestation payloadDigest does not match the proof payload");
    receipt.attestation.payloadDigest = payloadDigest;
  }
  receipt.receiptDigest = taggedDigest(receipt);
  return receipt;
}

function finding(code, message) {
  return { code, message };
}

export function verifyProviderCompatibilityReceipt(receipt, { trustedPublicKeys = {} } = {}) {
  try {
    assert(receipt?.format === PROVIDER_COMPATIBILITY_FORMAT, "INVALID_PROVIDER_PROOF", `receipt format must be ${PROVIDER_COMPATIBILITY_FORMAT}`);
    assert(receipt.version === 1, "INVALID_PROVIDER_PROOF", "receipt version must be 1");
    assert(receipt.status === (receipt.executionMode === "HOST_OBSERVED" ? "ATTESTATION_PENDING" : "REHEARSAL_ONLY"), "INVALID_PROVIDER_PROOF", "receipt status does not match execution mode");
    digest(receipt.workflowDigest, "workflowDigest");
    digest(receipt.requestDigest, "requestDigest");
    digest(receipt.responseDigest, "responseDigest");
    digest(receipt.receiptDigest, "receiptDigest");
    assert(receipt.receiptDigest === taggedDigest({ ...receipt, receiptDigest: undefined }), "PROVIDER_PROOF_DIGEST_MISMATCH", "receiptDigest does not match the receipt");
    assert(receipt.boundary?.effect === "read" && receipt.boundary?.maxEffects === 0, "PROVIDER_PROOF_NOT_READ_ONLY", "provider proof is not read-only");
    if (receipt.executionMode === "SYNTHETIC_REHEARSAL") {
      return { valid: true, publishable: false, status: "REHEARSAL_ONLY", findings: [] };
    }
    assert(receipt.provider?.identity === "pinned", "PROVIDER_PROOF_IDENTITY_REQUIRED", "host-observed proof requires a pinned provider identity");
    const attestation = receipt.attestation;
    assert(attestation?.format === `${PROVIDER_COMPATIBILITY_FORMAT}.attestation`, "PROVIDER_PROOF_ATTESTATION_MISSING", "signed host attestation is required");
    assert(attestation.algorithm === "ed25519", "PROVIDER_PROOF_ATTESTATION_UNSUPPORTED", "only ed25519 attestations are supported");
    const publicKey = trustedPublicKeys[attestation.keyId];
    assert(publicKey, "PROVIDER_PROOF_TRUST_ROOT_MISSING", `no trusted public key is configured for ${attestation.keyId}`);
    const payload = providerCompatibilityPayload(receipt);
    assert(attestation.payloadDigest === taggedDigest(payload), "PROVIDER_PROOF_DIGEST_MISMATCH", "attestation payload digest does not match the receipt");
    const verified = verifySignature(null, Buffer.from(canonicalize(payload)), publicKey, Buffer.from(attestation.signature, "base64"));
    assert(verified, "PROVIDER_PROOF_SIGNATURE_INVALID", "provider attestation signature is invalid");
    return { valid: true, publishable: true, status: "REAL_PROVIDER_VERIFIED", findings: [] };
  } catch (error) {
    return {
      valid: false,
      publishable: false,
      status: "BLOCKED",
      findings: [finding(error.code || "PROVIDER_PROOF_INVALID", error.message)]
    };
  }
}
