import { assert } from "./errors.mjs";

const ID = /^[a-z][a-z0-9._-]{1,79}$/;

function closedObject(value, allowed, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_TYPE", `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), "UNKNOWN_FIELD", `${label}.${key} is not allowed`);
}

function id(value, label) {
  assert(typeof value === "string" && ID.test(value), "INVALID_ID", `${label} is not a valid stable ID`);
}

function strings(value, label) {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string"), "INVALID_TYPE", `${label} must be a string array`);
}

export function validateSpecialist(profile) {
  closedObject(profile, ["id", "version", "description", "strengths", "limitations", "capabilities", "authority", "adapter", "evidence"], "specialist");
  id(profile.id, "specialist.id");
  assert(profile.version === 1, "UNSUPPORTED_VERSION", "specialist.version must be 1");
  assert(typeof profile.description === "string" && profile.description.length > 0, "INVALID_TYPE", "specialist.description is required");
  strings(profile.strengths, "specialist.strengths");
  strings(profile.limitations, "specialist.limitations");
  strings(profile.capabilities, "specialist.capabilities");
  strings(profile.authority, "specialist.authority");
  id(profile.adapter, "specialist.adapter");
  closedObject(profile.evidence, ["completedRuns", "acceptedOutputs", "rejectedOutputs"], "specialist.evidence");
  for (const key of ["completedRuns", "acceptedOutputs", "rejectedOutputs"]) assert(Number.isSafeInteger(profile.evidence[key]) && profile.evidence[key] >= 0, "INVALID_EVIDENCE", `specialist.evidence.${key} must be a non-negative integer`);
  assert(profile.evidence.acceptedOutputs + profile.evidence.rejectedOutputs <= profile.evidence.completedRuns, "INVALID_EVIDENCE", "specialist evidence outcomes cannot exceed completed runs");
  return profile;
}

export function validatePlan(plan) {
  closedObject(plan, ["id", "version", "objective", "budget", "steps"], "plan");
  id(plan.id, "plan.id");
  assert(plan.version === 1, "UNSUPPORTED_VERSION", "plan.version must be 1");
  assert(typeof plan.objective === "string" && plan.objective.length > 0, "INVALID_TYPE", "plan.objective is required");
  closedObject(plan.budget, ["maxCostUnits"], "plan.budget");
  assert(Number.isSafeInteger(plan.budget.maxCostUnits) && plan.budget.maxCostUnits >= 0, "INVALID_BUDGET", "budget.maxCostUnits must be a non-negative integer");
  assert(Array.isArray(plan.steps) && plan.steps.length > 0, "INVALID_STEPS", "plan.steps must not be empty");
  const seen = new Set();
  for (const [index, step] of plan.steps.entries()) {
    closedObject(step, ["id", "specialist", "capability", "authority", "dependsOn", "contextProjection", "input", "inputContract", "outputContract", "costUnits", "effect", "idempotencyKey", "approval"], `plan.steps[${index}]`);
    id(step.id, `plan.steps[${index}].id`);
    assert(!seen.has(step.id), "DUPLICATE_STEP", `duplicate step ${step.id}`);
    seen.add(step.id);
    id(step.specialist, `${step.id}.specialist`);
    id(step.capability, `${step.id}.capability`);
    id(step.authority, `${step.id}.authority`);
    strings(step.dependsOn, `${step.id}.dependsOn`);
    assert(step.contextProjection && typeof step.contextProjection === "object" && !Array.isArray(step.contextProjection), "INVALID_CONTEXT_PROJECTION", `${step.id}.contextProjection must be an object`);
    for (const [dependency, fields] of Object.entries(step.contextProjection)) {
      assert(step.dependsOn.includes(dependency), "INVALID_CONTEXT_PROJECTION", `${step.id} projects undeclared dependency ${dependency}`);
      strings(fields, `${step.id}.contextProjection.${dependency}`);
      assert(new Set(fields).size === fields.length, "INVALID_CONTEXT_PROJECTION", `${step.id}.contextProjection.${dependency} contains duplicate fields`);
    }
    assert(step.dependsOn.every((dependency) => Object.hasOwn(step.contextProjection, dependency)), "INVALID_CONTEXT_PROJECTION", `${step.id} must explicitly project every dependency`);
    id(step.outputContract, `${step.id}.outputContract`);
    id(step.inputContract, `${step.id}.inputContract`);
    assert(Number.isSafeInteger(step.costUnits) && step.costUnits >= 0, "INVALID_COST", `${step.id}.costUnits must be a non-negative integer`);
    assert(step.input && typeof step.input === "object" && !Array.isArray(step.input), "INVALID_INPUT", `${step.id}.input must be an object`);
    assert(["read", "local", "external"].includes(step.effect), "INVALID_EFFECT", `${step.id}.effect must be read, local, or external`);
    if (step.effect === "external") {
      assert(typeof step.idempotencyKey === "string" && step.idempotencyKey.length >= 8, "IDEMPOTENCY_REQUIRED", `${step.id} requires a stable idempotencyKey`);
    } else {
      assert(step.idempotencyKey === undefined, "UNEXPECTED_IDEMPOTENCY_KEY", `${step.id} may not declare idempotencyKey for a non-external effect`);
    }
    if (step.approval !== undefined) {
      closedObject(step.approval, ["required", "gateId"], `${step.id}.approval`);
      assert(step.approval.required === true, "INVALID_APPROVAL_GATE", `${step.id}.approval.required must be true when declared`);
      id(step.approval.gateId, `${step.id}.approval.gateId`);
    }
  }
  return plan;
}
