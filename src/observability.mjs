import { assert } from "./errors.mjs";

export function summarizeEvents(events) {
  assert(Array.isArray(events), "INVALID_EVENTS", "events must be an array");
  const runs = new Map();
  for (const event of events) {
    if (!event.runId) continue;
    if (!runs.has(event.runId)) runs.set(event.runId, {
      runId: event.runId, status: "unknown", workflowDigest: null, startedAt: null, lastEventAt: null,
      completedSteps: 0, failedSteps: 0, spentCostUnits: 0, reservedCostUnits: 0, providers: []
    });
    const run = runs.get(event.runId);
    run.lastEventAt = event.at || run.lastEventAt;
    if (event.type === "run.started") {
      run.status = "running";
      run.workflowDigest = event.workflowDigest;
      run.startedAt = event.at;
    } else if (event.type === "run.completed") {
      run.status = "completed";
    } else if (event.type === "run.failed") {
      run.status = "failed";
      run.failure = { code: event.code, message: event.message };
    } else if (event.type === "step.completed") {
      run.completedSteps += 1;
      run.spentCostUnits += event.costUnits;
      run.reservedCostUnits += event.reservedCostUnits ?? event.costUnits;
      if (event.provider && !run.providers.some((provider) => provider.name === event.provider.name && provider.version === event.provider.version)) run.providers.push(event.provider);
    }
  }
  return [...runs.values()].sort((left, right) => left.runId.localeCompare(right.runId)).map((run) => ({
    ...run,
    savedCostUnits: run.reservedCostUnits - run.spentCostUnits,
    providers: run.providers.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`))
  }));
}
