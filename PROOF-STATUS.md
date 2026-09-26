# Bounded Agent Harness proof status

Recorded 2026-09-26 for development package version `0.4.2`. The code-bearing verification commit is
`d4f919edc8f82e12a4947be7b0ee9012c17bae53`; any later public release commit is explicitly allowed to be a
documentation-only follow-up and must not be treated as a different code proof.

Capability maturity: `LOCAL_CONTROL_PLANE_MILESTONE_1.9`. This maturity label is separate from contract IDs such as `*.v1` and from hosted/commercial readiness.

## Bottom line

Bounded Agent Harness is proven within a declared local-control-plane scope. The current checked-in suite passes 154/154 tests, the package audit returns `valid: true` with no findings, the deterministic workflow demo passes, the two-provider in-process MCP compatibility demo completes without a network or model call, the repository-native shared-agent bridge passes its focused identity/claim/scope-reservation/lease tests, the local concurrency rehearsal passes overlap rejection/disjoint admission/release-and-reclaim, the token-efficiency utilities pass their focused proof, the adoption scorecard and repeatable evaluation matrix pass their focused proof, the signed provider-compatibility receipt verifier keeps synthetic evidence non-publishable, and the proof-release gate returns `READY_TO_PUBLISH` for a fresh exact observation.

This is not a claim that the package is already a hosted production service or that an external provider has been independently authenticated.

The machine-readable record is [`PROOF-STATUS.v1.json`](PROOF-STATUS.v1.json). It is the concise proof surface for automated readers; this document explains the same boundary in plain language.

## What the direct proof establishes

| Area | Result | Evidence | Boundary |
|---|---|---|---|
| Automated behavior | PASS | `npm test` — 154/154 | Checked-in local behavior, not hosted operation |
| Package safety surface | PASS | `npm run audit` — `valid: true`, no findings | Does not authenticate an external deployment |
| Deterministic compilation | PASS | `npm run demo` | Closed example inputs and local compiler |
| MCP adapter compatibility | PASS | `npm run demo:mcp` — 2 specialists, 6 evidence events, 5 cost units | In-process client shapes; no claim about a named external provider |
| Provider-compatibility proof boundary | PASS WITH LIMITS | `node --test test/provider-compatibility-proof.test.mjs` — 4/4; synthetic evidence stays `REHEARSAL_ONLY`, signed host evidence verifies only with a trusted Ed25519 key, tampering and non-read authority block | No actual host-provider run has been executed; a valid receipt does not prove provider business correctness |
| Continuation and recovery | PASS | Automated tests for approvals, checkpoints, wakes, forks, work-loop policy, and reconciliation | Host scheduling and external authority remain injected boundaries |
| Proof publication gate | PASS | `npm run proof:release` — `READY_TO_PUBLISH`; stale deployment, stale observation, missing observation, and field-name drift are tested as blocking cases | The host adapter must still supply truthful read-only observations |
| Shared repository agent bridge | PASS | `shared-task-queue.test.mjs` — deterministic identity, one fixed claim, overlapping-scope rejection, disjoint-scope admission, digest-bound result, path scope, lease expiry, and release | Does not itself provide a direct Muse chat/MCP channel or hosted queue |
| Shared-agent concurrency rehearsal | PASS | `npm run demo:shared-task` — overlapping scope blocked, disjoint scope claimed, released scope reclaimed; temporary synthetic queue only | Does not prove DFW repository access or direct Muse messaging |
| Token-efficiency layer | PASS | `node --test test/capability-index.test.mjs test/token-efficiency.test.mjs` — 5/5 | Contract-shaped utilities and measurements; no cross-provider production benchmark claim |
| Adoption scorecard and evaluation matrix | PASS WITH LIMITS | `node --test test/adoption-evaluation.test.mjs` — 4/4; fixed five-system scorecard and repeatable local matrix | Comparative judgments are not a neutral benchmark; the actual-provider leg is not executed; crash fault-injection is held back |
| Live reconciliation exercise | DEMONSTRATED WITH DRIFT | Owner-controlled `dfwmetro-reconciliation-v1` run — 17 hash-chained events, 10 compiled cost units, 7 spent, 5 checks passed, 1 stale-claim finding | Demonstrates detection and reporting of live drift; not a clean all-live proof or hosted-service proof |
| FreeVibeApps integration | OWNER-ATTESTED WITH LIVE READBACK | Harness-mounted USB build through deterministic sidecar proof, deployment preflight, and same-origin pilot; focused proofs 9/9, 10/10, and 14/14 | Source and raw run records remain owner-controlled; does not claim hosted harness runtime or least-privilege credentials |

Reproduce the direct proof from the repository root:

```powershell
npm test
npm run audit
npm run demo
npm run demo:mcp
npm run proof:release
```

## Stale-proof prevention

The release gate in `src/proof-release.mjs` separates a proof claim from the read-only observation that supports it. A `CURRENT` claim is publishable only when its target, exact deployment ID, exact rollback ID, observation timestamp, freshness window, and expected field names and values match the observation packet. `HISTORICAL` and `SUPERSEDED` evidence remains traceable but cannot satisfy a current-state claim. Missing observations, drift, expired observations, unknown observations, and casing changes such as `Industry` versus `industry` return `BLOCKED`.

The gate is intentionally provider-neutral. A Netlify, DFW Metro, or other host adapter may obtain the observation, but the adapter cannot make an old claim current by itself and no credentials enter the proof packet. This prevents the specific stale-DFWMow-reference failure from silently becoming a green proof receipt while preserving the useful finding when drift is detected.

The provider-compatibility proof adds a separate release check for the other trust boundary. A synthetic rehearsal receipt is
valid evidence of the local adapter path but is explicitly `REHEARSAL_ONLY` and cannot satisfy a real-provider gate. A
host-observed receipt must bind the exact source commit, workflow, read-only capability, request/response digests, provider
identity, and usage, then verify an Ed25519 signature against a trusted host key. The verifier is offline and token-free; it
does not store credentials or make the provider call. The current repository proves the boundary and negative cases, not an
actual external-provider execution.

## USB and DFW Metro integration

USB used the harness while building and verifying deterministic Site artifacts for DFW Metro and the disposable DFWMow review lab. In that integration, the harness supplied bounded continuation decisions, portable takeover checkpoints, focused change-impact verification, approval boundaries, handoff state, rollback-aware evidence, and now the repository-native task/claim/result bridge. USB's production Site generation remained deterministic and model-free.

The DFW work is integral integration evidence, but it is not silently promoted into a stronger claim:

- `dfwmow.app` is a disposable lab. The latest control-plane deployment is `6ab3d15578d1a74798a1ffaa` with rollback `6ab3ae36c48beb67fba5f13f`; its postflight kept the three approved functions, returned the public root, `/usb-lab/`, and preserved offline download, and rejected an unauthenticated private-route probe. The earlier visibility-only deployment `6ab3ae36c48beb67fba5f13f` with rollback `6ab30ab46f75142052f49c05` remains historical evidence.
- `dfwmetro.net` is external production state. Representative deploy `6ab2942e25bdceaae9957a56` has rollback `6ab286fa2f85736581654303`; its evidence covers the reported DFW address-validation/crawler update and browser-readback scope, not a claim that the harness is DFW Metro runtime infrastructure.
- The USB repository is private, so its integration commit and detailed postflight records are cited as owner-controlled evidence rather than presented as publicly inspectable source.

## Live reconciliation evidence

Muse ran a read-only `dfwmetro-reconciliation-v1` workflow through the harness itself. The compiled artifact was digest-bound; the governance bundle, step input/output contracts, budget, and hash-chained event log were enforced. The run produced 17 events, compiled 10 cost units, spent 7, and reported 5 checks passing with 1 finding: the proof record's old DFWMow reference was stale because live had advanced to `6ab3d15578d1a74798a1ffaa`. That finding is a useful proof of drift detection, not a reason to call the live reconciliation fully green.

The same run confirmed the claimed DFW Metro production deploy, the 138-city `dfw-cities.json` content, four agent-discovery documents, and the manifest's `submit_listing` declaration on `POST /mcp`. The first industry-name mismatch was corrected as a checker expectation (`industry`, not `Industry`) and was not treated as a Site defect. The raw run remains owner-controlled rather than copied into this public repository, so this is integration evidence for reconciliation behavior, not a replacement for reproducible package tests.

The exact IDs and effect boundaries are also recorded in [`PROOF-STATUS.v1.json`](PROOF-STATUS.v1.json). They are evidence references, not deployment authority.

## FreeVibeApps integration evidence

The owner attests that Bounded Agent Harness was mounted before FreeVibeApps work began and remained mounted throughout
the intake, grouped-directory, headless-sidecar, submission/review, and same-origin production-pilot work. This is
recorded as an owner-attested continuity fact, not inferred from a late test run.

The public evidence is scoped to the parts that can be stated without exposing the private USB repository or secrets:

- The deterministic FreeVibeApps headless sidecar proof passed `9/9`; its manifest was bound to the intended public
  listing table and event function, and the browser used injected API configuration rather than direct database calls.
- The combined FreeVibeApps/headless preflight and regression proof passed `14/14`.
- The same-origin production pilot passed `10/10` focused tests and live readback for the homepage/runtime, public API,
  exact CORS and preflight, arbitrary-origin rejection, protected admin access, and invalid submission rejection.
- The published pilot is deploy `6ab72d616482efce5606aa34` at [freevibeapps.com](https://freevibeapps.com); the recorded
  rollback is `6ab6ca26ee52574fa30c527d`.

This demonstrates the harness being used as the bounded control plane around a real site build and production pilot.
It does not claim that every individual FreeVibeApps mutation is independently replayable from this public repository,
that the harness itself is the hosted FreeVibeApps runtime, or that the current shared backend credential is least
privilege. The source and raw owner-controlled run records remain private in USB.

## What remains unproven

The following should remain visible rather than being hidden by the positive proof:

- hosted or distributed operation;
- cryptographic authentication of external providers;
- independent real-provider compatibility;
- a real-provider MCP run through an actual host client;
- a successful signed provider-compatibility receipt from an actual host client;
- a hosted approval/scheduling service;
- commercial production readiness as a managed service;
- the claim that every DFW Metro production action was executed by this harness.

An evaluator should therefore score the harness as **proven within scope**, with explicit remaining product and deployment work—not as “unproven.”
