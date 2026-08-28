import { assert } from "./errors.mjs";
import { sha256 } from "./canonical-json.mjs";

export class ContractRegistry {
  #contracts = new Map();

  register(id, validator, { definition } = {}) {
    assert(typeof id === "string" && id.length > 0, "INVALID_CONTRACT", "contract ID is required");
    assert(typeof validator === "function", "INVALID_CONTRACT", `contract ${id} requires a validator`);
    assert(!this.#contracts.has(id), "DUPLICATE_CONTRACT", `contract ${id} is already registered`);
    const source = definition === undefined ? { runtimeValidator: validator.toString() } : definition;
    this.#contracts.set(id, { validator, digest: `sha256:${sha256(source)}`, portability: definition === undefined ? "runtime-bound" : "portable" });
    return this;
  }

  has(id) { return this.#contracts.has(id); }

  validate(id, value) {
    assert(this.#contracts.has(id), "UNKNOWN_CONTRACT", `contract ${id} is not registered`);
    const result = this.#contracts.get(id).validator(value);
    assert(result !== false, "CONTRACT_REJECTED", `contract ${id} rejected the value`);
    return value;
  }

  list() { return [...this.#contracts.keys()].sort(); }

  describe() {
    return this.list().map((id) => ({ id, digest: this.#contracts.get(id).digest, portability: this.#contracts.get(id).portability }));
  }
}
