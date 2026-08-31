import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

/**
 * Republic-style review levels. A level describes the review authority that
 * may be delegated; it never grants authority to a specialist by itself.
 */
export const REVIEW_LEVELS = Object.freeze({
  FLOOR: 0,
  CONTRACT: 1,
  DOMAIN: 2,
  CONSISTENCY: 3,
  RECONCILIATION: 4,
  EXECUTION: 5
});

const LEVEL_NAMES = Object.freeze({
  0: "FLOOR",
  1: "CONTRACT",
  2: "DOMAIN",
  3: "CONSISTENCY",
  4: "RECONCILIATION",
  5: "EXECUTION"
});
const ENFORCEMENT_POINTS = new Set(["compile", "authorize", "lease", "invoke", "reconcile"]);
const BLAST_RADII = new Set(["low", "medium", "high"]);
const STATUSES = new Set(["ACTIVE", "SUPERSEDED", "REVOKED"]);
const EVIDENCE_KINDS = new Set([
  "accepted-output",
  "contract-violation",
  "composition-defect",
  "unenforced-binding",
  "identity-mismatch",
  "cost-overrun",
  "reconciliation"
]);

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function stableId(value, label) {
  assert(typeof value === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(value), "INVALID_ID", `${label} is not a stable ID`);
}

function stringArray(value, label) {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string"), "INVALID_TYPE", `${label} must be a string array`);
  assert(new Set(value).size === value.length, "INVALID_TYPE", `${label} must not contain duplicates`);
}

export function levelName(level) {
  assert(Number.isInteger(level) && Object.hasOwn(LEVEL_NAMES, level), "INVALID_REVIEW_LEVEL", "review level must be an integer from 0 through 5");
  return LEVEL_NAMES[level];
}

export function validateGovernedAtom(atom) {
  closedObject(atom, ["id", "version", "statement", "reviewLevel", "enforcementPoints", "requiredEvidence", "blastRadius", "humanFloorRequired", "authorityMode", "status", "supersedes"], "governed atom");
  stableId(atom.id, "governed atom.id");
  assert(atom.version === 1, "UNSUPPORTED_VERSION", "governed atom.version must be 1");
  assert(typeof atom.statement === "string" && atom.statement.trim().length > 0, "INVALID_TYPE", "governed atom.statement is required");
  levelName(atom.reviewLevel);
  assert(Array.isArray(atom.enforcementPoints), "INVALID_TYPE", `${atom.id}.enforcementPoints must be an array`);
  stringArray(atom.enforcementPoints, "governed atom.enforcementPoints");
  for (const point of atom.enforcementPoints) assert(ENFORCEMENT_POINTS.has(point), "INVALID_ENFORCEMENT_POINT", `${atom.id} uses unknown enforcement point ${point}`);
  stringArray(atom.requiredEvidence, "governed atom.requiredEvidence");
  for (const kind of atom.requiredEvidence) assert(EVIDENCE_KINDS.has(kind), "INVALID_EVIDENCE_KIND", `${atom.id} uses unknown evidence kind ${kind}`);
  assert(BLAST_RADII.has(atom.blastRadius), "INVALID_BLAST_RADIUS", `${atom.id}.blastRadius is invalid`);
  assert(typeof atom.humanFloorRequired === "boolean", "INVALID_TYPE", `${atom.id}.humanFloorRequired must be boolean`);
  assert(atom.authorityMode === "NARROW_ONLY", "AUTHORITY_MODE_INVALID", `${atom.id} must use NARROW_ONLY authority`);
  assert(STATUSES.has(atom.status), "INVALID_STATUS", `${atom.id}.status is invalid`);
  if (atom.supersedes !== undefined) stableId(atom.supersedes, `${atom.id}.supersedes`);
  if (atom.reviewLevel === REVIEW_LEVELS.FLOOR || atom.blastRadius === "high") {
    assert(atom.humanFloorRequired === true, "HUMAN_FLOOR_REQUIRED", `${atom.id} must retain a human floor`);
  }
  return atom;
}

export function validateGovernanceEvidence(evidence) {
  closedObject(evidence, ["atomId", "specialistId", "kind", "passed", "workflowDigest", "runId", "details"], "governance evidence");
  stableId(evidence.atomId, "governance evidence.atomId");
  if (evidence.specialistId !== undefined) stableId(evidence.specialistId, "governance evidence.specialistId");
  assert(EVIDENCE_KINDS.has(evidence.kind), "INVALID_EVIDENCE_KIND", `unknown governance evidence kind ${evidence.kind}`);
  assert(typeof evidence.passed === "boolean", "INVALID_TYPE", "governance evidence.passed must be boolean");
  assert(typeof evidence.workflowDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(evidence.workflowDigest), "INVALID_DIGEST", "governance evidence.workflowDigest must be a SHA-256 digest");
  assert(typeof evidence.runId === "string" && evidence.runId.length > 0, "INVALID_TYPE", "governance evidence.runId is required");
  if (evidence.details !== undefined) closedObject(evidence.details, ["message", "acceptanceCriteriaWeakened"], "governance evidence.details");
  if (evidence.details?.acceptanceCriteriaWeakened !== undefined) assert(typeof evidence.details.acceptanceCriteriaWeakened === "boolean", "INVALID_TYPE", "acceptanceCriteriaWeakened must be boolean");
  return evidence;
}

export function validateGovernanceBundle(bundle) {
  closedObject(bundle, ["version", "atoms", "requiredAtomIds", "authorityMode"], "governance bundle");
  assert(bundle.version === 1, "UNSUPPORTED_VERSION", "governance bundle.version must be 1");
  assert(bundle.authorityMode === "NARROW_ONLY", "AUTHORITY_MODE_INVALID", "governance bundle must use NARROW_ONLY authority");
  assert(Array.isArray(bundle.atoms) && bundle.atoms.length > 0, "INVALID_ATOMS", "governance bundle must contain atoms");
  const atoms = bundle.atoms.map(validateGovernedAtom);
  const ids = new Set(atoms.map((atom) => atom.id));
  assert(ids.size === atoms.length, "DUPLICATE_ATOM", "governed atom IDs must be unique");
  assert(Array.isArray(bundle.requiredAtomIds) && bundle.requiredAtomIds.length > 0, "INVALID_ATOMS", "governance bundle must require at least one atom");
  stringArray(bundle.requiredAtomIds, "governance bundle.requiredAtomIds");
  for (const id of bundle.requiredAtomIds) {
    assert(ids.has(id), "UNKNOWN_ATOM", `required governed atom ${id} is missing`);
    const atom = atoms.find((candidate) => candidate.id === id);
    assert(atom.status === "ACTIVE", "INACTIVE_ATOM", `required governed atom ${id} is not active`);
    assert(atom.enforcementPoints.length > 0, "UNENFORCED_RULE", `required governed atom ${id} has no enforcement point`);
  }
  return bundle;
}

/**
 * Standing queries are intentionally pure and queryable. They report gaps;
 * they never grant authority or silently downgrade a human gate.
 */
export function standingGovernanceQueries({ bundle, evidence = [] }) {
  validateGovernanceBundle(bundle);
  assert(Array.isArray(evidence), "INVALID_EVIDENCE", "governance evidence must be an array");
  evidence.forEach(validateGovernanceEvidence);
  const active = bundle.atoms.filter((atom) => atom.status === "ACTIVE");
  const passed = new Map();
  for (const item of evidence) {
    if (!item.passed) continue;
    if (!passed.has(item.atomId)) passed.set(item.atomId, new Set());
    passed.get(item.atomId).add(item.kind);
  }
  const unenforcedRules = active.filter((atom) => atom.enforcementPoints.length === 0).map((atom) => atom.id);
  const unenforcedBindings = active.flatMap((atom) => atom.requiredEvidence.filter((kind) => !passed.get(atom.id)?.has(kind)).map((kind) => ({ atomId: atom.id, kind })));
  const compositionDefects = evidence.filter((item) => item.kind === "composition-defect" && item.passed).map((item) => ({ atomId: item.atomId, specialistId: item.specialistId ?? null, runId: item.runId }));
  return {
    unenforcedRules,
    unenforcedBindings,
    compositionDefects,
    clean: unenforcedRules.length === 0 && unenforcedBindings.length === 0 && compositionDefects.length === 0
  };
}

/**
 * Promotion is an evidence-based recommendation only. The caller must still
 * issue the narrowed capability/approval change; this function never mutates
 * a profile or grants external authority.
 */
export function assessPromotion({ specialistId, currentLevel, targetLevel, outcomes, governance, thresholds }) {
  stableId(specialistId, "specialistId");
  levelName(currentLevel);
  levelName(targetLevel);
  assert(targetLevel >= currentLevel, "LEVEL_REGRESSION", "promotion target must not lower the current review level");
  closedObject(thresholds, ["minCompletedRuns", "minAcceptanceRate"], "promotion thresholds");
  assert(Number.isSafeInteger(thresholds.minCompletedRuns) && thresholds.minCompletedRuns > 0, "INVALID_THRESHOLD", "minCompletedRuns must be positive");
  assert(typeof thresholds.minAcceptanceRate === "number" && thresholds.minAcceptanceRate >= 0 && thresholds.minAcceptanceRate <= 1, "INVALID_THRESHOLD", "minAcceptanceRate must be between 0 and 1");
  closedObject(outcomes, ["completedRuns", "acceptedOutputs", "rejectedOutputs", "contractViolations", "identityMismatches", "costOverruns"], "promotion outcomes");
  for (const key of Object.keys(outcomes)) assert(Number.isSafeInteger(outcomes[key]) && outcomes[key] >= 0, "INVALID_OUTCOMES", `${key} must be a non-negative integer`);
  assert(outcomes.acceptedOutputs + outcomes.rejectedOutputs <= outcomes.completedRuns, "INVALID_OUTCOMES", "accepted and rejected outputs cannot exceed completed runs");
  const standing = standingGovernanceQueries(governance);
  const acceptanceRate = outcomes.completedRuns === 0 ? 0 : outcomes.acceptedOutputs / outcomes.completedRuns;
  const eligible = outcomes.completedRuns >= thresholds.minCompletedRuns
    && acceptanceRate >= thresholds.minAcceptanceRate
    && outcomes.rejectedOutputs === 0
    && outcomes.contractViolations === 0
    && outcomes.identityMismatches === 0
    && outcomes.costOverruns === 0
    && standing.clean;
  return {
    specialistId,
    currentLevel,
    targetLevel,
    targetName: levelName(targetLevel),
    acceptanceRate,
    eligible,
    humanFloorRequired: targetLevel === REVIEW_LEVELS.FLOOR || targetLevel === REVIEW_LEVELS.EXECUTION,
    authorityChange: "FLOOR_APPROVAL_REQUIRED",
    standingQueries: standing
  };
}

export function governanceDigest(bundle) {
  validateGovernanceBundle(bundle);
  return `sha256:${sha256(bundle)}`;
}
