import { assert } from "./errors.mjs";

export const WORK_EXECUTION_MODES = Object.freeze(["CONTINUOUS_RUN", "HEARTBEAT_RECOVERY"]);

const INPUT_KEYS = [
  "executionMode",
  "objectiveState",
  "validationState",
  "gitState",
  "ownerBoundary",
  "safeWorkAvailable",
  "alternateSafeWorkAvailable",
  "executionWindow",
  "checkpointRecorded",
  "progressReported"
];

function closedObject(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_WORK_LOOP", "work-loop snapshot must be an object");
  assert(Object.keys(value).sort().join("\0") === [...INPUT_KEYS].sort().join("\0"), "INVALID_WORK_LOOP", "work-loop snapshot must be closed");
}

function decision(value) {
  return Object.freeze(value);
}

/**
 * Decide what the host must do after a bounded unit of work.
 *
 * A continuous run is the primary execution host. A heartbeat may observe,
 * recover, or request that host, but cannot claim to be continuous work.
 * Reporting progress never changes the decision into a stopping condition.
 */
export function decideWorkLoop(snapshot) {
  closedObject(snapshot);
  assert(WORK_EXECUTION_MODES.includes(snapshot.executionMode), "INVALID_WORK_LOOP", "executionMode is unsupported");
  assert(["ACTIVE", "COMPLETE"].includes(snapshot.objectiveState), "INVALID_WORK_LOOP", "objectiveState is unsupported");
  assert(["PASS", "FAILED_RECOVERABLE", "FAILED_FINAL"].includes(snapshot.validationState), "INVALID_WORK_LOOP", "validationState is unsupported");
  assert(["SAFE", "AMBIGUOUS"].includes(snapshot.gitState), "INVALID_WORK_LOOP", "gitState is unsupported");
  assert(["NONE", "REQUIRED"].includes(snapshot.ownerBoundary), "INVALID_WORK_LOOP", "ownerBoundary is unsupported");
  assert(["OPEN", "ENDING"].includes(snapshot.executionWindow), "INVALID_WORK_LOOP", "executionWindow is unsupported");
  for (const key of ["safeWorkAvailable", "alternateSafeWorkAvailable", "checkpointRecorded", "progressReported"]) {
    assert(typeof snapshot[key] === "boolean", "INVALID_WORK_LOOP", `${key} must be boolean`);
  }

  if (snapshot.objectiveState === "COMPLETE") {
    return decision({ action: "COMPLETE_OBJECTIVE", continueNow: false, terminal: true, reason: "OBJECTIVE_PROVEN_COMPLETE" });
  }
  if (snapshot.gitState === "AMBIGUOUS") {
    return decision({ action: "ESCALATE_OWNER", continueNow: false, terminal: false, reason: "UNSAFE_GIT_AMBIGUITY" });
  }
  if (snapshot.validationState === "FAILED_FINAL") {
    return decision({ action: "ESCALATE_OWNER", continueNow: false, terminal: false, reason: "UNRECOVERABLE_VALIDATION_FAILURE" });
  }
  if (snapshot.ownerBoundary === "REQUIRED" && snapshot.alternateSafeWorkAvailable) {
    return decision({ action: "CONTINUE_ALTERNATE_SAFE_WORK", continueNow: true, terminal: false, reason: "BLOCK_ONLY_THE_GATED_ACTION" });
  }
  if (snapshot.ownerBoundary === "REQUIRED") {
    return decision({ action: "ARM_OWNER_WAKE_AND_YIELD", continueNow: false, terminal: false, reason: "OWNER_REQUIRED_AND_NO_ALTERNATE_SAFE_WORK" });
  }
  if (snapshot.validationState === "FAILED_RECOVERABLE") {
    assert(snapshot.safeWorkAvailable, "INVALID_WORK_LOOP", "recoverable validation requires a safe repair step");
    return decision({ action: "REPAIR_AND_CONTINUE", continueNow: true, terminal: false, reason: "RECOVERABLE_VALIDATION_FAILURE" });
  }
  if (snapshot.executionWindow === "ENDING" || !snapshot.safeWorkAvailable) {
    if (!snapshot.checkpointRecorded) {
      return decision({ action: "RECORD_CHECKPOINT_BEFORE_YIELD", continueNow: true, terminal: false, reason: snapshot.executionWindow === "ENDING" ? "EXECUTION_WINDOW_ENDING" : "NO_SAFE_WORK_REMAINS" });
    }
    return decision({ action: "YIELD_FOR_RECOVERY", continueNow: false, terminal: false, reason: snapshot.executionWindow === "ENDING" ? "EXECUTION_WINDOW_ENDED" : "NO_SAFE_WORK_REMAINS" });
  }
  if (snapshot.executionMode === "HEARTBEAT_RECOVERY") {
    return decision({ action: "START_OR_RESUME_CONTINUOUS_RUN", continueNow: false, terminal: false, reason: "HEARTBEAT_IS_RECOVERY_NOT_PRIMARY_EXECUTION" });
  }
  return decision({ action: "CONTINUE_CURRENT_RUN", continueNow: true, terminal: false, reason: snapshot.progressReported ? "PROGRESS_REPORT_IS_NOT_A_STOP" : "SAFE_WORK_REMAINS" });
}
