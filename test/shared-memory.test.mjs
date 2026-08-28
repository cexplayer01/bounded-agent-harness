import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractRegistry } from "../src/contract-registry.mjs";
import { FileMemoryStore } from "../src/memory-store.mjs";
import { SharedMemory } from "../src/shared-memory.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "shared-memory-"));
  const contracts = new ContractRegistry().register("checkpoint.v1", (value) => typeof value?.next === "string");
  const events = new FileMemoryStore(join(root, "ledger"));
  return { root, events, memory: new SharedMemory({ root: join(root, "brain"), contracts, events }) };
}

test("shared memory persists contract-bound versioned facts", async () => {
  const { root, events, memory } = await fixture();
  try {
    const first = await memory.put({ key: "project.current-state", contract: "checkpoint.v1", value: { next: "compile" } });
    const second = await memory.put({ key: "project.current-state", contract: "checkpoint.v1", value: { next: "test" }, expectedRevision: 1 });
    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal((await memory.get("project.current-state")).value.next, "test");
    assert.equal((await events.events()).filter((event) => event.type === "memory.updated").length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("shared memory rejects stale writers and invalid contracts", async () => {
  const { root, memory } = await fixture();
  try {
    await memory.put({ key: "project.current-state", contract: "checkpoint.v1", value: { next: "compile" } });
    await assert.rejects(() => memory.put({ key: "project.current-state", contract: "checkpoint.v1", value: { next: "overwrite" }, expectedRevision: 0 }), /revision 1/);
    await assert.rejects(() => memory.put({ key: "project.bad", contract: "checkpoint.v1", value: { wrong: true } }), /rejected/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("shared memory detects record tampering before returning facts", async () => {
  const { root, memory } = await fixture();
  try {
    await memory.put({ key: "project.current-state", contract: "checkpoint.v1", value: { next: "compile" } });
    const target = memory.path("project.current-state");
    const text = await readFile(target, "utf8");
    await writeFile(target, text.replace('"compile"', '"tampered"'), "utf8");
    await assert.rejects(() => memory.get("project.current-state"), /integrity check/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
