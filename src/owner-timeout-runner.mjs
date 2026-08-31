import { assert } from "./errors.mjs";

/**
 * One restart-safe polling tick for a host heartbeat or queue worker.
 * A due wake is acknowledged only after the injected dispatcher succeeds;
 * if dispatch fails, the persisted wake remains available for retry.
 */
export async function pollOwnerWake({ wakeStore, now = Date.now(), dispatchDueWake }) {
  assert(typeof wakeStore?.readPendingWake === "function", "INVALID_WAKE_STORE", "wakeStore.readPendingWake() is required");
  assert(typeof wakeStore?.acknowledgeWake === "function", "INVALID_WAKE_STORE", "wakeStore.acknowledgeWake() is required");
  assert(typeof dispatchDueWake === "function", "MISSING_WAKE_DISPATCHER", "dispatchDueWake callback is required");
  const pending = await wakeStore.readPendingWake({ now });
  if (!pending) return { state: "IDLE", terminal: false };
  const outcome = await dispatchDueWake(pending);
  assert(outcome && typeof outcome === "object" && typeof outcome.decision === "string", "INVALID_WAKE_OUTCOME", "dispatchDueWake must return a decision");
  await wakeStore.acknowledgeWake(pending.wake.wakeDigest);
  return { state: "DISPATCHED", terminal: false, wakeDigest: pending.wake.wakeDigest, decision: outcome.decision };
}
