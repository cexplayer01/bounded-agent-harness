import test from "node:test";
import assert from "node:assert/strict";
import { decideWorkLoop } from "../src/work-loop-policy.mjs";

const snapshot = (overrides = {}) => ({
  executionMode: "CONTINUOUS_RUN",
  objectiveState: "ACTIVE",
  validationState: "PASS",
  gitState: "SAFE",
  ownerBoundary: "NONE",
  safeWorkAvailable: true,
  alternateSafeWorkAvailable: false,
  executionWindow: "OPEN",
  checkpointRecorded: false,
  progressReported: false,
  ...overrides
});

test("continuous run keeps working after a progress report", () => {
  const result = decideWorkLoop(snapshot({ progressReported: true }));
  assert.deepEqual(result, { action: "CONTINUE_CURRENT_RUN", continueNow: true, terminal: false, reason: "PROGRESS_REPORT_IS_NOT_A_STOP" });
});

test("heartbeat requests the continuous host instead of pretending to be it", () => {
  const result = decideWorkLoop(snapshot({ executionMode: "HEARTBEAT_RECOVERY" }));
  assert.deepEqual(result, { action: "START_OR_RESUME_CONTINUOUS_RUN", continueNow: false, terminal: false, reason: "HEARTBEAT_IS_RECOVERY_NOT_PRIMARY_EXECUTION" });
});

test("a gated action does not stop unrelated safe work", () => {
  assert.equal(decideWorkLoop(snapshot({ ownerBoundary: "REQUIRED", alternateSafeWorkAvailable: true })).action, "CONTINUE_ALTERNATE_SAFE_WORK");
  assert.equal(decideWorkLoop(snapshot({ ownerBoundary: "REQUIRED" })).action, "ARM_OWNER_WAKE_AND_YIELD");
});

test("recoverable validation repairs while unsafe Git and final failure escalate", () => {
  assert.equal(decideWorkLoop(snapshot({ validationState: "FAILED_RECOVERABLE" })).action, "REPAIR_AND_CONTINUE");
  assert.equal(decideWorkLoop(snapshot({ gitState: "AMBIGUOUS" })).reason, "UNSAFE_GIT_AMBIGUITY");
  assert.equal(decideWorkLoop(snapshot({ validationState: "FAILED_FINAL" })).reason, "UNRECOVERABLE_VALIDATION_FAILURE");
});

test("window exhaustion requires a checkpoint before yielding", () => {
  assert.equal(decideWorkLoop(snapshot({ executionWindow: "ENDING" })).action, "RECORD_CHECKPOINT_BEFORE_YIELD");
  assert.equal(decideWorkLoop(snapshot({ executionWindow: "ENDING", checkpointRecorded: true })).action, "YIELD_FOR_RECOVERY");
  assert.equal(decideWorkLoop(snapshot({ safeWorkAvailable: false, checkpointRecorded: true })).reason, "NO_SAFE_WORK_REMAINS");
});

test("only proven completion is terminal and inputs are closed", () => {
  assert.deepEqual(decideWorkLoop(snapshot({ objectiveState: "COMPLETE" })), { action: "COMPLETE_OBJECTIVE", continueNow: false, terminal: true, reason: "OBJECTIVE_PROVEN_COMPLETE" });
  assert.throws(() => decideWorkLoop({ ...snapshot(), extra: true }), /must be closed/);
  assert.throws(() => decideWorkLoop(snapshot({ validationState: "FAILED_RECOVERABLE", safeWorkAvailable: false })), /safe repair step/);
});
