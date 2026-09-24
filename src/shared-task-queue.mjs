import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

export const SHARED_TASK_FORMAT = "agent-harness.shared-task.v1";
export const SHARED_CLAIM_FORMAT = "agent-harness.shared-task-claim.v1";
export const SHARED_RESULT_FORMAT = "agent-harness.shared-task-result.v1";
export const SHARED_RESERVATION_FORMAT = "agent-harness.shared-task-reservations.v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/i;
const TASK_ID = /^[a-z0-9][a-z0-9._-]{2,80}$/;
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{1,40}$/;
const EFFECTS = new Set(["NONE", "DRAFT_ONLY", "EXPLICIT_GO_REQUIRED"]);
const RESULT_STATUSES = new Set(["COMPLETED", "BLOCKED"]);
const EXTERNAL_STATES = new Set(["NOT_EXECUTED", "DRAFT_ONLY", "LIVE_VERIFIED"]);

function iso(value, field) {
  assert(typeof value === "string" && !Number.isNaN(Date.parse(value)), "INVALID_TASK", `${field} must be an ISO timestamp`);
  return value;
}

function text(value, field, min = 1) {
  assert(typeof value === "string" && value.trim().length >= min, "INVALID_TASK", `${field} must be a non-empty string`);
  return value;
}

function list(value, field) {
  assert(Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim()), "INVALID_TASK", `${field} must be a non-empty string array`);
  return value;
}

function taskId(value) {
  assert(TASK_ID.test(value || ""), "INVALID_TASK", "taskId must use a stable lowercase identifier");
  return value;
}

function agentId(value) {
  assert(AGENT_ID.test(value || ""), "INVALID_TASK", "agentId must use a stable lowercase identifier");
  return value;
}

function digest(value, field) {
  assert(DIGEST.test(value || ""), "INVALID_TASK", `${field} must be a sha256 digest`);
  return value;
}

function commit(value, field, { nullable = false } = {}) {
  assert(nullable && value === null || COMMIT.test(value || ""), "INVALID_TASK", `${field} must be a full 40-character Git commit SHA`);
  return value;
}

function normalizedPath(value, field) {
  text(value, field);
  const normalized = value.replaceAll("\\", "/");
  assert(!normalized.startsWith("/") && !normalized.startsWith("../") && !normalized.includes("/../") && normalized !== ".." && !/^[A-Za-z]:/.test(normalized), "INVALID_TASK", `${field} must be a repository-relative path`);
  return normalized;
}

function taskUnsigned(task) {
  const { taskDigest: _taskDigest, ...unsigned } = task;
  return unsigned;
}

function claimUnsigned(claim) {
  const { claimDigest: _claimDigest, ...unsigned } = claim;
  return unsigned;
}

function resultUnsigned(result) {
  const { resultDigest: _resultDigest, ...unsigned } = result;
  return unsigned;
}

function reservationLedgerUnsigned(ledger) {
  const { ledgerDigest: _ledgerDigest, ...unsigned } = ledger;
  return unsigned;
}

function scopeReservationsPath(queueRoot) {
  return join(queueRoot, "scope-reservations.v1.json");
}

function queueLockPath(queueRoot) {
  return join(queueRoot, ".scope-reservation.lock");
}

function taskPaths(queueRoot, id) {
  return {
    ready: join(queueRoot, "ready", `${id}.json`),
    claim: join(queueRoot, "claims", `${id}.json`),
    result: join(queueRoot, "results", `${id}.json`),
  };
}

async function readJson(path, code = "TASK_NOT_FOUND") {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw Object.assign(new Error(`shared task file not found: ${path}`), { code });
    throw error;
  }
}

async function writeExclusive(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function withQueueLock(queueRoot, action) {
  await mkdir(queueRoot, { recursive: true });
  const lock = queueLockPath(queueRoot);
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") throw Object.assign(new Error("scope reservation ledger is locked by another local writer"), { code: "QUEUE_LOCKED" });
    throw error;
  }
  try { return await action(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

function assertRepository(repository) {
  assert(repository && typeof repository === "object", "INVALID_TASK", "repository is required");
  text(repository.name, "repository.name");
  text(repository.url, "repository.url");
  text(repository.ref, "repository.ref");
  commit(repository.baseCommit, "repository.baseCommit");
}

export function buildSharedTask({
  taskId: id,
  createdAt = new Date().toISOString(),
  createdBy,
  assignedTo,
  repository,
  objective,
  allowedPaths,
  forbiddenActions,
  acceptance,
  expectedOutputs,
  externalEffect = "NONE",
}) {
  const task = {
    format: SHARED_TASK_FORMAT,
    version: 1,
    taskId: taskId(id),
    createdAt: iso(createdAt, "createdAt"),
    createdBy: agentId(createdBy),
    assignedTo: assignedTo === "*" ? "*" : agentId(assignedTo),
    repository: {
      name: text(repository?.name, "repository.name"),
      url: text(repository?.url, "repository.url"),
      ref: text(repository?.ref, "repository.ref"),
      baseCommit: commit(repository?.baseCommit, "repository.baseCommit"),
    },
    objective: text(objective, "objective"),
    allowedPaths: list(allowedPaths, "allowedPaths").map((value) => normalizedPath(value, "allowedPaths item")),
    forbiddenActions: list(forbiddenActions, "forbiddenActions"),
    acceptance: list(acceptance, "acceptance"),
    expectedOutputs: list(expectedOutputs, "expectedOutputs"),
    externalEffect: EFFECTS.has(externalEffect) ? externalEffect : (() => { throw new Error(`externalEffect must be one of ${[...EFFECTS].join(", ")}`); })(),
  };
  return { ...task, taskDigest: `sha256:${sha256(task)}` };
}

export function validateSharedTask(task) {
  assert(task?.format === SHARED_TASK_FORMAT && task.version === 1, "INVALID_TASK", `${SHARED_TASK_FORMAT} is required`);
  taskId(task.taskId);
  iso(task.createdAt, "createdAt");
  agentId(task.createdBy);
  assert(task.assignedTo === "*" || AGENT_ID.test(task.assignedTo || ""), "INVALID_TASK", "assignedTo must be an agent id or *");
  assertRepository(task.repository);
  text(task.objective, "objective");
  list(task.allowedPaths, "allowedPaths").forEach((value) => normalizedPath(value, "allowedPaths item"));
  list(task.forbiddenActions, "forbiddenActions");
  list(task.acceptance, "acceptance");
  list(task.expectedOutputs, "expectedOutputs");
  assert(EFFECTS.has(task.externalEffect), "INVALID_TASK", "externalEffect is unsupported");
  digest(task.taskDigest, "taskDigest");
  assert(task.taskDigest === `sha256:${sha256(taskUnsigned(task))}`, "TASK_TAMPERED", "taskDigest does not match task contents");
  return task;
}

function scopeOverlaps(left, right) {
  return left === right || left.startsWith(`${right.replace(/\/$/, "")}/`) || right.startsWith(`${left.replace(/\/$/, "")}/`);
}

function reservationOverlaps(taskPaths, reservedPaths) {
  return taskPaths.some((left) => reservedPaths.some((right) => scopeOverlaps(left, right)));
}

function buildReservationLedger(reservations) {
  const unsigned = {
    format: SHARED_RESERVATION_FORMAT,
    version: 1,
    reservations: reservations
      .map((reservation) => ({ ...reservation, allowedPaths: [...reservation.allowedPaths].sort() }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
  };
  return { ...unsigned, ledgerDigest: `sha256:${sha256(unsigned)}` };
}

function validateReservationLedger(ledger) {
  assert(ledger?.format === SHARED_RESERVATION_FORMAT && ledger.version === 1, "INVALID_RESERVATION_LEDGER", `${SHARED_RESERVATION_FORMAT} is required`);
  assert(Array.isArray(ledger.reservations), "INVALID_RESERVATION_LEDGER", "reservations must be an array");
  for (const reservation of ledger.reservations) {
    taskId(reservation.taskId);
    digest(reservation.taskDigest, "reservation.taskDigest");
    agentId(reservation.agentId);
    assert(Array.isArray(reservation.allowedPaths) && reservation.allowedPaths.length > 0, "INVALID_RESERVATION_LEDGER", "reservation.allowedPaths must be non-empty");
    reservation.allowedPaths.forEach((path) => normalizedPath(path, "reservation.allowedPaths item"));
    iso(reservation.claimedAt, "reservation.claimedAt");
    iso(reservation.expiresAt, "reservation.expiresAt");
    assert(Date.parse(reservation.expiresAt) > Date.parse(reservation.claimedAt), "INVALID_RESERVATION_LEDGER", "reservation expiresAt must follow claimedAt");
  }
  for (let index = 0; index < ledger.reservations.length; index += 1) {
    for (let other = index + 1; other < ledger.reservations.length; other += 1) {
      assert(!reservationOverlaps(ledger.reservations[index].allowedPaths, ledger.reservations[other].allowedPaths), "RESERVATION_OVERLAP", "active task reservations overlap");
    }
  }
  digest(ledger.ledgerDigest, "ledgerDigest");
  assert(ledger.ledgerDigest === `sha256:${sha256(reservationLedgerUnsigned(ledger))}`, "RESERVATION_LEDGER_TAMPERED", "ledgerDigest does not match reservation contents");
  return ledger;
}

async function loadReservationLedger(queueRoot) {
  const path = scopeReservationsPath(queueRoot);
  const raw = await readOptionalJson(path);
  return { path, ledger: raw ? validateReservationLedger(raw) : buildReservationLedger([]), raw };
}

function activeReservations(ledger, now) {
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  return ledger.reservations.filter((reservation) => Date.parse(reservation.expiresAt) > current);
}

async function writeLedgerWithRollback(path, nextLedger, previousRaw, action) {
  await writeFile(path, `${JSON.stringify(nextLedger, null, 2)}\n`, { encoding: "utf8" });
  try {
    return await action();
  } catch (error) {
    if (previousRaw === null) await unlink(path).catch(() => {});
    else await writeFile(path, previousRaw, { encoding: "utf8" });
    throw error;
  }
}

export function buildTaskClaim({ task, agentId: worker, claimedAt = new Date().toISOString(), leaseMs = 30 * 60 * 1000 }) {
  validateSharedTask(task);
  agentId(worker);
  assert(task.assignedTo === "*" || task.assignedTo === worker, "TASK_ASSIGNMENT_MISMATCH", `task is assigned to ${task.assignedTo}, not ${worker}`);
  iso(claimedAt, "claimedAt");
  assert(Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= 24 * 60 * 60 * 1000, "INVALID_TASK", "leaseMs must be a positive integer no longer than 24 hours");
  const claim = {
    format: SHARED_CLAIM_FORMAT,
    version: 1,
    taskId: task.taskId,
    taskDigest: task.taskDigest,
    agentId: worker,
    claimedAt,
    expiresAt: new Date(Date.parse(claimedAt) + leaseMs).toISOString(),
  };
  return { ...claim, claimDigest: `sha256:${sha256(claim)}` };
}

export function validateTaskClaim(claim, { task, now = new Date() } = {}) {
  assert(claim?.format === SHARED_CLAIM_FORMAT && claim.version === 1, "INVALID_TASK_CLAIM", `${SHARED_CLAIM_FORMAT} is required`);
  taskId(claim.taskId);
  digest(claim.taskDigest, "taskDigest");
  agentId(claim.agentId);
  iso(claim.claimedAt, "claimedAt");
  iso(claim.expiresAt, "expiresAt");
  assert(Date.parse(claim.expiresAt) > Date.parse(claim.claimedAt), "INVALID_TASK_CLAIM", "expiresAt must follow claimedAt");
  digest(claim.claimDigest, "claimDigest");
  assert(claim.claimDigest === `sha256:${sha256(claimUnsigned(claim))}`, "TASK_CLAIM_TAMPERED", "claimDigest does not match claim contents");
  if (task) {
    validateSharedTask(task);
    assert(claim.taskId === task.taskId && claim.taskDigest === task.taskDigest, "TASK_CLAIM_MISMATCH", "claim does not bind to the task");
  }
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  assert(!Number.isNaN(current), "INVALID_TASK_CLAIM", "now must be a valid timestamp");
  return { ...claim, expired: current >= Date.parse(claim.expiresAt) };
}

function pathAllowed(path, allowedPaths) {
  const normalized = normalizedPath(path, "changedPaths item");
  return allowedPaths.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed.replace(/\/$/, "")}/`));
}

export function buildTaskResult({
  task,
  agentId: worker,
  status,
  startedAt,
  completedAt = new Date().toISOString(),
  sourceCommit,
  resultCommit = null,
  changedPaths = [],
  tests,
  externalState = "NOT_EXECUTED",
  nextAction,
  rollback,
  notes = "",
}) {
  validateSharedTask(task);
  const result = {
    format: SHARED_RESULT_FORMAT,
    version: 1,
    taskId: task.taskId,
    taskDigest: task.taskDigest,
    agentId: agentId(worker),
    status,
    startedAt: iso(startedAt, "startedAt"),
    completedAt: iso(completedAt, "completedAt"),
    sourceCommit: commit(sourceCommit, "sourceCommit"),
    resultCommit: commit(resultCommit, "resultCommit", { nullable: true }),
    changedPaths: Array.isArray(changedPaths) ? changedPaths.map((path) => normalizedPath(path, "changedPaths item")) : (() => { throw new Error("changedPaths must be an array"); })(),
    tests: Array.isArray(tests) ? tests : (() => { throw new Error("tests must be an array"); })(),
    externalState,
    nextAction: text(nextAction, "nextAction"),
    rollback: text(rollback, "rollback"),
    notes: typeof notes === "string" ? notes : (() => { throw new Error("notes must be a string"); })(),
  };
  return { ...result, resultDigest: `sha256:${sha256(result)}` };
}

export function validateTaskResult(result, { task, claim, now = new Date() } = {}) {
  assert(result?.format === SHARED_RESULT_FORMAT && result.version === 1, "INVALID_TASK_RESULT", `${SHARED_RESULT_FORMAT} is required`);
  validateSharedTask(task);
  const checkedClaim = validateTaskClaim(claim, { task, now });
  assert(!checkedClaim.expired, "TASK_LEASE_EXPIRED", "task claim lease has expired");
  assert(result.taskId === task.taskId && result.taskDigest === task.taskDigest, "TASK_RESULT_MISMATCH", "result does not bind to the task");
  assert(result.agentId === checkedClaim.agentId, "TASK_RESULT_AGENT_MISMATCH", "result agent does not match the claim");
  assert(RESULT_STATUSES.has(result.status), "INVALID_TASK_RESULT", "result status is unsupported");
  iso(result.startedAt, "startedAt");
  iso(result.completedAt, "completedAt");
  assert(Date.parse(result.completedAt) >= Date.parse(result.startedAt), "INVALID_TASK_RESULT", "completedAt must follow startedAt");
  commit(result.sourceCommit, "sourceCommit");
  commit(result.resultCommit, "resultCommit", { nullable: true });
  assert(result.status === "BLOCKED" ? result.resultCommit === null : COMMIT.test(result.resultCommit || ""), "INVALID_TASK_RESULT", "completed results require resultCommit and blocked results require null resultCommit");
  assert(Array.isArray(result.changedPaths) && result.changedPaths.every((path) => pathAllowed(path, task.allowedPaths)), "TASK_SCOPE_VIOLATION", "result contains a changed path outside the task scope");
  assert(Array.isArray(result.tests), "INVALID_TASK_RESULT", "tests must be an array");
  assert(EXTERNAL_STATES.has(result.externalState), "INVALID_TASK_RESULT", "externalState is unsupported");
  text(result.nextAction, "nextAction");
  text(result.rollback, "rollback");
  assert(typeof result.notes === "string", "INVALID_TASK_RESULT", "notes must be a string");
  digest(result.resultDigest, "resultDigest");
  assert(result.resultDigest === `sha256:${sha256(resultUnsigned(result))}`, "TASK_RESULT_TAMPERED", "resultDigest does not match result contents");
  return result;
}

export async function enqueueSharedTask(queueRoot, task) {
  validateSharedTask(task);
  const paths = taskPaths(queueRoot, task.taskId);
  await writeExclusive(paths.ready, task);
  return paths.ready;
}

export async function claimSharedTask(queueRoot, { taskId: id, agentId: worker, claimedAt, leaseMs }) {
  return withQueueLock(queueRoot, async () => {
    const paths = taskPaths(queueRoot, taskId(id));
    const task = validateSharedTask(await readJson(paths.ready));
    const claim = buildTaskClaim({ task, agentId: worker, claimedAt, leaseMs });
    const existingClaim = await readOptionalJson(paths.claim);
    assert(existingClaim === null, "TASK_ALREADY_CLAIMED", "task already has an immutable claim");
    const { path: ledgerPath, ledger, raw: previousRaw } = await loadReservationLedger(queueRoot);
    const currentReservations = activeReservations(ledger, claim.claimedAt);
    assert(!currentReservations.some((reservation) => reservation.taskId === task.taskId), "TASK_ALREADY_CLAIMED", "task already has an active scope reservation");
    const conflicting = currentReservations.find((reservation) => reservationOverlaps(task.allowedPaths, reservation.allowedPaths));
    assert(!conflicting, "TASK_SCOPE_RESERVED", conflicting ? `task scope overlaps active reservation ${conflicting.taskId}` : "task scope overlaps an active reservation");
    const reservation = {
      taskId: task.taskId,
      taskDigest: task.taskDigest,
      agentId: claim.agentId,
      allowedPaths: task.allowedPaths,
      claimedAt: claim.claimedAt,
      expiresAt: claim.expiresAt,
    };
    const nextLedger = buildReservationLedger([...currentReservations, reservation]);
    return writeLedgerWithRollback(ledgerPath, nextLedger, previousRaw, async () => {
      await writeExclusive(paths.claim, claim);
      return claim;
    });
  });
}

export async function completeSharedTask(queueRoot, result) {
  return withQueueLock(queueRoot, async () => {
    const paths = taskPaths(queueRoot, taskId(result?.taskId));
    const task = validateSharedTask(await readJson(paths.ready));
    const claim = await readJson(paths.claim);
    validateTaskResult(result, { task, claim, now: result.completedAt });
    const existingResult = await readOptionalJson(paths.result);
    assert(existingResult === null, "TASK_ALREADY_COMPLETED", "task already has an immutable result");
    const { path: ledgerPath, ledger, raw: previousRaw } = await loadReservationLedger(queueRoot);
    const nextLedger = buildReservationLedger(ledger.reservations.filter((reservation) => reservation.taskId !== task.taskId));
    return writeLedgerWithRollback(ledgerPath, nextLedger, previousRaw, async () => {
      await writeExclusive(paths.result, result);
      return paths.result;
    });
  });
}

export async function inspectSharedTasks(queueRoot) {
  const output = [];
  for (const state of ["ready", "claims", "results"]) {
    const directory = join(queueRoot, state);
    let names = [];
    try { names = await readdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const item = JSON.parse(await readFile(join(directory, name), "utf8"));
      output.push({ state, taskId: item.taskId, digest: item.taskDigest, agentId: item.agentId || null, status: item.status || null, path: join(directory, name) });
    }
  }
  return output.sort((left, right) => `${left.taskId}:${left.state}`.localeCompare(`${right.taskId}:${right.state}`));
}

export function sharedTaskDirectory(root) {
  const value = join(root, ".agent-harness", "tasks");
  assert(relative(root, value).split(sep)[0] !== "..", "INVALID_TASK_QUEUE", "task queue must live under the repository root");
  return value;
}
