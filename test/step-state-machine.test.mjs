import test from "node:test";
import assert from "node:assert/strict";
import {
  STEP_EVENTS,
  STEP_STATES,
  allowedStepEvents,
  classifyExecutionPlane,
  isTerminalStepState,
  reduceStepEvents,
  transitionStepState
} from "../src/step-state-machine.mjs";

function code(expected) {
  return (error) => error?.code === expected;
}

test("happy path requires authorization, lease, invocation, success, and completion", () => {
  const state = reduceStepEvents([
    STEP_EVENTS.AUTHORIZE,
    STEP_EVENTS.ACQUIRE_LEASE,
    STEP_EVENTS.START_INVOCATION,
    STEP_EVENTS.SUCCEED,
    STEP_EVENTS.COMPLETE
  ]);
  assert.equal(state, STEP_STATES.COMPLETED);
  assert.equal(isTerminalStepState(state), true);
});

test("ambiguous external effects enter reconciliation before completion", () => {
  const state = reduceStepEvents([
    STEP_EVENTS.AUTHORIZE,
    STEP_EVENTS.ACQUIRE_LEASE,
    STEP_EVENTS.START_INVOCATION,
    STEP_EVENTS.AMBIGUOUS_EFFECT
  ]);
  assert.equal(state, STEP_STATES.RECONCILIATION_REQUIRED);
  assert.deepEqual(allowedStepEvents(state), [
    STEP_EVENTS.START_RECONCILIATION,
    STEP_EVENTS.PARK
  ]);
  assert.equal(
    transitionStepState(
      transitionStepState(state, STEP_EVENTS.START_RECONCILIATION),
      STEP_EVENTS.RECONCILE_SUCCEEDED
    ),
    STEP_STATES.SUCCEEDED
  );
});

test("invalid shortcuts fail closed", () => {
  assert.throws(
    () => transitionStepState(STEP_STATES.PENDING, STEP_EVENTS.START_INVOCATION),
    code("INVALID_STEP_TRANSITION")
  );
  assert.throws(
    () => transitionStepState(STEP_STATES.SUCCEEDED, STEP_EVENTS.START_INVOCATION),
    code("INVALID_STEP_TRANSITION")
  );
  assert.throws(
    () => transitionStepState(STEP_STATES.COMPLETED, STEP_EVENTS.ACQUIRE_LEASE),
    code("INVALID_STEP_TRANSITION")
  );
});

test("retryable failures must reacquire a lease before invoking again", () => {
  const failed = reduceStepEvents([
    STEP_EVENTS.AUTHORIZE,
    STEP_EVENTS.ACQUIRE_LEASE,
    STEP_EVENTS.START_INVOCATION,
    STEP_EVENTS.FAIL_RETRYABLE
  ]);
  assert.equal(failed, STEP_STATES.FAILED_RETRYABLE);
  assert.throws(() => transitionStepState(failed, STEP_EVENTS.START_INVOCATION), code("INVALID_STEP_TRANSITION"));
  assert.equal(
    transitionStepState(transitionStepState(failed, STEP_EVENTS.ACQUIRE_LEASE), STEP_EVENTS.START_INVOCATION),
    STEP_STATES.INVOKING
  );
});

test("failed-final and reconciliation-required states can park without pretending completion", () => {
  assert.equal(
    transitionStepState(STEP_STATES.FAILED_FINAL, STEP_EVENTS.PARK),
    STEP_STATES.PARKED
  );
  assert.equal(
    transitionStepState(STEP_STATES.RECONCILIATION_REQUIRED, STEP_EVENTS.PARK),
    STEP_STATES.PARKED
  );
  assert.equal(isTerminalStepState(STEP_STATES.PARKED), true);
});

test("events are classified into control, execution, and reconciliation planes", () => {
  assert.equal(classifyExecutionPlane(STEP_EVENTS.AUTHORIZE), "control");
  assert.equal(classifyExecutionPlane(STEP_EVENTS.START_INVOCATION), "execution");
  assert.equal(classifyExecutionPlane(STEP_EVENTS.AMBIGUOUS_EFFECT), "execution");
  assert.equal(classifyExecutionPlane(STEP_EVENTS.START_RECONCILIATION), "reconciliation");
  assert.equal(classifyExecutionPlane(STEP_EVENTS.COMPLETE), "reconciliation");
  assert.throws(() => classifyExecutionPlane("BOGUS"), code("INVALID_STEP_EVENT"));
});
