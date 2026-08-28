import { assert } from "./errors.mjs";

export function heartbeatStatus({ lastReceiptAt, now, leaseMs }) {
  assert(Number.isFinite(lastReceiptAt) && Number.isFinite(now), "INVALID_TIME", "heartbeat times must be epoch milliseconds");
  assert(Number.isSafeInteger(leaseMs) && leaseMs > 0, "INVALID_LEASE", "leaseMs must be a positive integer");
  const ageMs = Math.max(0, now - lastReceiptAt);
  return { state: ageMs <= leaseMs ? "alive" : "expired", ageMs, leaseMs, recoveryRequired: ageMs > leaseMs };
}

export function recoveryCheckpoint({ run, reason, now }) {
  assert(run && typeof run === "object", "INVALID_RUN", "run is required");
  return {
    format: "agent-harness.recovery.v1",
    runId: run.id,
    workflowDigest: run.workflowDigest,
    completedSteps: [...run.completedSteps],
    pendingSteps: [...run.pendingSteps],
    spentCostUnits: run.spentCostUnits,
    reason,
    recordedAt: new Date(now).toISOString()
  };
}

export async function recordHeartbeat(memory, { runId, workerId, workflowDigest, spentCostUnits, at = Date.now() }) {
  assert(typeof runId === "string" && runId.length > 0, "INVALID_HEARTBEAT", "runId is required");
  assert(typeof workerId === "string" && workerId.length > 0, "INVALID_HEARTBEAT", "workerId is required");
  assert(typeof workflowDigest === "string" && workflowDigest.startsWith("sha256:"), "INVALID_HEARTBEAT", "workflowDigest is required");
  assert(Number.isSafeInteger(spentCostUnits) && spentCostUnits >= 0, "INVALID_HEARTBEAT", "spentCostUnits must be a non-negative integer");
  assert(Number.isFinite(at), "INVALID_HEARTBEAT", "heartbeat time must be epoch milliseconds");
  const prior = (await memory.events()).filter((event) => event.type === "heartbeat.received" && event.runId === runId && event.workerId === workerId).at(-1);
  if (prior) {
    assert(prior.workflowDigest === workflowDigest, "HEARTBEAT_WORKFLOW_MISMATCH", "worker heartbeat changed workflow identity");
    assert(Date.parse(prior.at) <= at, "HEARTBEAT_TIME_REGRESSION", "worker heartbeat moved backward in time");
    assert(prior.spentCostUnits <= spentCostUnits, "HEARTBEAT_COST_REGRESSION", "worker heartbeat reduced cumulative cost");
  }
  const event = { type: "heartbeat.received", runId, workerId, workflowDigest, spentCostUnits, at: new Date(at).toISOString() };
  await memory.append(event);
  return event;
}

export function summarizeHeartbeats(events, { now, leaseMs }) {
  const latest = new Map();
  for (const event of events) {
    if (event.type !== "heartbeat.received") continue;
    latest.set(`${event.runId}\u0000${event.workerId}`, event);
  }
  return [...latest.values()].map((event) => ({
    runId: event.runId,
    workerId: event.workerId,
    workflowDigest: event.workflowDigest,
    spentCostUnits: event.spentCostUnits,
    lastReceiptAt: event.at,
    ...heartbeatStatus({ lastReceiptAt: Date.parse(event.at), now, leaseMs })
  })).sort((left, right) => `${left.runId}/${left.workerId}`.localeCompare(`${right.runId}/${right.workerId}`));
}
