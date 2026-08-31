import test from "node:test";
import assert from "node:assert/strict";
import { assertPlanWithinFloor, floorDigest, validateFloorManifest } from "../src/floor-policy.mjs";

const floor = {
  format: "usb.autonomous-floor.v1", version: 1, project: "usb-website-platform", goal: "local work",
  allowedEffects: ["read", "local-test", "local-reversible-artifact"],
  forbiddenEffects: ["deploy", "dns", "payment"],
  requiredReviewRoles: ["contract", "domain", "consistency", "reconciliation"],
  maxCostUnits: 8, timeoutPolicy: { forkAfterMinutes: 30, localOnly: true }, authorityMode: "NARROW_ONLY"
};
const plan = (effect = "read") => ({ budget: { maxCostUnits: 2 }, steps: [{ effect }] });

test("floor manifests validate and digest deterministically", () => {
  assert.equal(validateFloorManifest(floor), floor);
  assert.match(floorDigest(floor), /^sha256:[a-f0-9]{64}$/);
});

test("floor permits bounded local plans and rejects external effects", () => {
  const readPlan = plan("read");
  assert.equal(assertPlanWithinFloor({ plan: readPlan, floor }), readPlan);
  assert.doesNotThrow(() => assertPlanWithinFloor({ plan: plan("local"), floor }));
  assert.throws(() => assertPlanWithinFloor({ plan: plan("external"), floor }), /does not permit external-effect/);
});

test("floor rejects budget overflow, contradiction, and unknown fields", () => {
  assert.throws(() => assertPlanWithinFloor({ plan: { ...plan(), budget: { maxCostUnits: 9 } }, floor }), /exceeds floor/);
  assert.throws(() => validateFloorManifest({ ...floor, allowedEffects: ["deploy"], forbiddenEffects: ["deploy"] }), /both allowed and forbidden/);
  assert.throws(() => validateFloorManifest({ ...floor, extra: true }), /not allowed/);
});
