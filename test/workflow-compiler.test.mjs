import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, ContractRegistry, HarnessError, compileWorkflow, verifyWorkflowArtifact } from "../src/index.mjs";
import { REVIEW_LEVELS } from "../src/index.mjs";

const registry = () => new ContractRegistry().register("input.v1", () => true).register("result.v1", () => true);
const specialists = [{ id: "reviewer", version: 1, description: "Reviewer", strengths: ["review"], limitations: ["read only"], capabilities: ["review.code"], authority: ["read.workspace"], adapter: "mcp.review", evidence: { completedRuns: 0, acceptedOutputs: 0, rejectedOutputs: 0 } }];
const plan = () => ({ id: "test-plan", version: 1, objective: "Test", budget: { maxCostUnits: 2 }, steps: [{ id: "review", specialist: "reviewer", capability: "review.code", authority: "read.workspace", dependsOn: [], contextProjection: {}, input: {}, inputContract: "input.v1", outputContract: "result.v1", costUnits: 1, effect: "read" }] });
const governance = () => ({ version: 1, atoms: [{ id: "contract-review", version: 1, statement: "Every handoff satisfies the named output contract.", reviewLevel: REVIEW_LEVELS.CONTRACT, enforcementPoints: ["compile", "invoke"], requiredEvidence: ["accepted-output"], blastRadius: "low", humanFloorRequired: false, authorityMode: "NARROW_ONLY", status: "ACTIVE" }], requiredAtomIds: ["contract-review"], authorityMode: "NARROW_ONLY" });
const floor = () => ({ format: "usb.autonomous-floor.v1", version: 1, project: "usb-website-platform", goal: "local work", allowedEffects: ["read", "local-test", "local-reversible-artifact"], forbiddenEffects: ["deploy", "dns", "payment"], requiredReviewRoles: ["contract", "domain", "consistency", "reconciliation"], maxCostUnits: 8, timeoutPolicy: { forkAfterMinutes: 30, localOnly: true }, authorityMode: "NARROW_ONLY" });

test("compilation is deterministic", () => {
  const first = compileWorkflow({ plan: plan(), specialists, contracts: registry() });
  const second = compileWorkflow({ plan: plan(), specialists, contracts: registry() });
  assert.equal(first.digest, second.digest);
  assert.equal(first.canonical, second.canonical);
  assert.match(first.contracts[0].digest, /^sha256:/);
  assert.match(first.specialists[0].profileDigest, /^sha256:/);
});

test("specialist profile changes alter the compiled workflow identity", () => {
  const first = compileWorkflow({ plan: plan(), specialists, contracts: registry() });
  const changed = structuredClone(specialists);
  changed[0].limitations.push("cannot inspect generated files");
  const second = compileWorkflow({ plan: plan(), specialists: changed, contracts: registry() });
  assert.notEqual(first.digest, second.digest);
});

test("contract definition changes alter the compiled workflow identity", () => {
  const firstContracts = new ContractRegistry().register("input.v1", () => true).register("result.v1", () => true, { definition: { required: ["answer"] } });
  const secondContracts = new ContractRegistry().register("input.v1", () => true).register("result.v1", () => true, { definition: { required: ["answer", "source"] } });
  const first = compileWorkflow({ plan: plan(), specialists, contracts: firstContracts });
  const second = compileWorkflow({ plan: plan(), specialists, contracts: secondContracts });
  assert.notEqual(first.digest, second.digest);
});

test("compiled artifact verification detects field, canonical, and digest tampering", () => {
  const compiled = compileWorkflow({ plan: plan(), specialists, contracts: registry() });
  assert.equal(verifyWorkflowArtifact(compiled), compiled);
  const changedField = structuredClone(compiled);
  changedField.steps[0].authority = "write.workspace";
  assert.throws(() => verifyWorkflowArtifact(changedField), /canonical payload/);
  const changedCanonical = structuredClone(compiled);
  changedCanonical.canonical = "{}";
  assert.throws(() => verifyWorkflowArtifact(changedCanonical), /canonical payload/);
  const changedDigest = structuredClone(compiled);
  changedDigest.digest = "sha256:wrong";
  assert.throws(() => verifyWorkflowArtifact(changedDigest), /digest does not match/);
});

test("optional governance bundle is digest-bound at compile and verification", () => {
  const compiled = compileWorkflow({ plan: plan(), specialists, contracts: registry(), governance: governance() });
  assert.match(compiled.governance.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(verifyWorkflowArtifact(compiled), compiled);
  const tampered = structuredClone(compiled);
  tampered.governance.atoms[0].statement = "weakened";
  assert.throws(() => verifyWorkflowArtifact(tampered), (error) => error?.code === "GOVERNANCE_TAMPERED");
});

test("optional floor manifest is bound and tamper-checked", () => {
  const compiled = compileWorkflow({ plan: plan(), specialists, contracts: registry(), floor: floor() });
  assert.match(compiled.floor.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(verifyWorkflowArtifact(compiled), compiled);
  const tampered = structuredClone(compiled);
  tampered.floor.goal = "changed";
  assert.throws(() => verifyWorkflowArtifact(tampered), (error) => error?.code === "FLOOR_TAMPERED");
});

test("canonical JSON matches JSON omission semantics for undefined values", () => {
  assert.equal(canonicalize({ keep: 1, omit: undefined, array: [undefined] }), '{"array":[null],"keep":1}');
});

test("authority escalation fails closed", () => {
  const unsafe = plan();
  unsafe.steps[0].authority = "write.workspace";
  assert.throws(() => compileWorkflow({ plan: unsafe, specialists, contracts: registry() }), (error) => error instanceof HarnessError && error.code === "AUTHORITY_ESCALATION");
});

test("cycles and excess cost fail closed", () => {
  const cyclic = plan();
  cyclic.steps[0].dependsOn = ["review"];
  cyclic.steps[0].contextProjection = { review: [] };
  assert.throws(() => compileWorkflow({ plan: cyclic, specialists, contracts: registry() }), /dependency cycle/);
  const expensive = plan();
  expensive.steps[0].costUnits = 3;
  assert.throws(() => compileWorkflow({ plan: expensive, specialists, contracts: registry() }), /budget permits/);
});
