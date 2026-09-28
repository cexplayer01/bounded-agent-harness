import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractProjectContextLocator, materializeProjectContext, verifyProjectContextPacket, PROJECT_CONTEXT_PACKET_FORMAT, PROJECT_CONTEXT_ROOTS_FORMAT } from "../src/project-context-materializer.mjs";
import { sha256 } from "../src/canonical-json.mjs";
import { runCli } from "../src/cli.mjs";

const manifest = JSON.parse(await readFile(new URL("../examples/project-scope/manifest.valid.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(new URL("../examples/project-scope/sources.valid.json", import.meta.url), "utf8"));
const rootsSchema = JSON.parse(await readFile(new URL("../contracts/project-context-roots.v1.schema.json", import.meta.url), "utf8"));
const packetSchema = JSON.parse(await readFile(new URL("../contracts/project-context-packet.v1.schema.json", import.meta.url), "utf8"));
const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

test("published root-map and context-packet contracts are strict and versioned", () => {
  assert.equal(rootsSchema.$id.endsWith("project-context-roots.v1.schema.json"), true);
  assert.deepEqual(rootsSchema.required, ["format", "version", "repositories"]);
  assert.equal(rootsSchema.additionalProperties, false);
  assert.deepEqual(rootsSchema.properties.repositories.items.required, ["repositoryId", "rootPath", "expectedGitRemote"]);
  assert.match(gitignore, /^\/.agent-harness\/local-context-roots\.json$/m);
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
  execFileSync("git", ["init", "--quiet", primary], { stdio: "ignore" });
  execFileSync("git", ["-C", primary, "remote", "add", "origin", "https://example.invalid/sample-site.git"], { stdio: "ignore" });
  execFileSync("git", ["init", "--quiet", dependency], { stdio: "ignore" });
  execFileSync("git", ["-C", dependency, "remote", "add", "origin", "https://example.invalid/bounded-agent-harness.git"], { stdio: "ignore" });
  return {
    base,
    roots: { format: PROJECT_CONTEXT_ROOTS_FORMAT, version: 1, repositories: [
      { repositoryId: "sample-site-repo", rootPath: primary, expectedGitRemote: "https://example.invalid/sample-site.git" },
      { repositoryId: "bounded-agent-harness-repo", rootPath: dependency, expectedGitRemote: "https://example.invalid/bounded-agent-harness.git" },
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
    assert.equal(verifyProjectContextPacket(result), true);
    assert.throws(() => result.selected.push({}), TypeError);
    assert.throws(() => { result.selected[0].content = "tampered"; }, TypeError);
    assert.equal(JSON.stringify(result).includes(f.base), false);
    const repeated = await materializeProjectContext({ manifest, sources, roots: f.roots });
    assert.equal(repeated.digest, result.digest);
    const changedContent = structuredClone(result);
    changedContent.selected[0].content = "tampered";
    assert.throws(() => verifyProjectContextPacket(changedContent), { code: "INVALID_CONTEXT_PACKET" });
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("repository root must be the exact Git checkout and match its credential-free origin", async () => {
  const f = await fixture();
  try {
    const roots = structuredClone(f.roots);
    roots.repositories[0].expectedGitRemote = "https://example.invalid/other-project.git";
    await assert.rejects(materializeProjectContext({ manifest, sources, roots }), { code: "ROOT_IDENTITY_MISMATCH" });
    roots.repositories[0].rootPath = join(f.base, "primary", "Project Brain");
    roots.repositories[0].expectedGitRemote = "https://example.invalid/sample-site.git";
    await assert.rejects(materializeProjectContext({ manifest, sources, roots }), { code: "ROOT_IDENTITY_MISMATCH" });
    roots.repositories[0].expectedGitRemote = "https://token@example.invalid/sample-site.git";
    await assert.rejects(materializeProjectContext({ manifest, sources, roots }), { code: "INVALID_CONTEXT_ROOTS" });
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
  assert.throws(() => extractProjectContextLocator("{\"a\":1,\"\\u0061\":2}", "json-pointer:/a"), { code: "SOURCE_JSON_DUPLICATE_KEY" });
});

test("Markdown heading locators ignore code-fence contents and reject duplicate real headings", () => {
  const content = "## Wanted\nactual section\n```markdown\n## Fake next section\nnot a heading here\n```\nstill included\n## End\nstop here\n";
  const selected = extractProjectContextLocator(content, "heading:Wanted");
  assert.match(selected, /## Fake next section/);
  assert.match(selected, /still included/);
  assert.doesNotMatch(selected, /stop here/);
  assert.throws(() => extractProjectContextLocator("## Wanted\none\n## Wanted\ntwo", "heading:Wanted"), { code: "LOCATOR_AMBIGUOUS" });
});

test("allowlisted source symlinks block the complete packet", async (t) => {
  const f = await fixture();
  const alias = join(f.base, "primary", "Project Brain", "alias.md");
  try {
    try { await symlink("CURRENT-STATE.md", alias, "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) { t.skip("host does not permit creating a test symlink"); return; }
      throw error;
    }
    const changedManifest = structuredClone(manifest);
    changedManifest.project.sources[0].path = "Project Brain/alias.md";
    const changedSources = structuredClone(sources);
    changedSources[0].path = "Project Brain/alias.md";
    const result = await materializeProjectContext({ manifest: changedManifest, sources: changedSources, roots: f.roots });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.selected, []);
    assert.equal(result.findings[0].code, "SOURCE_SYMLINK_BLOCKED");
  } finally { await rm(f.base, { recursive: true, force: true }); }
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
