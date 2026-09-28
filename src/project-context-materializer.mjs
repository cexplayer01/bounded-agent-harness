import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";
import { validateProjectContextScope } from "./project-context-scope.mjs";

export const PROJECT_CONTEXT_ROOTS_FORMAT = "agent-harness.project-context-roots.v1";
export const PROJECT_CONTEXT_PACKET_FORMAT = "agent-harness.project-context-packet.v1";

function closed(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_CONTEXT_ROOTS", `${label} must be an object`);
  assert(Object.keys(value).every((key) => keys.includes(key)), "INVALID_CONTEXT_ROOTS", `${label} contains an unknown field`);
}

function normalizeRoots(roots, selected) {
  closed(roots, ["format", "version", "repositories"], "roots");
  assert(roots.format === PROJECT_CONTEXT_ROOTS_FORMAT && roots.version === 1, "INVALID_CONTEXT_ROOTS", "unsupported project-context roots version");
  assert(Array.isArray(roots.repositories) && roots.repositories.length > 0 && roots.repositories.length <= 101, "INVALID_CONTEXT_ROOTS", "roots.repositories must list 1 to 101 repositories");
  const required = new Set(selected.map((source) => source.repositoryId));
  const result = new Map();
  for (const [index, item] of roots.repositories.entries()) {
    closed(item, ["repositoryId", "rootPath"], `roots.repositories[${index}]`);
    assert(typeof item.repositoryId === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(item.repositoryId), "INVALID_CONTEXT_ROOTS", `roots.repositories[${index}].repositoryId is invalid`);
    assert(typeof item.rootPath === "string" && isAbsolute(item.rootPath), "INVALID_CONTEXT_ROOTS", `roots.repositories[${index}].rootPath must be an absolute local path`);
    assert(required.has(item.repositoryId), "INVALID_CONTEXT_ROOTS", `root supplied for unselected repository: ${item.repositoryId}`);
    assert(!result.has(item.repositoryId), "INVALID_CONTEXT_ROOTS", `duplicate repository root: ${item.repositoryId}`);
    result.set(item.repositoryId, item.rootPath);
  }
  assert([...required].every((repositoryId) => result.has(repositoryId)), "INVALID_CONTEXT_ROOTS", "a selected source repository has no local root");
  return result;
}

function parseJson(content, sourceId) {
  try { return JSON.parse(content); }
  catch { throw Object.assign(new Error("source is not valid JSON"), { code: "SOURCE_JSON_INVALID", sourceId }); }
}

function extractHeading(content, heading, sourceId) {
  const lines = content.split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[index]);
    if (match && match[2].trim() === heading) matches.push({ index, level: match[1].length });
  }
  if (matches.length !== 1) throw Object.assign(new Error("heading locator is missing or ambiguous"), { code: matches.length ? "LOCATOR_AMBIGUOUS" : "LOCATOR_NOT_FOUND", sourceId });
  const selected = matches[0];
  let end = lines.length;
  for (let index = selected.index + 1; index < lines.length; index += 1) {
    const match = /^ {0,3}(#{1,6})[ \t]+/.exec(lines[index]);
    if (match && match[1].length <= selected.level) { end = index; break; }
  }
  return lines.slice(selected.index, end).join("\n");
}

function extractJsonPointer(value, pointer, sourceId) {
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) throw Object.assign(new Error("JSON pointer is invalid"), { code: "LOCATOR_INVALID", sourceId });
  let selected = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(selected)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) throw Object.assign(new Error("JSON pointer target is missing"), { code: "LOCATOR_NOT_FOUND", sourceId });
      selected = selected[Number(key)];
    } else if (selected && typeof selected === "object" && Object.hasOwn(selected, key)) selected = selected[key];
    else throw Object.assign(new Error("JSON pointer target is missing"), { code: "LOCATOR_NOT_FOUND", sourceId });
  }
  if (selected === undefined) throw Object.assign(new Error("JSON pointer target is missing"), { code: "LOCATOR_NOT_FOUND", sourceId });
  return JSON.stringify(selected, null, 2);
}

function extractRecord(value, recordId, sourceId) {
  const matches = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) { for (const item of candidate) visit(item); return; }
    if (!candidate || typeof candidate !== "object") return;
    if (["$id", "id", "format", "schema_version"].some((key) => candidate[key] === recordId)) matches.push(candidate);
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  if (matches.length !== 1) throw Object.assign(new Error("record locator is missing or ambiguous"), { code: matches.length ? "LOCATOR_AMBIGUOUS" : "LOCATOR_NOT_FOUND", sourceId });
  return JSON.stringify(matches[0], null, 2);
}

export function extractProjectContextLocator(content, locator, sourceId = "unknown") {
  assert(typeof content === "string" && typeof locator === "string", "INVALID_CONTEXT_SOURCE", "source content and locator must be strings");
  const separator = locator.indexOf(":");
  const type = locator.slice(0, separator);
  const value = locator.slice(separator + 1);
  if (type === "heading") return extractHeading(content, value, sourceId);
  const parsed = parseJson(content, sourceId);
  if (type === "json-pointer") return extractJsonPointer(parsed, value, sourceId);
  if (type === "record") return extractRecord(parsed, value, sourceId);
  throw Object.assign(new Error("locator type is unsupported"), { code: "LOCATOR_INVALID", sourceId });
}

async function loadSource(source, rootPath) {
  let root;
  let file;
  try {
    root = await realpath(rootPath);
    file = await realpath(resolve(root, ...source.path.split("/")));
  } catch {
    throw Object.assign(new Error("declared source is unavailable"), { code: "SOURCE_UNAVAILABLE", sourceId: source.id });
  }
  const relativeFile = relative(root, file);
  if (!relativeFile || relativeFile === ".." || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
    throw Object.assign(new Error("declared source resolves outside its repository root"), { code: "SOURCE_PATH_ESCAPE", sourceId: source.id });
  }
  let info;
  let bytes;
  try {
    info = await stat(file);
    assert(info.isFile(), "SOURCE_NOT_FILE", "declared source is not a regular file");
    bytes = await readFile(file);
  } catch (error) {
    if (error.code) throw Object.assign(error, { sourceId: source.id });
    throw Object.assign(new Error("declared source is unavailable"), { code: "SOURCE_UNAVAILABLE", sourceId: source.id });
  }
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw Object.assign(new Error("declared source is not valid UTF-8 text"), { code: "SOURCE_NOT_TEXT", sourceId: source.id }); }
  return extractProjectContextLocator(content, source.locator, source.id);
}

function packet({ projectId, scopeDigest, selected, findings }) {
  const unsigned = {
    format: PROJECT_CONTEXT_PACKET_FORMAT,
    version: 1,
    projectId,
    status: findings.length ? "BLOCKED" : "READY",
    scopeDigest,
    selected: findings.length ? [] : selected,
    findings,
  };
  return Object.freeze({ ...unsigned, digest: `sha256:${sha256(unsigned)}` });
}

export async function materializeProjectContext({ manifest, sources, roots } = {}) {
  const scope = validateProjectContextScope({ manifest, sources });
  if (scope.status !== "READY") return packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected: [], findings: scope.findings });
  if (scope.selected.length === 0) return packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected: [], findings: [] });
  const rootMap = normalizeRoots(roots, scope.selected);
  const declared = new Map([
    ...manifest.project.sources.map((source) => [source.id, source]),
    ...manifest.dependencies.flatMap((dependency) => dependency.sources.map((source) => [source.id, { ...source, dependencyId: dependency.id }])),
  ]);
  const selected = [];
  const findings = [];
  for (const source of scope.selected) {
    try {
      const content = await loadSource(source, rootMap.get(source.repositoryId));
      const declaration = declared.get(source.id);
      selected.push(Object.freeze({ ...source, purpose: declaration.purpose, content, contentDigest: `sha256:${sha256(content)}` }));
    } catch (error) {
      findings.push(Object.freeze({
        code: error.code || "SOURCE_UNAVAILABLE",
        sourceId: source.id,
        projectId: source.projectId,
        repositoryId: source.repositoryId,
        path: source.path,
      }));
    }
  }
  return packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected, findings });
}
