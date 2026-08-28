# Threat model

## Protected properties

- A specialist cannot gain authority merely by requesting or returning it.
- Unregistered or malformed outputs do not enter shared state as successful work.
- A resumed workflow cannot silently substitute a different contract definition under the same ID.
- Selected specialist profiles and adapter IDs are fingerprinted into the compiled workflow identity.
- Execution recomputes the canonical workflow and digest, detecting artifact field or digest modification before a run starts.
- Execution rejects contract-registry drift before the run enters shared history.
- Declarative output contracts reject undeclared fields by default, including extra fields attached to an otherwise valid result.
- Static step input is contract-validated both at compilation and immediately before adapter invocation.
- Dependency outputs cross specialist boundaries only through explicit per-step field projections.
- Missing projected fields fail the run before the downstream adapter is invoked.
- Cost cannot exceed the compiled ceiling.
- Completed side effects are not repeated after recovery.
- MCP/provider responses remain untrusted until contract validation.
- Run history remains inspectable and tamper-evident; checkpoints are written atomically.

## Addressed in 0.1

- Unknown fields, versions, specialists, contracts, dependencies, adapters, and authority fail closed.
- Dependency cycles and compile-time cost overflow fail closed.
- Runtime output crosses the named contract before completion is recorded.
- Failures produce a recovery checkpoint and structured event.
- Configured memory paths cannot escape their root.
- Event envelopes form a verified SHA-256 chain, detecting deletion, reordering, or modification except truncation at the tail.
- Concurrent local event writers are serialized by an exclusive bounded lock and fail closed on lock timeout.
- Lock inspection distinguishes a live long-running writer from a dead local owner without mutating the lock.
- Provider-reported cost is accepted only inside the compiled per-step reservation; missing usage conservatively charges the full reservation.
- Heartbeat identity, timestamp, and cumulative cost cannot regress within one worker/run stream.
- Recovery decisions separate lease expiry from retry authority and park policy failures or exhausted attempts.
- Approval evidence is bound to the gate, step, and complete compiled workflow digest before adapter invocation.
- A completed run is terminal; resume cannot duplicate its completed workflow.
- Configured MCP name/version pinning fails before tool invocation on mismatch and records whether identity was pinned or merely configured.

## Explicitly not yet addressed

- Authenticity of the event log (the hash chain is not signed), detection of tail truncation, distributed writers, or automatic recovery of a lock orphaned by process death.
- Secret storage, sandboxing, network egress, or provider identity.
- Exactly-once guarantees from external providers. The harness now requires and preserves an idempotency key for external-effect retries, but the provider must enforce it.
- Distributed leases, clock disagreement, or hostile filesystem access.
- Prompt injection inside a provider. Contracts limit accepted shape, not semantic truth.
- Verification of a provider's cost claim against an external invoice; the harness bounds trusted accounting but cannot audit a vendor bill by itself.
- Authentication, tenancy, billing, hosted operation, or legal compliance.
- Authentication of the human or system issuing an approval; the local prototype validates scope binding, not signer identity.
- Exhaustive secret detection. The package audit catches common embedded assignments and local paths, but publication still requires a dedicated secret scan and owner GO.
- Cryptographic authentication of an MCP server; name/version pinning detects configuration drift but does not prove who operates the process.

Do not deploy this prototype as a multi-tenant control plane. The next security-bearing milestone is idempotent resume with adapter-declared side-effect semantics.
