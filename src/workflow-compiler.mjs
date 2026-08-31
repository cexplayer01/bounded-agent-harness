import { canonicalize, sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";
import { validatePlan, validateSpecialist } from "./contracts.mjs";
import { governanceDigest, validateGovernanceBundle } from "./governance.mjs";
import { assertPlanWithinFloor, floorDigest, validateFloorManifest } from "./floor-policy.mjs";

export function compileWorkflow({ plan, specialists, contracts, governance, floor }) {
  validatePlan(plan);
  if (governance !== undefined) validateGovernanceBundle(governance);
  if (floor !== undefined) { validateFloorManifest(floor); assertPlanWithinFloor({ plan, floor }); }
  const profiles = new Map(specialists.map((profile) => [validateSpecialist(profile).id, profile]));
  assert(profiles.size === specialists.length, "DUPLICATE_SPECIALIST", "specialist IDs must be unique");
  const steps = new Map(plan.steps.map((step) => [step.id, step]));
  const totalCostUnits = plan.steps.reduce((sum, step) => sum + step.costUnits, 0);
  assert(totalCostUnits <= plan.budget.maxCostUnits, "BUDGET_EXCEEDED", `plan costs ${totalCostUnits}, budget permits ${plan.budget.maxCostUnits}`);

  for (const step of plan.steps) {
    const specialist = profiles.get(step.specialist);
    assert(specialist, "UNKNOWN_SPECIALIST", `${step.id} references unknown specialist ${step.specialist}`);
    assert(specialist.capabilities.includes(step.capability), "CAPABILITY_MISMATCH", `${step.specialist} lacks ${step.capability}`);
    assert(specialist.authority.includes(step.authority), "AUTHORITY_ESCALATION", `${step.specialist} lacks ${step.authority}`);
    assert(contracts.has(step.outputContract), "UNKNOWN_CONTRACT", `${step.id} references unknown contract ${step.outputContract}`);
    assert(contracts.has(step.inputContract), "UNKNOWN_CONTRACT", `${step.id} references unknown contract ${step.inputContract}`);
    contracts.validate(step.inputContract, step.input);
    for (const dependency of step.dependsOn) assert(steps.has(dependency), "UNKNOWN_DEPENDENCY", `${step.id} depends on unknown step ${dependency}`);
  }

  const remaining = new Set(steps.keys());
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter((stepId) => steps.get(stepId).dependsOn.every((dependency) => ordered.includes(dependency))).sort();
    assert(ready.length > 0, "DEPENDENCY_CYCLE", "workflow contains a dependency cycle");
    for (const stepId of ready) { ordered.push(stepId); remaining.delete(stepId); }
  }

  const artifact = {
    format: "agent-harness.workflow.v1",
    planId: plan.id,
    objective: plan.objective,
    budget: { maxCostUnits: plan.budget.maxCostUnits, compiledCostUnits: totalCostUnits },
    contracts: contracts.describe(),
    specialists: [...new Set(plan.steps.map((step) => step.specialist))].sort().map((id) => {
      const profile = profiles.get(id);
      return { id, adapter: profile.adapter, profileDigest: `sha256:${sha256(profile)}` };
    }),
    steps: ordered.map((stepId, sequence) => {
      const step = steps.get(stepId);
      return { sequence, ...step, adapter: profiles.get(step.specialist).adapter };
    })
  };
  if (governance !== undefined) artifact.governance = { ...governance, digest: governanceDigest(governance) };
  if (floor !== undefined) artifact.floor = { ...floor, digest: floorDigest(floor) };
  return { ...artifact, digest: `sha256:${sha256(artifact)}`, canonical: canonicalize(artifact) };
}

export function verifyWorkflowArtifact(workflow) {
  assert(workflow?.format === "agent-harness.workflow.v1", "INVALID_WORKFLOW", "compiled workflow v1 is required");
  if (workflow.governance !== undefined) {
    const { digest, ...governance } = workflow.governance;
    validateGovernanceBundle(governance);
    assert(digest === governanceDigest(governance), "GOVERNANCE_TAMPERED", "workflow governance digest does not match its bundle");
  }
  if (workflow.floor !== undefined) {
    const { digest, ...floor } = workflow.floor;
    validateFloorManifest(floor);
    assert(digest === floorDigest(floor), "FLOOR_TAMPERED", "workflow floor digest does not match its manifest");
  }
  const { digest, canonical, ...artifact } = workflow;
  const expectedCanonical = canonicalize(artifact);
  const expectedDigest = `sha256:${sha256(artifact)}`;
  assert(canonical === expectedCanonical, "WORKFLOW_ARTIFACT_TAMPERED", "workflow canonical payload does not match its fields");
  assert(digest === expectedDigest, "WORKFLOW_ARTIFACT_TAMPERED", "workflow digest does not match its fields");
  return workflow;
}
