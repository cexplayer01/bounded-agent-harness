import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

const WAKE_FILE = "owner-wake.json";
const SCHEDULE_FILE = "owner-wake-schedule.json";

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/**
 * Restart-safe local adapter for the owner-timeout scheduler port. It stores
 * the wake and its schedule separately so a process restart can discover a
 * due wake without relying on an in-memory timer.
 */
export class FileOwnerWakeStore {
  constructor(root) {
    assert(typeof root === "string" && root.length > 0, "INVALID_WAKE_STORE", "wake store root is required");
    this.root = resolve(root);
    this.wakePath = join(this.root, WAKE_FILE);
    this.schedulePath = join(this.root, SCHEDULE_FILE);
  }

  async initialize() { await mkdir(this.root, { recursive: true }); }

  async persistWake(record) {
    assert(record?.format === "agent-harness.owner-wake.v1", "INVALID_WAKE", "persistWake requires an owner-wake.v1 record");
    await this.initialize();
    const existing = await readJson(this.wakePath);
    if (existing) assert(existing.wakeDigest === record.wakeDigest, "WAKE_CONFLICT", "a different owner wake is already persisted");
    if (!existing) await atomicJson(this.wakePath, record);
    return record;
  }

  async scheduleWake(record) {
    await this.initialize();
    const persisted = await readJson(this.wakePath);
    assert(persisted?.wakeDigest === record?.wakeDigest, "WAKE_NOT_PERSISTED", "wake must be persisted before scheduling");
    const existing = await readJson(this.schedulePath);
    if (existing) assert(existing.wakeDigest === record.wakeDigest, "WAKE_CONFLICT", "a different owner wake is already scheduled");
    if (existing) assert(existing.status === "SCHEDULED", "WAKE_ALREADY_CONSUMED", "owner wake was already consumed");
    if (!existing) await atomicJson(this.schedulePath, { format: "agent-harness.owner-wake-schedule.v1", version: 1, wakeDigest: record.wakeDigest, nextWakeAt: record.nextWakeAt, action: record.action, status: "SCHEDULED" });
    return { scheduled: true };
  }

  async readPendingWake({ now = Date.now() } = {}) {
    const [wake, schedule] = await Promise.all([readJson(this.wakePath), readJson(this.schedulePath)]);
    if (!wake || !schedule) return null;
    assert(schedule.format === "agent-harness.owner-wake-schedule.v1" && schedule.version === 1, "WAKE_CORRUPT", "owner wake schedule format is invalid");
    assert(["SCHEDULED", "CONSUMED"].includes(schedule.status), "WAKE_CORRUPT", "owner wake schedule status is invalid");
    if (schedule.status !== "SCHEDULED") return null;
    const unsignedWake = { format: wake.format, version: wake.version, workflowDigest: wake.workflowDigest, parentRunId: wake.parentRunId, checkpointDigest: wake.checkpointDigest, action: wake.action, nextWakeAt: wake.nextWakeAt };
    assert(wake.wakeDigest === `sha256:${sha256(unsignedWake)}`, "WAKE_CORRUPT", "persisted owner wake digest is invalid");
    assert(schedule.wakeDigest === wake.wakeDigest, "WAKE_CORRUPT", "scheduled wake does not match persisted wake");
    assert(schedule.nextWakeAt === wake.nextWakeAt && schedule.action === wake.action, "WAKE_CORRUPT", "scheduled wake details do not match persisted wake");
    const current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
    assert(Number.isFinite(current), "INVALID_TIME", "wake inspection time must be a valid timestamp");
    return Date.parse(schedule.nextWakeAt) <= current ? { wake, schedule } : null;
  }

  async acknowledgeWake(wakeDigest) {
    const schedule = await readJson(this.schedulePath);
    assert(schedule?.wakeDigest === wakeDigest, "WAKE_NOT_FOUND", "wake digest is not scheduled");
    assert(schedule.status === "SCHEDULED", "WAKE_ALREADY_CONSUMED", "owner wake was already consumed");
    await atomicJson(this.schedulePath, { ...schedule, status: "CONSUMED", consumedAt: new Date().toISOString() });
    return { acknowledged: true, wakeDigest };
  }
}
