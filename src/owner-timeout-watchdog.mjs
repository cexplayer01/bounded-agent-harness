import { assert } from "./errors.mjs";

function timestamp(value, label) {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  assert(Number.isFinite(parsed), "INVALID_TIMESTAMP", `${label} must be a valid timestamp`);
  return parsed;
}

/**
 * Owner absence is never terminal. The watchdog returns the exact next wake
 * time before the deadline and a mandatory fork action at/after the deadline.
 */
export function ownerTimeoutWatchdog({ lastOwnerPromptAt, now = Date.now(), timeoutMinutes }) {
  const prompted = timestamp(lastOwnerPromptAt, "lastOwnerPromptAt");
  const current = timestamp(now, "now");
  assert(Number.isSafeInteger(timeoutMinutes) && timeoutMinutes > 0 && timeoutMinutes <= 1440, "INVALID_TIMEOUT", "timeoutMinutes must be between 1 and 1440");
  const deadline = prompted + timeoutMinutes * 60_000;
  const remainingMs = Math.max(0, deadline - current);
  if (remainingMs === 0) return { state: "DUE", action: "CREATE_OR_RESUME_FORK", terminal: false, nextWakeAt: null, remainingMs: 0 };
  return { state: "ARMED", action: "CHECK_AGAIN", terminal: false, nextWakeAt: new Date(deadline).toISOString(), remainingMs };
}
