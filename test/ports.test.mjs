import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertContractRegistryPort,
  assertEventStore,
  assertLeaseStore,
  assertProviderAdapter,
  assertStateStore,
  ContractRegistry,
  FileMemoryStore,
  mcpAdapter,
  SharedMemory
} from "../src/index.mjs";

test("existing filesystem and MCP implementations satisfy explicit ports", async () => {
  const root = await mkdtemp(join(tmpdir(), "ports-"));
  try {
    const contracts = assertContractRegistryPort(new ContractRegistry().register("state.v1", (value) => value?.ok === true));
    const events = assertEventStore(new FileMemoryStore(join(root, "events")));
    const state = assertStateStore(new SharedMemory({ root: join(root, "state"), contracts, events }));
    const adapter = assertProviderAdapter(mcpAdapter({ callTool: async () => ({ structuredContent: { ok: true } }) }, { server: "local", tool: "noop" }));

    assert.equal(await events.append({ type: "port.checked" }).then((event) => event.type), "port.checked");
    assert.equal(await events.checkpoint({ ok: true }).then((checkpoint) => checkpoint.ok), true);
    assert.equal((await events.readCheckpoint()).ok, true);
    assert.equal((await state.put({ key: "project.current", contract: "state.v1", value: { ok: true } })).revision, 1);
    assert.equal((await state.get("project.current")).value.ok, true);
    assert.equal(typeof adapter.invoke, "function");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ports fail closed instead of accepting partial local-only impostors", () => {
  assert.throws(() => assertEventStore({ append() {} }), (error) => error?.code === "INVALID_PORT");
  assert.throws(() => assertStateStore({ get() {} }), (error) => error?.code === "INVALID_PORT");
  assert.throws(() => assertProviderAdapter({ call() {} }), (error) => error?.code === "INVALID_PORT");
  assert.throws(() => assertLeaseStore({ acquire() {}, renew() {} }), (error) => error?.code === "INVALID_PORT");
});
