import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokenCount, estimateTokenRequest, evaluateTokenCapacity, withTokenCapacityGate } from "../src/index.mjs";

const availability = {
  provider: "shared-account",
  windowId: "daily-2026-09-24",
  remainingTokens: 20_000,
  windowTokens: 100_000,
  observedAt: "2026-09-24T12:00:00.000Z",
  resetsAt: "2026-09-25T00:00:00.000Z"
};

test("token estimation is conservative and deterministic for text and structured requests", () => {
  assert.equal(estimateTokenCount("abcd"), 2);
  const text = estimateTokenRequest({ prompt: "abcd", maxOutputTokens: 100, reserveTokens: 10 });
  const structured = estimateTokenRequest({ request: { prompt: "abcd" }, maxOutputTokens: 100, reserveTokens: 10 });
  assert.equal(text.requiredTokens, 112);
  assert.equal(text.promptSource, "conservative-text-estimate");
  assert.equal(structured.promptSource, "conservative-structured-estimate");
  assert.equal(estimateTokenRequest({ promptTokens: 40, maxOutputTokens: 100 }).requiredTokens, 140);
});

test("green capacity continues only with protected headroom", () => {
  const result = evaluateTokenCapacity({
    availability,
    request: { prompt: "small request", maxOutputTokens: 1000, reserveTokens: 100 },
    now: Date.parse("2026-09-24T12:01:00.000Z")
  });
  assert.equal(result.decision, "CONTINUE");
  assert.equal(result.status, "GREEN");
  assert.equal(result.redZone, false);
  assert.equal(result.remainingAfterReservation, availability.remainingTokens - result.estimate.requiredTokens);
});

test("red-zone capacity may continue only when the full reservation and headroom fit", () => {
  const result = evaluateTokenCapacity({
    availability: { ...availability, remainingTokens: 6_000 },
    request: { promptTokens: 1_000, maxOutputTokens: 2_000, reserveTokens: 500 },
    now: Date.parse("2026-09-24T12:01:00.000Z")
  });
  assert.equal(result.decision, "CONTINUE");
  assert.equal(result.status, "RED");
  assert.equal(result.code, "TOKEN_CAPACITY_RED_ZONE");
});

test("insufficient red-zone capacity returns an error before provider invocation", () => {
  const result = evaluateTokenCapacity({
    availability: { ...availability, remainingTokens: 3_000 },
    request: { promptTokens: 1_000, maxOutputTokens: 2_000, reserveTokens: 500 },
    now: Date.parse("2026-09-24T12:01:00.000Z")
  });
  assert.equal(result.decision, "ERROR");
  assert.equal(result.code, "TOKEN_CAPACITY_INSUFFICIENT");
});

test("stale, reset, and unknown observations fail closed", () => {
  const request = { prompt: "request", maxOutputTokens: 100 };
  assert.equal(evaluateTokenCapacity({ availability: { ...availability, remainingTokens: null }, request, now: Date.parse("2026-09-24T12:01:00.000Z") }).code, "TOKEN_CAPACITY_UNKNOWN");
  assert.equal(evaluateTokenCapacity({ availability, request, now: Date.parse("2026-09-24T12:03:01.000Z") }).code, "TOKEN_CAPACITY_STALE");
  assert.equal(evaluateTokenCapacity({ availability: { ...availability, resetsAt: "2026-09-24T11:59:00.000Z" }, request, now: Date.parse("2026-09-24T12:01:00.000Z") }).code, "TOKEN_CAPACITY_REFRESH_REQUIRED");
  assert.throws(() => estimateTokenRequest({ prompt: "unbounded", maxOutputTokens: 0 }), /greater than zero/);
});

test("the adapter gate blocks the provider before invocation when capacity is insufficient", async () => {
  let calls = 0;
  const guarded = withTokenCapacityGate({ invoke: async () => { calls += 1; return { ok: true }; } }, {
    readCapacity: async () => ({ ...availability, remainingTokens: 1_000 }),
    reserveCapacity: async () => ({ reservationId: "reservation-1" }),
    now: Date.parse("2026-09-24T12:01:00.000Z")
  });
  await assert.rejects(() => guarded.invoke({ tokenBudget: { maxOutputTokens: 2_000 }, input: { prompt: "large" } }), (error) => error.code === "TOKEN_CAPACITY_INSUFFICIENT");
  assert.equal(calls, 0);
});

test("the adapter gate passes a verified capacity decision to the provider", async () => {
  let received;
  const guarded = withTokenCapacityGate({ invoke: async (request) => { received = request; return { ok: true }; } }, {
    readCapacity: async () => availability,
    reserveCapacity: async () => ({ reservationId: "reservation-2" }),
    now: Date.parse("2026-09-24T12:01:00.000Z")
  });
  await guarded.invoke({ tokenBudget: { maxOutputTokens: 1_000 }, input: { prompt: "small" } });
  assert.equal(received.tokenCapacity.decision, "CONTINUE");
  assert.equal(received.tokenCapacity.status, "GREEN");
  assert.equal(received.tokenReservation.reservationId, "reservation-2");
});

test("the adapter gate requires a reservation boundary even when capacity is green", async () => {
  assert.throws(() => withTokenCapacityGate({ invoke: async () => ({}) }, { readCapacity: async () => availability }), /reserveCapacity/);
});
