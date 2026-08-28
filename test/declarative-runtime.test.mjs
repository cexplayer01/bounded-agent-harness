import test from "node:test";
import assert from "node:assert/strict";
import { declarativeContracts, localAdapters } from "../src/declarative-runtime.mjs";

test("declarative runtime admits only contract-bound literal adapters", async () => {
  const contracts = declarativeContracts([{ id: "result.v1", required: ["answer"] }]);
  assert.deepEqual(contracts.validate("result.v1", { answer: 42 }), { answer: 42 });
  assert.throws(() => contracts.validate("result.v1", { wrong: 42 }), /rejected/);
  assert.throws(() => contracts.validate("result.v1", { answer: 42, invented: true }), /rejected/);
  const adapters = localAdapters({ "local.answer": { type: "literal", output: { answer: 42 } } });
  assert.deepEqual(await adapters.get("local.answer").invoke({}), { answer: 42 });
  assert.throws(() => localAdapters({ shell: { type: "command", command: "anything" } }), /zero-side-effect literal adapter/);
  assert.equal(contracts.describe()[0].portability, "portable");
  assert.match(contracts.describe()[0].digest, /^sha256:[a-f0-9]{64}$/);
});

test("declarative contracts allow explicit optional fields but reject undeclared fields", () => {
  const contracts = declarativeContracts([{ id: "result.v1", required: ["answer"], allowed: ["answer", "source"] }]);
  assert.deepEqual(contracts.validate("result.v1", { answer: 42, source: "primary" }), { answer: 42, source: "primary" });
  assert.throws(() => declarativeContracts([{ id: "bad.v1", required: ["answer"], allowed: ["source"] }]), /include every required key/);
});
