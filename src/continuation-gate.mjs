import { assert } from "./errors.mjs";

const ROLES = new Set(["contract", "domain", "consistency", "reconciliation"]);
const STATUSES = new Set(["PASS", "FAIL"]);

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function digest(value, label) {
  assert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "INVALID_DIGEST", `${label} must be a SHA-256 digest`);
}

function isoTimestamp(value, label) {
  assert(typeof value === "string" && !Number.isNaN(Date.parse(value)), "INVALID_TIMESTAMP", `${label} must be an ISO timestamp`);
}

/** Validate one independent review record. A PASS is evidence, never authority. */
export function validateReviewRecord(record) {
  closedObject(record, ["format", "version", "role", "reviewerId", "status", "workflowDigest", "floorDigest", "scope", "evidence", "findings", "checkedAt"], "review record");
  assert(record.format === "agent-harness.review-record.v1", "UNSUPPORTED_FORMAT", "review record format must be agent-harness.review-record.v1");
  assert(record.version === 1, "UNSUPPORTED_VERSION", "review record version must be 1");
  assert(ROLES.has(record.role), "INVALID_REVIEW_ROLE", `unknown continuation review role ${record.role}`);
  assert(typeof record.reviewerId === "string" && record.reviewerId.length > 0, "INVALID_REVIEWER", "review record reviewerId is required");
  assert(STATUSES.has(record.status), "INVALID_STATUS", "review record status must be PASS or FAIL");
  digest(record.workflowDigest, "review record.workflowDigest");
  digest(record.floorDigest, "review record.floorDigest");
  assert(typeof record.scope === "string" && record.scope.length > 0, "INVALID_SCOPE", "review record scope is required");
  assert(typeof record.evidence === "string" && record.evidence.length > 0, "INVALID_EVIDENCE", "review record evidence is required");
  assert(Array.isArray(record.findings) && record.findings.every((finding) => typeof finding === "string"), "INVALID_FINDINGS", "review record findings must be a string array");
  if (record.status === "PASS") assert(record.findings.length === 0, "INVALID_FINDINGS", "a passing review cannot contain findings");
  assert(record.status === "FAIL" ? record.findings.length > 0 : true, "INVALID_FINDINGS", "a failing review must identify at least one finding");
  isoTimestamp(record.checkedAt, "review record.checkedAt");
  return record;
}

/**
 * Require one PASS from each distinct role, bound to the same workflow and
 * floor digests. Missing, stale, duplicate, or failed reviews escalate.
 */
export function evaluateContinuationGate({ workflowDigest, floorDigest, reviews, requiredRoles = [...ROLES] }) {
  digest(workflowDigest, "workflowDigest");
  digest(floorDigest, "floorDigest");
  assert(Array.isArray(requiredRoles) && requiredRoles.length > 0, "INVALID_REVIEW_ROLES", "requiredRoles must not be empty");
  assert(new Set(requiredRoles).size === requiredRoles.length && requiredRoles.every((role) => ROLES.has(role)), "INVALID_REVIEW_ROLES", "requiredRoles must contain distinct known roles");
  assert(Array.isArray(reviews), "INVALID_REVIEWS", "reviews must be an array");
  const valid = reviews.map(validateReviewRecord);
  const seen = new Set();
  const duplicateRoles = [];
  for (const review of valid) {
    if (seen.has(review.role)) duplicateRoles.push(review.role);
    seen.add(review.role);
  }
  const missingRoles = requiredRoles.filter((role) => !seen.has(role));
  const staleRoles = valid.filter((review) => review.workflowDigest !== workflowDigest || review.floorDigest !== floorDigest).map((review) => review.role);
  const failedRoles = valid.filter((review) => review.status !== "PASS").map((review) => review.role);
  const reasons = [];
  if (missingRoles.length) reasons.push(`missing reviews: ${missingRoles.join(", ")}`);
  if (duplicateRoles.length) reasons.push(`duplicate reviews: ${duplicateRoles.join(", ")}`);
  if (staleRoles.length) reasons.push(`stale reviews: ${staleRoles.join(", ")}`);
  if (failedRoles.length) reasons.push(`failed reviews: ${failedRoles.join(", ")}`);
  return {
    decision: reasons.length === 0 ? "CONTINUE" : "ESCALATE",
    requiredRoles: [...requiredRoles],
    passedRoles: valid.filter((review) => review.status === "PASS" && review.workflowDigest === workflowDigest && review.floorDigest === floorDigest).map((review) => review.role),
    missingRoles,
    duplicateRoles,
    staleRoles,
    failedRoles,
    reasons
  };
}

export { ROLES as CONTINUATION_REVIEW_ROLES };
