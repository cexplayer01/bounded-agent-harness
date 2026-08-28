# Operator guide

This guide covers the local extraction prototype. It does not authorize provider calls, deployments, billing, publication, or live side effects.

## Prove the package first

From `agent-harness/`:

```powershell
npm test
npm run audit
npm run demo:mcp
```

Expected result: all tests pass, the package audit reports `valid: true`, and the MCP demo completes two specialist steps with pinned provider identities and bounded cost.

## Run a zero-side-effect workflow

```powershell
node bin/harness.mjs validate --plan examples/review-plan.json --specialists examples/specialists.json
node bin/harness.mjs compile --plan examples/review-plan.json --specialists examples/specialists.json --contracts examples/contracts.json --output workflow.json
node bin/harness.mjs run --workflow workflow.json --contracts examples/contracts.json --adapters examples/local-adapters.json --memory .agent-harness/demo --run-id demo-1
node bin/harness.mjs inspect --memory .agent-harness/demo
```

The local adapter manifest admits only literal outputs. It cannot execute a command or contact a provider.

## What to inspect

- `workflow.json`: immutable compiled plan, contract fingerprints, ordered steps, authorities, cost ceilings, and digest.
- `.agent-harness/demo/events.jsonl`: hash-chained events. Never edit it.
- `.agent-harness/demo/checkpoint.json`: latest recovery or completion state.
- `inspect` output: run status, failure, providers, reserved versus spent cost, ledger head, and checkpoint.

## Recovery

1. Run `inspect`; do not infer state from chat.
2. Check worker leases with `leases` if heartbeats are in use.
3. Check `lock-status` if writes are blocked. A live stale lock is not safe to remove. The prototype never removes a lock automatically.
4. Evaluate the failure with `decideRecovery` in the library.
5. Resume only the same workflow digest and run ID. Completed runs are terminal.
6. External-effect retries require their original idempotency key. Without one, seek owner review.

## Common fail-closed results

| Code | Meaning | Operator response |
|---|---|---|
| `WORKFLOW_ARTIFACT_TAMPERED` | Workflow fields, canonical payload, or digest differ. | Recompile from reviewed inputs. |
| `CONTRACT_REGISTRY_MISMATCH` | Runtime contracts differ from compilation. | Use the original manifest or intentionally recompile. |
| `AUTHORITY_ESCALATION` | Specialist lacks the requested authority. | Correct the plan or choose an eligible specialist; never widen authority silently. |
| `APPROVAL_REQUIRED` | Exact workflow-bound approval is absent. | Obtain the required approval for this digest and step. |
| `STEP_COST_EXCEEDED` | Provider reported more than the reserved ceiling. | Park and investigate; do not enlarge the budget automatically. |
| `CONTRACT_REJECTED` | Input or output violated its named contract. | Reject the handoff and correct the producer. |
| `MCP_IDENTITY_MISMATCH` | Provider name/version differs from the pin. | Stop and verify provider configuration. |
| `EVENT_LOG_CORRUPT` | Event history failed sequence or hash validation. | Preserve the files and investigate; do not continue the run. |
| `EVENT_LOG_LOCKED` | Another writer owns the ledger lock. | Use `lock-status`; do not delete a live lock. |
| `RUN_ALREADY_COMPLETED` | A terminal run was asked to resume. | Start a newly compiled/new-ID run only if new work is intended. |

## Before any external integration

- Supply a real MCP client through the library; the CLI does not load arbitrary provider code.
- Pin server identity where the client exposes it.
- Keep secrets outside plans, manifests, events, and checkpoints.
- Give external-effect steps stable provider-enforced idempotency keys.
- Add exact approval gates for protected actions.
- Confirm output contracts accept only fields the next step needs.
- Treat package publication, hosting, provider configuration, and live mutations as separately authorized actions.
