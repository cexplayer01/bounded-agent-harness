import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, canonicalize, ContractRegistry, FileMemoryStore, executeWorkflow, governanceDigest, heartbeatStatus, sha256 } from "../src/index.mjs";

const workflow = {
  format: "agent-harness.workflow.v1", digest: "sha256:test", budget: { maxCostUnits: 2, compiledCostUnits: 2 },
  steps: [
    { sequence: 0, id: "find", specialist: "researcher", adapter: "mcp.fake", capability: "research.web", authority: "read.workspace", dependsOn: [], input: { q: "x" }, outputContract: "evidence.v1", costUnits: 1, effect: "read" },
    { sequence: 1, id: "review", specialist: "reviewer", adapter: "local.review", capability: "review.evidence", authority: "read.workspace", dependsOn: ["find"], input: {}, outputContract: "review.v1", costUnits: 1, effect: "read" }
  ]
};

test("executor validates handoffs, records costs, and checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root);
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", (v) => v.approved === true);
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => ({ sources: ["primary"] }) })
      .register("local.review", { invoke: async ({ context, handoff }) => ({ approved: context.find.sources.length === 1 && handoff.format === "agent-harness.handoff.v1" }) });
    const result = await executeWorkflow({ workflow, contracts, adapters, memory, runId: "run-1", now: () => 1_800_000_000_000 });
    assert.equal(result.status, "completed");
    assert.equal(result.spentCostUnits, 2);
    assert.equal((await memory.events()).length, 6);
    assert.equal((await memory.readCheckpoint()).status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor verifies an optional governance bundle before invoking steps", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const governance = {
      version: 1,
      authorityMode: "NARROW_ONLY",
      requiredAtomIds: ["contract-review"],
      atoms: [{ id: "contract-review", version: 1, statement: "Handoffs satisfy their contracts.", reviewLevel: 1, enforcementPoints: ["compile", "invoke"], requiredEvidence: [], blastRadius: "low", humanFloorRequired: false, authorityMode: "NARROW_ONLY", status: "ACTIVE" }]
    };
    const governed = { ...structuredClone(workflow), governance: { ...governance, digest: governanceDigest(governance) } };
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", (v) => v.approved === true);
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => ({ sources: ["primary"] }) })
      .register("local.review", { invoke: async () => ({ approved: true }) });
    const memory = new FileMemoryStore(root);
    await executeWorkflow({ workflow: governed, contracts, adapters, memory, runId: "governed-1" });
    assert.equal((await memory.events()).some((event) => event.type === "governance.verified" && event.governanceDigest === governed.governance.digest), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor reveals only dependency fields explicitly projected by the plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const projected = structuredClone(workflow);
    projected.steps[1].contextProjection = { find: ["sources"] };
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", (v) => v.approved === true);
    let received;
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => ({ sources: ["primary"], internalNote: "do not share" }) })
      .register("local.review", { invoke: async ({ context }) => { received = context; return { approved: true }; } });
    await executeWorkflow({ workflow: projected, contracts, adapters, memory: new FileMemoryStore(root), runId: "projection" });
    assert.deepEqual(received, { find: { sources: ["primary"] } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor fails closed when a projected dependency field is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const projected = structuredClone(workflow);
    projected.steps[1].contextProjection = { find: ["requiredField"] };
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", () => true);
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => ({ sources: [] }) })
      .register("local.review", { invoke: async () => ({ approved: true }) });
    await assert.rejects(() => executeWorkflow({ workflow: projected, contracts, adapters, memory: new FileMemoryStore(root), runId: "missing-projection" }), /requires find.requiredField/);
    assert.equal((await new FileMemoryStore(root).events()).some((event) => event.type === "run.failed" && event.code === "CONTEXT_FIELD_MISSING"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("invalid specialist output fails closed with a recovery checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root);
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", () => true);
    const adapters = new AdapterRegistry().register("mcp.fake", { invoke: async () => ({ invented: true }) });
    await assert.rejects(() => executeWorkflow({ workflow, contracts, adapters, memory, runId: "run-2", now: () => 1_800_000_000_000 }), /rejected/);
    const checkpoint = await memory.readCheckpoint();
    assert.deepEqual(checkpoint.completedSteps, []);
    assert.equal(checkpoint.reason, "CONTRACT_REJECTED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("heartbeat exposes liveness without pretending to schedule work", () => {
  assert.equal(heartbeatStatus({ lastReceiptAt: 1000, now: 1500, leaseMs: 1000 }).state, "alive");
  assert.equal(heartbeatStatus({ lastReceiptAt: 1000, now: 2500, leaseMs: 1000 }).recoveryRequired, true);
});

test("event log is hash chained and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root);
    await memory.append({ type: "one" });
    await memory.append({ type: "two" });
    const envelopes = await memory.envelopes();
    assert.equal(envelopes[1].previousHash, envelopes[0].hash);
    const text = await readFile(memory.eventsPath, "utf8");
    await writeFile(memory.eventsPath, text.replace('"type":"one"', '"type":"tampered"'), "utf8");
    await assert.rejects(() => memory.events(), /hash is invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("event log serializes concurrent writers without losing chain integrity", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const writers = Array.from({ length: 4 }, () => new FileMemoryStore(root));
    await Promise.all(Array.from({ length: 24 }, (_, index) => writers[index % writers.length].append({ type: "concurrent", index })));
    const envelopes = await writers[0].envelopes();
    assert.equal(envelopes.length, 24);
    assert.deepEqual(envelopes.map((entry) => entry.sequence), Array.from({ length: 24 }, (_, index) => index));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("event log fails closed when another writer holds its lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root, { lockTimeoutMs: 20, lockRetryMs: 5 });
    await memory.initialize();
    await writeFile(memory.lockPath, "occupied", "utf8");
    await assert.rejects(() => memory.append({ type: "blocked" }), (error) => error.code === "EVENT_LOG_LOCKED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lock inspection distinguishes held, stale-active, orphaned, and unlocked without mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root);
    await memory.initialize();
    await writeFile(memory.lockPath, `${JSON.stringify({ pid: 42, acquiredAt: "2026-01-01T00:00:00.000Z" })}\n`, "utf8");
    assert.equal((await memory.lockStatus({ now: Date.parse("2026-01-01T00:00:01Z"), staleAfterMs: 5000, isProcessAlive: async () => true })).state, "held");
    assert.equal((await memory.lockStatus({ now: Date.parse("2026-01-01T00:00:10Z"), staleAfterMs: 5000, isProcessAlive: async () => true })).state, "stale-active");
    const orphaned = await memory.lockStatus({ now: Date.parse("2026-01-01T00:00:10Z"), staleAfterMs: 5000, isProcessAlive: async () => false });
    assert.equal(orphaned.state, "orphaned");
    assert.equal(orphaned.safeToRemove, true);
    await rm(memory.lockPath);
    assert.equal((await memory.lockStatus()).state, "unlocked");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resume skips completed work and supplies the same external idempotency key", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const resumable = structuredClone(workflow);
    resumable.steps[1].effect = "external";
    resumable.steps[1].idempotencyKey = "customer-42-review-v1";
    const memory = new FileMemoryStore(root);
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", (v) => v.approved === true);
    let researchCalls = 0;
    let externalCalls = 0;
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => { researchCalls += 1; return { sources: ["primary"] }; } })
      .register("local.review", { invoke: async ({ idempotencyKey }) => { externalCalls += 1; assert.equal(idempotencyKey, "customer-42-review-v1"); if (externalCalls === 1) throw new Error("connection lost"); return { approved: true }; } });
    await assert.rejects(() => executeWorkflow({ workflow: resumable, contracts, adapters, memory, runId: "resume-1", now: () => 1_800_000_000_000 }), /connection lost/);
    const result = await executeWorkflow({ workflow: resumable, contracts, adapters, memory, runId: "resume-1", now: () => 1_800_000_000_000, resume: true });
    assert.equal(result.status, "completed");
    assert.equal(researchCalls, 1);
    assert.equal(externalCalls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completed runs cannot be resumed or duplicated", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const memory = new FileMemoryStore(root);
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources)).register("review.v1", (v) => v.approved === true);
    const adapters = new AdapterRegistry()
      .register("mcp.fake", { invoke: async () => ({ sources: [] }) })
      .register("local.review", { invoke: async () => ({ approved: true }) });
    await executeWorkflow({ workflow, contracts, adapters, memory, runId: "finished" });
    const before = (await memory.events()).length;
    await assert.rejects(() => executeWorkflow({ workflow, contracts, adapters, memory, runId: "finished", resume: true }), (error) => error.code === "RUN_ALREADY_COMPLETED");
    assert.equal((await memory.events()).length, before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor records actual bounded usage and rejects cost overruns", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const oneStep = structuredClone(workflow);
    oneStep.steps = [oneStep.steps[0]];
    oneStep.steps[0].costUnits = 4;
    oneStep.budget = { maxCostUnits: 4, compiledCostUnits: 4 };
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources));
    const memory = new FileMemoryStore(join(root, "good"));
    const good = new AdapterRegistry().register("mcp.fake", { invoke: async () => ({ format: "agent-harness.adapter-result.v1", output: { sources: [] }, usage: { costUnits: 2, source: "provider-reported" } }) });
    const result = await executeWorkflow({ workflow: oneStep, contracts, adapters: good, memory, runId: "cost-good" });
    assert.equal(result.spentCostUnits, 2);
    const completed = (await memory.events()).find((event) => event.type === "step.completed");
    assert.equal(completed.reservedCostUnits, 4);
    assert.equal(completed.costUnits, 2);

    const bad = new AdapterRegistry().register("mcp.fake", { invoke: async () => ({ format: "agent-harness.adapter-result.v1", output: { sources: [] }, usage: { costUnits: 5, source: "provider-reported" } }) });
    await assert.rejects(() => executeWorkflow({ workflow: oneStep, contracts, adapters: bad, memory: new FileMemoryStore(join(root, "bad")), runId: "cost-bad" }), /reported 5 cost units/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor rejects a runtime contract registry different from the compiled artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const contracts = new ContractRegistry().register("evidence.v1", () => true, { definition: { required: ["sources"] } });
    const mismatched = structuredClone(workflow);
    mismatched.contracts = [{ id: "evidence.v1", digest: "sha256:not-the-runtime-contract", portability: "portable" }];
    const artifact = structuredClone(mismatched);
    delete artifact.digest;
    mismatched.canonical = canonicalize(artifact);
    mismatched.digest = `sha256:${sha256(artifact)}`;
    await assert.rejects(() => executeWorkflow({ workflow: mismatched, contracts, adapters: new AdapterRegistry(), memory: new FileMemoryStore(root), runId: "contract-drift" }), /does not match the compiled workflow/);
    assert.deepEqual(await memoryEvents(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("approval gates are bound to the exact step and workflow digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-"));
  try {
    const gated = structuredClone(workflow);
    gated.steps = [gated.steps[0]];
    gated.steps[0].approval = { required: true, gateId: "owner.publish" };
    const contracts = new ContractRegistry().register("evidence.v1", (v) => Array.isArray(v.sources));
    const adapters = new AdapterRegistry().register("mcp.fake", { invoke: async () => ({ sources: [] }) });
    await assert.rejects(() => executeWorkflow({ workflow: gated, contracts, adapters, memory: new FileMemoryStore(join(root, "missing")), runId: "gate-missing" }), /requires approval gate/);
    await assert.rejects(() => executeWorkflow({ workflow: gated, contracts, adapters, memory: new FileMemoryStore(join(root, "stale")), runId: "gate-stale", approvals: [{ gateId: "owner.publish", stepId: "find", workflowDigest: "sha256:other", decision: "approved" }] }), /requires approval gate/);
    const memory = new FileMemoryStore(join(root, "approved"));
    const result = await executeWorkflow({ workflow: gated, contracts, adapters, memory, runId: "gate-approved", approvals: [{ gateId: "owner.publish", stepId: "find", workflowDigest: gated.digest, decision: "approved" }] });
    assert.equal(result.status, "completed");
    assert.equal((await memory.events()).some((event) => event.type === "step.approval-verified"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function memoryEvents(root) { return new FileMemoryStore(root).events(); }
