# Bounded Agent Harness product definition

## Buyer

A small engineering team building constrained agent systems that already has models and tools, but lacks a dependable control plane for assigning work, preserving state, bounding authority, controlling cost, and recovering after interruption.

## Pain

Most agent frameworks optimize for invoking models. Production failures happen around them: stale chat context, ambiguous authority, unvalidated handoffs, duplicated work, silent cost growth, provider-specific coupling, and no trustworthy recovery point.

## Wedge

Bounded Agent Harness compiles a versioned plan before it runs. Specialists are selected for declared capabilities and cannot exceed declared authority. Every output crosses a named contract. The executor records an append-only event trail and an atomic checkpoint. MCP is an interchangeable tool boundary rather than a source of implicit trust.

## Smallest sellable offer

1. AGPL community edition: compiler, local executor, contracts, memory, heartbeat, and adapter SDK.
2. Commercial license: proprietary embedding or modified hosted use without AGPL source-release obligations.
3. Founding design-partner service: migrate one brittle agent workflow into a deterministic compiled workflow.
4. Future hosted edition: managed run ledger, policy registry, dashboards, approval gates, and recovery controls.

Licensing is AGPL-3.0-or-later with a separately negotiated commercial alternative. Sponsorship funds community work but does not replace a commercial license. Pricing and hosting remain unproven and must follow evidence from real design partners.

## Proof required before commercialization

- A new developer can run the demo and understand a failed policy check in under 15 minutes.
- Two materially different MCP providers can use the same compiled workflow without changing its contracts.
- An interrupted run resumes without repeating a completed side effect.
- Cost and authority limits remain enforced under adapter failure and malformed output.
- One external builder reports that the harness removed code or operational work they otherwise needed.

## Honest differentiation

Specialists are not interchangeable personas. A profile states observable capabilities, limitations, adapter, authority, and accepted/rejected outcome counts. Routing filters by capability and authority first, then prefers verified outcomes and labels missing history honestly. Model branding and fictional personality never affect selection. Provider metadata is evidence for routing; it never relaxes a contract or gate.

Completed-but-unreviewed work is tracked separately from accepted or rejected outputs. The system does not turn activity volume into a false quality claim.
