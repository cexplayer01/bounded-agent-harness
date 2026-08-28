import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.mjs";
import { FileMemoryStore } from "../src/memory-store.mjs";

const examples = new URL("../examples/", import.meta.url);
const path = (name) => decodeURIComponent(new URL(name, examples).pathname).replace(/^\/(.:\/)/, "$1");
const silent = { out: () => {}, err: () => {} };

test("CLI validates and deterministically compiles example files", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-cli-"));
  try {
    const output = join(root, "workflow.json");
    const validated = await runCli(["validate", "--plan", path("review-plan.json"), "--specialists", path("specialists.json")], silent);
    assert.equal(validated.valid, true);
    const compiled = await runCli(["compile", "--plan", path("review-plan.json"), "--specialists", path("specialists.json"), "--contracts", path("contracts.json"), "--output", output], silent);
    assert.match(compiled.digest, /^sha256:/);
    await assert.rejects(() => runCli(["compile", "--plan", path("review-plan.json"), "--specialists", path("specialists.json"), "--contracts", path("contracts.json"), "--output", output], silent), (error) => error.code === "EEXIST");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI inspection verifies the event chain and reports its head", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-cli-"));
  try {
    const memory = new FileMemoryStore(root);
    await memory.append({ type: "proof" });
    const result = await runCli(["inspect", "--memory", root], silent);
    assert.equal(result.events, 1);
    assert.match(result.headHash, /^sha256:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI heartbeat reports expired leases", async () => {
  const result = await runCli(["heartbeat", "--last", "2026-01-01T00:00:00Z", "--now", "2026-01-01T00:00:02Z", "--lease-ms", "1000"], silent);
  assert.equal(result.recoveryRequired, true);
});

test("CLI runs a compiled workflow locally and can inspect its evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-cli-"));
  try {
    const output = join(root, "workflow.json");
    await runCli(["compile", "--plan", path("review-plan.json"), "--specialists", path("specialists.json"), "--contracts", path("contracts.json"), "--output", output], silent);
    const result = await runCli([
      "run", "--workflow", output,
      "--contracts", path("contracts.json"),
      "--adapters", path("local-adapters.json"),
      "--memory", join(root, "run"), "--run-id", "cli-run-1"
    ], silent);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.outputs.review, { findings: [] });
    const inspected = await runCli(["inspect", "--memory", join(root, "run")], silent);
    assert.equal(inspected.checkpoint.status, "completed");
    assert.equal(inspected.runs[0].status, "completed");
    assert.equal(inspected.runs[0].reservedCostUnits, 7);
    await assert.rejects(() => runCli([
      "run", "--workflow", output,
      "--contracts", path("contracts.json"),
      "--adapters", path("local-adapters.json"),
      "--memory", join(root, "run"), "--run-id", "cli-run-1"
    ], silent), /explicit resume/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
