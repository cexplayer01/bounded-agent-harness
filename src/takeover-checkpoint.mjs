const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "recorded_at_utc",
  "repository",
  "continuation",
  "evidence",
  "preservation_register",
  "authority"
]);

const REPOSITORY_KEYS = new Set(["branch", "head", "tracked_source_state", "expected_git_status"]);
const CONTINUATION_KEYS = new Set([
  "phase",
  "status",
  "objective",
  "last_completed",
  "in_progress",
  "next_step",
  "resume_command",
  "do_not_repeat"
]);
const EVIDENCE_KEYS = new Set(["tests", "live", "known_problems"]);
const AUTHORITY_KEYS = new Set(["next_action", "go_required", "blocked_actions"]);
const REGISTER_KEYS = new Set([
  "path",
  "kind",
  "classification",
  "state",
  "action",
  "provenance",
  "owner_decision_required",
  "availability",
  "sha256",
  "required_for"
]);

const CHECKPOINT_SCHEMA_VERSION = "usb-takeover-checkpoint.v1";
const TRACKED_SOURCE_STATES = new Set(["CLEAN", "CLEAN_WITH_PRESERVED_UNTRACKED", "IN_PROGRESS"]);
const CONTINUATION_STATUSES = new Set(["READY", "IN_PROGRESS", "BLOCKED", "WAITING_FOR_OWNER", "COMPLETE"]);
const REGISTER_KINDS = new Set(["FILE", "DIRECTORY"]);
const REGISTER_STATES = new Set(["PRESERVE", "CURRENT", "HISTORICAL", "REBUILDABLE"]);
const REGISTER_ACTIONS = new Set([
  "PRESERVE_IN_PLACE",
  "PRESERVE_UNTIL_OWNER_DECISION",
  "REBUILD_FROM_SOURCE",
  "DO_NOT_TOUCH"
]);
const STATUS_CODES = /^[ MADRCU?!]{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const AVAILABILITIES = new Set(["REPOSITORY", "LOCAL_ONLY", "EXTERNAL"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function add(findings, code, path, message) {
  findings.push({ code, path, message });
}

function checkKeys(value, allowed, path, findings) {
  if (!isObject(value)) {
    add(findings, "OBJECT_REQUIRED", path, "an object is required");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(findings, "UNKNOWN_FIELD", `${path}.${key}`, "field is not part of the checkpoint contract");
  }
  return true;
}

function requiredString(value, path, findings) {
  if (typeof value !== "string" || value.trim() === "") {
    add(findings, "STRING_REQUIRED", path, "a non-empty string is required");
    return false;
  }
  return true;
}

function requiredArray(value, path, findings) {
  if (!Array.isArray(value)) {
    add(findings, "ARRAY_REQUIRED", path, "an array is required");
    return false;
  }
  return true;
}

function validRelativePath(value) {
  return typeof value === "string" && value !== "" && !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value) && !value.split("/").includes("..") && !value.includes("\\");
}

function statusKey(entry) {
  return `${entry.code}\u0000${entry.path}`;
}

function normalizeStatuses(entries) {
  return entries.map((entry) => ({ code: entry.code, path: entry.path, availability: entry.availability })).sort((a, b) => statusKey(a).localeCompare(statusKey(b)));
}

function compareStatuses(expected, actual, findings, warnings) {
  const expectedKeys = new Set(expected.map(statusKey));
  const actualKeys = new Set(actual.map(statusKey));
  for (const entry of expected) {
    if (!actualKeys.has(statusKey(entry))) {
      if (entry.availability === "LOCAL_ONLY") warnings.push({ code: "LOCAL_ONLY_STATUS_UNAVAILABLE", path: `repository.expected_git_status.${entry.path}`, message: "local-only Git status is absent on this machine; the source checkout may still be continued" });
      else add(findings, "GIT_STATUS_MISMATCH", `repository.expected_git_status.${entry.path}`, "checkpoint expects a Git status entry that is not present");
    }
  }
  for (const entry of actual) {
    if (!expectedKeys.has(statusKey(entry))) add(findings, "UNREGISTERED_GIT_CHANGE", `repository.actual_git_status.${entry.path}`, "current Git status is not recorded in the checkpoint");
  }
}

export function validateTakeoverCheckpoint(checkpoint, { gitSnapshot = null, fileSnapshot = null } = {}) {
  const findings = [];
  const warnings = [];
  if (!checkKeys(checkpoint, TOP_LEVEL_KEYS, "$", findings)) return { valid: false, findings, warnings };
  if (checkpoint.schema_version !== CHECKPOINT_SCHEMA_VERSION) add(findings, "SCHEMA_VERSION_MISMATCH", "schema_version", `expected ${CHECKPOINT_SCHEMA_VERSION}`);
  if (requiredString(checkpoint.recorded_at_utc, "recorded_at_utc", findings) && Number.isNaN(Date.parse(checkpoint.recorded_at_utc))) add(findings, "INVALID_TIMESTAMP", "recorded_at_utc", "must be an ISO-8601 timestamp");

  if (checkKeys(checkpoint.repository, REPOSITORY_KEYS, "repository", findings)) {
    requiredString(checkpoint.repository.branch, "repository.branch", findings);
    if (requiredString(checkpoint.repository.head, "repository.head", findings) && !/^[a-f0-9]{40}$/.test(checkpoint.repository.head)) add(findings, "INVALID_GIT_HEAD", "repository.head", "must be a 40-character lowercase commit SHA");
    if (!TRACKED_SOURCE_STATES.has(checkpoint.repository.tracked_source_state)) add(findings, "INVALID_TRACKED_SOURCE_STATE", "repository.tracked_source_state", "unsupported tracked-source state");
    if (requiredArray(checkpoint.repository.expected_git_status, "repository.expected_git_status", findings)) {
      const seen = new Set();
      for (const [index, entry] of checkpoint.repository.expected_git_status.entries()) {
        const path = `repository.expected_git_status[${index}]`;
        if (!checkKeys(entry, new Set(["code", "path", "availability"]), path, findings)) continue;
        if (!STATUS_CODES.test(entry.code)) add(findings, "INVALID_GIT_STATUS", `${path}.code`, "must be a two-character porcelain status code");
        if (!validRelativePath(entry.path)) add(findings, "INVALID_REPOSITORY_PATH", `${path}.path`, "must be a repository-relative forward-slash path");
        if (!AVAILABILITIES.has(entry.availability)) add(findings, "INVALID_AVAILABILITY", `${path}.availability`, "must state whether the item is in Git, local-only, or external");
        const key = statusKey(entry);
        if (seen.has(key)) add(findings, "DUPLICATE_GIT_STATUS", path, "status entry is duplicated");
        seen.add(key);
      }
    }
  }

  if (checkKeys(checkpoint.continuation, CONTINUATION_KEYS, "continuation", findings)) {
    for (const key of ["phase", "objective", "last_completed", "next_step", "resume_command"]) requiredString(checkpoint.continuation[key], `continuation.${key}`, findings);
    if (!CONTINUATION_STATUSES.has(checkpoint.continuation.status)) add(findings, "INVALID_CONTINUATION_STATUS", "continuation.status", "unsupported continuation status");
    if (checkpoint.continuation.in_progress !== null) requiredString(checkpoint.continuation.in_progress, "continuation.in_progress", findings);
    if (requiredArray(checkpoint.continuation.do_not_repeat, "continuation.do_not_repeat", findings)) {
      checkpoint.continuation.do_not_repeat.forEach((value, index) => requiredString(value, `continuation.do_not_repeat[${index}]`, findings));
    }
  }

  if (checkKeys(checkpoint.evidence, EVIDENCE_KEYS, "evidence", findings)) {
    if (requiredArray(checkpoint.evidence.tests, "evidence.tests", findings)) {
      checkpoint.evidence.tests.forEach((entry, index) => {
        const path = `evidence.tests[${index}]`;
        if (!checkKeys(entry, new Set(["name", "result", "summary"]), path, findings)) return;
        requiredString(entry.name, `${path}.name`, findings);
        if (!new Set(["PASS", "KNOWN_FAILURE", "NOT_RUN"]).has(entry.result)) add(findings, "INVALID_TEST_RESULT", `${path}.result`, "unsupported test result");
        requiredString(entry.summary, `${path}.summary`, findings);
      });
    }
    if (requiredArray(checkpoint.evidence.live, "evidence.live", findings)) {
      checkpoint.evidence.live.forEach((entry, index) => {
        const path = `evidence.live[${index}]`;
        if (!checkKeys(entry, new Set(["target", "result", "observed_on", "deployment_id", "rollback_deployment_id", "effect_boundary"]), path, findings)) return;
        requiredString(entry.target, `${path}.target`, findings);
        requiredString(entry.observed_on, `${path}.observed_on`, findings);
        requiredString(entry.effect_boundary, `${path}.effect_boundary`, findings);
        if (!new Set(["PASS", "NOT_APPLICABLE", "KNOWN_FAILURE"]).has(entry.result)) add(findings, "INVALID_LIVE_RESULT", `${path}.result`, "unsupported live evidence result");
        if (entry.result === "PASS") {
          requiredString(entry.deployment_id, `${path}.deployment_id`, findings);
          requiredString(entry.rollback_deployment_id, `${path}.rollback_deployment_id`, findings);
        }
      });
    }
    if (requiredArray(checkpoint.evidence.known_problems, "evidence.known_problems", findings)) {
      checkpoint.evidence.known_problems.forEach((entry, index) => {
        const path = `evidence.known_problems[${index}]`;
        if (!checkKeys(entry, new Set(["scope", "status", "summary", "next_action"]), path, findings)) return;
        requiredString(entry.scope, `${path}.scope`, findings);
        requiredString(entry.status, `${path}.status`, findings);
        requiredString(entry.summary, `${path}.summary`, findings);
        requiredString(entry.next_action, `${path}.next_action`, findings);
      });
    }
  }

  const registeredPaths = new Set();
  if (requiredArray(checkpoint.preservation_register, "preservation_register", findings)) {
    checkpoint.preservation_register.forEach((entry, index) => {
      const path = `preservation_register[${index}]`;
      if (!checkKeys(entry, REGISTER_KEYS, path, findings)) return;
      if (!validRelativePath(entry.path)) add(findings, "INVALID_PRESERVATION_PATH", `${path}.path`, "must be a repository-relative forward-slash path");
      if (registeredPaths.has(entry.path)) add(findings, "DUPLICATE_PRESERVATION_PATH", `${path}.path`, "path is registered more than once");
      registeredPaths.add(entry.path);
      if (!REGISTER_KINDS.has(entry.kind)) add(findings, "INVALID_PRESERVATION_KIND", `${path}.kind`, "unsupported preservation kind");
      if (!REGISTER_STATES.has(entry.state)) add(findings, "INVALID_PRESERVATION_STATE", `${path}.state`, "unsupported preservation state");
      if (!REGISTER_ACTIONS.has(entry.action)) add(findings, "INVALID_PRESERVATION_ACTION", `${path}.action`, "unsupported preservation action");
      requiredString(entry.classification, `${path}.classification`, findings);
      requiredString(entry.provenance, `${path}.provenance`, findings);
      if (typeof entry.owner_decision_required !== "boolean") add(findings, "BOOLEAN_REQUIRED", `${path}.owner_decision_required`, "must explicitly state whether owner decision is required");
      if (!AVAILABILITIES.has(entry.availability)) add(findings, "INVALID_AVAILABILITY", `${path}.availability`, "must state whether the item is in Git, local-only, or external");
      if (entry.sha256 !== undefined && !SHA256.test(entry.sha256)) add(findings, "INVALID_SHA256", `${path}.sha256`, "must be a lowercase SHA-256 digest");
      if (entry.required_for !== undefined) requiredString(entry.required_for, `${path}.required_for`, findings);
    });
  }

  if (checkKeys(checkpoint.authority, AUTHORITY_KEYS, "authority", findings)) {
    requiredString(checkpoint.authority.next_action, "authority.next_action", findings);
    if (typeof checkpoint.authority.go_required !== "boolean") add(findings, "BOOLEAN_REQUIRED", "authority.go_required", "must state whether the next action needs an owner GO");
    if (requiredArray(checkpoint.authority.blocked_actions, "authority.blocked_actions", findings)) checkpoint.authority.blocked_actions.forEach((value, index) => requiredString(value, `authority.blocked_actions[${index}]`, findings));
  }

  if (gitSnapshot) {
    if (checkpoint.repository.branch !== gitSnapshot.branch) add(findings, "GIT_BRANCH_MISMATCH", "repository.branch", "checkpoint branch does not match the current branch");
    const checkpointCommitOnly = gitSnapshot.head_parent === checkpoint.repository.head && Array.isArray(gitSnapshot.head_parent_paths) && gitSnapshot.head_parent_paths.length === 1 && gitSnapshot.head_parent_paths[0] === "Project Brain/TAKEOVER-CHECKPOINT.v1.json";
    if (checkpoint.repository.head !== gitSnapshot.head && !checkpointCommitOnly) add(findings, "GIT_HEAD_MISMATCH", "repository.head", "checkpoint commit does not match the current commit or a checkpoint-only follow-up commit");
    compareStatuses(normalizeStatuses(checkpoint.repository.expected_git_status), normalizeStatuses(gitSnapshot.status), findings, warnings);
    for (const entry of gitSnapshot.status.filter((item) => item.code === "??")) {
      if (!registeredPaths.has(entry.path)) add(findings, "UNREGISTERED_UNTRACKED_PATH", `preservation_register.${entry.path}`, "every untracked path must be classified before continuation");
    }
  }

  if (fileSnapshot) {
    for (const entry of checkpoint.preservation_register || []) {
      const observed = fileSnapshot[entry.path];
      if (!observed?.exists) {
        if (entry.availability === "LOCAL_ONLY") warnings.push({ code: "LOCAL_ONLY_ITEM_UNAVAILABLE", path: `preservation_register.${entry.path}`, message: "local-only preserved item is not present on this machine; do not recreate or claim it without the originating workspace" });
        else add(findings, "PRESERVED_ITEM_MISSING", `preservation_register.${entry.path}`, "registered item does not exist at the checkpoint");
      }
      if (entry.sha256 && observed?.sha256 && entry.sha256 !== observed.sha256) add(findings, "PRESERVED_HASH_MISMATCH", `preservation_register.${entry.path}`, "registered SHA-256 does not match the preserved file");
    }
  }

  return { valid: findings.length === 0, findings, warnings };
}

export { CHECKPOINT_SCHEMA_VERSION };
