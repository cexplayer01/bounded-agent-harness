import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { armOwnerTimeout } from "../src/continuation-scheduler.mjs";
import { FileOwnerWakeStore } from "../src/file-wake-store.mjs";
import { pollOwnerWake } from "../src/owner-timeout-runner.mjs";

const decision = { decision: "WAIT_OWNER", workflowDigest: "sha256:" + "a".repeat(64), parentRunId: "run-1", checkpointDigest: "sha256:" + "c".repeat(64), watchdog: { state: "ARMED", terminal: false, nextWakeAt: "2026-08-29T00:30:00.000Z" } };

async function armedStore(prefix) {
  const store = new FileOwnerWakeStore(await mkdtemp(join(tmpdir(), prefix)));
  await armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", persistWake: store.persistWake.bind(store), scheduleWake: store.scheduleWake.bind(store) });
  return store;
}

test("runner dispatches a due wake and acknowledges it after success", async () => {
  const store = await armedStore("owner-runner-");
  let calls = 0;
  const result = await pollOwnerWake({ wakeStore: store, now: "2026-08-29T00:30:00Z", dispatchDueWake: async (pending) => { calls++; assert.equal(pending.wake.parentRunId, "run-1"); return { decision: "CONTINUE_FORK" }; } });
  assert.deepEqual(result, { state: "DISPATCHED", terminal: false, wakeDigest: result.wakeDigest, decision: "CONTINUE_FORK" });
  assert.equal(calls, 1);
  assert.equal(await store.readPendingWake({ now: "2026-08-29T00:31:00Z" }), null);
});

test("runner leaves the wake pending when dispatch fails", async () => {
  const store = await armedStore("owner-runner-retry-");
  await assert.rejects(() => pollOwnerWake({ wakeStore: store, now: "2026-08-29T00:30:00Z", dispatchDueWake: async () => { throw new Error("dispatcher unavailable"); } }), /dispatcher unavailable/);
  assert.ok(await store.readPendingWake({ now: "2026-08-29T00:31:00Z" }));
});

test("runner requires an explicit dispatcher outcome", async () => {
  const store = await armedStore("owner-runner-outcome-");
  await assert.rejects(() => pollOwnerWake({ wakeStore: store, now: "2026-08-29T00:30:00Z", dispatchDueWake: async () => null }), /must return a decision/);
  assert.ok(await store.readPendingWake({ now: "2026-08-29T00:31:00Z" }));
});
