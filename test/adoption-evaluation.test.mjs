import test from "node:test";
import assert from "node:assert/strict";
import { ADOPTION_COMPARISON_SET, ADOPTION_RUBRIC, buildAdoptionScorecard, compareAdoptionScorecards, verifyAdoptionScorecard } from "../src/adoption-evaluation.mjs";

const dimensions = (value) => Object.fromEntries(ADOPTION_RUBRIC.map(({ id }) => [id, value]));
const baselineScores = [
  { systemId: "bounded-agent-harness", dimensions: { token_efficiency: 9, boundaries: 9, recovery: 8, provider_evidence: 3, adoption: 1, documentation: 7 } },
  { systemId: "langgraph", dimensions: dimensions(8) },
  { systemId: "openai-agents-sdk", dimensions: dimensions(7) },
  { systemId: "google-adk", dimensions: dimensions(8) },
  { systemId: "microsoft-agent-framework", dimensions: dimensions(8) },
  { systemId: "crewai", dimensions: dimensions(7) },
];

test("adoption scorecard fixes the five-system comparison surface and weighted rubric", () => {
  assert.equal(ADOPTION_COMPARISON_SET.length, 5);
  assert.ok(Math.abs(ADOPTION_RUBRIC.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
  const scorecard = buildAdoptionScorecard({ reviewId: "baseline", reviewedAt: "2026-09-26T00:00:00.000Z", scores: baselineScores });
  assert.equal(scorecard.summary.subjectAggregate, 6.5);
  assert.equal(scorecard.summary.comparatorMean, 7.6);
  assert.equal(scorecard.summary.relativeMargin, -1.1);
  assert.match(scorecard.digest, /^sha256:[0-9a-f]{64}$/);
  verifyAdoptionScorecard(scorecard);
});

test("scorecard comparisons detect relative decline, not only raw score changes", () => {
  const baseline = buildAdoptionScorecard({ reviewId: "baseline", reviewedAt: "2026-09-26T00:00:00.000Z", scores: baselineScores });
  const after = buildAdoptionScorecard({
    reviewId: "after",
    reviewedAt: "2026-09-27T00:00:00.000Z",
    scores: baselineScores.map((entry) => entry.systemId === "bounded-agent-harness" ? { ...entry, dimensions: { ...entry.dimensions, provider_evidence: 2 } } : entry),
  });
  const comparison = compareAdoptionScorecards(baseline, after);
  assert.equal(comparison.comparativeDecline, true);
  assert.equal(comparison.automaticRollback, true);
  assert.ok(comparison.relativeMarginDelta < 0);
});

test("scorecard comparisons reject a changed comparator set or rubric", () => {
  const scorecard = buildAdoptionScorecard({ reviewId: "baseline", reviewedAt: "2026-09-26T00:00:00.000Z", scores: baselineScores });
  const changed = { ...scorecard, comparisonSet: scorecard.comparisonSet.slice(1) };
  assert.throws(() => verifyAdoptionScorecard(changed), /comparison set/);
  assert.throws(() => compareAdoptionScorecards(scorecard, { ...scorecard, digest: scorecard.digest, comparisonSet: scorecard.comparisonSet.slice(1) }), /comparison set|digest/);
});

test("scorecard rejects scores outside the 1-to-10 scale", () => {
  assert.throws(() => buildAdoptionScorecard({ reviewId: "bad", reviewedAt: "2026-09-26T00:00:00.000Z", scores: baselineScores.map((entry) => entry.systemId === "crewai" ? { ...entry, dimensions: { ...entry.dimensions, adoption: 11 } } : entry) }), /between 1 and 10/);
});
