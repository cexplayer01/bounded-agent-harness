import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

const KEY = /^[a-z][a-z0-9._-]{1,119}$/;

export class SharedMemory {
  constructor({ root, contracts, events }) {
    assert(contracts && typeof contracts.validate === "function", "INVALID_CONTRACT_REGISTRY", "shared memory requires a contract registry");
    assert(events && typeof events.append === "function", "INVALID_EVENT_STORE", "shared memory requires an event store");
    this.root = resolve(root);
    this.recordsRoot = join(this.root, "records");
    this.contracts = contracts;
    this.eventStore = events;
  }

  path(key) {
    assert(typeof key === "string" && KEY.test(key), "INVALID_MEMORY_KEY", "memory key must be a stable lowercase ID");
    return join(this.recordsRoot, `${key}.json`);
  }

  async get(key) {
    try {
      const record = JSON.parse(await readFile(this.path(key), "utf8"));
      const unsigned = { key: record.key, revision: record.revision, contract: record.contract, value: record.value };
      assert(record.digest === `sha256:${sha256(unsigned)}`, "MEMORY_CORRUPT", `memory record ${key} failed its integrity check`);
      this.contracts.validate(record.contract, record.value);
      return record;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async put({ key, contract, value, expectedRevision = 0 }) {
    assert(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, "INVALID_REVISION", "expectedRevision must be a non-negative integer");
    this.contracts.validate(contract, value);
    const current = await this.get(key);
    const actualRevision = current?.revision || 0;
    assert(actualRevision === expectedRevision, "REVISION_CONFLICT", `${key} is at revision ${actualRevision}, not ${expectedRevision}`);
    const unsigned = { key, revision: actualRevision + 1, contract, value };
    const record = { ...unsigned, digest: `sha256:${sha256(unsigned)}` };
    await mkdir(this.recordsRoot, { recursive: true });
    const target = this.path(key);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    await this.eventStore.append({ type: "memory.updated", key, revision: record.revision, contract, digest: record.digest });
    return record;
  }
}
