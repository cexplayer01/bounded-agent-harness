import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditPackage } from "../src/package-audit.mjs";

test("current harness passes the extraction package audit", async () => {
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/^\/(.:\/)/, "$1");
  assert.deepEqual(await auditPackage(root), { valid: true, findings: [] });
});

test("package audit catches secrets, machine paths, package escapes, dependencies, and publication unlock", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-audit-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "wrong-name", license: "MIT", private: false, dependencies: { x: "1" } }));
    await writeFile(join(root, "src", "bad.mjs"), 'import x from "../../outside.mjs";\nconst api_key = "123456789-secret";\nconst p = "C:\\\\Users\\\\someone";');
    const result = await auditPackage(root);
    assert.equal(result.valid, false);
    assert.deepEqual(new Set(result.findings.map((item) => item.code)), new Set(["POSSIBLE_SECRET_ASSIGNMENT", "LOCAL_ABSOLUTE_PATH", "IMPORT_ESCAPES_PACKAGE", "PUBLIC_NAME_MISMATCH", "LICENSE_METADATA_MISMATCH", "LICENSE_TEXT_MISSING", "PUBLICATION_NOT_LOCKED", "RUNTIME_DEPENDENCIES_PRESENT"]));
  } finally { await rm(root, { recursive: true, force: true }); }
});
