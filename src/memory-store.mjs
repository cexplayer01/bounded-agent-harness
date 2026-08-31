import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assert } from "./errors.mjs";
import { sha256 } from "./canonical-json.mjs";

function inside(root, target) {
  const base = resolve(root);
  const candidate = resolve(target);
  assert(candidate === base || candidate.startsWith(`${base}${sep}`), "PATH_ESCAPE", "memory path escapes its configured root");
  return candidate;
}

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

function isRetriableLockContention(error) {
  return error?.code === "EEXIST" || (process.platform === "win32" && error?.code === "EPERM");
}

export class FileMemoryStore {
  constructor(root, { lockTimeoutMs = 2000, lockRetryMs = 10 } = {}) {
    this.root = resolve(root);
    this.eventsPath = inside(this.root, join(this.root, "events.jsonl"));
    this.checkpointPath = inside(this.root, join(this.root, "checkpoint.json"));
    this.lockPath = inside(this.root, join(this.root, "events.lock"));
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockRetryMs = lockRetryMs;
  }

  async initialize() { await mkdir(this.root, { recursive: true }); }

  async lockStatus({ now = Date.now(), staleAfterMs = 60_000, isProcessAlive = defaultProcessAlive } = {}) {
    assert(Number.isFinite(now), "INVALID_TIME", "lock inspection time must be epoch milliseconds");
    assert(Number.isSafeInteger(staleAfterMs) && staleAfterMs > 0, "INVALID_LOCK_POLICY", "staleAfterMs must be a positive integer");
    try {
      const lock = JSON.parse(await readFile(this.lockPath, "utf8"));
      assert(Number.isSafeInteger(lock.pid) && lock.pid > 0 && Number.isFinite(Date.parse(lock.acquiredAt)), "LOCK_FILE_CORRUPT", "event lock metadata is invalid");
      const ageMs = Math.max(0, now - Date.parse(lock.acquiredAt));
      const alive = await isProcessAlive(lock.pid);
      return { state: !alive ? "orphaned" : ageMs > staleAfterMs ? "stale-active" : "held", pid: lock.pid, acquiredAt: lock.acquiredAt, ageMs, safeToRemove: !alive };
    } catch (error) {
      if (error.code === "ENOENT") return { state: "unlocked", safeToRemove: false };
      throw error;
    }
  }

  async append(event) {
    assert(event && typeof event === "object" && !Array.isArray(event), "INVALID_EVENT", "event must be an object");
    await this.initialize();
    const startedAt = Date.now();
    let lock;
    while (!lock) {
      try {
        lock = await open(this.lockPath, "wx");
        await lock.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
      } catch (error) {
        // Windows can briefly report EPERM while another writer closes and
        // removes the lock file. Treat it as contention within the same
        // bounded timeout; other permission failures still fail immediately.
        if (!isRetriableLockContention(error)) throw error;
        assert(Date.now() - startedAt < this.lockTimeoutMs, "EVENT_LOG_LOCKED", "event log is locked by another writer");
        await pause(this.lockRetryMs);
      }
    }
    try {
      const envelopes = await this.envelopes();
      const previous = envelopes.at(-1);
      const unsigned = { sequence: envelopes.length, previousHash: previous?.hash || null, payload: event };
      const envelope = { ...unsigned, hash: `sha256:${sha256(unsigned)}` };
      await appendFile(this.eventsPath, `${JSON.stringify(envelope)}\n`, "utf8");
    } finally {
      await lock.close();
      await unlink(this.lockPath);
    }
    return event;
  }

  async envelopes() {
    try {
      const content = await readFile(this.eventsPath, "utf8");
      const envelopes = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      let previousHash = null;
      for (const [sequence, envelope] of envelopes.entries()) {
        assert(envelope.sequence === sequence, "EVENT_LOG_CORRUPT", `event sequence ${sequence} is invalid`);
        assert(envelope.previousHash === previousHash, "EVENT_LOG_CORRUPT", `event ${sequence} does not link to its predecessor`);
        const expected = `sha256:${sha256({ sequence: envelope.sequence, previousHash: envelope.previousHash, payload: envelope.payload })}`;
        assert(envelope.hash === expected, "EVENT_LOG_CORRUPT", `event ${sequence} hash is invalid`);
        previousHash = envelope.hash;
      }
      return envelopes;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async events() { return (await this.envelopes()).map((envelope) => envelope.payload); }

  async checkpoint(value) {
    await this.initialize();
    const temporary = `${this.checkpointPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, this.checkpointPath);
    return value;
  }

  async readCheckpoint() {
    try { return JSON.parse(await readFile(this.checkpointPath, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
}

async function defaultProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; return true; }
}
