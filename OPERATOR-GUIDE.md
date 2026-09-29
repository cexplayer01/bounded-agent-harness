# Operator guide

This guide covers the local extraction prototype. It does not authorize provider calls, deployments, billing, publication, or live side effects.

## Prove the package first

From `agent-harness/`:

```powershell
npm test
npm run audit
npm run demo:mcp
npm run proof:release
```

Expected result: all tests pass, the package audit reports `valid: true`, and the MCP demo completes two specialist steps with pinned provider identities and bounded cost.

## Publish a reviewed branch safely

- Confirm the repository, remote URL, branch, working-tree state, and exact commit before publishing. Preserve unrelated edits; push only the reviewed commit or ref.
- Prefer the established authenticated Git CLI route for a normal fast-forward push. A GitHub REST integration returning `403 Resource not accessible by integration` proves that integration cannot perform that API operation; it does not prove that the user's Git CLI credentials are absent or need to be recreated.
- On a bundled Windows Git runtime, `git: 'remote-https' is not a git command` can mean the subprocess lost Git's helper path, even when the credential manager is still valid. Resolve the path with `git --exec-path`, supply that value as `GIT_EXEC_PATH` for the push process, and retry a dry run before asking the owner to reconnect anything.
- A checked plugin toggle is not repository-installation proof. Inspect the repositories visible to the integration separately, and do not substitute that integration for a working Git CLI route.
- Read the current remote SHA and verify it is an ancestor of the candidate. Use a dry run when available, then use an ordinary non-force push. Verify the remote ref SHA afterward.
- If a checkout fails Git's ownership/safe-directory check, do not add a broad or persistent `safe.directory` exception. Preserve that checkout and its metadata. Transfer the exact reviewed commit into a clean checkout owned by the authenticated operator, or stop and report the specific host-level ownership blocker.
- Do not ask the owner to reconnect or recreate credentials until the known authenticated Git route has been tested and its actual failure recorded. Never expose credential values while diagnosing it.

## Publish proof without stale live claims

Before updating a proof receipt, create a claim file from the exact state you intend to publish and obtain a fresh read-only observation packet from the relevant host adapter. Run:

```powershell
node bin/harness.mjs proof-release --release proof-release.v1.json --observations proof-observations.v1.json --now 2026-09-23T19:00:00.000Z
```

Publish only on `READY_TO_PUBLISH`. A `BLOCKED` result is useful evidence: update the claim from the observation, mark the old deployment `HISTORICAL` or `SUPERSEDED`, or repair the observed-field contract. Do not change the checker to make a mismatch disappear. The host adapter owns network access; the harness gate only compares the supplied packets and stores no credentials.

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
| `PROOF_RELEASE_BLOCKED` / `DEPLOYMENT_DRIFT` / `STALE_OBSERVATION` | A current proof claim is not backed by a matching fresh observation. | Keep the release blocked; reconcile live state, update the claim, or mark the old evidence historical/superseded. |

## Before any external integration

- Supply a real MCP client through the library; the CLI does not load arbitrary provider code.
- Pin server identity where the client exposes it.
- Keep secrets outside plans, manifests, events, and checkpoints.
- Give external-effect steps stable provider-enforced idempotency keys.
- Add exact approval gates for protected actions.
- Confirm output contracts accept only fields the next step needs.
- Treat package publication, hosting, provider configuration, and live mutations as separately authorized actions.
