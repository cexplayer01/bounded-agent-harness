import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityIndex, createCapabilityDescriptor, resolveCapability, verifyCapabilityIndex } from "../src/index.mjs";

const payload = { name: "review-tool", input: { contract: "review.v1" }, output: { contract: "review-result.v1" } };

test("capability index is compact, deterministic, and lazily resolves verified payloads", async () => {
  const descriptor = createCapabilityDescriptor({ id: "review", summary: "Review a bounded artifact", contractId: "review.v1", authority: "read.workspace", effects: ["read"], payload, estimatedSchemaTokens: 42 });
  const index = buildCapabilityIndex([descriptor]);
  assert.equal(index.capabilities[0].payload, undefined);
  assert.equal(verifyCapabilityIndex(index).digest, index.digest);
  let loaded = 0;
  const resolved = await resolveCapability(index, "review", async () => { loaded += 1; return payload; });
  assert.equal(loaded, 1);
  assert.deepEqual(resolved.payload, payload);
});

test("capability index rejects payload drift and index tampering", async () => {
  const descriptor = createCapabilityDescriptor({ id: "review", summary: "Review", contractId: "review.v1", authority: "read.workspace", payload });
  const index = buildCapabilityIndex([descriptor]);
  assert.throws(() => verifyCapabilityIndex({ ...index, capabilities: [{ ...index.capabilities[0], authority: "write.workspace" }] }), /digest does not match/);
  await assert.rejects(() => resolveCapability(index, "review", async () => ({ changed: true })), /failed its digest check/);
});
