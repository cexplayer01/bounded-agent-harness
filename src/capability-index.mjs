import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

export const CAPABILITY_INDEX_FORMAT = "agent-harness.capability-index.v1";
export const CAPABILITY_DESCRIPTOR_FORMAT = "agent-harness.capability-descriptor.v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function text(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, "INVALID_CAPABILITY_INDEX", `${label} must be a non-empty string`);
  return value;
}

function integer(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, "INVALID_CAPABILITY_INDEX", `${label} must be a non-negative integer`);
  return value;
}

function digest(value, label) {
  assert(typeof value === "string" && DIGEST.test(value), "INVALID_CAPABILITY_INDEX", `${label} must be a sha256 digest`);
  return value;
}

function normalizeDescriptor(input) {
  assert(input && typeof input === "object" && !Array.isArray(input), "INVALID_CAPABILITY_INDEX", "capability descriptor must be an object");
  const effects = input.effects ?? [];
  assert(Array.isArray(effects) && effects.every((effect) => typeof effect === "string" && effect.length > 0), "INVALID_CAPABILITY_INDEX", "capability effects must be non-empty strings");
  const result = {
    format: CAPABILITY_DESCRIPTOR_FORMAT,
    id: text(input.id, "capability.id"),
    summary: text(input.summary, "capability.summary"),
    contractId: text(input.contractId, "capability.contractId"),
    authority: text(input.authority, "capability.authority"),
    effects: [...new Set(effects)].sort(),
    payloadDigest: digest(input.payloadDigest, "capability.payloadDigest"),
    estimatedSchemaTokens: integer(input.estimatedSchemaTokens, "capability.estimatedSchemaTokens"),
    loaderKey: text(input.loaderKey ?? input.id, "capability.loaderKey")
  };
  return result;
}

/**
 * Make a small descriptor for a larger capability/tool contract. The payload
 * stays out of the index; hosts load it only after task classification.
 */
export function createCapabilityDescriptor({ id, summary, contractId, authority, effects = [], payload, estimatedSchemaTokens = 0, loaderKey } = {}) {
  assert(payload !== undefined, "CAPABILITY_PAYLOAD_REQUIRED", "capability payload is required to create its digest");
  return normalizeDescriptor({ id, summary, contractId, authority, effects, payloadDigest: `sha256:${sha256(payload)}`, estimatedSchemaTokens, loaderKey });
}

export function buildCapabilityIndex(descriptors) {
  assert(Array.isArray(descriptors), "INVALID_CAPABILITY_INDEX", "capability descriptors must be an array");
  const normalized = descriptors.map(normalizeDescriptor).sort((left, right) => left.id.localeCompare(right.id));
  assert(new Set(normalized.map((item) => item.id)).size === normalized.length, "DUPLICATE_CAPABILITY", "capability IDs must be unique");
  const unsigned = { format: CAPABILITY_INDEX_FORMAT, version: 1, capabilities: normalized };
  return { ...unsigned, digest: `sha256:${sha256(unsigned)}` };
}

export function verifyCapabilityIndex(index) {
  assert(index && index.format === CAPABILITY_INDEX_FORMAT && index.version === 1, "INVALID_CAPABILITY_INDEX", `index must use ${CAPABILITY_INDEX_FORMAT}`);
  assert(Array.isArray(index.capabilities), "INVALID_CAPABILITY_INDEX", "index.capabilities must be an array");
  const normalized = index.capabilities.map(normalizeDescriptor).sort((left, right) => left.id.localeCompare(right.id));
  assert(new Set(normalized.map((item) => item.id)).size === normalized.length, "DUPLICATE_CAPABILITY", "capability IDs must be unique");
  const unsigned = { format: CAPABILITY_INDEX_FORMAT, version: 1, capabilities: normalized };
  assert(index.digest === `sha256:${sha256(unsigned)}`, "CAPABILITY_INDEX_TAMPERED", "capability index digest does not match its contents");
  return { ...unsigned, digest: index.digest };
}

/**
 * Resolve one capability after the caller has decided it is needed. The
 * loaded payload is verified against the descriptor before it is returned.
 */
export async function resolveCapability(index, id, load) {
  const verified = verifyCapabilityIndex(index);
  text(id, "capability.id");
  assert(typeof load === "function", "CAPABILITY_LOADER_REQUIRED", "capability loader is required");
  const descriptor = verified.capabilities.find((item) => item.id === id);
  assert(descriptor, "UNKNOWN_CAPABILITY", `capability ${id} is not present in the index`);
  const payload = await load(descriptor);
  assert(payload !== undefined, "CAPABILITY_PAYLOAD_MISSING", `loader returned no payload for ${id}`);
  assert(`sha256:${sha256(payload)}` === descriptor.payloadDigest, "CAPABILITY_PAYLOAD_DRIFT", `loaded capability ${id} failed its digest check`);
  return { descriptor, payload };
}
