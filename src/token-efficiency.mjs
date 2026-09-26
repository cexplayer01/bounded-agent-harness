import { estimateTokenCount } from "./token-capacity.mjs";
import { canonicalize, sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

export const CONTEXT_PACKET_FORMAT = "agent-harness.context-packet.v1";
export const CONTEXT_PRUNING_FORMAT = "agent-harness.context-pruning.v1";
export const ARTIFACT_REFERENCE_FORMAT = "agent-harness.artifact-reference.v1";
export const TOKEN_USAGE_FORMAT = "agent-harness.token-usage.v1";
export const TOKEN_EFFICIENCY_REPORT_FORMAT = "agent-harness.token-efficiency-report.v1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OUTCOMES = new Set(["accepted", "rejected", "failed", "unreviewed"]);

function text(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, "INVALID_TOKEN_EFFICIENCY", `${label} must be a non-empty string`);
  return value;
}

function integer(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, "INVALID_TOKEN_EFFICIENCY", `${label} must be a non-negative integer`);
  return value;
}

function digest(value, label) {
  assert(typeof value === "string" && DIGEST.test(value), "INVALID_TOKEN_EFFICIENCY", `${label} must be a sha256 digest`);
  return value;
}

function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TOKEN_EFFICIENCY", `${label} must be an object`);
  return value;
}

function reference(value) {
  object(value, "artifact reference");
  assert(value.format === ARTIFACT_REFERENCE_FORMAT, "INVALID_ARTIFACT_REFERENCE", `artifact reference must use ${ARTIFACT_REFERENCE_FORMAT}`);
  digest(value.digest, "artifact.digest");
  text(value.id, "artifact.id");
  return value;
}

/** A portable pointer to a large artifact; content remains in its source of truth. */
export function buildArtifactReference({ id, digest: artifactDigest, uri, mediaType = "application/json", bytes, contractId, summary } = {}) {
  text(id, "artifact.id");
  digest(artifactDigest, "artifact.digest");
  text(mediaType, "artifact.mediaType");
  if (uri !== undefined) text(uri, "artifact.uri");
  if (bytes !== undefined) integer(bytes, "artifact.bytes");
  if (contractId !== undefined) text(contractId, "artifact.contractId");
  if (summary !== undefined) text(summary, "artifact.summary");
  const result = { format: ARTIFACT_REFERENCE_FORMAT, version: 1, id, digest: artifactDigest, mediaType, ...(uri === undefined ? {} : { uri }), ...(bytes === undefined ? {} : { bytes }), ...(contractId === undefined ? {} : { contractId }), ...(summary === undefined ? {} : { summary }) };
  return Object.freeze(result);
}

/**
 * Build a cache-shaped packet: stable authority/context first, then only the
 * current delta. The digest covers both, so cache optimization cannot become
 * an authority or provenance bypass.
 */
export function buildContextPacket({ stable = {}, delta = {}, references = [], omitted = [] } = {}) {
  object(stable, "context.stable");
  object(delta, "context.delta");
  assert(Array.isArray(references), "INVALID_CONTEXT_PACKET", "context.references must be an array");
  assert(Array.isArray(omitted), "INVALID_CONTEXT_PACKET", "context.omitted must be an array");
  const normalizedReferences = references.map(reference).sort((left, right) => left.id.localeCompare(right.id));
  const normalizedOmitted = omitted.map((item) => {
    object(item, "context.omitted item");
    return { id: text(item.id, "context.omitted.id"), reason: text(item.reason, "context.omitted.reason"), ...(item.digest === undefined ? {} : { digest: digest(item.digest, "context.omitted.digest") }) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const unsigned = { format: CONTEXT_PACKET_FORMAT, version: 1, stable, delta, references: normalizedReferences, omitted: normalizedOmitted };
  return { ...unsigned, stableDigest: `sha256:${sha256(stable)}`, deltaDigest: `sha256:${sha256(delta)}`, digest: `sha256:${sha256(unsigned)}` };
}

export function verifyContextPacket(packet) {
  const rebuilt = buildContextPacket(packet);
  assert(packet.stableDigest === rebuilt.stableDigest, "CONTEXT_STABLE_DRIFT", "context stable section failed its digest check");
  assert(packet.deltaDigest === rebuilt.deltaDigest, "CONTEXT_DELTA_DRIFT", "context delta section failed its digest check");
  assert(packet.digest === rebuilt.digest, "CONTEXT_PACKET_TAMPERED", "context packet digest does not match its contents");
  return rebuilt;
}

/** Render only after verification, preserving stable-prefix then delta order. */
export function renderContextPacket(packet) {
  const verified = verifyContextPacket(packet);
  return JSON.stringify({ stable: verified.stable, delta: verified.delta, references: verified.references, omitted: verified.omitted });
}

/**
 * Deterministically keep required records and the highest-priority optional
 * records that fit. Omitted records are reported; nothing is silently erased.
 */
export function pruneContextRecords(records, { maxTokens, policy = {} } = {}) {
  assert(Array.isArray(records), "INVALID_CONTEXT_RECORDS", "context records must be an array");
  integer(maxTokens, "maxTokens");
  assert(maxTokens > 0, "INVALID_CONTEXT_RECORDS", "maxTokens must be greater than zero");
  const seen = new Set();
  const normalized = records.map((record, index) => {
    object(record, "context record");
    const id = text(record.id, "context record.id");
    assert(!seen.has(id), "DUPLICATE_CONTEXT_RECORD", `context record ${id} is duplicated`);
    seen.add(id);
    const content = text(record.text, `${id}.text`);
    const tokenCount = record.tokenCount === undefined ? estimateTokenCount(content, policy) : integer(record.tokenCount, `${id}.tokenCount`);
    const priority = record.priority === undefined ? 0 : integer(record.priority, `${id}.priority`);
    return { id, text: content, tokenCount, priority, required: record.required === true, index, digest: `sha256:${sha256({ id, text: content })}` };
  });
  const required = normalized.filter((record) => record.required);
  const requiredTokens = required.reduce((sum, record) => sum + record.tokenCount, 0);
  assert(requiredTokens <= maxTokens, "TOKEN_CONTEXT_REQUIRED_OVERFLOW", "required context records exceed the active token budget", { requiredTokens, maxTokens });
  const selectedIds = new Set(required.map((record) => record.id));
  let usedTokens = requiredTokens;
  for (const record of normalized.filter((item) => !item.required).sort((left, right) => right.priority - left.priority || left.tokenCount - right.tokenCount || left.id.localeCompare(right.id))) {
    if (usedTokens + record.tokenCount <= maxTokens) {
      selectedIds.add(record.id);
      usedTokens += record.tokenCount;
    }
  }
  const selected = normalized.filter((record) => selectedIds.has(record.id)).map(({ index: _index, required: _required, ...record }) => record);
  const omitted = normalized.filter((record) => !selectedIds.has(record.id)).map(({ id, tokenCount, digest: recordDigest }) => ({ id, tokenCount, digest: recordDigest, reason: "TOKEN_CONTEXT_BUDGET" }));
  return { format: CONTEXT_PRUNING_FORMAT, version: 1, maxTokens, estimatedTokens: usedTokens, selected, omitted, digest: `sha256:${sha256({ format: CONTEXT_PRUNING_FORMAT, version: 1, maxTokens, selected, omitted })}` };
}

export function buildTokenUsageRecord({ runId, stepId, provider, model, attempt = 1, inputTokens, cachedInputTokens = 0, outputTokens, reasoningTokens = 0, reservedTokens = 0, outcome = "unreviewed", recordedAt } = {}) {
  text(runId, "usage.runId");
  text(stepId, "usage.stepId");
  text(provider, "usage.provider");
  if (model !== undefined) text(model, "usage.model");
  integer(attempt, "usage.attempt");
  assert(attempt > 0, "INVALID_TOKEN_USAGE", "usage.attempt must be greater than zero");
  integer(inputTokens, "usage.inputTokens");
  integer(cachedInputTokens, "usage.cachedInputTokens");
  integer(outputTokens, "usage.outputTokens");
  integer(reasoningTokens, "usage.reasoningTokens");
  integer(reservedTokens, "usage.reservedTokens");
  assert(cachedInputTokens <= inputTokens, "INVALID_TOKEN_USAGE", "cached input tokens cannot exceed input tokens");
  assert(OUTCOMES.has(outcome), "INVALID_TOKEN_USAGE", `unsupported usage outcome ${outcome}`);
  if (recordedAt !== undefined) assert(Number.isFinite(Date.parse(recordedAt)), "INVALID_TOKEN_USAGE", "usage.recordedAt must be an ISO timestamp");
  const result = {
    format: TOKEN_USAGE_FORMAT,
    version: 1,
    runId,
    stepId,
    provider,
    ...(model === undefined ? {} : { model }),
    attempt,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens,
    reasoningTokens,
    reservedTokens,
    totalTokens: inputTokens + outputTokens,
    savedByCacheTokens: cachedInputTokens,
    outcome,
    ...(recordedAt === undefined ? {} : { recordedAt })
  };
  return { ...result, digest: `sha256:${sha256(result)}` };
}

export function summarizeTokenUsage(records) {
  assert(Array.isArray(records), "INVALID_TOKEN_USAGE", "usage records must be an array");
  const runs = new Map();
  for (const record of records) {
    assert(record?.format === TOKEN_USAGE_FORMAT, "INVALID_TOKEN_USAGE", "usage record has an unsupported format");
    assert(record.digest === `sha256:${sha256(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest")))}`, "TOKEN_USAGE_TAMPERED", `usage record ${record.runId}/${record.stepId} failed its digest check`);
    const current = runs.get(record.runId) || { runId: record.runId, calls: 0, retries: 0, inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, reservedTokens: 0, savedByCacheTokens: 0, acceptedCalls: 0, failedCalls: 0 };
    current.calls += 1;
    current.retries += record.attempt > 1 ? 1 : 0;
    for (const field of ["inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens", "reservedTokens", "savedByCacheTokens"]) current[field] += record[field];
    current.acceptedCalls += record.outcome === "accepted" ? 1 : 0;
    current.failedCalls += record.outcome === "failed" ? 1 : 0;
    runs.set(record.runId, current);
  }
  return [...runs.values()].sort((left, right) => left.runId.localeCompare(right.runId));
}

function metricSavings(before, after, field) {
  const base = before[field];
  return { before: base, after: after[field], delta: after[field] - base, saved: base - after[field], percentSaved: base === 0 ? null : (base - after[field]) / base };
}

function aggregateSummary(value) {
  const records = Array.isArray(value) ? value : [value];
  assert(records.length > 0, "INVALID_TOKEN_EFFICIENCY", "usage summary cannot be empty");
  const fields = ["calls", "retries", "inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens", "reservedTokens", "savedByCacheTokens", "acceptedCalls", "failedCalls"];
  return Object.fromEntries(fields.map((field) => [field, records.reduce((sum, item) => sum + (item[field] ?? 0), 0)]));
}

export function compareTokenEfficiency({ baseline, candidate } = {}) {
  const before = aggregateSummary(Array.isArray(baseline) && baseline.every((item) => item?.format === TOKEN_USAGE_FORMAT) ? summarizeTokenUsage(baseline) : baseline);
  const after = aggregateSummary(Array.isArray(candidate) && candidate.every((item) => item?.format === TOKEN_USAGE_FORMAT) ? summarizeTokenUsage(candidate) : candidate);
  assert(before && after, "INVALID_TOKEN_EFFICIENCY", "baseline and candidate usage summaries are required");
  const fields = ["inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "totalTokens", "reservedTokens", "retries"];
  const delta = Object.fromEntries(fields.map((field) => [field, metricSavings(before, after, field)]));
  return { format: TOKEN_EFFICIENCY_REPORT_FORMAT, version: 1, baseline: before, candidate: after, delta, note: "Token savings are observations, not permission to bypass capacity, authority, or approval gates." };
}

export function contextPacketTokenEstimate(packet, policy = {}) {
  return estimateTokenCount(renderContextPacket(packet), policy);
}

export function contextPacketCanonicalText(packet) {
  return canonicalize(verifyContextPacket(packet));
}
