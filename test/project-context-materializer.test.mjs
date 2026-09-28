import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractProjectContextLocator, materializeProjectContext, PROJECT_CONTEXT_PACKET_FORMAT, PROJECT_CONTEXT_ROOTS_FORMAT } from "../src/project-context-materializer.mjs";
import { sha256 } from "../src/canonical-json.mjs";
import { runCli } from "../src/cli.mjs";

const manifest = JSON.parse(await readFile(new URL("../examples/project-scope/manifest.valid.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(new URL("../examples/project-scope/sources.valid.json", import.meta.url), "utf8"));
const rootsSchema = JSON.parse(await readFile(new URL("../contracts/project-context-roots.v1.schema.json", import.meta.url), "utf8"));
const packetSchema = JSON.parse(await readFile(new URL("../contracts/project-context-packet.v1.schema.json", import.meta.url), "utf8"));

test("published root-map and context-packet contracts are strict and versioned", () => {
  assert.equal(rootsSchema.$id.endsWith("project-context-roots.v1.schema.json"), true);
  assert.deepEqual(rootsSchema.required, ["format", "version", "repositories"]);
  assert.equal(rootsSchema.additionalProperties, false);
  assert.equal(packetSchema.$id.endsWith("project-context-packet.v1.schema.json"), true);
  assert.deepEqual(packetSchema.required, ["format", "version", "projectId", "status", "scopeDigest", "selected", "findings", "digest"]);
  assert.equal(packetSchema.additionalProperties, false);
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "bah-context-scope-"));
  const primary = join(base, "primary");
  const dependency = join(base, "dependency");
  await mkdir(join(primary, "Project Brain"), { recursive: true });
  await mkdir(join(dependency, "contracts"), { recursive: true });
  await writeFile(join(primary, "Project Brain", "CURRENT-STATE.md"), "# State\n\n## Site runtime\nOnly approved site facts.\n### Details\nThese details are in scope.\n## Other project\nDo not include this section.\n");
  await writeFile(join(dependency, "contracts", "project-scope-manifest.v1.schema.json"), JSON.stringify({ properties: { project: { type: "object" }, dependencies: { type: "array" } }, private: "not selected" }, null, 2));
  return {
    base,
    roots: { format: PROJECT_CONTEXT_ROOTS_FORMAT, version: 1, repositories: [
      { repositoryId: "sample-site-repo", rootPath: primary },
      { repositoryId: "bounded-agent-harness-repo", rootPath: dependency },
    ] },
  };
}

test("materializer returns only exact allowlisted text and digests without leaking local roots", async () => {
  const f = await fixture();
  try {
    const result = await materializeProjectContext({ manifest, sources, roots: f.roots });
    assert.equal(result.format, PROJECT_CONTEXT_PACKET_FORMAT);
    assert.equal(result.status, "READY");
    assert.equal(result.selected.length, 2);
    assert.match(result.selected[0].content, /^## Site runtime/m);
    assert.match(result.selected[0].content, /These details are in scope/);
    assert.doesNotMatch(result.selected[0].content, /Other project/);
    assert.deepEqual(JSON.parse(result.selected[1].content), { project: { type: "object" }, dependencies: { type: "array" } });
    for (const source of result.selected) assert.equal(source.contentDigest, `sha256:${sha256(source.content)}`);
    assert.match(result.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes(f.base), false);
    const repeated = await materializeProjectContext({ manifest, sources, roots: f.roots });
    assert.equal(repeated.digest, result.digest);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("an unauthorized reference blocks before any file read and releases no partial sources", async () => {
  const f = await fixture();
  try {
    const result = await materializeProjectContext({
      manifest,
      sources: [...sources, { id: "foreign-notes", projectId: "other-app", repositoryId: "other-app-repo", path: "missing-do-not-read.md", locator: "heading:secret" }],
      roots: f.roots,
    });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.selected, []);
    assert.equal(result.findings.at(-1).code, "UNDECLARED_PROJECT_DEPENDENCY");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("a missing or ambiguous locator blocks the whole packet instead of returning partial context", async () => {
  const f = await fixture();
  try {
    const changedLocator = "heading:Missing section";
    const changedManifest = {
      ...manifest,
      project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], locator: changedLocator }] },
    };
    const changedSources = [{ ...sources[0], locator: changedLocator }, sources[1]];
    const result = await materializeProjectContext({ manifest: changedManifest, sources: changedSources, roots: f.roots });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.selected, []);
    assert.equal(result.findings[0].code, "LOCATOR_NOT_FOUND");
    assert.equal(result.findings[0].sourceId, sources[0].id);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("record and JSON-pointer locators resolve one exact JSON value and reject ambiguity", () => {
  const json = JSON.stringify({ format: "current", records: [{ id: "wanted", value: 1 }, { id: "other", value: 2 }] });
  assert.deepEqual(JSON.parse(extractProjectContextLocator(json, "record:wanted")), { id: "wanted", value: 1 });
  assert.deepEqual(JSON.parse(extractProjectContextLocator(json, "json-pointer:/records/0")), { id: "wanted", value: 1 });
  assert.throws(() => extractProjectContextLocator(JSON.stringify({ a: { id: "same" }, b: { id: "same" } }), "record:same"), /ambiguous/);
});

test("CLI materialize-context emits the verified packet using local-only repository roots", async () => {
  const f = await fixture();
  const rootsPath = join(f.base, "roots.json");
  await writeFile(rootsPath, JSON.stringify(f.roots));
  const output = [];
  try {
    const result = await runCli([
      "materialize-context",
      "--manifest", fileURLToPath(new URL("../examples/project-scope/manifest.valid.json", import.meta.url)),
      "--sources", fileURLToPath(new URL("../examples/project-scope/sources.valid.json", import.meta.url)),
      "--roots", rootsPath,
    ], { out: value => output.push(value), err: value => output.push(value) });
    assert.equal(result.status, "READY");
    assert.equal(JSON.parse(output[0]).selected.length, 2);
    assert.equal(output[0].includes(f.base), false);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
