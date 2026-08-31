# Governed review ladder

The harness uses a Republic-style governance plane beside its deterministic control plane. A governed atom is a versioned requirement with named enforcement points and required evidence. An atom that is not bound to enforcement is reported by a standing query; it is never treated as protected by prose alone.

## Levels

| Level | Name | Bounded role | Default HITL posture |
| ---: | --- | --- | --- |
| 0 | Floor | Owner or cold-key root; can ratify or narrow authority | Permanent human floor for irreversible or high-blast actions |
| 1 | Contract | Checks closed contracts, declared fields, and handoff shape | Can replace routine contract review after measured evidence |
| 2 | Domain | Checks one bounded domain (for example media metadata) | Can replace routine domain review after measured evidence |
| 3 | Consistency | Checks cross-step contradictions, leakage, and acceptance weakening | Independent cross-check remains required for composed workflows |
| 4 | Reconciliation | Verifies whether an external effect actually occurred | Can automate post-effect observation, never invent ambiguous success |
| 5 | Execution | Performs one already-authorized, narrow effect | Human floor remains for high-blast or irreversible effects |

Promotion is an evidence-based recommendation, not an authority grant. `assessPromotion` requires caller-supplied thresholds, zero recorded contract/identity/cost failures, clean standing queries, and no rejected outcomes. The caller must still issue a new narrow capability and approval bound to the workflow digest.

The authority mode is always `NARROW_ONLY`: atoms, reviewers, and adapters cannot widen their own authority. Gates are checked at compile, authorize, lease, invoke, and reconcile boundaries. There is no separate policy service whose outage can silently fail open.

The governance module is local and dependency-free. It does not change the USB website vertical, provider credentials, deployment, payment, email, DNS, or database behavior.
