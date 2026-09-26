# Bounded Agent Harness

Bounded Agent Harness is a small deterministic control plane for constrained multi-agent work. It turns a validated plan into a deterministic workflow, assigns each step only to a specialist with declared strengths and authority, and fails closed on mismatched capability, excess authority, unknown contracts, dependency cycles, or budget overflow.

It packages the useful reliability mechanisms without requiring chat transcripts, agent personas, or coordination rituals.

## Product promise

- Persistent shared memory is contract-bound, revisioned data, not chat history.
- The deterministic control plane is separate from nondeterministic provider execution and post-effect reconciliation.
- Contracts are named, versioned, fingerprinted, and validated at boundaries.
- Specialists advertise honest strengths, explicit limitations, capabilities, narrow authority, and outcome counts.
- MCP providers are adapters; they do not silently acquire authority.
- Heartbeats prove liveness and trigger bounded recovery, not busywork.
- Each step reserves a cost ceiling; verified provider usage may lower the recorded charge but can never exceed that ceiling.
- Provider hosts can run a token-capacity gate before invocation. It uses a fresh provider/account observation, a
  conservative prompt estimate, an explicit response ceiling, and protected headroom; unknown, stale, reset, or
  insufficient capacity returns an error before the provider call. A red-zone result remains visible even when the
  request fits, so a host can reserve or defer it instead of spending blindly.
- Validated plans compile deterministically before execution.
- Runtime execution can be mostly non-LLM; models are invoked only for steps that require them.
- Every meaningful transition produces inspectable, hash-chained evidence.

## Shared repository bridge

The harness now includes a repository-native bridge for agents that do not share a chat or MCP server. It is intentionally a transport protocol, not a second agent runtime: one agent publishes an immutable task packet, the assigned agent claims the one fixed claim path, and the worker publishes one result packet bound to the task digest and full Git commit SHAs.

The queue is designed for a private Git repository such as `cexplayer01/dfwmetro`:

```powershell
node bin/harness.mjs task-create --queue .agent-harness/tasks --task task.json
git add .agent-harness/tasks/ready && git commit -m "Publish shared agent task" && git push

node bin/harness.mjs task-claim --queue .agent-harness/tasks --task-id dfw-source-sync --agent-id muse
git add .agent-harness/tasks/claims && git commit -m "Claim shared agent task" && git push

node bin/harness.mjs task-complete --queue .agent-harness/tasks --result result.json
git add .agent-harness/tasks/results && git commit -m "Record shared agent result" && git push
node bin/harness.mjs task-inspect --queue .agent-harness/tasks
```

The fixed claim filename and shared `scope-reservations.v1.json` ledger make competing claims collide at Git push instead of silently allowing two workers to proceed. Same or overlapping file/directory scopes are rejected; disjoint scopes may proceed after their control-branch claims are recorded. Workers use separate branches/worktrees for source edits and never edit the canonical source branch directly. Tasks declare exact writable paths, forbidden actions, acceptance evidence, external-effect level, repository base commit, and expected outputs. Results declare changed paths, source/result commits, tests, external state, next action, and rollback. A result outside the declared scope, after lease expiry, or with a changed digest fails closed. Task and result packets must contain no secret values; environment variable names and secret references are permitted.

Run the local concurrency rehearsal with `npm run demo:shared-task`. It uses a temporary synthetic queue and proves three behaviors in one run: an overlapping claim is rejected with `TASK_SCOPE_RESERVED`, a disjoint claim is admitted, and the overlapping scope can be claimed after the first worker completes. It performs no Git, network, provider, database, deployment, or customer-Site action.

This closes durable coordination through shared Git. It does not claim to create a direct Muse chat channel: direct prompting still requires a Muse MCP connector or an authenticated browser session supplied by the host.

## Current runnable slice

The first slice implements a zero-dependency Node.js workflow compiler. It validates a closed plan, specialist profiles, contract references, dependency order, authority, capability, and cost budget. Identical inputs produce an identical canonical artifact and SHA-256 digest.

### Token-capacity gate

Provider hosts that share an account or rolling token window can wrap an adapter with `withTokenCapacityGate`. The
host must supply a fresh observation containing the provider, window ID, remaining tokens, observation time, and reset
time; the workflow step must declare `tokenBudget.maxOutputTokens`. The gate conservatively estimates the prompt,
adds the response ceiling and reserve, rejects stale/unknown/reset/insufficient observations, and requires an atomic
`reserveCapacity` callback before the provider call. A red-zone result is allowed only after that reservation succeeds;
otherwise the call is rejected before it reaches the provider. The harness cannot discover a provider's private quota by
itself, so a host that cannot read and reserve the shared account window must fail closed.

## Proof status

The current proof is dimension-specific rather than a single production-readiness claim. [`PROOF-STATUS.md`](PROOF-STATUS.md) and its machine-readable companion [`PROOF-STATUS.v1.json`](PROOF-STATUS.v1.json) record the exact tested source commit, reproducible commands, results, USB/DFW Metro/FreeVibeApps integration evidence, and remaining limits. The direct local proof is currently 140/140 tests, a clean package audit, a deterministic compiler demo, a two-provider in-process MCP compatibility demo, and a repository-native shared-agent bridge. DFW Metro, DFWMow, and FreeVibeApps are documented as integration and external-state evidence; they are not represented as hosted harness runtime infrastructure.

```powershell
cd agent-harness
npm test
npm run demo
npm run demo:mcp
npm run audit
npm run proof:release
```

The CLI exposes the control-plane primitives without contacting a provider:

```powershell
node bin/harness.mjs validate --plan examples/review-plan.json --specialists examples/specialists.json
node bin/harness.mjs compile --plan examples/review-plan.json --specialists examples/specialists.json --contracts examples/contracts.json --floor examples/autonomous-floor.json --output workflow.json
node bin/harness.mjs run --workflow workflow.json --contracts examples/contracts.json --adapters examples/local-adapters.json --memory .agent-harness/run-1 --run-id demo-1
node bin/harness.mjs inspect --memory .agent-harness/run-1
node bin/harness.mjs heartbeat --last 2026-08-28T00:00:00Z --lease-ms 60000
node bin/harness.mjs beat --memory .agent-harness/run-1 --run-id demo-1 --worker-id reviewer --workflow sha256:... --spent-cost 2
node bin/harness.mjs leases --memory .agent-harness/run-1 --lease-ms 60000
node bin/harness.mjs lock-status --memory .agent-harness/run-1 --stale-after-ms 60000
node bin/harness.mjs impact --root . --request examples/change-impact-request.json --output change-impact.json
node bin/harness.mjs proof-release --release examples/proof-release.v1.json --observations examples/proof-observations.v1.json --now 2026-09-23T19:00:00.000Z
```

### Proof release gate

Reconciliation is now a publication gate, not a paragraph an agent can update from memory. A proof release contains explicit claims with `CURRENT`, `HISTORICAL`, or `SUPERSEDED` state. A separate read-only observation packet must match every `CURRENT` claim's target, exact deployment and rollback IDs, timestamp, freshness window, and expected fields. Field names are compared exactly, including case; the gate never guesses whether `Industry` means `industry`.

`proof-release` returns `READY_TO_PUBLISH` only when all current claims are freshly reconciled. Missing observations, stale timestamps, deployment drift, rollback drift, field-name drift, unknown observations, and malformed claims return `BLOCKED`. Historical and superseded records remain available for audit, but cannot satisfy a current-state claim. The gate has no network or credential access: a provider-specific host adapter must produce the observation packet separately.

The source for [boundedagentharness.com](https://boundedagentharness.com) is kept in [`website/`](website/). Build output, provider credentials, deployment identity, and local hosting state are intentionally excluded.

### Public-site release binding

Every public build runs `website/scripts/create-public-release.mjs` before the static build. It writes an ignored
`website/public/release.json` containing the exact source commit, package versions, capability maturity, website-source
digest, and proof-status digest. The live site exposes that receipt at `/release.json`; it is not a claim of deployment
authority.

After publishing a build, verify the live binding before recording the deploy:

```powershell
cd website
pnpm run build:netlify
pnpm run verify:release -- --url https://boundedagentharness.com --commit <source-commit>
```

The deployment receipt belongs in `releases/boundedagentharness.com/` and records the deployed source commit, deploy
ID, rollback deploy ID, receipt URL, and postflight checks. A later repository commit containing the receipt is not
silently presented as the source of the already-published artifact; the receipt names the exact deployed commit.

Compilation refuses to overwrite an existing artifact. `run` and `resume` currently accept only declarative literal adapters, providing a safe zero-side-effect end-to-end proof without executing arbitrary code or contacting a provider. `inspect` verifies the complete event hash chain, then reports deterministic per-run status, failure, actual/reserved cost, savings, provider identity, ledger head, and checkpoint.

MCP adapters optionally verify that their configured tool is advertised, pass a versioned handoff envelope containing the exact workflow, specialist, capability, authority, and output-contract identity, and accept only `structuredContent`. Tool errors and prose-only responses fail closed.

An MCP adapter can pin the expected server name and version. When pinned, invocation cannot begin until the client reports a matching identity; the verified identity is retained in the step evidence. Unpinned adapters are labeled `configuration-only`, never implied to be authenticated. Pinned metadata is still recorded with `assuranceLevel: "configuration-only"` until a future adapter adds transport-authenticated or cryptographically attested identity.

Adapters also receive a versioned capability envelope that binds run ID, step ID, workflow digest, capability, authority, adapter ID, allowed effect count, expiry, and idempotency key for external effects. The MCP adapter validates that envelope before provider invocation, so an expired, mismatched, or over-scoped handoff fails before a tool call can happen.

`npm run demo:mcp` proves the provider boundary end to end with two intentionally different in-process MCP client shapes: a primary-source researcher feeds a separate contract reviewer, both identities are pinned, structured context crosses the dependency edge, actual cost is recorded, and no network or model is required. It is a compatibility proof, not evidence that a particular external provider is trustworthy.

MCP usage is normalized into a versioned adapter result. Missing provider usage charges the full reserved ceiling; reported usage is recorded only when it is a non-negative integer within that ceiling. A provider cannot enlarge its budget at runtime.

Worker heartbeats enter the same tamper-evident ledger with run, worker, workflow, cumulative cost, and receipt time. Identity, time, and cost regressions fail closed. Lease summaries distinguish healthy workers from expired workers that require recovery; a heartbeat does not itself authorize retry or side effects.

Recovery policy is an explicit pure decision, separate from heartbeat detection. Policy, contract, authority, identity, and budget failures park immediately. Temporary read/local failures may retry only within a caller-supplied attempt ceiling. An ambiguous external effect requires owner review unless its compiled step carries a stable idempotency key. Exhausted attempts park instead of creating an autonomous loop.

Step lifecycle is now a closed state machine instead of an implied event-story. A step must move through `PENDING -> AUTHORIZED -> LEASED -> INVOKING` before it can succeed, fail, or require reconciliation. Ambiguous external effects enter `RECONCILIATION_REQUIRED`; they cannot be marked completed without a reconciliation path, and retryable failures must reacquire a lease before invoking again.

Plans may place a named approval gate on any step. Execution accepts an approval only when its gate, step, decision, and complete workflow digest match exactly, then records gate verification before invoking the adapter. An approval from an older compilation cannot authorize changed work.

Missing or stale approval is resumable work, not a failed run. The executor records an `awaiting_approval` checkpoint and returns the exact gate, step, and workflow digest required for a later resume; already completed work is not repeated. This keeps the human boundary intact without making an owner wait terminate the broader workflow.

Deterministic specialist routing filters by capability and authority before considering outcomes. It prefers verified accepted-output rates, labels profiles with no history as unproven, retains limitations in its rationale, and uses stable ID ordering for ties. Model branding and persuasive self-description do not influence selection.

The compiled artifact fingerprints every selected specialist's complete profile and records its adapter ID. Changing declared capability, authority, limitation, evidence, or adapter therefore produces a different workflow identity and invalidates approvals or resume artifacts bound to the older compilation.

Outcome updates are explicit and immutable. A completed result may be recorded as accepted, rejected, or completed-but-unreviewed; an unreviewed completion increases experience without pretending it was accepted. The library returns an updated profile for the caller to validate and persist through shared memory.

Storage and provider boundaries are now named as ports. The existing filesystem event log, shared state, contract registry, and MCP adapter satisfy those executable interfaces, while future SQLite, Postgres, S3, Redis, hosted approval, or remote lease implementations can replace them without changing the compiler contract. The current package defines the lease-store shape, but does not claim distributed leasing is implemented.

`SharedMemory` is the compact persistent project-memory primitive: named records are validated against the registry, written atomically, integrity-digested, revisioned with optimistic concurrency, and linked into the run event ledger. A stale agent cannot silently overwrite a newer fact. The event ledger serializes multiple local writers through an exclusive bounded lock, preserving one valid hash chain instead of racing append operations.

Lock inspection is read-only. It distinguishes unlocked, held, long-running-but-live, and orphaned locks, and marks removal safe only when the recorded local process is no longer alive. The prototype intentionally does not delete an orphan automatically.

Compiled artifacts bind every field and contract definition fingerprint into a canonical payload and SHA-256 digest. Execution recomputes both before writing a run event, then checks the runtime registry. A modified step, authority, budget, contract, canonical payload, or digest fails closed. Changing a portable contract changes the workflow identity, so execution and resume cannot silently cross versions. Code-only validators are explicitly labeled `runtime-bound` rather than falsely presented as portable contracts.

Every compiled step binds both its static input and its output to named contract fingerprints. Input is validated during compilation and again immediately before adapter invocation. Declarative object contracts are closed by default: when `allowed` is omitted, only required keys may appear. Optional keys must be listed explicitly in `allowed`, which must include every required key. This prevents either the plan or a specialist from smuggling unreviewed fields through an otherwise valid boundary.

Dependency context is least-disclosure by construction. Every compiled step explicitly maps each dependency to the fields it may receive; undeclared output fields stay in the ledger but do not cross into the next specialist's handoff. A declared field that is absent fails the run rather than becoming a silent `undefined` input.

## Lean change verification

`impact` is the deterministic pre-test gate for a code or contract change. It scans bounded text files for caller-declared interface tokens, reports downstream consumer paths without copying their contents, maps those paths to a closed verification catalog, and emits one compact active card. It does not run a test command, read Git history, contact a provider, or grant permission to change a file.

The four verification tiers are intentionally small:

1. `TIER_0_STATIC` — syntax, schema parsing, or formatting checks.
2. `TIER_1_DIRECT` — tests for the changed implementation or contract.
3. `TIER_2_BOUNDARY` — tests for launchers, callers, adapters, or other consumers.
4. `TIER_3_FULL` — one serialized/full regression at the completed milestone.

Documentation-only and local implementation changes do not automatically require the full suite. Public interfaces, schemas/policies, and external-effect boundaries require a boundary test and one mapped full suite. Any executable consumer lacking focused coverage returns `NEEDS_VERIFICATION_MAPPING`; the harness does not recommend spending time on the full suite until that coverage gap is addressed.

This is the default rhythm:

- Before editing a public name or contract, declare the old/new reference tokens and scan consumers.
- After each small edit, run only selected static and direct checks.
- At the completed boundary, run selected boundary checks.
- At the milestone, run the full suite once when the impact result requires it.
- If a test fails, repair the specific defect, rerun the failed/direct boundary, then perform the required final suite once.
- Update the checkpoint after green evidence, not after every harmless command.

The generated `active_card` is the concise continuation surface: current outcome, current change, affected-consumer count, focused proof IDs, full-suite requirement, exact next action, and external gates. Detailed historical evidence remains in the event/checkpoint surfaces rather than being repeated in every heartbeat.

## Governed review ladder

`src/governance.mjs` adds a Republic-style governance plane without introducing a policy server or a second runtime. Versioned governed atoms bind each requirement to concrete enforcement points (`compile`, `authorize`, `lease`, `invoke`, or `reconcile`) and required evidence. The review ladder is explicit: level 0 floor, level 1 contract, level 2 domain, level 3 consistency, level 4 reconciliation, and level 5 execution. `standingGovernanceQueries` reports unenforced rules, missing evidence, and composition defects. `assessPromotion` can recommend replacing routine continuous HITL only after caller-supplied evidence thresholds pass; it never mutates a specialist or grants authority. `NARROW_ONLY` remains mandatory, and high-blast or irreversible work retains the human floor.

An optional governance bundle is digest-bound into a compiled workflow and revalidated before execution. This makes governance an execution-path check rather than a supervisory prompt or self-authored claim. The bundle is additive and does not change existing plans that do not opt in.

### Optional Sandy reviewer

`sandy-ux-reviewer` is a declared specialist option for asynchronous visual, responsive, and low-IQ usability review. It has `read.workspace` authority only and uses the external adapter ID `drive.sandy.review`; no Drive connector or local adapter is bundled. A plan may route a small review step to this profile when an adapter is available, but compilation and local execution remain independent of it. If the adapter is unavailable, record an explicit `UNAVAILABLE` result and continue the bounded workflow.

Results must use `contracts/sandy-review-result.v1.schema.json` (also enforced by `validateSandyReview`). The result is limited to 20 findings over at most 20 relative paths and 300 lines, is bound to the exact workflow digest, and cannot contain patches, deployment instructions, provider credentials, or execution authority. `verifySandyReviewScope` checks the digest and declared paths; a caller must still verify each finding against source, contracts, and tests before accepting it.

The proposed USB continuation floor is executable through `contracts/autonomous-floor.v1.schema.json` and `floor-policy.mjs`. Passing a floor to `compileWorkflow` binds it to the workflow digest and rejects plans whose effect or budget exceeds the declared envelope; execution rechecks the floor digest. The example floor is local-only and forbids deployment, DNS, payment, email sending, live database writes, and customer-Site writes. Floors are optional until USB explicitly activates them.

`continuation-gate.mjs` evaluates the four-role evidence gate (contract, domain, consistency, and reconciliation). It returns `CONTINUE` only when each distinct role has a passing record bound to the same workflow and floor digests; missing, duplicate, failed, or stale records return `ESCALATE`. A pass is evidence, not authority, and the gate does not alter existing workflows until a caller opts in.

`continuation-fork.mjs` creates one deterministic fork when an owner timeout occurs under a `localOnly` floor. The parent remains `PAUSED_FOR_OWNER`; the fork has a separate half-ceiling budget, `local-reversible-only` authority, and `lowest-reasonable-within-budget` model policy. Repeating the same checkpoint returns the existing fork instead of duplicating it. Owner decisions (`ACCEPT`, `REJECT`, or `RESUME_PARENT`) are explicit; no fork can merge or promote itself.

`model-policy.mjs` turns that model policy into an explicit selection decision. A fork may select the economy tier for Class A/B work only when it fits the fork budget. Class C/D work always returns `ESCALATE` with `HUMAN_FLOOR_REQUIRED`; model selection is metadata and never invokes a provider.

`continuation-controller.mjs` composes the optional path without I/O: it returns `CONTINUE_MAIN`, `WAIT_OWNER`, `CONTINUE_FORK`, or `ESCALATE_OWNER`. It requires the four-role gate first, waits for the configured local-only timeout, creates at most one deterministic fork, and applies the bounded model policy. The caller must persist the decision and run it through the existing executor; the controller never writes the parent run or invokes a model.

`owner-timeout-watchdog.mjs` makes owner absence non-terminal. Before the deadline it returns a mandatory `nextWakeAt`; at or after the deadline it returns `CREATE_OR_RESUME_FORK`. A scheduler must persist and honor that wake-up, so a `WAIT_OWNER` result cannot silently end the workflow.

`continuation-scheduler.mjs` is the enforcement boundary for that rule. `armOwnerTimeout` requires both a persistence callback and a scheduling callback, persists the versioned wake record before arming it, and fails closed when either boundary is missing. The host may use a file, database, queue, or timer adapter, but it cannot acknowledge `WAIT_OWNER` without a durable next wake.

`file-wake-store.mjs` is the zero-dependency local adapter. It writes the wake and schedule atomically, rejects competing wake identities, and exposes `readPendingWake()` after a process restart; a host can poll that method and invoke the controller at the due time. `acknowledgeWake()` marks the schedule consumed so a retry cannot replay the same wake indefinitely.

`owner-timeout-runner.mjs` provides that host polling boundary. `pollOwnerWake()` dispatches a due wake through an injected continuation handler and acknowledges it only after the handler returns a decision; a failed handler leaves the wake pending for a later heartbeat.

`work-loop-policy.mjs` separates primary execution from recovery. A continuous run owns the active objective and must immediately take the next safe step after reporting progress. A heartbeat may detect liveness loss, dispatch a due wake, or request that the host start/resume the continuous run; it cannot present periodic wake-ups as continuous execution. A blocked gated action pauses only that action when alternate safe work exists. Yielding for an execution-window limit or exhausted safe work requires a recorded checkpoint first. Only a proven-complete objective is terminal.

This distinction is intentionally host-neutral. Codex goal mode, a queue worker, a service process, or another durable runner may satisfy `CONTINUOUS_RUN`; cron and scheduled-task callbacks satisfy `HEARTBEAT_RECOVERY`. The harness decides the required disposition but does not secretly create a host process, spend tokens, or invoke a provider.

## Portable takeover checkpoints

`src/takeover-checkpoint.mjs` validates a machine-readable stop point that carries the active objective, exact next step, resume command, repository identity, test/live evidence, known problems, authority boundary, and preservation register. A host supplies its current Git and file snapshots; the validator compares them without treating chat history as authority.

The preservation register classifies each preserved item as `REPOSITORY`, `LOCAL_ONLY`, or `EXTERNAL`, records provenance and intended action, and binds an optional SHA-256 digest. Missing local-only artifacts produce explicit warnings so another clone can continue safe repository work without recreating owner data. Unregistered changes, branch or commit drift, missing repository items, and preserved-file hash drift fail closed.

This package exposes the validator as a library boundary. The default follow-up-commit path is the USB checkpoint location; a host for another repository can pass its own `checkpointPath`. A repository-specific host may add a thin snapshot adapter and a human-readable command, but the core package does not assume Git, a filesystem layout, credentials, deployment access, or a particular agent product.

`model-policy.mjs` turns that model policy into an explicit selection decision. A fork may select the economy tier for Class A/B work only when it fits the fork budget. Class C/D work always returns `ESCALATE` with `HUMAN_FLOOR_REQUIRED`; model selection is metadata and never invokes a provider.

## Architecture

```text
deterministic control plane
  validated plan + contracts + authority + budget + step state machine
                         |
                         v
nondeterministic execution plane
  MCP adapter / local adapter / human gate / provider result
                         |
                         v
reconciliation plane
  observed effect checks + events + checkpoints + heartbeat + shared memory
```

## Boundary

This package does not contain a general autonomous agent, prompt framework, model router, website generator, or deployment system. It provides the guardrails and deterministic control plane around tools that already exist. Live provider calls, credentials, billing, deployment, and package publication remain external decisions.

The extraction audit checks that the folder remains zero-dependency, publication-locked, free of apparent embedded secrets and machine-local paths, and free of source imports escaping the package boundary. It is a guardrail, not a substitute for repository secret scanning or human release review.

## Documentation

- [PRODUCT.md](PRODUCT.md) — buyer, pain, commercial wedge, and proof required.
- [OPERATOR-GUIDE.md](OPERATOR-GUIDE.md) — the shortest path to compile, run, inspect, and diagnose.
- [THREAT-MODEL.md](THREAT-MODEL.md) — protected properties and explicit limitations.
- [ROADMAP.md](ROADMAP.md) — completed foundation and remaining product work.

## License and sustainability

The community edition is free and open source under the [GNU Affero General Public License v3.0 or later](LICENSE). You may evaluate it, modify it, run it, and build open systems with it under those terms.

Organizations that need to embed the harness in proprietary software, keep network-service modifications closed, redistribute it under different terms, or obtain commercial support may purchase a separate commercial license. See [COMMERCIAL-LICENSING.md](COMMERCIAL-LICENSING.md).

Small sponsorships help fund the public edition. Commercial users who need different rights or hands-on integration should use the commercial path rather than treating sponsorship as a license fee.

Code contributions are temporarily closed while contributor and relicensing terms are established. Bug reports, compatibility findings, and focused design feedback are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Development package version `0.3.0` is a source-available extraction prototype, not a published npm package or hosted service. The package version identifies the source/package line; it is not a production-readiness score. Current capability maturity is `LOCAL_CONTROL_PLANE_MILESTONE_1.6`, with direct proof recorded in [PROOF-STATUS.md](PROOF-STATUS.md). It includes a complete zero-side-effect CLI loop and an end-to-end two-provider MCP compatibility demo, contract-bound revisioned shared memory, a multi-writer-safe tamper-evident event log and atomic checkpoints, heartbeat lease evaluation, provider-neutral MCP adapters with optional identity pinning, versioned structured handoffs, the repository-native shared-agent task/claim/result bridge, contract-checked outputs, cost enforcement, recovery evidence, explicit resume, and non-destructive lock diagnosis. Completed runs are terminal. Next: external MCP client configuration, private-repository adoption by Muse, owner-authorized orphan-lock recovery, cryptographic provider authentication, and a real-provider compatibility proof.
