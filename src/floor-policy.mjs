import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

const FLOOR_FORMAT = "usb.autonomous-floor.v1";
const EFFECTS = new Set(["read", "local-test", "local-reversible-artifact", "external-effect", "deploy", "dns", "payment", "email-send", "live-database-write", "customer-site-write"]);
const REVIEW_ROLES = new Set(["contract", "domain", "consistency", "reconciliation", "floor", "execution"]);

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function stableId(value, label) {
  assert(typeof value === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(value), "INVALID_ID", `${label} must be a stable ID`);
}

function uniqueStrings(value, label) {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string"), "INVALID_TYPE", `${label} must be a string array`);
  assert(new Set(value).size === value.length, "INVALID_TYPE", `${label} must not contain duplicates`);
}

/** Validate the machine-readable project floor used for autonomous continuation. */
export function validateFloorManifest(floor) {
  closedObject(floor, ["format", "version", "project", "goal", "allowedEffects", "forbiddenEffects", "requiredReviewRoles", "maxCostUnits", "timeoutPolicy", "authorityMode"], "floor manifest");
  assert(floor.format === FLOOR_FORMAT, "UNSUPPORTED_FORMAT", `floor format must be ${FLOOR_FORMAT}`);
  assert(floor.version === 1, "UNSUPPORTED_VERSION", "floor.version must be 1");
  stableId(floor.project, "floor.project");
  assert(typeof floor.goal === "string" && floor.goal.trim().length > 0, "INVALID_TYPE", "floor.goal is required");
  uniqueStrings(floor.allowedEffects, "floor.allowedEffects");
  uniqueStrings(floor.forbiddenEffects, "floor.forbiddenEffects");
  for (const effect of [...floor.allowedEffects, ...floor.forbiddenEffects]) assert(EFFECTS.has(effect), "INVALID_EFFECT", `floor uses unknown effect ${effect}`);
  assert(floor.allowedEffects.length > 0, "INVALID_EFFECT", "floor.allowedEffects must not be empty");
  assert(floor.allowedEffects.every((effect) => !floor.forbiddenEffects.includes(effect)), "CONTRADICTORY_FLOOR", "an effect cannot be both allowed and forbidden");
  uniqueStrings(floor.requiredReviewRoles, "floor.requiredReviewRoles");
  assert(floor.requiredReviewRoles.length > 0, "INVALID_REVIEW_ROLES", "floor.requiredReviewRoles must not be empty");
  for (const role of floor.requiredReviewRoles) assert(REVIEW_ROLES.has(role), "INVALID_REVIEW_ROLE", `floor uses unknown review role ${role}`);
  assert(Number.isSafeInteger(floor.maxCostUnits) && floor.maxCostUnits > 0, "INVALID_BUDGET", "floor.maxCostUnits must be a positive integer");
  closedObject(floor.timeoutPolicy, ["forkAfterMinutes", "localOnly"], "floor.timeoutPolicy");
  assert(Number.isSafeInteger(floor.timeoutPolicy.forkAfterMinutes) && floor.timeoutPolicy.forkAfterMinutes > 0 && floor.timeoutPolicy.forkAfterMinutes <= 1440, "INVALID_TIMEOUT", "floor.timeoutPolicy.forkAfterMinutes must be between 1 and 1440");
  assert(typeof floor.timeoutPolicy.localOnly === "boolean", "INVALID_TIMEOUT", "floor.timeoutPolicy.localOnly must be boolean");
  assert(floor.authorityMode === "NARROW_ONLY", "AUTHORITY_MODE_INVALID", "floor must use NARROW_ONLY authority");
  return floor;
}

export function floorDigest(floor) {
  validateFloorManifest(floor);
  return `sha256:${sha256(floor)}`;
}

function requiredEffects(plan) {
  return new Set(plan.steps.map((step) => step.effect === "read" ? "read" : step.effect === "local" ? "local-reversible-artifact" : "external-effect"));
}

/** Reject a plan that exceeds the declared project floor before compilation. */
export function assertPlanWithinFloor({ plan, floor }) {
  validateFloorManifest(floor);
  assert(plan?.budget && Number.isSafeInteger(plan.budget.maxCostUnits), "INVALID_BUDGET", "plan budget is required before floor evaluation");
  assert(plan.budget.maxCostUnits <= floor.maxCostUnits, "FLOOR_BUDGET_EXCEEDED", `plan budget ${plan.budget.maxCostUnits} exceeds floor ${floor.maxCostUnits}`);
  for (const effect of requiredEffects(plan)) {
    const permitted = effect === "local-reversible-artifact"
      ? floor.allowedEffects.includes("local-reversible-artifact") || floor.allowedEffects.includes("local-test")
      : floor.allowedEffects.includes(effect);
    assert(permitted && !floor.forbiddenEffects.includes(effect), "FLOOR_EFFECT_FORBIDDEN", `floor does not permit ${effect}`);
  }
  if (floor.timeoutPolicy.localOnly) assert([...requiredEffects(plan)].every((effect) => ["read", "local-reversible-artifact"].includes(effect)), "FLOOR_NOT_LOCAL_ONLY", "localOnly floor cannot compile an external-effect plan");
  return plan;
}

export { FLOOR_FORMAT as FLOOR_MANIFEST_FORMAT };
