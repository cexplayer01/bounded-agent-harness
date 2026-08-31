import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armOwnerTimeout } from "../src/continuation-scheduler.mjs";
import { FileOwnerWakeStore } from "../src/file-wake-store.mjs";

const decision = {
  decision: "WAIT_OWNER",
  workflowDigest: "sha256:" + "a".repeat(64),
  parentRunId: "run-1",
  checkpointDigest: "sha256:" + "c".repeat(64),
  watchdog: { state: "ARMED", terminal: false, nextWakeAt: "2026-08-29T00:30:00.000Z" }
};

test("file wake store survives restart and exposes only due wakes", async () => {
  const store = new FileOwnerWakeStore(await mkdtemp(join(tmpdir(), "owner-wake-")));
  const callbacks = { persistWake: store.persistWake.bind(store), scheduleWake: store.scheduleWake.bind(store) };
  const armed = await armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", ...callbacks });
  const restartedStore = new FileOwnerWakeStore(store.root);
  assert.equal(await restartedStore.readPendingWake({ now: "2026-08-29T00:29:59Z" }), null);
  const pending = await restartedStore.readPendingWake({ now: "2026-08-29T00:30:00Z" });
  assert.equal(pending.wake.wakeDigest, armed.wakeDigest);
  assert.equal(pending.schedule.status, "SCHEDULED");
  await restartedStore.acknowledgeWake(armed.wakeDigest);
  assert.equal(await restartedStore.readPendingWake({ now: "2026-08-29T00:31:00Z" }), null);
});

test("file wake store rejects competing wake identities", async () => {
  const store = new FileOwnerWakeStore(await mkdtemp(join(tmpdir(), "owner-wake-conflict-")));
  const callbacks = { persistWake: store.persistWake.bind(store), scheduleWake: store.scheduleWake.bind(store) };
  await armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", ...callbacks });
  const competing = { ...decision, workflowDigest: "sha256:" + "b".repeat(64) };
  await assert.rejects(() => armOwnerTimeout({ decision: competing, now: "2026-08-29T00:00:00Z", ...callbacks }), /different owner wake/);
});

test("a consumed wake cannot be replayed", async () => {
  const store = new FileOwnerWakeStore(await mkdtemp(join(tmpdir(), "owner-wake-replay-")));
  const callbacks = { persistWake: store.persistWake.bind(store), scheduleWake: store.scheduleWake.bind(store) };
  const armed = await armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", ...callbacks });
  await store.acknowledgeWake(armed.wakeDigest);
  await assert.rejects(() => store.scheduleWake({ ...decision, format: "agent-harness.owner-wake.v1", wakeDigest: armed.wakeDigest, nextWakeAt: decision.watchdog.nextWakeAt, action: "RECHECK_OWNER_TIMEOUT" }), /already consumed/);
  await assert.rejects(() => store.acknowledgeWake(armed.wakeDigest), /already consumed/);
});

test("tampered wake records fail closed", async () => {
  const store = new FileOwnerWakeStore(await mkdtemp(join(tmpdir(), "owner-wake-tamper-")));
  const callbacks = { persistWake: store.persistWake.bind(store), scheduleWake: store.scheduleWake.bind(store) };
  await armOwnerTimeout({ decision, now: "2026-08-29T00:00:00Z", ...callbacks });
  const wake = JSON.parse(await readFile(store.wakePath, "utf8"));
  await writeFile(store.wakePath, JSON.stringify({ ...wake, nextWakeAt: "2026-08-29T00:31:00.000Z" }));
  await assert.rejects(() => store.readPendingWake({ now: "2026-08-29T00:31:00Z" }), /digest is invalid/);
});
