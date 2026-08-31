import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeChangeImpact, scanChangeImpact } from "../src/change-impact.mjs";
import { runCli } from "../src/cli.mjs";

const request = (overrides = {}) => ({
  schema_version: "change-impact-request.v1",
  change_id: "stable-config-rename",
  outcome: "Ship one stable package without stale filename consumers",
  change_kind: "PUBLIC_INTERFACE",
  changed_paths: ["src/stable-package.mjs"],
  reference_tokens: ["request-runtime-config.json", "site-config.json"],
  verification_catalog: [
    { id: "syntax", tier: "TIER_0_STATIC", command: "node --check src/stable-package.mjs", covers: { paths: ["src/stable-package.mjs"] } },
    { id: "stable-unit", tier: "TIER_1_DIRECT", command: "node --test test/stable.test.mjs", covers: { paths: ["src/stable-package.mjs"], tokens: ["request-runtime-config.json", "site-config.json"] } },
    { id: "launcher-boundary", tier: "TIER_2_BOUNDARY", command: "node --test test/runner.test.mjs", covers: { prefixes: ["scripts"], tokens: ["request-runtime-config.json", "site-config.json"] } },
    { id: "full", tier: "TIER_3_FULL", command: "node --test", covers: { global: true } }
  ],
  external_gates: ["DEPLOYMENT_GO"],
  ...overrides
});

const inventory = [
  { path: "src/stable-package.mjs", text: "const name = 'site-config.json';" },
  { path: "scripts/runner.mjs", text: "open('request-runtime-config.json');" },
  { path: "test/runner.test.mjs", text: "assert.equal(name, 'site-config.json');" },
  { path: "README.md", text: "Historical name: request-runtime-config.json" }
];

test("discovers interface consumers and emits a deterministic tiered active card", () => {
  const first = analyzeChangeImpact(request(), inventory);
  const second = analyzeChangeImpact(request(), [...inventory].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.status, "READY_FOR_TIERED_VERIFICATION");
  assert.deepEqual(first.consumers.map((item) => item.path), ["README.md", "scripts/runner.mjs", "test/runner.test.mjs"]);
  assert.deepEqual(first.verification.execution_order, ["syntax", "stable-unit", "launcher-boundary", "full"]);
  assert.equal(first.verification.full_suite_required, true);
  assert.equal(first.active_card.full_suite, "REQUIRED_ONCE_AT_MILESTONE");
  assert.equal(first.active_card.exact_next_action, "RUN_SELECTED_TESTS_IN_ORDER");
  assert.deepEqual(first.active_card.external_gates, ["DEPLOYMENT_GO"]);
});

test("fails closed when a consumer, boundary, or full suite is not mapped", () => {
  const incomplete = request({
    verification_catalog: [
      { id: "stable-unit", tier: "TIER_1_DIRECT", command: "node --test test/stable.test.mjs", covers: { paths: ["src/stable-package.mjs"] } }
    ]
  });
  const result = analyzeChangeImpact(incomplete, inventory);
  assert.equal(result.status, "NEEDS_VERIFICATION_MAPPING");
  assert.equal(result.active_card.full_suite, "REQUIRED_BUT_UNMAPPED");
  assert.deepEqual(result.verification.gaps, [
    { code: "BOUNDARY_TEST_MISSING", path: null },
    { code: "CONSUMER_TEST_MISSING", path: "scripts/runner.mjs" },
    { code: "CONSUMER_TEST_MISSING", path: "test/runner.test.mjs" },
    { code: "FULL_SUITE_MISSING", path: null }
  ]);
});

test("does not select a globally cataloged full suite for documentation or local-only work", () => {
  const documentation = analyzeChangeImpact(request({
    change_id: "docs-only",
    change_kind: "DOCUMENTATION",
    changed_paths: ["README.md"],
    reference_tokens: [],
    verification_catalog: [
      { id: "full", tier: "TIER_3_FULL", command: "node --test", covers: { global: true } }
    ]
  }), inventory);
  assert.equal(documentation.status, "READY_FOR_TIERED_VERIFICATION");
  assert.deepEqual(documentation.verification.execution_order, []);
  assert.equal(documentation.active_card.full_suite, "NOT_REQUIRED_BY_CHANGE_KIND");

  const local = analyzeChangeImpact(request({
    change_id: "local-only",
    change_kind: "LOCAL_IMPLEMENTATION",
    reference_tokens: [],
    verification_catalog: [
      { id: "direct", tier: "TIER_1_DIRECT", command: "node --test test/stable.test.mjs", covers: { paths: ["src/stable-package.mjs"] } },
      { id: "full", tier: "TIER_3_FULL", command: "node --test", covers: { global: true } }
    ]
  }), inventory);
  assert.equal(local.status, "READY_FOR_TIERED_VERIFICATION");
  assert.deepEqual(local.verification.execution_order, ["direct"]);
  assert.equal(local.active_card.full_suite, "NOT_REQUIRED_BY_CHANGE_KIND");
});

test("scanner and CLI report paths only, ignore generated dependencies, and refuse overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-impact-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(root, "test"), { recursive: true });
    await mkdir(join(root, "node_modules", "hidden"), { recursive: true });
    await writeFile(join(root, "src", "stable-package.mjs"), "const name = 'site-config.json';\n");
    await writeFile(join(root, "scripts", "runner.mjs"), "const oldName = 'request-runtime-config.json';\n");
    await writeFile(join(root, "test", "runner.test.mjs"), "const expected = 'site-config.json';\n");
    await writeFile(join(root, "node_modules", "hidden", "secret.mjs"), "const hidden = 'request-runtime-config.json';\n");
    const analyzed = await scanChangeImpact({ rootDirectory: root, request: request() });
    assert.equal(analyzed.status, "READY_FOR_TIERED_VERIFICATION");
    assert.deepEqual(analyzed.consumers.map((item) => item.path), ["scripts/runner.mjs", "test/runner.test.mjs"]);
    assert.doesNotMatch(JSON.stringify(analyzed), /const oldName/);

    const requestPath = join(root, "request.json");
    const outputPath = join(root, "impact.json");
    await writeFile(requestPath, JSON.stringify(request()));
    const cli = await runCli(["impact", "--root", root, "--request", requestPath, "--output", outputPath], { out: () => {}, err: () => {} });
    assert.equal(cli.status, "READY_FOR_TIERED_VERIFICATION");
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), cli);
    await assert.rejects(() => runCli(["impact", "--root", root, "--request", requestPath, "--output", outputPath], { out: () => {}, err: () => {} }), (error) => error.code === "EEXIST");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe or under-specified impact requests and both schemas parse", async () => {
  assert.throws(() => analyzeChangeImpact(request({ changed_paths: ["../escape.mjs"] }), inventory), /unsafe segment/);
  assert.throws(() => analyzeChangeImpact(request({ reference_tokens: [] }), inventory), /requires at least one reference token/);
  assert.throws(() => analyzeChangeImpact(request({ verification_catalog: [{ id: "full", tier: "TIER_3_FULL", command: "node --test", covers: { paths: ["test/a.mjs"] } }] }), inventory), /must be global/);
  JSON.parse(await readFile(new URL("../contracts/change-impact-request.v1.schema.json", import.meta.url), "utf8"));
  JSON.parse(await readFile(new URL("../contracts/change-impact.v1.schema.json", import.meta.url), "utf8"));
});
