import { AdapterRegistry } from "./adapters.mjs";
import { ContractRegistry } from "./contract-registry.mjs";
import { assert } from "./errors.mjs";

export function declarativeContracts(definitions) {
  assert(Array.isArray(definitions), "INVALID_CONTRACT_MANIFEST", "contract manifest must be an array");
  const registry = new ContractRegistry();
  for (const definition of definitions) {
    assert(definition && typeof definition.id === "string", "INVALID_CONTRACT_MANIFEST", "each contract requires an ID");
    assert(Array.isArray(definition.required) && definition.required.every((key) => typeof key === "string"), "INVALID_CONTRACT_MANIFEST", `${definition.id}.required must be a string array`);
    const allowed = definition.allowed ?? definition.required;
    assert(Array.isArray(allowed) && allowed.every((key) => typeof key === "string"), "INVALID_CONTRACT_MANIFEST", `${definition.id}.allowed must be a string array`);
    assert(definition.required.every((key) => allowed.includes(key)), "INVALID_CONTRACT_MANIFEST", `${definition.id}.allowed must include every required key`);
    const normalized = { id: definition.id, required: [...definition.required], allowed: [...allowed] };
    registry.register(definition.id, (value) => value && typeof value === "object" && !Array.isArray(value)
      && normalized.required.every((key) => Object.hasOwn(value, key))
      && Object.keys(value).every((key) => normalized.allowed.includes(key)), { definition: normalized });
  }
  return registry;
}

export function localAdapters(manifest) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "INVALID_ADAPTER_MANIFEST", "adapter manifest must be an object");
  const registry = new AdapterRegistry();
  for (const [id, definition] of Object.entries(manifest)) {
    assert(definition?.type === "literal", "UNSAFE_LOCAL_ADAPTER", `${id} must use the zero-side-effect literal adapter`);
    assert(Object.hasOwn(definition, "output"), "INVALID_ADAPTER_MANIFEST", `${id} requires output`);
    registry.register(id, { invoke: async () => structuredClone(definition.output) });
  }
  return registry;
}
