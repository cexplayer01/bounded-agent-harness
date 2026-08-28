# Bounded Agent Harness

Bounded Agent Harness is a small deterministic control plane for constrained multi-agent work. It turns a validated plan into a deterministic workflow, assigns each step only to a specialist with declared strengths and authority, and fails closed on mismatched capability, excess authority, unknown contracts, dependency cycles, or budget overflow.

It packages the useful reliability mechanisms without requiring chat transcripts, agent personas, or coordination rituals.

## Product promise

- Persistent shared memory is contract-bound, revisioned data, not chat history.
- Contracts are named, versioned, fingerprinted, and validated at boundaries.
- Specialists advertise honest strengths, explicit limitations, capabilities, narrow authority, and outcome counts.
- MCP providers are adapters; they do not silently acquire authority.
- Heartbeats prove liveness and trigger bounded recovery, not busywork.
- Each step reserves a cost ceiling; verified provider usage may lower the recorded charge but can never exceed that ceiling.
- Validated plans compile deterministically before execution.
- Runtime execution can be mostly non-LLM; models are invoked only for steps that require them.
- Every meaningful transition produces inspectable, hash-chained evidence.

## Current runnable slice

The first slice implements a zero-dependency Node.js workflow compiler. It validates a closed plan, specialist profiles, contract references, dependency order, authority, capability, and cost budget. Identical inputs produce an identical canonical artifact and SHA-256 digest.

```powershell
cd agent-harness
npm test
npm run demo
npm run demo:mcp
npm run audit
```

The CLI exposes the control-plane primitives without contacting a provider:

```powershell
node bin/harness.mjs validate --plan examples/review-plan.json --specialists examples/specialists.json
node bin/harness.mjs compile --plan examples/review-plan.json --specialists examples/specialists.json --contracts examples/contracts.json --output workflow.json
node bin/harness.mjs run --workflow workflow.json --contracts examples/contracts.json --adapters examples/local-adapters.json --memory .agent-harness/run-1 --run-id demo-1
node bin/harness.mjs inspect --memory .agent-harness/run-1
node bin/harness.mjs heartbeat --last 2026-08-28T00:00:00Z --lease-ms 60000
node bin/harness.mjs beat --memory .agent-harness/run-1 --run-id demo-1 --worker-id reviewer --workflow sha256:... --spent-cost 2
node bin/harness.mjs leases --memory .agent-harness/run-1 --lease-ms 60000
node bin/harness.mjs lock-status --memory .agent-harness/run-1 --stale-after-ms 60000
```

Compilation refuses to overwrite an existing artifact. `run` and `resume` currently accept only declarative literal adapters, providing a safe zero-side-effect end-to-end proof without executing arbitrary code or contacting a provider. `inspect` verifies the complete event hash chain, then reports deterministic per-run status, failure, actual/reserved cost, savings, provider identity, ledger head, and checkpoint.

MCP adapters optionally verify that their configured tool is advertised, pass a versioned handoff envelope containing the exact workflow, specialist, capability, authority, and output-contract identity, and accept only `structuredContent`. Tool errors and prose-only responses fail closed.

An MCP adapter can pin the expected server name and version. When pinned, invocation cannot begin until the client reports a matching identity; the verified identity is retained in the step evidence. Unpinned adapters are labeled `configuration-only`, never implied to be authenticated.

`npm run demo:mcp` proves the provider boundary end to end with two intentionally different in-process MCP client shapes: a primary-source researcher feeds a separate contract reviewer, both identities are pinned, structured context crosses the dependency edge, actual cost is recorded, and no network or model is required. It is a compatibility proof, not evidence that a particular external provider is trustworthy.

MCP usage is normalized into a versioned adapter result. Missing provider usage charges the full reserved ceiling; reported usage is recorded only when it is a non-negative integer within that ceiling. A provider cannot enlarge its budget at runtime.

Worker heartbeats enter the same tamper-evident ledger with run, worker, workflow, cumulative cost, and receipt time. Identity, time, and cost regressions fail closed. Lease summaries distinguish healthy workers from expired workers that require recovery; a heartbeat does not itself authorize retry or side effects.

Recovery policy is an explicit pure decision, separate from heartbeat detection. Policy, contract, authority, identity, and budget failures park immediately. Temporary read/local failures may retry only within a caller-supplied attempt ceiling. An ambiguous external effect requires owner review unless its compiled step carries a stable idempotency key. Exhausted attempts park instead of creating an autonomous loop.

Plans may place a named approval gate on any step. Execution accepts an approval only when its gate, step, decision, and complete workflow digest match exactly, then records gate verification before invoking the adapter. An approval from an older compilation cannot authorize changed work.

Deterministic specialist routing filters by capability and authority before considering outcomes. It prefers verified accepted-output rates, labels profiles with no history as unproven, retains limitations in its rationale, and uses stable ID ordering for ties. Model branding and persuasive self-description do not influence selection.

The compiled artifact fingerprints every selected specialist's complete profile and records its adapter ID. Changing declared capability, authority, limitation, evidence, or adapter therefore produces a different workflow identity and invalidates approvals or resume artifacts bound to the older compilation.

Outcome updates are explicit and immutable. A completed result may be recorded as accepted, rejected, or completed-but-unreviewed; an unreviewed completion increases experience without pretending it was accepted. The library returns an updated profile for the caller to validate and persist through shared memory.

`SharedMemory` is the compact persistent project-memory primitive: named records are validated against the registry, written atomically, integrity-digested, revisioned with optimistic concurrency, and linked into the run event ledger. A stale agent cannot silently overwrite a newer fact. The event ledger serializes multiple local writers through an exclusive bounded lock, preserving one valid hash chain instead of racing append operations.

Lock inspection is read-only. It distinguishes unlocked, held, long-running-but-live, and orphaned locks, and marks removal safe only when the recorded local process is no longer alive. The prototype intentionally does not delete an orphan automatically.

Compiled artifacts bind every field and contract definition fingerprint into a canonical payload and SHA-256 digest. Execution recomputes both before writing a run event, then checks the runtime registry. A modified step, authority, budget, contract, canonical payload, or digest fails closed. Changing a portable contract changes the workflow identity, so execution and resume cannot silently cross versions. Code-only validators are explicitly labeled `runtime-bound` rather than falsely presented as portable contracts.

Every compiled step binds both its static input and its output to named contract fingerprints. Input is validated during compilation and again immediately before adapter invocation. Declarative object contracts are closed by default: when `allowed` is omitted, only required keys may appear. Optional keys must be listed explicitly in `allowed`, which must include every required key. This prevents either the plan or a specialist from smuggling unreviewed fields through an otherwise valid boundary.

Dependency context is least-disclosure by construction. Every compiled step explicitly maps each dependency to the fields it may receive; undeclared output fields stay in the ledger but do not cross into the next specialist's handoff. A declared field that is absent fails the run rather than becoming a silent `undefined` input.

## Architecture

```text
validated plan + contract registry + specialist profiles
                         |
                  deterministic compiler
                         |
                immutable workflow artifact
                         |
          policy-enforcing executor
             /            |             \
       MCP adapter   local adapter   human gate
                         |
          events + checkpoints + heartbeat
                         |
              persistent shared memory
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

Version `0.1.0` is a source-available extraction prototype, not a published npm package or hosted service. It now includes a complete zero-side-effect CLI loop and an end-to-end two-provider MCP compatibility demo, contract-bound revisioned shared memory, a multi-writer-safe tamper-evident event log and atomic checkpoints, heartbeat lease evaluation, provider-neutral MCP adapters with optional identity pinning, versioned structured handoffs, contract-checked outputs, cost enforcement, recovery evidence, explicit resume, and non-destructive lock diagnosis. Completed runs are terminal. Next: external MCP client configuration, owner-authorized orphan-lock recovery, cryptographic provider authentication, and a real-provider compatibility proof.
