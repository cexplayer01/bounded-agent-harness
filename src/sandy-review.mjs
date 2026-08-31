import { assert } from "./errors.mjs";

const FORMAT = "agent-harness.sandy-review.v1";
const SEVERITIES = new Set(["info", "low", "medium", "high"]);
const CATEGORIES = new Set(["visual", "ux", "consistency"]);

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function relativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]/).includes(".."), "INVALID_SCOPE", `${label} must be a relative repository path`);
}

function digest(value, label) {
  assert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "INVALID_DIGEST", `${label} must be a SHA-256 digest`);
}

/**
 * Validate the only result shape accepted from the optional Sandy reviewer.
 * This is intentionally read-only: a finding is evidence for a later caller
 * to verify, never a patch or an execution instruction.
 */
export function validateSandyReview(result) {
  closedObject(result, ["format", "version", "status", "reviewerId", "authority", "scope", "findings", "receivedAt"], "Sandy review");
  assert(result.format === FORMAT, "UNSUPPORTED_FORMAT", `Sandy review format must be ${FORMAT}`);
  assert(result.version === 1, "UNSUPPORTED_VERSION", "Sandy review version must be 1");
  assert(["RECEIVED", "UNAVAILABLE"].includes(result.status), "INVALID_STATUS", "Sandy review status must be RECEIVED or UNAVAILABLE");
  assert(result.reviewerId === "sandy-ux-reviewer", "INVALID_REVIEWER", "Sandy review reviewerId is not the declared optional specialist");
  assert(result.authority === "READ_ONLY_REVIEW", "AUTHORITY_ESCALATION", "Sandy review authority is read-only");
  closedObject(result.scope, ["paths", "maxLines", "workflowDigest"], "Sandy review.scope");
  assert(Array.isArray(result.scope.paths) && result.scope.paths.length > 0 && result.scope.paths.length <= 20, "INVALID_SCOPE", "Sandy review.scope.paths must contain 1 to 20 paths");
  result.scope.paths.forEach((path, index) => relativePath(path, `Sandy review.scope.paths[${index}]`));
  assert(Number.isSafeInteger(result.scope.maxLines) && result.scope.maxLines > 0 && result.scope.maxLines <= 300, "INVALID_SCOPE", "Sandy review.scope.maxLines must be between 1 and 300");
  digest(result.scope.workflowDigest, "Sandy review.scope.workflowDigest");
  assert(Array.isArray(result.findings) && result.findings.length <= 20, "INVALID_FINDINGS", "Sandy review.findings must contain at most 20 findings");
  const ids = new Set();
  for (const [index, finding] of result.findings.entries()) {
    closedObject(finding, ["id", "severity", "category", "summary", "evidence", "recommendation"], `Sandy review.findings[${index}]`);
    assert(typeof finding.id === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(finding.id) && !ids.has(finding.id), "INVALID_FINDING", `Sandy review.findings[${index}].id must be a unique stable ID`);
    ids.add(finding.id);
    assert(SEVERITIES.has(finding.severity), "INVALID_FINDING", `${finding.id}.severity is invalid`);
    assert(CATEGORIES.has(finding.category), "INVALID_FINDING", `${finding.id}.category is invalid`);
    for (const key of ["summary", "evidence", "recommendation"]) assert(typeof finding[key] === "string" && finding[key].trim().length > 0, "INVALID_FINDING", `${finding.id}.${key} is required`);
  }
  if (result.status === "UNAVAILABLE") assert(result.findings.length === 0, "INVALID_FINDINGS", "an unavailable Sandy review cannot contain findings");
  if (result.receivedAt !== undefined) assert(typeof result.receivedAt === "string" && !Number.isNaN(Date.parse(result.receivedAt)), "INVALID_TIMESTAMP", "Sandy review.receivedAt must be an ISO timestamp");
  return result;
}

/**
 * Bind a received review to the exact compiled workflow and declared paths.
 * Scope verification is still separate from semantic acceptance: callers must
 * inspect each finding against repository truth before applying it.
 */
export function verifySandyReviewScope({ result, expectedWorkflowDigest, allowedPaths }) {
  validateSandyReview(result);
  digest(expectedWorkflowDigest, "expectedWorkflowDigest");
  assert(Array.isArray(allowedPaths) && allowedPaths.every((path) => typeof path === "string"), "INVALID_SCOPE", "allowedPaths must be a string array");
  if (result.status === "UNAVAILABLE") return { available: false, verified: true, findings: [] };
  assert(result.scope.workflowDigest === expectedWorkflowDigest, "WORKFLOW_DIGEST_MISMATCH", "Sandy review is bound to a different workflow");
  const allowed = new Set(allowedPaths);
  assert(result.scope.paths.every((path) => allowed.has(path)), "SCOPE_ESCALATION", "Sandy review includes a path outside its declared scope");
  return { available: true, verified: true, findings: result.findings.map((finding) => ({ ...finding })) };
}

export { FORMAT as SANDY_REVIEW_FORMAT };
