# Roadmap

## 0.1 — deterministic control plane

- Closed plan and specialist contracts.
- Versioned contract registry.
- Compiled artifacts bind contract IDs to definition fingerprints and label runtime-only validators.

Status: implemented and tested locally.
- Deterministic topological compilation and digest.
- Capability, authority, contract, cycle, and cost rejection.

## 0.2 — reliable execution

- Append-only event log and atomic materialized checkpoint.
- Contract-bound, integrity-checked shared records with optimistic concurrency.
- Policy-enforcing executor with structured handoffs.
- MCP-shaped provider adapter and local test adapter.
- Executable port checks for event store, state store, contract registry, provider adapter, and future lease store.
- Versioned adapter capability envelope enforced before MCP provider invocation.
- Heartbeat receipt, lease expiry, bounded retry, and recovery checkpoint.
- Heartbeat receipts and lease summaries bind worker, workflow, cumulative cost, and monotonic time; bounded recovery policy is explicit and side-effect-aware.
- Per-step cost ledger and run summary.
- Local multi-writer serialization and non-destructive orphan diagnosis; distributed locking and authorized orphan removal remain.
- Closed step state machine with explicit `RECONCILIATION_REQUIRED` for ambiguous external effects.

Status: local execution foundation implemented; distributed operation remains.

## 0.3 — product boundary

- CLI supports validate, compile, zero-side-effect run/resume, inspect, and heartbeat; configured MCP execution remains.
- Portable JSON Schemas and example integration.
- Threat model, operator guide, and failure-mode documentation.
- Deterministic run summaries expose state, failures, cost variance, and providers; hosted dashboards remain outside the prototype.
- A zero-network two-provider MCP demo proves differentiated handoff, response-shape compatibility, identity pinning, context flow, and cost evidence; external-provider compatibility remains.

Status: extraction and operator path are runnable; external-provider proof and release packaging remain.

## 0.4 — governed review ladder

- Republic-style governed atoms with explicit lifecycle, blast radius, narrow-only authority, enforcement points, and required evidence.
- Review levels 0 (floor), 1 (contract), 2 (domain), 3 (consistency), 4 (reconciliation), and 5 (execution).
- Pure standing queries for unenforced rules, missing evidence, and composition defects.
- Evidence-based promotion assessment that never grants authority and retains the human floor for high-blast/irreversible work.
- Optional governance bundle digest-bound into compiled workflows and revalidated before execution.

Status: implemented and tested locally; cryptographic provider attestation and hosted governance remain future work.

## 0.5 — bounded optional visual review

- Declared `sandy-ux-reviewer` profile with narrow read-only authority and explicit unavailability semantics.
- Closed, digest-bound Sandy result contract with relative-path and 300-line scope limits.
- Scope verifier that keeps external review evidence separate from code changes and execution authority.

Status: local contract and validation implemented; external Drive connectivity remains optional and outside the package.

## 0.6 — executable autonomy floor

- Versioned floor manifest for project goal, allowed/forbidden effects, review roles, cost, timeout, and narrow-only authority.
- Optional floor digest bound into compilation and revalidated before execution.
- Plan effect and budget checks fail closed before a workflow can run outside its declared envelope.

Status: local contract and enforcement implemented; USB activation and timeout forks remain future work.

## 0.7 — four-role continuation evidence

- Closed review-record contract for contract, domain, consistency, and reconciliation roles.
- Unanimous digest-bound continuation evaluator with explicit `CONTINUE`/`ESCALATE` decisions.
- Missing, duplicate, failed, and stale evidence fail closed without granting authority.

Status: local evidence gate implemented; timeout forks, model downgrade, and USB activation remain future work.

## 0.8 — bounded timeout forks

- Deterministic local-only continuation fork with parent/checkpoint/floor digest binding.
- Duplicate suppression, parent pause state, separate bounded budget, and fixed authority/model ceilings.
- Explicit owner resolution decisions without implicit merge or promotion.

Status: local fork state machine implemented; runtime scheduling, model selection adapter, and USB activation remain future work.

## 0.9 — bounded model selection

- Deterministic model-tier selection for owner-absent forks with an explicit cost estimate.
- Economy-tier downgrade restricted to Class A/B local/reversible work.
- Class C/D work escalates to the human floor; no provider invocation is hidden in policy evaluation.

Status: local selection policy implemented; provider adapter wiring and USB activation remain future work.

## 1.0 — continuation controller

- Pure controller composing floor, four-role review, timeout fork, and model-tier decisions.
- Explicit `CONTINUE_MAIN`, `WAIT_OWNER`, `CONTINUE_FORK`, and `ESCALATE_OWNER` outcomes.
- No I/O, provider invocation, parent mutation, or automatic merge.

Status: local decision path implemented; durable scheduler integration, owner UI, and USB activation remain future work.

## 1.1 — non-terminal owner timeout watchdog

- Mandatory next wake time before owner timeout.
- Automatic create-or-resume-fork action at the deadline.
- Explicit `terminal: false` semantics so owner absence cannot silently halt safe work.

Status: pure watchdog implemented; durable scheduler wiring and USB activation remain future work.

## 1.2 — mandatory wake scheduling boundary

- Versioned owner-wake record with workflow/checkpoint identity and a future recheck time.
- Scheduler port persists the wake before arming it and fails closed when either callback is absent.

Status: persistence/scheduling adapter boundary and negative tests implemented; concrete host scheduler and USB activation remain future work.

## 1.3 — restart-safe local wake adapter

- File-backed owner wake and schedule records with atomic writes and identity checks.
- Due-wake inspection after process restart and explicit consumption acknowledgement.

Status: zero-dependency local adapter implemented; hosted queue/timer adapter and USB activation remain future work.

## 1.4 — host polling runner

- Restart-safe polling tick dispatches due owner wakes through an injected continuation handler.
- Consumption occurs only after successful dispatch; failures remain retryable.

Status: local host runner implemented; hosted queue/timer integration and USB activation remain future work.

## 1.5 — deterministic change-impact gate

- Bounded repository text scan for caller-declared interface tokens; output includes paths and match identities, never source contents.
- Closed direct, boundary, and full-suite verification catalog with deterministic execution order.
- Public interface, schema/policy, and external-effect changes fail closed when boundary or milestone regression coverage is missing.
- Compact active card replaces repeated phase narration while preserving the exact next action and external gates.

Status: local analyzer, CLI, contracts, and focused tests implemented. It recommends verification but never executes commands or grants change/live authority.

## 1.6 — continuous-run host policy

- Explicit separation between `CONTINUOUS_RUN` primary execution and `HEARTBEAT_RECOVERY` monitoring/recovery.
- A progress report is non-terminal and cannot replace immediately taking the next safe step.
- A gated action blocks only itself when alternate safe work exists.
- Execution-window or safe-work exhaustion requires a durable checkpoint before yielding; only proven objective completion is terminal.

Status: pure host-neutral policy and negative tests implemented. Concrete continuous-host adapters remain platform integrations rather than hidden package behavior.

## Commercial path

- Community edition: AGPL-3.0-or-later.
- Commercial alternative: proprietary embedding, closed modified hosted use, support, and integration.
- Early revenue: voluntary sponsorship plus a small number of scoped founding design-partner engagements.
- Future hosted product: managed observability, policy, approval, and recovery surfaces after external demand is proven.

Publishing to a package registry or deploying a hosted service remains intentionally locked.
