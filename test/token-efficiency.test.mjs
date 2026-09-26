import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArtifactReference,
  buildContextPacket,
  buildTokenUsageRecord,
  compareTokenEfficiency,
  contextPacketTokenEstimate,
  pruneContextRecords,
  renderContextPacket,
  summarizeTokenUsage,
  verifyContextPacket
} from "../src/index.mjs";

const artifact = buildArtifactReference({ id: "proof", digest: `sha256:${"a".repeat(64)}`, uri: "git:proof.json@abc", contractId: "proof.v1", summary: "Bounded proof artifact" });

test("context packets keep stable and delta sections digest-bound and render deterministically", () => {
  const packet = buildContextPacket({ stable: { authority: "read-only", workflow: "sha256:workflow" }, delta: { changedPaths: ["src/a.mjs"] }, references: [artifact] });
  assert.equal(verifyContextPacket(packet).digest, packet.digest);
  assert.equal(renderContextPacket(packet), renderContextPacket(packet));
  assert.ok(contextPacketTokenEstimate(packet) > 0);
  assert.throws(() => verifyContextPacket({ ...packet, delta: { changedPaths: ["src/b.mjs"] } }), /delta section failed/);
});

test("context pruning preserves required records, reports omissions, and is deterministic", () => {
  const records = [
    { id: "authority", text: "read only", required: true, tokenCount: 2 },
    { id: "small", text: "small evidence", priority: 2, tokenCount: 3 },
    { id: "large", text: "large evidence", priority: 1, tokenCount: 8 }
  ];
  const result = pruneContextRecords(records, { maxTokens: 5 });
  assert.deepEqual(result.selected.map((item) => item.id), ["authority", "small"]);
  assert.deepEqual(result.omitted.map((item) => item.id), ["large"]);
  assert.throws(() => pruneContextRecords(records, { maxTokens: 1 }), /required context records exceed/);
});

test("usage ledger records cache savings and compares accepted work without changing gates", () => {
  const baseline = [buildTokenUsageRecord({ runId: "run", stepId: "build", provider: "test", inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reservedTokens: 150, outcome: "accepted" })];
  const candidate = [buildTokenUsageRecord({ runId: "run", stepId: "build", provider: "test", inputTokens: 60, cachedInputTokens: 30, outputTokens: 20, reservedTokens: 100, outcome: "accepted" })];
  const summary = summarizeTokenUsage(candidate);
  assert.equal(summary[0].savedByCacheTokens, 30);
  const report = compareTokenEfficiency({ baseline, candidate });
  assert.equal(report.delta.totalTokens.saved, 40);
  assert.equal(report.delta.reservedTokens.saved, 50);
  assert.equal(report.baseline.totalTokens, 120);
});
