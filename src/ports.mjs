import { assert } from "./errors.mjs";

function method(value, name, port) {
  assert(typeof value?.[name] === "function", "INVALID_PORT", `${port} must expose ${name}()`);
}

export function assertEventStore(value) {
  method(value, "append", "EventStore");
  method(value, "events", "EventStore");
  method(value, "envelopes", "EventStore");
  method(value, "checkpoint", "EventStore");
  method(value, "readCheckpoint", "EventStore");
  method(value, "lockStatus", "EventStore");
  return value;
}

export function assertStateStore(value) {
  method(value, "get", "StateStore");
  method(value, "put", "StateStore");
  return value;
}

export function assertContractRegistryPort(value) {
  method(value, "register", "ContractRegistry");
  method(value, "has", "ContractRegistry");
  method(value, "validate", "ContractRegistry");
  method(value, "list", "ContractRegistry");
  method(value, "describe", "ContractRegistry");
  return value;
}

export function assertProviderAdapter(value) {
  method(value, "invoke", "ProviderAdapter");
  return value;
}

export function assertLeaseStore(value) {
  method(value, "acquire", "LeaseStore");
  method(value, "renew", "LeaseStore");
  method(value, "release", "LeaseStore");
  return value;
}
