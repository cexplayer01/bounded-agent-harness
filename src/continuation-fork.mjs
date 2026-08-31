import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";
import { floorDigest, validateFloorManifest } from "./floor-policy.mjs";

const FORK_FORMAT = "agent-harness.continuation-fork.v1";
const STATUSES = new Set(["RUNNABLE", "PENDING_OWNER_REVIEW", "REJECTED", "ACCEPTED", "PARENT_RESUMED"]);

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function digest(value, label) {
  assert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "INVALID_DIGEST", `${label} must be a SHA-256 digest`);
}

function identifier(value, label) {
  assert(typeof value === "string" && /^[a-zA-Z0-9._:-]{1,120}$/.test(value), "INVALID_ID", `${label} must be a bounded identifier`);
}

export function validateContinuationFork(fork) {
  closedObject(fork, ["format", "version", "id", "parentRunId", "parentWorkflowDigest", "checkpointDigest", "floorDigest", "reason", "authorityCeiling", "modelPolicy", "budget", "parentStatus", "status", "createdAt"], "continuation fork");
  assert(fork.format === FORK_FORMAT, "UNSUPPORTED_FORMAT", `fork format must be ${FORK_FORMAT}`);
  assert(fork.version === 1, "UNSUPPORTED_VERSION", "fork.version must be 1");
  identifier(fork.id, "fork.id");
  identifier(fork.parentRunId, "fork.parentRunId");
  digest(fork.parentWorkflowDigest, "fork.parentWorkflowDigest");
  digest(fork.checkpointDigest, "fork.checkpointDigest");
  digest(fork.floorDigest, "fork.floorDigest");
  assert(fork.reason === "OWNER_TIMEOUT", "INVALID_FORK_REASON", "fork reason must be OWNER_TIMEOUT");
  assert(fork.authorityCeiling === "local-reversible-only", "AUTHORITY_ESCALATION", "fork authority ceiling must remain local-reversible-only");
  assert(fork.modelPolicy === "lowest-reasonable-within-budget", "MODEL_POLICY_INVALID", "fork model policy is invalid");
  closedObject(fork.budget, ["maxCostUnits"], "fork.budget");
  assert(Number.isSafeInteger(fork.budget.maxCostUnits) && fork.budget.maxCostUnits > 0, "INVALID_BUDGET", "fork budget must be a positive integer");
  assert(fork.parentStatus === "PAUSED_FOR_OWNER", "INVALID_FORK_STATE", "parent must remain paused for owner while forked");
  assert(STATUSES.has(fork.status), "INVALID_FORK_STATE", `unknown fork status ${fork.status}`);
  assert(typeof fork.createdAt === "string" && !Number.isNaN(Date.parse(fork.createdAt)), "INVALID_TIMESTAMP", "fork.createdAt must be an ISO timestamp");
  return fork;
}

/**
 * Create one deterministic local-only continuation fork. Repeating the same
 * timeout/checkpoint returns the existing fork instead of spawning another.
 */
export function createContinuationFork({ parentRunId, parentWorkflowDigest, checkpointDigest, floor, now = new Date(), existingForks = [] }) {
  identifier(parentRunId, "parentRunId");
  digest(parentWorkflowDigest, "parentWorkflowDigest");
  digest(checkpointDigest, "checkpointDigest");
  validateFloorManifest(floor);
  assert(floor.timeoutPolicy.localOnly, "FORK_NOT_LOCAL_ONLY", "automatic forks require a localOnly floor");
  assert(Array.isArray(existingForks), "INVALID_FORKS", "existingForks must be an array");
  existingForks.forEach(validateContinuationFork);
  const targetFloorDigest = floorDigest(floor);
  const duplicate = existingForks.find((fork) => fork.parentRunId === parentRunId && fork.parentWorkflowDigest === parentWorkflowDigest && fork.checkpointDigest === checkpointDigest && fork.floorDigest === targetFloorDigest);
  if (duplicate) return { fork: structuredClone(duplicate), created: false };
  const key = { parentRunId, parentWorkflowDigest, checkpointDigest, floorDigest: targetFloorDigest };
  const id = `fork-${sha256(key).slice(0, 24)}`;
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const fork = validateContinuationFork({
    format: FORK_FORMAT,
    version: 1,
    id,
    parentRunId,
    parentWorkflowDigest,
    checkpointDigest,
    floorDigest: targetFloorDigest,
    reason: "OWNER_TIMEOUT",
    authorityCeiling: "local-reversible-only",
    modelPolicy: "lowest-reasonable-within-budget",
    budget: { maxCostUnits: Math.max(1, Math.floor(floor.maxCostUnits / 2)) },
    parentStatus: "PAUSED_FOR_OWNER",
    status: "RUNNABLE",
    createdAt
  });
  return { fork, created: true };
}

/** Owner decisions are explicit and never merge or resume implicitly. */
export function resolveContinuationFork({ fork, decision }) {
  validateContinuationFork(fork);
  assert(["ACCEPT", "REJECT", "RESUME_PARENT"].includes(decision), "INVALID_FORK_DECISION", "decision must be ACCEPT, REJECT, or RESUME_PARENT");
  const resolved = structuredClone(fork);
  resolved.status = decision === "ACCEPT" ? "ACCEPTED" : decision === "REJECT" ? "REJECTED" : "PARENT_RESUMED";
  return validateContinuationFork(resolved);
}

export { FORK_FORMAT as CONTINUATION_FORK_FORMAT };
