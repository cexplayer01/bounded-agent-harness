import { assert } from "./errors.mjs";

const TIERS = new Set(["frontier", "standard", "economy"]);
const RISK_CLASSES = new Set(["A", "B", "C", "D"]);
const COSTS = Object.freeze({ frontier: 4, standard: 2, economy: 1 });

/**
 * Select a model tier as policy metadata only. This function never invokes a
 * provider and cannot lower the authority ceiling of the compiled workflow.
 */
export function selectModelTier({ riskClass, requestedTier = "standard", fork = false, maxCostUnits }) {
  assert(RISK_CLASSES.has(riskClass), "INVALID_RISK_CLASS", "riskClass must be A, B, C, or D");
  assert(TIERS.has(requestedTier), "INVALID_MODEL_TIER", "requestedTier must be frontier, standard, or economy");
  assert(Number.isSafeInteger(maxCostUnits) && maxCostUnits > 0, "INVALID_BUDGET", "maxCostUnits must be a positive integer");
  if (fork) assert(["A", "B"].includes(riskClass), "MODEL_DOWNGRADE_FORBIDDEN", "fork model selection is limited to Class A/B work");
  if (["C", "D"].includes(riskClass)) {
    return { decision: "ESCALATE", selectedTier: null, reason: "HUMAN_FLOOR_REQUIRED", riskClass, fork, estimatedCostUnits: 0, maxCostUnits };
  }
  const selectedTier = fork ? "economy" : requestedTier;
  const estimatedCostUnits = COSTS[selectedTier];
  assert(estimatedCostUnits <= maxCostUnits, "MODEL_BUDGET_EXCEEDED", `${selectedTier} model estimate exceeds the available budget`);
  return { decision: "CONTINUE", selectedTier, reason: fork ? "FORK_LOWEST_REASONABLE" : "REQUESTED_TIER", riskClass, fork, estimatedCostUnits, maxCostUnits };
}

export { COSTS as MODEL_TIER_COSTS };
