import { readFile } from "node:fs/promises";
import { ContractRegistry, compileWorkflow } from "../src/index.mjs";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const [plan, specialists] = await Promise.all([load("../examples/review-plan.json"), load("../examples/specialists.json")]);
const contracts = new ContractRegistry()
  .register("research-input.v1", (value) => value && typeof value.question === "string", { definition: { id: "research-input.v1", required: ["question"] } })
  .register("review-input.v1", (value) => value && typeof value.scope === "string", { definition: { id: "review-input.v1", required: ["scope"] } })
  .register("evidence.v1", (value) => value && Array.isArray(value.sources), { definition: { id: "evidence.v1", required: ["sources"] } })
  .register("review.v1", (value) => value && Array.isArray(value.findings), { definition: { id: "review.v1", required: ["findings"] } });

const compiled = compileWorkflow({ plan, specialists, contracts });
console.log(JSON.stringify(compiled, null, 2));
