import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { assert } from "./errors.mjs";

const TEXT = new Set([".json", ".md", ".mjs"]);
const SECRET_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[=:]\s*["'][^"']{8,}["']/i;
const ABSOLUTE_LOCAL_PATH = /(?:[A-Za-z]:\\+Users\\+|\/home\/|\/Users\/)/;
const IMPORT = /from\s+["']([^"']+)["']/g;

async function files(root, current = root) {
  const found = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (["node_modules", ".agent-harness", "test"].includes(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) found.push(...await files(root, path));
    else if (TEXT.has(extname(entry.name))) found.push(path);
  }
  return found;
}

export async function auditPackage(root) {
  const base = resolve(root);
  const findings = [];
  for (const path of await files(base)) {
    const name = relative(base, path).replaceAll("\\", "/");
    const content = await readFile(path, "utf8");
    if (SECRET_ASSIGNMENT.test(content)) findings.push({ file: name, code: "POSSIBLE_SECRET_ASSIGNMENT" });
    if (ABSOLUTE_LOCAL_PATH.test(content)) findings.push({ file: name, code: "LOCAL_ABSOLUTE_PATH" });
    if (extname(path) === ".mjs") {
      for (const match of content.matchAll(IMPORT)) {
        if (!match[1].startsWith(".")) continue;
        const target = resolve(path, "..", match[1]);
        if (!(target === base || target.startsWith(`${base}${sep}`))) findings.push({ file: name, code: "IMPORT_ESCAPES_PACKAGE", import: match[1] });
      }
    }
  }
  const packageJson = JSON.parse(await readFile(resolve(base, "package.json"), "utf8"));
  const license = await readFile(resolve(base, "LICENSE"), "utf8").catch(() => "");
  if (packageJson.name !== "bounded-agent-harness") findings.push({ file: "package.json", code: "PUBLIC_NAME_MISMATCH" });
  if (packageJson.license !== "AGPL-3.0-or-later") findings.push({ file: "package.json", code: "LICENSE_METADATA_MISMATCH" });
  if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE") || !license.includes("Version 3, 19 November 2007")) findings.push({ file: "LICENSE", code: "LICENSE_TEXT_MISSING" });
  if (packageJson.private !== true) findings.push({ file: "package.json", code: "PUBLICATION_NOT_LOCKED" });
  if (Object.keys(packageJson.dependencies || {}).length) findings.push({ file: "package.json", code: "RUNTIME_DEPENDENCIES_PRESENT" });
  return { valid: findings.length === 0, findings };
}

export async function assertPackageSafe(root) {
  const result = await auditPackage(root);
  assert(result.valid, "PACKAGE_AUDIT_FAILED", `package audit found ${result.findings.length} issue(s)`, result);
  return result;
}
