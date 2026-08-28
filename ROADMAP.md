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
- Heartbeat receipt, lease expiry, bounded retry, and recovery checkpoint.
- Heartbeat receipts and lease summaries bind worker, workflow, cumulative cost, and monotonic time; bounded recovery policy is explicit and side-effect-aware.
- Per-step cost ledger and run summary.
- Local multi-writer serialization and non-destructive orphan diagnosis; distributed locking and authorized orphan removal remain.

Status: local execution foundation implemented; distributed operation remains.

## 0.3 — product boundary

- CLI supports validate, compile, zero-side-effect run/resume, inspect, and heartbeat; configured MCP execution remains.
- Portable JSON Schemas and example integration.
- Threat model, operator guide, and failure-mode documentation.
- Deterministic run summaries expose state, failures, cost variance, and providers; hosted dashboards remain outside the prototype.
- A zero-network two-provider MCP demo proves differentiated handoff, response-shape compatibility, identity pinning, context flow, and cost evidence; external-provider compatibility remains.

Status: extraction and operator path are runnable; external-provider proof and release packaging remain.

## Commercial path

- Community edition: AGPL-3.0-or-later.
- Commercial alternative: proprietary embedding, closed modified hosted use, support, and integration.
- Early revenue: voluntary sponsorship plus a small number of scoped founding design-partner engagements.
- Future hosted product: managed observability, policy, approval, and recovery surfaces after external demand is proven.

Publishing to a package registry or deploying a hosted service remains intentionally locked.
