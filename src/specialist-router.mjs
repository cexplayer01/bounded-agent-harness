import { assert } from "./errors.mjs";
import { validateSpecialist } from "./contracts.mjs";

function record(profile) {
  const completed = profile.evidence.completedRuns;
  return {
    profile,
    acceptanceRate: completed === 0 ? null : profile.evidence.acceptedOutputs / completed,
    completed
  };
}

export function selectSpecialist({ capability, authority, specialists }) {
  const eligible = specialists.map(validateSpecialist)
    .filter((profile) => profile.capabilities.includes(capability) && profile.authority.includes(authority))
    .map(record)
    .sort((left, right) => {
      if (left.acceptanceRate === null && right.acceptanceRate !== null) return 1;
      if (right.acceptanceRate === null && left.acceptanceRate !== null) return -1;
      if (left.acceptanceRate !== right.acceptanceRate) return (right.acceptanceRate ?? -1) - (left.acceptanceRate ?? -1);
      if (left.completed !== right.completed) return right.completed - left.completed;
      return left.profile.id.localeCompare(right.profile.id);
    });
  assert(eligible.length > 0, "NO_ELIGIBLE_SPECIALIST", `no specialist has capability ${capability} and authority ${authority}`);
  const winner = eligible[0];
  return {
    specialist: winner.profile.id,
    basis: winner.acceptanceRate === null ? "declared-capability-no-outcome-history" : "verified-accepted-output-rate",
    evidence: { ...winner.profile.evidence },
    limitations: [...winner.profile.limitations]
  };
}

export function assignSpecialists({ plan, specialists }) {
  const assignments = [];
  const routed = structuredClone(plan);
  for (const step of routed.steps) {
    if (step.specialist !== "auto") continue;
    const selection = selectSpecialist({ capability: step.capability, authority: step.authority, specialists });
    step.specialist = selection.specialist;
    assignments.push({ stepId: step.id, ...selection });
  }
  return { plan: routed, assignments };
}

export function recordSpecialistOutcome(profile, outcome) {
  validateSpecialist(profile);
  assert(["accepted", "rejected", "completed-unreviewed"].includes(outcome), "INVALID_SPECIALIST_OUTCOME", "outcome must be accepted, rejected, or completed-unreviewed");
  const updated = structuredClone(profile);
  updated.evidence.completedRuns += 1;
  if (outcome === "accepted") updated.evidence.acceptedOutputs += 1;
  if (outcome === "rejected") updated.evidence.rejectedOutputs += 1;
  return validateSpecialist(updated);
}
