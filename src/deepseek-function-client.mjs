import { assert } from "./errors.mjs";

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
export const DEEPSEEK_DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";

function text(value, label) {
  assert(typeof value === "string" && value.length > 0, "INVALID_DEEPSEEK_CLIENT", `${label} is required`);
  return value;
}

function functionTool(tool) {
  assert(tool && typeof tool === "object", "INVALID_DEEPSEEK_TOOL", "tool is required");
  const name = text(tool.name, "tool.name");
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(name), "INVALID_DEEPSEEK_TOOL", "tool.name must be a valid function name");
  assert(tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters), "INVALID_DEEPSEEK_TOOL", `${name}.parameters is required`);
  return {
    type: "function",
    function: {
      name,
      description: text(tool.description, `${name}.description`),
      parameters: tool.parameters,
      ...(tool.strict === undefined ? {} : { strict: Boolean(tool.strict) })
    }
  };
}

function usage(response) {
  const totalTokens = response?.usage?.total_tokens;
  if (totalTokens === undefined) return undefined;
  assert(Number.isSafeInteger(totalTokens) && totalTokens >= 0, "INVALID_DEEPSEEK_RESPONSE", "DeepSeek returned invalid total_tokens");
  return { costUnits: totalTokens, source: "provider-reported-tokens" };
}

export function createDeepSeekFunctionClient({ apiKey = process.env.DEEPSEEK_API_KEY, model = process.env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL, endpoint = process.env.DEEPSEEK_ENDPOINT || DEEPSEEK_DEFAULT_ENDPOINT, tools = [], fetchImpl = globalThis.fetch } = {}) {
  text(apiKey, "DEEPSEEK_API_KEY");
  text(model, "model");
  text(endpoint, "endpoint");
  assert(typeof fetchImpl === "function", "INVALID_DEEPSEEK_CLIENT", "fetch implementation is required");
  const normalizedTools = tools.map(functionTool);
  assert(normalizedTools.length > 0, "INVALID_DEEPSEEK_CLIENT", "at least one function tool is required");
  const names = new Set(normalizedTools.map((tool) => tool.function.name));
  assert(names.size === normalizedTools.length, "INVALID_DEEPSEEK_TOOL", "DeepSeek function names must be unique");

  return {
    async getServerInfo() {
      return { name: "deepseek-function-calling", version: model };
    },
    async listTools() {
      return normalizedTools.map((tool) => ({ name: tool.function.name }));
    },
    async callTool(request) {
      const toolName = text(request?.name, "request.name");
      assert(names.has(toolName), "DEEPSEEK_TOOL_MISSING", `DeepSeek bridge has no function ${toolName}`);
      const input = request?.arguments?.input ?? null;
      const context = request?.arguments?.context ?? null;
      const authority = request?.arguments?.invocation?.authorization;
      assert(authority?.allowedEffect === "read" && authority.maxEffects === 0, "DEEPSEEK_NOT_READ_ONLY", "DeepSeek bridge accepts read-only invocations only");
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          thinking: { type: "disabled" },
          temperature: 0,
          max_tokens: request?.arguments?.maxOutputTokens ?? 512,
          messages: [
            { role: "system", content: "Return exactly one structured function call. Do not claim to execute the function or perform external effects." },
            { role: "user", content: JSON.stringify({ input, context, authority }) }
          ],
          tools: normalizedTools,
          tool_choice: { type: "function", function: { name: toolName } }
        }),
        signal: request?.signal
      });
      assert(response?.ok === true, "DEEPSEEK_API_ERROR", `DeepSeek API returned HTTP ${response?.status ?? "unknown"}`);
      const payload = await response.json();
      const calls = payload?.choices?.[0]?.message?.tool_calls;
      assert(Array.isArray(calls) && calls.length === 1, "DEEPSEEK_UNSTRUCTURED_OUTPUT", "DeepSeek must return exactly one function call");
      const call = calls[0];
      assert(call?.type === "function" && call.function?.name === toolName, "DEEPSEEK_TOOL_MISMATCH", "DeepSeek returned an unexpected function");
      let structuredContent;
      try {
        structuredContent = JSON.parse(call.function.arguments);
      } catch {
        throw new Error("DEEPSEEK_UNSTRUCTURED_OUTPUT: function arguments were not valid JSON");
      }
      assert(structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent), "DEEPSEEK_UNSTRUCTURED_OUTPUT", "DeepSeek function arguments must be an object");
      const reportedUsage = usage(payload);
      return { structuredContent, ...(reportedUsage ? { _meta: reportedUsage } : {}) };
    }
  };
}
