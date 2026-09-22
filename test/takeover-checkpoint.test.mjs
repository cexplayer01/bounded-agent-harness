import test from "node:test";
import assert from "node:assert/strict";
import { CHECKPOINT_SCHEMA_VERSION, validateTakeoverCheckpoint } from "../src/takeover-checkpoint.mjs";

function validCheckpoint() {
  return {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    recorded_at_utc: "2026-09-21T18:00:00.000Z",
    repository: {
      branch: "codex/usb-clean-review",
      head: "a".repeat(40),
      tracked_source_state: "CLEAN_WITH_PRESERVED_UNTRACKED",
      expected_git_status: [{ code: "??", path: "Project Brain/USB-HANDOFF-20260921.md", availability: "LOCAL_ONLY" }]
    },
    continuation: {
      phase: "Phase 376",
      status: "READY",
      objective: "Continue the next local USB-only product step.",
      last_completed: "Visibility-only DFW build and postflight.",
      in_progress: null,
      next_step: "Wire the proven booking preview into production output.",
      resume_command: "Read Project Brain/CURRENT-STATE.md and run the focused booking regression.",
      do_not_repeat: ["Do not activate booking, payment, provider, or customer data paths."]
    },
    evidence: {
      tests: [{ name: "bounded harness", result: "PASS", summary: "62/62" }],
      live: [{
        target: "https://example.invalid",
        result: "PASS",
        observed_on: "2026-09-21",
        deployment_id: "deploy-1",
        rollback_deployment_id: "deploy-0",
        effect_boundary: "visibility-only"
      }],
      known_problems: [{ scope: "legacy fixture", status: "KNOWN_FIXTURE_DRIFT", summary: "Not part of the active path.", next_action: "Repair only when that fixture is reactivated." }]
    },
    preservation_register: [{
      path: "Project Brain/USB-HANDOFF-20260921.md",
      kind: "FILE",
      classification: "OWNER_UNTRACKED",
      state: "PRESERVE",
      action: "PRESERVE_IN_PLACE",
      provenance: "Owner-created handoff; not yet reconciled.",
      owner_decision_required: true,
      availability: "LOCAL_ONLY",
      sha256: "b".repeat(64),
      required_for: "Recovery context until reconciled."
    }],
    authority: {
      next_action: "Local code work only.",
      go_required: false,
      blocked_actions: ["No live booking or payment activation."]
    }
  };
}

test("valid takeover checkpoint matches the repository snapshot", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: {
      branch: checkpoint.repository.branch,
      head: checkpoint.repository.head,
      status: checkpoint.repository.expected_git_status
    },
    fileSnapshot: {
      "Project Brain/USB-HANDOFF-20260921.md": { exists: true, sha256: checkpoint.preservation_register[0].sha256 }
    }
  });
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.deepEqual(result.warnings, []);
});

test("portable clone passes with explicit warnings when local-only artifacts are absent", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: {
      branch: checkpoint.repository.branch,
      head: "c".repeat(40),
      head_parent: checkpoint.repository.head,
      head_parent_paths: ["Project Brain/TAKEOVER-CHECKPOINT.v1.json"],
      status: []
    },
    fileSnapshot: { "Project Brain/USB-HANDOFF-20260921.md": { exists: false } }
  });
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.ok(result.warnings.some((warning) => warning.code === "LOCAL_ONLY_STATUS_UNAVAILABLE"));
  assert.ok(result.warnings.some((warning) => warning.code === "LOCAL_ONLY_ITEM_UNAVAILABLE"));
});

test("checkpoint fails closed when HEAD changes", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: { branch: checkpoint.repository.branch, head: "c".repeat(40), status: checkpoint.repository.expected_git_status },
    fileSnapshot: { "Project Brain/USB-HANDOFF-20260921.md": { exists: true, sha256: checkpoint.preservation_register[0].sha256 } }
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "GIT_HEAD_MISMATCH"));
});

test("checkpoint accepts a follow-up commit that changes only the checkpoint", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: {
      branch: checkpoint.repository.branch,
      head: "c".repeat(40),
      head_parent: checkpoint.repository.head,
      head_parent_paths: ["Project Brain/TAKEOVER-CHECKPOINT.v1.json"],
      status: checkpoint.repository.expected_git_status
    },
    fileSnapshot: { "Project Brain/USB-HANDOFF-20260921.md": { exists: true, sha256: checkpoint.preservation_register[0].sha256 } }
  });
  assert.equal(result.valid, true, JSON.stringify(result.findings));
});

test("checkpoint fails closed when an untracked path is not registered", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: {
      branch: checkpoint.repository.branch,
      head: checkpoint.repository.head,
      status: [...checkpoint.repository.expected_git_status, { code: "??", path: "new-unclassified-file.txt", availability: "REPOSITORY" }]
    },
    fileSnapshot: { "Project Brain/USB-HANDOFF-20260921.md": { exists: true, sha256: checkpoint.preservation_register[0].sha256 } }
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "UNREGISTERED_UNTRACKED_PATH"));
});

test("checkpoint fails closed when a preserved file hash drifts", () => {
  const checkpoint = validCheckpoint();
  const result = validateTakeoverCheckpoint(checkpoint, {
    gitSnapshot: { branch: checkpoint.repository.branch, head: checkpoint.repository.head, status: checkpoint.repository.expected_git_status },
    fileSnapshot: { "Project Brain/USB-HANDOFF-20260921.md": { exists: true, sha256: "d".repeat(64) } }
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((finding) => finding.code === "PRESERVED_HASH_MISMATCH"));
});
