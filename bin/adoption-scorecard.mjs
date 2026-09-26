#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildAdoptionScorecard } from "../src/adoption-evaluation.mjs";

const input = process.argv[2] || "examples/adoption-baseline-scorecard.v1.json";
const record = JSON.parse(await readFile(input, "utf8"));
const scorecard = buildAdoptionScorecard(record);
console.log(JSON.stringify({
  valid: true,
  reviewId: scorecard.reviewId,
  digest: scorecard.digest,
  summary: scorecard.summary,
}, null, 2));
