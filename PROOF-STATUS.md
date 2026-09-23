# Bounded Agent Harness proof status

Recorded 2026-09-23 for development package version `0.2.0` and tested source commit `284085a`.

Capability maturity: `LOCAL_CONTROL_PLANE_MILESTONE_1.6`. This maturity label is separate from contract IDs such as `*.v1` and from hosted/commercial readiness.

## Bottom line

Bounded Agent Harness is proven within a declared local-control-plane scope. The current checked-in suite passes 120/120 tests, the package audit returns `valid: true` with no findings, the deterministic workflow demo passes, and the two-provider in-process MCP compatibility demo completes without a network or model call.

This is not a claim that the package is already a hosted production service or that an external provider has been independently authenticated.

The machine-readable record is [`PROOF-STATUS.v1.json`](PROOF-STATUS.v1.json). It is the concise proof surface for automated readers; this document explains the same boundary in plain language.

## What the direct proof establishes

| Area | Result | Evidence | Boundary |
|---|---|---|---|
| Automated behavior | PASS | `npm test` — 120/120 | Checked-in local behavior, not hosted operation |
| Package safety surface | PASS | `npm run audit` — `valid: true`, no findings | Does not authenticate an external deployment |
| Deterministic compilation | PASS | `npm run demo` | Closed example inputs and local compiler |
| MCP adapter compatibility | PASS | `npm run demo:mcp` — 2 specialists, 6 evidence events, 5 cost units | In-process client shapes; no claim about a named external provider |
| Continuation and recovery | PASS | Automated tests for approvals, checkpoints, wakes, forks, work-loop policy, and reconciliation | Host scheduling and external authority remain injected boundaries |

Reproduce the direct proof from the repository root:

```powershell
npm test
npm run audit
npm run demo
npm run demo:mcp
```

## USB and DFW Metro integration

USB used the harness while building and verifying deterministic Site artifacts for DFW Metro and the disposable DFWMow review lab. In that integration, the harness supplied bounded continuation decisions, portable takeover checkpoints, focused change-impact verification, approval boundaries, handoff state, and rollback-aware evidence. USB's production Site generation remained deterministic and model-free.

The DFW work is integral integration evidence, but it is not silently promoted into a stronger claim:

- `dfwmow.app` is a disposable visibility-only lab. Representative postflight deploy `6ab3ae36c48beb67fba5f13f` had rollback `6ab30ab46f75142052f49c05`; its boundary kept `live_lead_save=false` and `booking_payment_active=false`.
- `dfwmetro.net` is external production state. Representative deploy `6ab2942e25bdceaae9957a56` has rollback `6ab286fa2f85736581654303`; its evidence covers the reported DFW address-validation/crawler update and browser-readback scope, not a claim that the harness is DFW Metro runtime infrastructure.
- The USB repository is private, so its integration commit and detailed postflight records are cited as owner-controlled evidence rather than presented as publicly inspectable source.

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
