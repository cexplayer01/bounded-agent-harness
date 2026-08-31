import { assert } from "./errors.mjs";
import { createContinuationFork } from "./continuation-fork.mjs";
import { evaluateContinuationGate } from "./continuation-gate.mjs";
import { floorDigest, validateFloorManifest } from "./floor-policy.mjs";
import { selectModelTier } from "./model-policy.mjs";
import { ownerTimeoutWatchdog } from "./owner-timeout-watchdog.mjs";

function timestamp(value, label) {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  assert(Number.isFinite(parsed), "INVALID_TIMESTAMP", `${label} must be a valid timestamp`);
  return parsed;
}

/**
 * Compose the optional autonomous path without performing I/O or invoking a
 * model. The caller persists the returned decision and executes it through
 * the existing workflow runtime only after its normal gates pass.
 */
export function decideContinuation({ workflowDigest, floor, reviews, ownerAvailable, lastOwnerPromptAt, now = Date.now(), parentRunId, checkpointDigest, existingForks = [], riskClass, requestedTier = "standard" }) {
  validateFloorManifest(floor);
  assert(typeof ownerAvailable === "boolean", "INVALID_OWNER_STATE", "ownerAvailable must be boolean");
  assert(typeof parentRunId === "string" && parentRunId.length > 0, "INVALID_ID", "parentRunId is required");
  const targetFloorDigest = floorDigest(floor);
  const gate = evaluateContinuationGate({ workflowDigest, floorDigest: targetFloorDigest, reviews, requiredRoles: ["contract", "domain", "consistency", "reconciliation"] });
  if (gate.decision !== "CONTINUE") return { decision: "ESCALATE_OWNER", reason: "REVIEW_GATE", gate };
  if (ownerAvailable) {
    const model = selectModelTier({ riskClass, requestedTier, fork: false, maxCostUnits: floor.maxCostUnits });
    if (model.decision === "ESCALATE") return { decision: "ESCALATE_OWNER", reason: model.reason, gate, model };
    return { decision: "CONTINUE_MAIN", gate, model };
  }
  const current = timestamp(now, "now");
  const prompted = timestamp(lastOwnerPromptAt, "lastOwnerPromptAt");
  const watchdog = ownerTimeoutWatchdog({ lastOwnerPromptAt: prompted, now: current, timeoutMinutes: floor.timeoutPolicy.forkAfterMinutes });
  const elapsedMinutes = (current - prompted) / 60_000;
  if (watchdog.state === "ARMED") return { decision: "WAIT_OWNER", reason: "TIMEOUT_NOT_REACHED", workflowDigest, parentRunId, checkpointDigest, elapsedMinutes, timeoutMinutes: floor.timeoutPolicy.forkAfterMinutes, watchdog, gate };
  if (["C", "D"].includes(riskClass)) {
    const model = selectModelTier({ riskClass, requestedTier, fork: false, maxCostUnits: floor.maxCostUnits });
    return { decision: "ESCALATE_OWNER", reason: model.reason, gate, model };
  }
  const forked = createContinuationFork({ parentRunId, parentWorkflowDigest: workflowDigest, checkpointDigest, floor, now: new Date(current), existingForks });
  const model = selectModelTier({ riskClass, requestedTier, fork: true, maxCostUnits: forked.fork.budget.maxCostUnits });
  if (model.decision === "ESCALATE") return { decision: "ESCALATE_OWNER", reason: model.reason, gate, model, fork: forked.fork };
  return { decision: "CONTINUE_FORK", gate, fork: forked.fork, forkCreated: forked.created, model, watchdog };
}
