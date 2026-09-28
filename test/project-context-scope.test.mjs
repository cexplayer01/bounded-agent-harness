import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertProjectContextScope, validateProjectContextScope, validateProjectScopeManifest } from "../src/project-context-scope.mjs";
import { runCli } from "../src/cli.mjs";

const manifest = JSON.parse(await readFile(new URL("../examples/project-scope/manifest.valid.json", import.meta.url), "utf8"));
const sources = JSON.parse(await readFile(new URL("../examples/project-scope/sources.valid.json", import.meta.url), "utf8"));
const scopeSchema = JSON.parse(await readFile(new URL("../contracts/project-scope-manifest.v1.schema.json", import.meta.url), "utf8"));
const sourcesSchema = JSON.parse(await readFile(new URL("../contracts/project-context-sources.v1.schema.json", import.meta.url), "utf8"));

test("project scope accepts owned sources and a narrow, capability-linked dependency", () => {
  const result = assertProjectContextScope({ manifest, sources });
  assert.equal(result.status, "READY");
  assert.equal(result.selected.length, 2);
  assert.equal(result.findings.length, 0);
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/);
});

test("an unrelated project's source is blocked, and no partial source list is released", () => {
  const result = validateProjectContextScope({
    manifest,
    sources: [...sources, {
      id: "game-session-notes",
      projectId: "echo-fracture",
      repositoryId: "echo-fracture-repo",
      path: "Project Brain/GAME-NOTES.md",
      locator: "heading:Game mechanics",
    }],
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.selected, []);
  assert.equal(result.findings.at(-1).code, "UNDECLARED_PROJECT_DEPENDENCY");
});

test("same-repository sources still require exact registered ownership and location", () => {
  const result = validateProjectContextScope({
    manifest,
    sources: [{
      id: "game-session-notes",
      projectId: "sample-site",
      repositoryId: "sample-site-repo",
      path: "echo-fracture/README.md",
      locator: "heading:Game mechanics",
    }],
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.findings[0].code, "UNREGISTERED_PRIMARY_SOURCE");
});

test("foreign sources require the exact dependency, repository, path, and locator", () => {
  const wrongDependency = validateProjectContextScope({ manifest, sources: [{ ...sources[1], dependencyId: "missing-link" }] });
  assert.equal(wrongDependency.findings[0].code, "UNDECLARED_PROJECT_DEPENDENCY");
  const wrongRepo = validateProjectContextScope({ manifest, sources: [{ ...sources[1], repositoryId: "lookalike-repo" }] });
  assert.equal(wrongRepo.findings[0].code, "DEPENDENCY_OWNER_MISMATCH");
  const wrongPath = validateProjectContextScope({ manifest, sources: [{ ...sources[1], path: "README.md" }] });
  assert.equal(wrongPath.findings[0].code, "UNREGISTERED_DEPENDENCY_SOURCE");
});

test("scope declarations reject path traversal, globs, broad whole-file locators, and vague dependency reasons", () => {
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], path: "../other/notes.md" }] },
  }), /unsafe path segment/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], path: "Project Brain/**" }] },
  }), /non-glob/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], locator: "whole-file" }] },
  }), /one heading, JSON pointer, or record/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], locator: "heading:*" }] },
  }), /one heading, JSON pointer, or record/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], locator: "heading:   " }] },
  }), /one heading, JSON pointer, or record/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [{ ...manifest.project.sources[0], path: "Project Brain//CURRENT-STATE.md" }] },
  }), /unsafe path segment/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    project: { ...manifest.project, sources: [] },
  }), /1 to 500 sources/);
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    dependencies: [{ ...manifest.dependencies[0], rationale: "useful" }],
  }), /12 to 500 characters/);
});

test("duplicate source IDs and unknown fields fail closed", () => {
  const duplicates = validateProjectContextScope({ manifest, sources: [sources[0], sources[0]] });
  assert.equal(duplicates.status, "BLOCKED");
  assert.equal(duplicates.selected.length, 0);
  assert.equal(duplicates.findings[0].code, "DUPLICATE_CONTEXT_SOURCE");
  assert.throws(() => validateProjectContextScope({ manifest, sources: [{ ...sources[0], extra: true }] }), /unknown field/);
});

test("a declared dependency cannot claim an outcome absent from the project's capability list", () => {
  assert.throws(() => validateProjectScopeManifest({
    ...manifest,
    dependencies: [{ ...manifest.dependencies[0], affectedCapabilities: ["game-scoreboard"] }],
  }), /reference declared project capabilities/);
});

test("CLI emits a deterministic scope decision for the sample manifest", async () => {
  const output = [];
  const result = await runCli([
    "scope-context",
    "--manifest",
    fileURLToPath(new URL("../examples/project-scope/manifest.valid.json", import.meta.url)),
    "--sources",
    fileURLToPath(new URL("../examples/project-scope/sources.valid.json", import.meta.url)),
  ], { out: (value) => output.push(value), err: (value) => output.push(value) });
  assert.equal(result.status, "READY");
  assert.equal(JSON.parse(output[0]).projectId, "sample-site");
});

test("published schemas parse and enforce canonical relative path/locator patterns", () => {
  assert.equal(scopeSchema.$defs.project.required.includes("capabilities"), true);
  assert.equal(sourcesSchema.type, "array");
  const pathPattern = new RegExp(scopeSchema.$defs.path.pattern);
  const pathTraversalPattern = new RegExp(scopeSchema.$defs.path.not.pattern);
  const additionalPathPatterns = scopeSchema.$defs.path.allOf.map((rule) => new RegExp(rule.not.pattern));
  const locatorPattern = new RegExp(scopeSchema.$defs.locator.pattern);
  const isSchemaPath = (value) => pathPattern.test(value) && !pathTraversalPattern.test(value) && additionalPathPatterns.every((pattern) => !pattern.test(value));
  assert.equal(pathPattern.test("Project Brain/CURRENT-STATE.md"), true);
  assert.equal(pathPattern.test("C:/outside.md"), false);
  assert.equal(pathPattern.test("Project Brain\\CURRENT.md"), false);
  assert.equal(pathPattern.test("Project Brain/**"), false);
  assert.equal(pathTraversalPattern.test("Project Brain/../other.md"), true);
  assert.equal(isSchemaPath("folder/name.md"), true);
  assert.equal(isSchemaPath("folder/name:alternate.md"), false);
  assert.equal(isSchemaPath("folder/[name].md"), false);
  assert.equal(isSchemaPath("folder/name\nother.md"), false);
  assert.equal(isSchemaPath("folder//name.md"), false);
  assert.equal(isSchemaPath("folder/name.md/"), false);
  assert.equal(locatorPattern.test("heading:USB integration"), true);
  assert.equal(locatorPattern.test("heading:   "), false);
  assert.equal(locatorPattern.test("whole-file"), false);
});

test("CLI exits nonzero and releases no partial sources when unrelated project context is supplied", () => {
  const child = spawnSync(process.execPath, [
    fileURLToPath(new URL("../bin/harness.mjs", import.meta.url)),
    "scope-context",
    "--manifest",
    fileURLToPath(new URL("../examples/project-scope/manifest.valid.json", import.meta.url)),
    "--sources",
    fileURLToPath(new URL("../examples/project-scope/sources.with-unrelated-project.json", import.meta.url)),
  ], { encoding: "utf8" });
  assert.equal(child.status, 1, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.selected, []);
  assert.equal(result.findings[0].code, "UNDECLARED_PROJECT_DEPENDENCY");
});
