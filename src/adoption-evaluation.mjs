import { assert } from "./errors.mjs";
import { sha256 } from "./canonical-json.mjs";

export const ADOPTION_EVALUATION_FORMAT = "bounded-agent-harness-adoption-evaluation.v1";
export const ADOPTION_COMPARISON_SET = Object.freeze([
  Object.freeze({ id: "langgraph", name: "LangGraph", evidenceUrl: "https://langchain-ai.github.io/langgraph/" }),
  Object.freeze({ id: "openai-agents-sdk", name: "OpenAI Agents SDK", evidenceUrl: "https://openai.github.io/openai-agents-python/" }),
  Object.freeze({ id: "google-adk", name: "Google ADK", evidenceUrl: "https://google.github.io/adk-docs/" }),
  Object.freeze({ id: "microsoft-agent-framework", name: "Microsoft Agent Framework", evidenceUrl: "https://learn.microsoft.com/agent-framework" }),
  Object.freeze({ id: "crewai", name: "CrewAI", evidenceUrl: "https://docs.crewai.com/" }),
]);
export const ADOPTION_RUBRIC = Object.freeze([
  Object.freeze({ id: "token_efficiency", label: "Token efficiency", weight: 0.15 }),
  Object.freeze({ id: "boundaries", label: "Boundaries and authority", weight: 0.25 }),
  Object.freeze({ id: "recovery", label: "Recovery and resume", weight: 0.20 }),
  Object.freeze({ id: "provider_evidence", label: "Real-provider evidence", weight: 0.15 }),
  Object.freeze({ id: "adoption", label: "Adoption and ecosystem", weight: 0.15 }),
  Object.freeze({ id: "documentation", label: "Documentation and operator path", weight: 0.10 }),
]);

const SUBJECT_ID = "bounded-agent-harness";
const VALID_SYSTEM_IDS = new Set([SUBJECT_ID, ...ADOPTION_COMPARISON_SET.map((entry) => entry.id)]);
const RUBRIC_IDS = new Set(ADOPTION_RUBRIC.map((entry) => entry.id));

function score(value, label) {
  assert(Number.isFinite(value) && value >= 1 && value <= 10, "INVALID_ADOPTION_SCORE", `${label} must be between 1 and 10`);
  return Number(value);
}

function rubricDigest() {
  return sha256(ADOPTION_RUBRIC);
}

function comparisonDigest() {
  return sha256(ADOPTION_COMPARISON_SET);
}

function normalizeDimensions(dimensions, label) {
  assert(dimensions && typeof dimensions === "object" && !Array.isArray(dimensions), "INVALID_ADOPTION_SCORE", `${label} dimensions are required`);
  const keys = Object.keys(dimensions);
  assert(keys.length === ADOPTION_RUBRIC.length && keys.every((key) => RUBRIC_IDS.has(key)), "INVALID_ADOPTION_SCORE", `${label} dimensions must match the fixed rubric`);
  return Object.fromEntries(ADOPTION_RUBRIC.map(({ id }) => [id, score(dimensions[id], `${label}.${id}`)]));
}

function aggregate(dimensions) {
  const raw = ADOPTION_RUBRIC.reduce((total, item) => total + dimensions[item.id] * item.weight, 0);
  return Math.round((raw + Number.EPSILON) * 10) / 10;
}

function orderedSystems(scores) {
  assert(Array.isArray(scores) && scores.length === VALID_SYSTEM_IDS.size, "INVALID_ADOPTION_SCORECARD", "scores must contain the subject and all five comparators");
  const seen = new Set();
  const normalized = scores.map((entry) => {
    assert(entry && typeof entry === "object", "INVALID_ADOPTION_SCORECARD", "each score is an object");
    assert(typeof entry.systemId === "string" && VALID_SYSTEM_IDS.has(entry.systemId), "INVALID_ADOPTION_SCORECARD", `unknown system ${entry.systemId}`);
    assert(!seen.has(entry.systemId), "INVALID_ADOPTION_SCORECARD", `duplicate system ${entry.systemId}`);
    seen.add(entry.systemId);
    const dimensions = normalizeDimensions(entry.dimensions, entry.systemId);
    return { systemId: entry.systemId, dimensions, aggregate: aggregate(dimensions), notes: entry.notes || null };
  });
  assert(seen.has(SUBJECT_ID), "INVALID_ADOPTION_SCORECARD", "bounded-agent-harness score is required");
  for (const comparator of ADOPTION_COMPARISON_SET) assert(seen.has(comparator.id), "INVALID_ADOPTION_SCORECARD", `${comparator.id} score is required`);
  return normalized.sort((a, b) => a.systemId.localeCompare(b.systemId));
}

function summarize(scores) {
  const subject = scores.find((entry) => entry.systemId === SUBJECT_ID);
  const comparators = scores.filter((entry) => entry.systemId !== SUBJECT_ID);
  const comparatorMean = Number((comparators.reduce((sum, entry) => sum + entry.aggregate, 0) / comparators.length).toFixed(2));
  return {
    subjectAggregate: subject.aggregate,
    comparatorMean,
    relativeMargin: Number((subject.aggregate - comparatorMean).toFixed(2)),
    subjectRank: [...scores].sort((a, b) => b.aggregate - a.aggregate || a.systemId.localeCompare(b.systemId)).findIndex((entry) => entry.systemId === SUBJECT_ID) + 1,
  };
}

export function buildAdoptionScorecard({ reviewId, reviewedAt, reviewer = "independent-reviewer", scores, evidence = [] }) {
  assert(typeof reviewId === "string" && reviewId.length > 0, "INVALID_ADOPTION_SCORECARD", "reviewId is required");
  assert(typeof reviewedAt === "string" && reviewedAt.length > 0, "INVALID_ADOPTION_SCORECARD", "reviewedAt is required");
  assert(typeof reviewer === "string" && reviewer.length > 0, "INVALID_ADOPTION_SCORECARD", "reviewer is required");
  assert(Array.isArray(evidence), "INVALID_ADOPTION_SCORECARD", "evidence must be an array");
  const normalizedScores = orderedSystems(scores);
  const payload = {
    format: ADOPTION_EVALUATION_FORMAT,
    version: 1,
    reviewId,
    reviewedAt,
    reviewer,
    comparisonSet: ADOPTION_COMPARISON_SET,
    rubric: ADOPTION_RUBRIC,
    scores: normalizedScores,
    summary: summarize(normalizedScores),
    evidence,
  };
  return { ...payload, digest: `sha256:${sha256(payload)}` };
}

export function verifyAdoptionScorecard(scorecard) {
  assert(scorecard?.format === ADOPTION_EVALUATION_FORMAT, "INVALID_ADOPTION_SCORECARD", "adoption evaluation v1 is required");
  assert(sha256(scorecard.comparisonSet) === comparisonDigest(), "ADOPTION_SURFACE_MISMATCH", "comparison set does not match the fixed review surface");
  assert(sha256(scorecard.rubric) === rubricDigest(), "ADOPTION_SURFACE_MISMATCH", "rubric does not match the fixed review surface");
  const rebuilt = buildAdoptionScorecard(scorecard);
  assert(scorecard.digest === rebuilt.digest, "ADOPTION_SCORECARD_TAMPERED", "adoption scorecard digest does not match its contents");
  return scorecard;
}

export function compareAdoptionScorecards(baseline, after) {
  verifyAdoptionScorecard(baseline);
  verifyAdoptionScorecard(after);
  assert(comparisonDigest() === sha256(after.comparisonSet), "INVALID_ADOPTION_SCORECARD", "comparison set drifted");
  assert(rubricDigest() === sha256(after.rubric), "INVALID_ADOPTION_SCORECARD", "rubric drifted");
  assert(sha256(baseline.comparisonSet) === sha256(after.comparisonSet), "ADOPTION_SURFACE_MISMATCH", "baseline and after comparison sets differ");
  assert(sha256(baseline.rubric) === sha256(after.rubric), "ADOPTION_SURFACE_MISMATCH", "baseline and after rubrics differ");
  const delta = Number((after.summary.relativeMargin - baseline.summary.relativeMargin).toFixed(2));
  return {
    baselineRelativeMargin: baseline.summary.relativeMargin,
    afterRelativeMargin: after.summary.relativeMargin,
    relativeMarginDelta: delta,
    baselineSubjectRank: baseline.summary.subjectRank,
    afterSubjectRank: after.summary.subjectRank,
    comparativeDecline: delta < 0 || after.summary.subjectRank > baseline.summary.subjectRank,
    automaticRollback: delta < 0 || after.summary.subjectRank > baseline.summary.subjectRank,
  };
}
