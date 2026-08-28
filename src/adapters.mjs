import { assert } from "./errors.mjs";

export class AdapterRegistry {
  #adapters = new Map();
  register(id, adapter) {
    assert(typeof adapter?.invoke === "function", "INVALID_ADAPTER", `${id} must expose invoke(request)`);
    assert(!this.#adapters.has(id), "DUPLICATE_ADAPTER", `${id} is already registered`);
    this.#adapters.set(id, adapter);
    return this;
  }
  get(id) {
    assert(this.#adapters.has(id), "UNKNOWN_ADAPTER", `adapter ${id} is not registered`);
    return this.#adapters.get(id);
  }
}

export function mcpAdapter(client, { server, tool, expectedServer }) {
  assert(typeof client?.callTool === "function", "INVALID_MCP_CLIENT", "MCP client must expose callTool(request)");
  let verified = false;
  let provider = null;
  return {
    async invoke(request) {
      if (!provider) {
        if (expectedServer) {
          assert(typeof client.getServerInfo === "function", "MCP_IDENTITY_UNAVAILABLE", `${server} must expose server identity for pinning`);
          const actual = await client.getServerInfo({ server, signal: request.signal });
          assert(actual?.name === expectedServer.name, "MCP_IDENTITY_MISMATCH", `expected MCP server ${expectedServer.name}, received ${actual?.name || "unknown"}`);
          if (expectedServer.version !== undefined) assert(actual.version === expectedServer.version, "MCP_IDENTITY_MISMATCH", `expected MCP server version ${expectedServer.version}, received ${actual.version || "unknown"}`);
          provider = { name: actual.name, version: actual.version || null, identity: "pinned" };
        } else {
          provider = { name: server, version: null, identity: "configuration-only" };
        }
      }
      if (!verified && typeof client.listTools === "function") {
        const listed = await client.listTools({ server, signal: request.signal });
        const tools = Array.isArray(listed) ? listed : listed?.tools;
        assert(Array.isArray(tools) && tools.some((entry) => (typeof entry === "string" ? entry : entry.name) === tool), "MCP_TOOL_MISSING", `${server}/${tool} was not advertised by the MCP provider`);
        verified = true;
      }
      const response = await client.callTool({
        server,
        name: tool,
        arguments: {
          handoff: request.handoff,
          input: request.input,
          context: request.context,
          idempotencyKey: request.idempotencyKey,
          resumed: request.resumed
        },
        signal: request.signal
      });
      assert(!response?.isError, "MCP_TOOL_ERROR", `${server}/${tool} returned an error`);
      assert(response && Object.hasOwn(response, "structuredContent"), "MCP_UNSTRUCTURED_OUTPUT", `${server}/${tool} must return structuredContent`);
      const reportedCostUnits = response?._meta?.costUnits;
      if (reportedCostUnits !== undefined) {
        assert(Number.isSafeInteger(reportedCostUnits) && reportedCostUnits >= 0, "INVALID_PROVIDER_USAGE", `${server}/${tool} returned invalid costUnits`);
      }
      return {
        format: "agent-harness.adapter-result.v1",
        output: response.structuredContent,
        usage: { costUnits: reportedCostUnits ?? request.reservedCostUnits, source: reportedCostUnits === undefined ? "reserved-ceiling" : "provider-reported" },
        provider
      };
    }
  };
}
