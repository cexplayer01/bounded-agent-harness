import test from "node:test";
import assert from "node:assert/strict";
import { ownerTimeoutWatchdog } from "../src/owner-timeout-watchdog.mjs";

test("owner absence is armed with a mandatory next wake, never terminal", () => {
  const result = ownerTimeoutWatchdog({ lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:10:00Z", timeoutMinutes: 30 });
  assert.deepEqual(result, { state: "ARMED", action: "CHECK_AGAIN", terminal: false, nextWakeAt: "2026-08-29T00:30:00.000Z", remainingMs: 1_200_000 });
});

test("deadline requires automatic fork creation or resume", () => {
  const result = ownerTimeoutWatchdog({ lastOwnerPromptAt: "2026-08-29T00:00:00Z", now: "2026-08-29T00:31:00Z", timeoutMinutes: 30 });
  assert.deepEqual(result, { state: "DUE", action: "CREATE_OR_RESUME_FORK", terminal: false, nextWakeAt: null, remainingMs: 0 });
});

test("invalid timeout inputs fail closed", () => {
  assert.throws(() => ownerTimeoutWatchdog({ lastOwnerPromptAt: "not-a-time", timeoutMinutes: 30 }), /valid timestamp/);
  assert.throws(() => ownerTimeoutWatchdog({ lastOwnerPromptAt: "2026-08-29T00:00:00Z", timeoutMinutes: 0 }), /between 1 and 1440/);
});
