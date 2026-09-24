import { canonicalize } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

export const PROOF_RELEASE_FORMAT = "bounded-agent-harness-proof-release.v1";
export const PROOF_OBSERVATIONS_FORMAT = "bounded-agent-harness-proof-observations.v1";

const CLAIM_STATES = new Set(["CURRENT", "HISTORICAL", "SUPERSEDED"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const keys = (value) => Object.keys(value || {}).sort();
const same = (left, right) => canonicalize(left) === canonicalize(right);

function finding(code, path, message, details = {}) { return { code, path, message, ...details }; }
function requireString(value, path, findings) { if (typeof value !== "string" || !value.trim()) findings.push(finding("REQUIRED_STRING", path, "must be a non-empty string")); }
function requireIso(value, path, findings) {
  requireString(value, path, findings);
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) findings.push(finding("INVALID_TIMESTAMP", path, "must be an ISO-8601 timestamp"));
}

function validateClaim(claim, index, findings) {
  const path = `claims[${index}]`;
  if (!isObject(claim)) { findings.push(finding("INVALID_CLAIM", path, "must be an object")); return; }
  const allowed = new Set(["id", "target", "claim_state", "observed_at", "freshness", "deployment", "expected", "superseded_by"]);
  for (const key of Object.keys(claim)) if (!allowed.has(key)) findings.push(finding("UNKNOWN_CLAIM_FIELD", `${path}.${key}`, "proof claims are closed objects"));
  requireString(claim.id, `${path}.id`, findings);
  requireString(claim.target, `${path}.target`, findings);
  if (!CLAIM_STATES.has(claim.claim_state)) findings.push(finding("INVALID_CLAIM_STATE", `${path}.claim_state`, "must be CURRENT, HISTORICAL, or SUPERSEDED"));
  requireIso(claim.observed_at, `${path}.observed_at`, findings);
  if (!isObject(claim.freshness) || !Number.isInteger(claim.freshness.max_age_seconds) || claim.freshness.max_age_seconds <= 0) findings.push(finding("INVALID_FRESHNESS", `${path}.freshness.max_age_seconds`, "must be a positive integer"));
  if (!isObject(claim.deployment)) findings.push(finding("INVALID_DEPLOYMENT", `${path}.deployment`, "must contain the claimed deployment and rollback IDs"));
  else { requireString(claim.deployment.id, `${path}.deployment.id`, findings); requireString(claim.deployment.rollback_id, `${path}.deployment.rollback_id`, findings); }
  if (!isObject(claim.expected)) findings.push(finding("INVALID_EXPECTED_STATE", `${path}.expected`, "must be an object with exact expected field names"));
  if (claim.claim_state === "SUPERSEDED") requireString(claim.superseded_by, `${path}.superseded_by`, findings);
  if (claim.claim_state !== "SUPERSEDED" && has(claim, "superseded_by")) findings.push(finding("UNEXPECTED_SUPERSEDED_BY", `${path}.superseded_by`, "only SUPERSEDED claims may name a successor"));
}

function validateObservation(observation, index, findings) {
  const path = `observations[${index}]`;
  if (!isObject(observation)) { findings.push(finding("INVALID_OBSERVATION", path, "must be an object")); return; }
  const allowed = new Set(["id", "target", "observed_at", "reconciled_by", "deployment", "observed"]);
  for (const key of Object.keys(observation)) if (!allowed.has(key)) findings.push(finding("UNKNOWN_OBSERVATION_FIELD", `${path}.${key}`, "observations are closed objects"));
  requireString(observation.id, `${path}.id`, findings);
  requireString(observation.target, `${path}.target`, findings);
  requireIso(observation.observed_at, `${path}.observed_at`, findings);
  requireString(observation.reconciled_by, `${path}.reconciled_by`, findings);
  if (!isObject(observation.deployment)) findings.push(finding("INVALID_OBSERVATION_DEPLOYMENT", `${path}.deployment`, "must contain the observed deployment and rollback IDs"));
  else { requireString(observation.deployment.id, `${path}.deployment.id`, findings); requireString(observation.deployment.rollback_id, `${path}.deployment.rollback_id`, findings); }
  if (!isObject(observation.observed)) findings.push(finding("INVALID_OBSERVED_STATE", `${path}.observed`, "must be an object with exact observed field names"));
}

function parseNow(now) { if (now instanceof Date) return now.getTime(); if (typeof now === "number") return now; return Date.parse(now || new Date().toISOString()); }

function evaluateCurrentClaim(claim, observation, index, nowMs, findings) {
  const path = `claims[${index}]`;
  if (!observation) { findings.push(finding("MISSING_OBSERVATION", path, "CURRENT claims require a matching read-only observation")); return { id: claim.id, status: "DRIFT_DETECTED" }; }
  if (claim.target !== observation.target) findings.push(finding("TARGET_MISMATCH", path, "claim and observation target differ", { claim: claim.target, observation: observation.target }));
  if (claim.observed_at !== observation.observed_at) findings.push(finding("CLAIM_OBSERVATION_TIME_MISMATCH", path, "the proof claim must be regenerated from the exact observation timestamp", { claim: claim.observed_at, observation: observation.observed_at }));
  if (!same(claim.deployment, observation.deployment)) findings.push(finding("DEPLOYMENT_DRIFT", path, "claimed deployment or rollback ID differs from the observation", { claim: claim.deployment, observation: observation.deployment }));
  if (!same(claim.expected, observation.observed)) {
    if (!same(keys(claim.expected), keys(observation.observed))) findings.push(finding("FIELD_NAME_MISMATCH", `${path}.expected`, "expected and observed field names must match exactly, including case", { expected: keys(claim.expected), observed: keys(observation.observed) }));
    findings.push(finding("OBSERVED_STATE_MISMATCH", `${path}.expected`, "the observed state differs from the proof claim"));
  }
  const ageSeconds = Math.floor((nowMs - Date.parse(observation.observed_at)) / 1000);
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) findings.push(finding("INVALID_OBSERVATION_TIME", path, "observation time cannot be in the future or invalid"));
  else if (ageSeconds > claim.freshness.max_age_seconds) findings.push(finding("STALE_OBSERVATION", path, "CURRENT proof observation is older than its freshness policy", { age_seconds: ageSeconds, max_age_seconds: claim.freshness.max_age_seconds }));
  return { id: claim.id, status: findings.some((item) => item.path === path || item.path.startsWith(`${path}.`)) ? "DRIFT_DETECTED" : "CURRENT_VERIFIED", age_seconds: ageSeconds, reconciled_by: observation.reconciled_by };
}

export function validateProofRelease(release, observations = []) {
  const findings = [];
  if (!isObject(release)) findings.push(finding("INVALID_RELEASE", "release", "must be an object"));
  else {
    if (release.schema_version !== PROOF_RELEASE_FORMAT) findings.push(finding("INVALID_RELEASE_FORMAT", "schema_version", `must equal ${PROOF_RELEASE_FORMAT}`));
    requireString(release.release_id, "release_id", findings);
    if (!Array.isArray(release.claims) || release.claims.length === 0) findings.push(finding("MISSING_CLAIMS", "claims", "must be a non-empty array"));
    else release.claims.forEach((claim, index) => validateClaim(claim, index, findings));
  }
  if (!Array.isArray(observations)) findings.push(finding("INVALID_OBSERVATIONS", "observations", "must be an array"));
  else observations.forEach((observation, index) => validateObservation(observation, index, findings));
  return { valid: findings.length === 0, findings };
}

export function evaluateProofRelease({ release, observations = [], now = new Date() }) {
  const structural = validateProofRelease(release, observations);
  const findings = [...structural.findings];
  if (!structural.valid) return { valid: false, status: "BLOCKED", claims: [], findings };
  const claimById = new Map();
  const observationById = new Map();
  for (const claim of release.claims) { if (claimById.has(claim.id)) findings.push(finding("DUPLICATE_CLAIM_ID", `claims.${claim.id}`, "claim IDs must be unique")); claimById.set(claim.id, claim); }
  for (const observation of observations) { if (observationById.has(observation.id)) findings.push(finding("DUPLICATE_OBSERVATION_ID", `observations.${observation.id}`, "observation IDs must be unique")); observationById.set(observation.id, observation); if (!claimById.has(observation.id)) findings.push(finding("UNCLAIMED_OBSERVATION", `observations.${observation.id}`, "every observation must correspond to a proof claim")); }
  const nowMs = parseNow(now);
  const claims = release.claims.map((claim, index) => claim.claim_state === "HISTORICAL" || claim.claim_state === "SUPERSEDED" ? { id: claim.id, status: claim.claim_state } : evaluateCurrentClaim(claim, observationById.get(claim.id), index, nowMs, findings));
  return { valid: findings.length === 0, status: findings.length === 0 ? "READY_TO_PUBLISH" : "BLOCKED", claims, findings };
}

export function assertProofRelease(input) {
  const result = evaluateProofRelease(input);
  assert(result.valid, "PROOF_RELEASE_BLOCKED", "proof release is blocked until every CURRENT claim reconciles", result);
  return result;
}
