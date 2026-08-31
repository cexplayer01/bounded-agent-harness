import test from "node:test";
import assert from "node:assert/strict";
import { armOwnerTimeout, buildOwnerWakeRecord } from "../src/continuation-scheduler.mjs";

const workflowDigest = "sha256:" + "a".repeat(64);
const checkpointDigest = "sha256:" + "c".repeat(64);
const decision = {
  decision: "WAIT_OWNER",
  workflowDigest,
  parentRunId: "run-1",
  checkpointDigest,
  watchdog: { state: "ARMED", terminal: false, nextWakeAt: "2026-08-29T00:30:00.000Z" }
};

test("owner timeout wake is persisted before it is scheduled", async () => {
  const order = [];
  const result = await armOwnerTimeout({
    decision,
    now: "2026-08-29T00:00:00Z",
    persistWake: async (record) => { order.push(["persist", record]); return record; },
    scheduleWake: async (record) => { order.push(["schedule", record]); return { scheduled: true }; }
  });
  assert.equal(result.armed, true);
  assert.equal(result.terminal, false);
  assert.deepEqual(order.map(([name]) => name), ["persist", "schedule"]);
  assert.equal(order[0][1].wakeDigest, result.wakeDigest);
});

test("missing persistence or scheduling boundary fails closed", async () => {
  await assert.rejects(() => armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", persistWake: async () => ({}), scheduleWake: async () => ({ scheduled: true }) }), /exact wake digest/);
  await assert.rejects(() => armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", persistWake: async (record) => record, scheduleWake: async () => ({ scheduled: false }) }), /wake was armed/);
  await assert.rejects(() => armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", persistWake: async () => {} }), /scheduleWake callback is required/);
  await assert.rejects(() => armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", scheduleWake: async () => ({ scheduled: true }) }), /persistWake callback is required/);
});

test("wake records reject stale or invalid timestamps", () => {
  assert.throws(() => buildOwnerWakeRecord({ workflowDigest, parentRunId: "run-1", checkpointDigest, nextWakeAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:00:01Z" }), /in the future/);
  assert.throws(() => buildOwnerWakeRecord({ workflowDigest, parentRunId: "run-1", checkpointDigest, nextWakeAt: "bad", now: "2026-08-29T00:00:00Z" }), /valid ISO timestamp/);
});
