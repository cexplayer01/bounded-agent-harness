import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ContractRegistry } from "./contract-registry.mjs";
import { validatePlan, validateSpecialist } from "./contracts.mjs";
import { validateFloorManifest } from "./floor-policy.mjs";
import { heartbeatStatus } from "./heartbeat.mjs";
import { recordHeartbeat, summarizeHeartbeats } from "./heartbeat.mjs";
import { FileMemoryStore } from "./memory-store.mjs";
import { compileWorkflow } from "./workflow-compiler.mjs";
import { assert } from "./errors.mjs";
import { declarativeContracts, localAdapters } from "./declarative-runtime.mjs";
import { executeWorkflow } from "./executor.mjs";
import { summarizeEvents } from "./observability.mjs";
import { scanChangeImpact } from "./change-impact.mjs";

const json = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));

function options(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) parsed._.push(value);
    else {
      const key = value.slice(2);
      assert(args[index + 1] && !args[index + 1].startsWith("--"), "CLI_ARGUMENT", `--${key} requires a value`);
      parsed[key] = args[index += 1];
    }
  }
  return parsed;
}

export async function runCli(argv, io = { out: console.log, err: console.error }) {
  const [command, ...rest] = argv;
  const args = options(rest);
  if (command === "validate") {
    const plan = validatePlan(await json(args.plan));
    const specialists = await json(args.specialists);
    specialists.forEach(validateSpecialist);
    const floor = args.floor ? validateFloorManifest(await json(args.floor)) : undefined;
    const result = { valid: true, planId: plan.id, specialists: specialists.map((item) => item.id).sort(), ...(floor ? { floorProject: floor.project } : {}) };
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "compile") {
    const plan = await json(args.plan);
    const specialists = await json(args.specialists);
    const contracts = declarativeContracts(await json(args.contracts));
    const floor = args.floor ? await json(args.floor) : undefined;
    const compiled = compileWorkflow({ plan, specialists, contracts, floor });
    const output = args.output ? resolve(args.output) : null;
    if (output) await writeFile(output, `${JSON.stringify(compiled, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    io.out(JSON.stringify({ compiled: true, planId: compiled.planId, digest: compiled.digest, output }, null, 2));
    return compiled;
  }
  if (command === "inspect") {
    const memory = new FileMemoryStore(args.memory);
    const envelopes = await memory.envelopes();
    const result = { valid: true, events: envelopes.length, headHash: envelopes.at(-1)?.hash || null, runs: summarizeEvents(envelopes.map((entry) => entry.payload)), checkpoint: await memory.readCheckpoint() };
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "run" || command === "resume") {
    const workflow = await json(args.workflow);
    const contracts = declarativeContracts(await json(args.contracts));
    const adapters = localAdapters(await json(args.adapters));
    const memory = new FileMemoryStore(args.memory);
    const approvals = args.approvals ? await json(args.approvals) : [];
    const result = await executeWorkflow({ workflow, contracts, adapters, memory, runId: args["run-id"], resume: command === "resume", approvals });
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "heartbeat") {
    const result = heartbeatStatus({ lastReceiptAt: Date.parse(args.last), now: args.now ? Date.parse(args.now) : Date.now(), leaseMs: Number(args["lease-ms"]) });
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "beat") {
    const memory = new FileMemoryStore(args.memory);
    const event = await recordHeartbeat(memory, { runId: args["run-id"], workerId: args["worker-id"], workflowDigest: args.workflow, spentCostUnits: Number(args["spent-cost"]), at: args.at ? Date.parse(args.at) : Date.now() });
    io.out(JSON.stringify(event, null, 2));
    return event;
  }
  if (command === "leases") {
    const memory = new FileMemoryStore(args.memory);
    const result = summarizeHeartbeats(await memory.events(), { now: args.now ? Date.parse(args.now) : Date.now(), leaseMs: Number(args["lease-ms"]) });
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "lock-status") {
    const result = await new FileMemoryStore(args.memory).lockStatus({ staleAfterMs: args["stale-after-ms"] ? Number(args["stale-after-ms"]) : 60_000 });
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "impact") {
    assert(args.request && args.root, "CLI_ARGUMENT", "impact requires --request and --root");
    const request = await json(args.request);
    const result = await scanChangeImpact({ rootDirectory: resolve(args.root), request });
    const output = args.output ? resolve(args.output) : null;
    if (output) await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    io.out(JSON.stringify(result, null, 2));
    return result;
  }
  throw new Error("Usage: agent-harness <validate|compile|run|resume|inspect|heartbeat|beat|leases|lock-status|impact> [options]");
}
