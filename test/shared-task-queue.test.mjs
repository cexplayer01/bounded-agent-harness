import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSharedTask,
  buildTaskResult,
  claimSharedTask,
  completeSharedTask,
  enqueueSharedTask,
  inspectSharedTasks,
  validateSharedTask,
} from "../src/shared-task-queue.mjs";

const base = "a".repeat(40);
const resultCommit = "b".repeat(40);
const taskInput = {
  taskId: "dfw-source-sync",
  createdAt: "2026-09-23T20:00:00.000Z",
  createdBy: "codex",
  assignedTo: "muse",
  repository: { name: "cexplayer01/dfwmetro", url: "https://github.com/cexplayer01/dfwmetro", ref: "main", baseCommit: base },
  objective: "Establish the canonical DFW source and return an immutable preview handoff.",
  allowedPaths: ["CURRENT-HANDOFF.json", "netlify/functions"],
  forbiddenActions: ["no production publish", "no database writes", "no secrets in Git"],
  acceptance: ["source commit is reported", "preview status is reported"],
  expectedOutputs: ["full commit SHA", "test evidence", "next action"],
  externalEffect: "DRAFT_ONLY",
};

function task() {
  return buildSharedTask(taskInput);
}

function taskWith(overrides) {
  return buildSharedTask({ ...taskInput, ...overrides, repository: { ...taskInput.repository, ...(overrides.repository || {}) } });
}

test("shared task identity is deterministic and tamper-evident", () => {
  const first = task();
  const second = task();
  assert.deepEqual(first, second);
  assert.equal(validateSharedTask(first), first);
  assert.throws(() => validateSharedTask({ ...first, objective: "changed" }), (error) => error.code === "TASK_TAMPERED");
});

test("repository task queue claims once and accepts a bound result", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-task-"));
  try {
    const queue = join(root, "tasks");
    const current = task();
    await enqueueSharedTask(queue, current);
    const claim = await claimSharedTask(queue, { taskId: current.taskId, agentId: "muse", claimedAt: "2026-09-23T20:01:00.000Z", leaseMs: 3_600_000 });
    assert.equal(claim.agentId, "muse");
    await assert.rejects(() => claimSharedTask(queue, { taskId: current.taskId, agentId: "muse", claimedAt: "2026-09-23T20:02:00.000Z", leaseMs: 3_600_000 }), (error) => error.code === "TASK_ALREADY_CLAIMED");

    const result = buildTaskResult({
      task: current,
      agentId: "muse",
      status: "COMPLETED",
      startedAt: "2026-09-23T20:01:00.000Z",
      completedAt: "2026-09-23T20:10:00.000Z",
      sourceCommit: base,
      resultCommit,
      changedPaths: ["CURRENT-HANDOFF.json", "netlify/functions/dfwmetro-badge.mjs"],
      tests: [{ id: "source-check", status: "PASS" }],
      externalState: "DRAFT_ONLY",
      nextAction: "Codex verifies the source commit before any production action.",
      rollback: "Revert the result commit or repoint the preview to the prior commit.",
    });
    const resultPath = await completeSharedTask(queue, result);
    assert.equal(JSON.parse(await readFile(resultPath, "utf8")).resultDigest, result.resultDigest);
    assert.deepEqual((await inspectSharedTasks(queue)).map((item) => `${item.state}:${item.taskId}`), ["claims:dfw-source-sync", "ready:dfw-source-sync", "results:dfw-source-sync"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("result cannot escape its declared paths or expired lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-task-"));
  try {
    const queue = join(root, "tasks");
    const current = task();
    await enqueueSharedTask(queue, current);
    await claimSharedTask(queue, { taskId: current.taskId, agentId: "muse", claimedAt: "2026-09-23T20:01:00.000Z", leaseMs: 1_000 });
    const outOfScope = buildTaskResult({
      task: current,
      agentId: "muse",
      status: "COMPLETED",
      startedAt: "2026-09-23T20:01:00.000Z",
      completedAt: "2026-09-23T20:01:00.500Z",
      sourceCommit: base,
      resultCommit,
      changedPaths: ["agent-harness/src/secret.mjs"],
      tests: [],
      externalState: "NOT_EXECUTED",
      nextAction: "Fix the scope before retrying.",
      rollback: "No external change occurred.",
    });
    await assert.rejects(() => completeSharedTask(queue, outOfScope), (error) => error.code === "TASK_SCOPE_VIOLATION");

    const expired = { ...outOfScope, changedPaths: [], completedAt: "2026-09-23T20:02:00.000Z" };
    const { sha256 } = await import("../src/canonical-json.mjs");
    const { resultDigest: _resultDigest, ...unsigned } = expired;
    expired.resultDigest = `sha256:${sha256(unsigned)}`;
    await assert.rejects(() => completeSharedTask(queue, expired), (error) => error.code === "TASK_LEASE_EXPIRED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scope reservations block overlap, permit disjoint work, and release on completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "shared-task-"));
  try {
    const queue = join(root, "tasks");
    const first = task();
    const overlap = taskWith({ taskId: "dfw-overlapping-task", assignedTo: "codex", allowedPaths: ["netlify/functions/dfwmetro-badge.mjs"] });
    const disjoint = taskWith({ taskId: "usb-disjoint-task", assignedTo: "codex", allowedPaths: ["public"] });
    await enqueueSharedTask(queue, first);
    await enqueueSharedTask(queue, overlap);
    await enqueueSharedTask(queue, disjoint);

    await claimSharedTask(queue, { taskId: first.taskId, agentId: "muse", claimedAt: "2026-09-23T20:01:00.000Z", leaseMs: 3_600_000 });
    await assert.rejects(
      () => claimSharedTask(queue, { taskId: overlap.taskId, agentId: "codex", claimedAt: "2026-09-23T20:02:00.000Z", leaseMs: 3_600_000 }),
      (error) => error.code === "TASK_SCOPE_RESERVED",
    );
    await claimSharedTask(queue, { taskId: disjoint.taskId, agentId: "codex", claimedAt: "2026-09-23T20:02:00.000Z", leaseMs: 3_600_000 });

    const firstResult = buildTaskResult({
      task: first,
      agentId: "muse",
      status: "COMPLETED",
      startedAt: "2026-09-23T20:01:00.000Z",
      completedAt: "2026-09-23T20:10:00.000Z",
      sourceCommit: base,
      resultCommit,
      changedPaths: ["netlify/functions/dfwmetro-badge.mjs"],
      tests: [{ id: "scope", status: "PASS" }],
      externalState: "NOT_EXECUTED",
      nextAction: "Codex may now claim the released path if still needed.",
      rollback: "Revert the result commit; no external state changed.",
    });
    await completeSharedTask(queue, firstResult);
    await claimSharedTask(queue, { taskId: overlap.taskId, agentId: "codex", claimedAt: "2026-09-23T20:11:00.000Z", leaseMs: 3_600_000 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
