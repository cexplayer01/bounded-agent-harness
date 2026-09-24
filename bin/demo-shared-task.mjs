import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSharedTask,
  buildTaskResult,
  claimSharedTask,
  completeSharedTask,
  enqueueSharedTask,
} from "../src/shared-task-queue.mjs";

const syntheticBaseCommit = "a".repeat(40);
const syntheticResultCommit = "b".repeat(40);
const repository = {
  name: "synthetic/coordination-rehearsal",
  url: "https://example.invalid/synthetic/coordination-rehearsal",
  ref: "main",
  baseCommit: syntheticBaseCommit,
};

function task(taskId, assignedTo, allowedPaths, objective) {
  return buildSharedTask({
    taskId,
    createdAt: "2026-09-24T04:00:00.000Z",
    createdBy: "codex",
    assignedTo,
    repository,
    objective,
    allowedPaths,
    forbiddenActions: ["no production effects", "no secrets", "no canonical-branch edits"],
    acceptance: ["claim is immutable", "scope decision is observable", "result is digest-bound"],
    expectedOutputs: ["task result packet", "test evidence", "next action"],
    externalEffect: "NONE",
  });
}

const root = await mkdtemp(join(tmpdir(), "agent-harness-shared-task-demo-"));
const queue = join(root, "tasks");

try {
  const first = task("demo-primary-scope", "codex", ["demo/alpha"], "Hold the alpha demo scope.");
  const overlap = task("demo-overlapping-scope", "muse", ["demo/alpha/index.mjs"], "Attempt an overlapping scope.");
  const disjoint = task("demo-disjoint-scope", "muse", ["demo/beta"], "Claim an independent scope.");
  await Promise.all([first, overlap, disjoint].map((item) => enqueueSharedTask(queue, item)));

  await claimSharedTask(queue, { taskId: first.taskId, agentId: "codex", claimedAt: "2026-09-24T04:01:00.000Z", leaseMs: 3_600_000 });
  let overlapBlocked = false;
  let overlapCode = null;
  try {
    await claimSharedTask(queue, { taskId: overlap.taskId, agentId: "muse", claimedAt: "2026-09-24T04:02:00.000Z", leaseMs: 3_600_000 });
  } catch (error) {
    overlapBlocked = error.code === "TASK_SCOPE_RESERVED";
    overlapCode = error.code || "UNKNOWN";
  }
  await claimSharedTask(queue, { taskId: disjoint.taskId, agentId: "muse", claimedAt: "2026-09-24T04:02:00.000Z", leaseMs: 3_600_000 });

  const firstResult = buildTaskResult({
    task: first,
    agentId: "codex",
    status: "COMPLETED",
    startedAt: "2026-09-24T04:01:00.000Z",
    completedAt: "2026-09-24T04:03:00.000Z",
    sourceCommit: syntheticBaseCommit,
    resultCommit: syntheticResultCommit,
    changedPaths: [],
    tests: [{ id: "synthetic-scope-rehearsal", status: "PASS" }],
    externalState: "NOT_EXECUTED",
    nextAction: "The released alpha scope may be claimed by the next eligible worker.",
    rollback: "Delete the temporary rehearsal directory; no repository or external state changed.",
  });
  await completeSharedTask(queue, firstResult);
  await claimSharedTask(queue, { taskId: overlap.taskId, agentId: "muse", claimedAt: "2026-09-24T04:04:00.000Z", leaseMs: 3_600_000 });

  console.log(JSON.stringify({
    format: "agent-harness.shared-task-demo.v1",
    pass: overlapBlocked && overlapCode === "TASK_SCOPE_RESERVED",
    assertions: {
      overlappingScopeBlocked: overlapBlocked,
      blockedCode: overlapCode,
      disjointScopeClaimed: true,
      releasedScopeReclaimed: true,
      externalState: "NOT_EXECUTED",
    },
    cleanup: "temporary queue removed after output",
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
