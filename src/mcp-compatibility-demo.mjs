import { readFile } from "node:fs/promises";
import { AdapterRegistry, mcpAdapter } from "./adapters.mjs";
import { declarativeContracts } from "./declarative-runtime.mjs";
import { executeWorkflow } from "./executor.mjs";
import { FileMemoryStore } from "./memory-store.mjs";
import { compileWorkflow } from "./workflow-compiler.mjs";

const load = async (url) => JSON.parse(await readFile(url, "utf8"));

export async function runMcpCompatibilityDemo({ memoryRoot, runId = "mcp-compatibility-demo" }) {
  const [plan, specialists, definitions] = await Promise.all([
    load(new URL("../examples/review-plan.json", import.meta.url)),
    load(new URL("../examples/specialists.json", import.meta.url)),
    load(new URL("../examples/contracts.json", import.meta.url))
  ]);
  const contracts = declarativeContracts(definitions);
  const workflow = compileWorkflow({ plan, specialists, contracts });
  const calls = [];
  const researchClient = {
    getServerInfo: async () => ({ name: "research-provider", version: "1.0.0" }),
    listTools: async () => [{ name: "find-primary-sources" }],
    callTool: async (request) => {
      calls.push({ provider: "research-provider", handoff: request.arguments.handoff });
      return { structuredContent: { sources: ["primary-source"] }, _meta: { costUnits: 2 } };
    }
  };
  const reviewClient = {
    getServerInfo: async () => ({ name: "review-provider", version: "2.0.0" }),
    listTools: async () => ({ tools: ["review-contract"] }),
    callTool: async (request) => {
      calls.push({ provider: "review-provider", handoff: request.arguments.handoff });
      const hasEvidence = request.arguments.context.research.sources.includes("primary-source");
      return { structuredContent: { findings: hasEvidence ? [] : [{ code: "MISSING_EVIDENCE" }] }, _meta: { costUnits: 3 } };
    }
  };
  const adapters = new AdapterRegistry()
    .register("mcp.research", mcpAdapter(researchClient, { server: "research", tool: "find-primary-sources", expectedServer: { name: "research-provider", version: "1.0.0" } }))
    .register("mcp.code-review", mcpAdapter(reviewClient, { server: "review", tool: "review-contract", expectedServer: { name: "review-provider", version: "2.0.0" } }));
  const memory = new FileMemoryStore(memoryRoot);
  const result = await executeWorkflow({ workflow, contracts, adapters, memory, runId });
  return { workflow, result, calls, events: await memory.events() };
}
