import { randomUUID } from "node:crypto";
import { assert, HarnessError } from "./errors.mjs";
import { buildCapabilityEnvelope } from "./capability-envelope.mjs";
import { recoveryCheckpoint } from "./heartbeat.mjs";
import { verifyWorkflowArtifact } from "./workflow-compiler.mjs";
import { governanceDigest, validateGovernanceBundle } from "./governance.mjs";
import { floorDigest, validateFloorManifest } from "./floor-policy.mjs";

async function reconstruct(memory, workflow, runId) {
  const events = (await memory.events()).filter((event) => event.runId === runId);
  if (!events.length) return null;
  const started = events.find((event) => event.type === "run.started");
  assert(started?.workflowDigest === workflow.digest, "RESUME_DIGEST_MISMATCH", "run belongs to a different workflow artifact");
  const completed = events.filter((event) => event.type === "step.completed");
  const runCompleted = events.some((event) => event.type === "run.completed");
  const outputs = Object.fromEntries(completed.map((event) => [event.stepId, event.output]));
  const completedSteps = completed.map((event) => event.stepId);
  const ambiguous = events.filter((event) => event.type === "step.started" && !completedSteps.includes(event.stepId)).map((event) => event.stepId);
  return {
    run: {
      id: runId,
      workflowDigest: workflow.digest,
      completedSteps,
      pendingSteps: workflow.steps.map((step) => step.id).filter((id) => !completedSteps.includes(id)),
      spentCostUnits: completed.reduce((sum, event) => sum + event.costUnits, 0)
    },
    outputs,
    ambiguous,
    runCompleted
  };
}

export async function executeWorkflow({ workflow, contracts, adapters, memory, runId = randomUUID(), now = () => Date.now(), signal, resume = false, approvals = [] }) {
  if (workflow?.canonical !== undefined || workflow?.contracts !== undefined) verifyWorkflowArtifact(workflow);
  else assert(workflow?.format === "agent-harness.workflow.v1", "INVALID_WORKFLOW", "compiled workflow v1 is required");
  if (Array.isArray(workflow.contracts)) {
    assert(JSON.stringify(workflow.contracts) === JSON.stringify(contracts.describe()), "CONTRACT_REGISTRY_MISMATCH", "runtime contract registry does not match the compiled workflow");
  }
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
  const prior = resume ? await reconstruct(memory, workflow, runId) : null;
  assert(resume || !(await reconstruct(memory, workflow, runId)), "RUN_ALREADY_EXISTS", `run ${runId} already exists; explicit resume is required`);
  assert(!prior?.runCompleted, "RUN_ALREADY_COMPLETED", `run ${runId} is already complete and cannot be resumed`);
  const run = prior?.run || { id: runId, workflowDigest: workflow.digest, completedSteps: [], pendingSteps: workflow.steps.map((step) => step.id), spentCostUnits: 0 };
  const outputs = prior?.outputs || {};
  if (!prior) await memory.append({ type: "run.started", runId, workflowDigest: workflow.digest, at: new Date(now()).toISOString() });
  else await memory.append({ type: "run.resumed", runId, completedSteps: [...run.completedSteps], at: new Date(now()).toISOString() });
  if (workflow.governance) await memory.append({ type: "governance.verified", runId, governanceDigest: workflow.governance.digest, authorityMode: workflow.governance.authorityMode, at: new Date(now()).toISOString() });
  try {
    for (const step of workflow.steps) {
      if (run.completedSteps.includes(step.id)) continue;
      if (signal?.aborted) throw new HarnessError("RUN_ABORTED", "run was aborted");
      if (step.approval?.required) {
        const approval = approvals.find((item) => item.gateId === step.approval.gateId && item.stepId === step.id && item.workflowDigest === workflow.digest && item.decision === "approved");
        assert(approval, "APPROVAL_REQUIRED", `${step.id} requires approval gate ${step.approval.gateId} bound to this workflow`);
        await memory.append({ type: "step.approval-verified", runId, stepId: step.id, gateId: step.approval.gateId, workflowDigest: workflow.digest, at: new Date(now()).toISOString() });
      }
      if (prior?.ambiguous.includes(step.id) && step.effect === "external") {
        assert(step.idempotencyKey, "AMBIGUOUS_EXTERNAL_EFFECT", `${step.id} may have completed externally and has no safe retry key`);
      }
      assert(run.spentCostUnits + step.costUnits <= workflow.budget.maxCostUnits, "BUDGET_EXCEEDED", `step ${step.id} would exceed budget`);
      const context = Object.fromEntries(step.dependsOn.map((id) => {
        const fields = step.contextProjection?.[id];
        if (!fields) return [id, outputs[id]];
        for (const field of fields) assert(Object.hasOwn(outputs[id], field), "CONTEXT_FIELD_MISSING", `${step.id} requires ${id}.${field}, but the dependency did not produce it`);
        return [id, Object.fromEntries(fields.map((field) => [field, outputs[id][field]]))];
      }));
      if (step.inputContract) contracts.validate(step.inputContract, step.input);
      await memory.append({ type: "step.started", runId, stepId: step.id, specialist: step.specialist, adapter: step.adapter, at: new Date(now()).toISOString() });
      const handoff = {
        format: "agent-harness.handoff.v1",
        runId,
        workflowDigest: workflow.digest,
        stepId: step.id,
        sequence: step.sequence,
        specialist: step.specialist,
        adapter: step.adapter,
        capability: step.capability,
        authority: step.authority,
        inputContract: step.inputContract,
        outputContract: step.outputContract
      };
      const adapterValue = await adapters.get(step.adapter).invoke({
        handoff,
        invocation: buildCapabilityEnvelope({
          runId,
          workflowDigest: workflow.digest,
          step,
          attempt: 1,
          expiresAt: new Date(now() + 60_000).toISOString()
        }),
        input: step.input,
        context,
        signal,
        idempotencyKey: step.idempotencyKey,
        resumed: Boolean(prior),
        reservedCostUnits: step.costUnits
      });
      const wrapped = adapterValue?.format === "agent-harness.adapter-result.v1";
      const output = wrapped ? adapterValue.output : adapterValue;
      const usage = wrapped ? adapterValue.usage : { costUnits: step.costUnits, source: "reserved-ceiling" };
      const provider = wrapped ? adapterValue.provider : null;
      assert(Number.isSafeInteger(usage?.costUnits) && usage.costUnits >= 0, "INVALID_ADAPTER_USAGE", `${step.id} returned invalid cost usage`);
      assert(usage.costUnits <= step.costUnits, "STEP_COST_EXCEEDED", `${step.id} reported ${usage.costUnits} cost units but reserved ${step.costUnits}`);
      contracts.validate(step.outputContract, output);
      outputs[step.id] = output;
      run.spentCostUnits += usage.costUnits;
      run.completedSteps.push(step.id);
      run.pendingSteps.shift();
      await memory.append({ type: "step.completed", runId, stepId: step.id, costUnits: usage.costUnits, reservedCostUnits: step.costUnits, usageSource: usage.source, provider, output, at: new Date(now()).toISOString() });
      await memory.checkpoint(recoveryCheckpoint({ run, reason: "step-completed", now: now() }));
    }
    const result = { status: "completed", runId, workflowDigest: workflow.digest, spentCostUnits: run.spentCostUnits, outputs };
    await memory.append({ type: "run.completed", runId, spentCostUnits: run.spentCostUnits, at: new Date(now()).toISOString() });
    await memory.checkpoint(result);
    return result;
  } catch (error) {
    const checkpoint = recoveryCheckpoint({ run, reason: error.code || "execution-failed", now: now() });
    await memory.append({ type: "run.failed", runId, code: error.code || "UNEXPECTED_ERROR", message: error.message, at: new Date(now()).toISOString() });
    await memory.checkpoint(checkpoint);
    throw error;
  }
}
