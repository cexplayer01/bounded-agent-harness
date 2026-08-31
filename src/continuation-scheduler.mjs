import { assert } from "./errors.mjs";
import { sha256 } from "./canonical-json.mjs";

export const OWNER_WAKE_FORMAT = "agent-harness.owner-wake.v1";

function validDigest(value, label) {
  assert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "INVALID_WAKE", `${label} must be a sha256 digest`);
}

function validTimestamp(value, label) {
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), "INVALID_WAKE", `${label} must be a valid ISO timestamp`);
  return parsed;
}

/**
 * Build the durable wake record required for a pre-timeout owner wait.
 * The record is deliberately plain JSON so any StateStore or queue adapter
 * can persist it without changing the control-plane semantics.
 */
export function buildOwnerWakeRecord({ workflowDigest, parentRunId, checkpointDigest, nextWakeAt, now = Date.now() }) {
  validDigest(workflowDigest, "workflowDigest");
  validDigest(checkpointDigest, "checkpointDigest");
  assert(typeof parentRunId === "string" && parentRunId.length > 0, "INVALID_WAKE", "parentRunId is required");
  const wakeAt = validTimestamp(nextWakeAt, "nextWakeAt");
  const current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  assert(Number.isFinite(current), "INVALID_WAKE", "now must be a valid timestamp");
  assert(wakeAt > current, "WAKE_NOT_FUTURE", "nextWakeAt must be in the future");
  const unsigned = { format: OWNER_WAKE_FORMAT, version: 1, workflowDigest, parentRunId, checkpointDigest, action: "RECHECK_OWNER_TIMEOUT", nextWakeAt: new Date(wakeAt).toISOString() };
  return { ...unsigned, wakeDigest: `sha256:${sha256(unsigned)}` };
}

/**
 * Persist and arm the mandatory owner-timeout wake in that order. Callers
 * must use this boundary for WAIT_OWNER; the scheduler callback is not
 * optional, so an absent queue/timer fails closed instead of ending a run.
 */
export async function armOwnerTimeout({ decision, now = Date.now(), persistWake, scheduleWake }) {
  assert(decision?.decision === "WAIT_OWNER", "INVALID_WAKE_DECISION", "only WAIT_OWNER decisions can be armed");
  assert(decision.watchdog?.terminal === false && decision.watchdog?.state === "ARMED", "INVALID_WAKE_DECISION", "WAIT_OWNER must carry an armed non-terminal watchdog");
  assert(typeof persistWake === "function", "MISSING_WAKE_STORE", "persistWake callback is required");
  assert(typeof scheduleWake === "function", "MISSING_WAKE_SCHEDULER", "scheduleWake callback is required");
  const record = buildOwnerWakeRecord({ workflowDigest: decision.workflowDigest, parentRunId: decision.parentRunId, checkpointDigest: decision.checkpointDigest, nextWakeAt: decision.watchdog.nextWakeAt, now });
  const persisted = await persistWake(record);
  assert(persisted?.wakeDigest === record.wakeDigest, "WAKE_NOT_PERSISTED", "persistWake must acknowledge the exact wake digest");
  const scheduled = await scheduleWake(record);
  assert(scheduled?.scheduled === true, "WAKE_NOT_SCHEDULED", "scheduleWake must acknowledge that the wake was armed");
  return { armed: true, terminal: false, action: record.action, nextWakeAt: record.nextWakeAt, wakeDigest: record.wakeDigest };
}
