# Bounded Agent Harness proof status

Recorded 2026-09-23 for development package version `0.3.0` and tested source commit `d46764964a27894d61e33f415406ff9ba41721e9`.

Capability maturity: `LOCAL_CONTROL_PLANE_MILESTONE_1.6`. This maturity label is separate from contract IDs such as `*.v1` and from hosted/commercial readiness.

## Bottom line

Bounded Agent Harness is proven within a declared local-control-plane scope. The current checked-in suite passes 130/130 tests, the package audit returns `valid: true` with no findings, the deterministic workflow demo passes, the two-provider in-process MCP compatibility demo completes without a network or model call, the repository-native shared-agent bridge passes its focused identity/claim/scope-reservation/lease tests, the local concurrency rehearsal passes overlap rejection/disjoint admission/release-and-reclaim, and the proof-release gate returns `READY_TO_PUBLISH` for a fresh exact observation.

This is not a claim that the package is already a hosted production service or that an external provider has been independently authenticated.

The machine-readable record is [`PROOF-STATUS.v1.json`](PROOF-STATUS.v1.json). It is the concise proof surface for automated readers; this document explains the same boundary in plain language.

## What the direct proof establishes

| Area | Result | Evidence | Boundary |
|---|---|---|---|
| Automated behavior | PASS | `npm test` — 130/130 | Checked-in local behavior, not hosted operation |
| Package safety surface | PASS | `npm run audit` — `valid: true`, no findings | Does not authenticate an external deployment |
| Deterministic compilation | PASS | `npm run demo` | Closed example inputs and local compiler |
| MCP adapter compatibility | PASS | `npm run demo:mcp` — 2 specialists, 6 evidence events, 5 cost units | In-process client shapes; no claim about a named external provider |
| Continuation and recovery | PASS | Automated tests for approvals, checkpoints, wakes, forks, work-loop policy, and reconciliation | Host scheduling and external authority remain injected boundaries |
| Proof publication gate | PASS | `npm run proof:release` — `READY_TO_PUBLISH`; stale deployment, stale observation, missing observation, and field-name drift are tested as blocking cases | The host adapter must still supply truthful read-only observations |
| Shared repository agent bridge | PASS | `shared-task-queue.test.mjs` — deterministic identity, one fixed claim, overlapping-scope rejection, disjoint-scope admission, digest-bound result, path scope, lease expiry, and release | Does not itself provide a direct Muse chat/MCP channel or hosted queue |
| Shared-agent concurrency rehearsal | PASS | `npm run demo:shared-task` — overlapping scope blocked, disjoint scope claimed, released scope reclaimed; temporary synthetic queue only | Does not prove DFW repository access or direct Muse messaging |
| Live reconciliation exercise | DEMONSTRATED WITH DRIFT | Owner-controlled `dfwmetro-reconciliation-v1` run — 17 hash-chained events, 10 compiled cost units, 7 spent, 5 checks passed, 1 stale-claim finding | Demonstrates detection and reporting of live drift; not a clean all-live proof or hosted-service proof |

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

## What remains unproven

The following should remain visible rather than being hidden by the positive proof:

- hosted or distributed operation;
- cryptographic authentication of external providers;
- independent real-provider compatibility;
- a hosted approval/scheduling service;
- commercial production readiness as a managed service;
- the claim that every DFW Metro production action was executed by this harness.

An evaluator should therefore score the harness as **proven within scope**, with explicit remaining product and deployment work—not as “unproven.”
