import { execFile } from "node:child_process";
import { open, lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";
import { validateProjectContextScope } from "./project-context-scope.mjs";

export const PROJECT_CONTEXT_ROOTS_FORMAT = "agent-harness.project-context-roots.v1";
export const PROJECT_CONTEXT_PACKET_FORMAT = "agent-harness.project-context-packet.v1";
const execFileAsync = promisify(execFile);

function closed(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_CONTEXT_ROOTS", `${label} must be an object`);
  assert(Object.keys(value).every((key) => keys.includes(key)), "INVALID_CONTEXT_ROOTS", `${label} contains an unknown field`);
}

function normalizeGitRemote(value) {
  assert(typeof value === "string" && value.length > 0 && value === value.trim(), "INVALID_CONTEXT_ROOTS", "expectedGitRemote must be a non-empty credential-free Git remote");
  let url;
  try {
    if (/^[^@/]+@[^:/]+:.+$/.test(value)) {
      const match = /^(?:[^@]+@)?([^:/]+):(.+)$/.exec(value);
      url = new URL(`ssh://git@${match[1]}/${match[2]}`);
    } else {
      url = new URL(value);
    }
  } catch {
    throw Object.assign(new Error("expectedGitRemote is not a supported Git remote"), { code: "INVALID_CONTEXT_ROOTS" });
  }
  assert(["https:", "ssh:"].includes(url.protocol), "INVALID_CONTEXT_ROOTS", "expectedGitRemote must use HTTPS or SSH");
  assert(!url.password && (!url.username || (url.protocol === "ssh:" && url.username === "git")) && !url.search && !url.hash, "INVALID_CONTEXT_ROOTS", "expectedGitRemote must not contain credentials, a query, or a fragment");
  const pathname = url.pathname.replace(/\/$/, "").replace(/\.git$/i, "");
  assert(pathname.length > 1, "INVALID_CONTEXT_ROOTS", "expectedGitRemote must identify a repository");
  return `${url.protocol}//${url.host.toLowerCase()}${pathname}`;
}

async function gitOutput(rootPath, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootPath, ...args], { encoding: "utf8", windowsHide: true });
    return stdout.trim();
  } catch {
    throw Object.assign(new Error("local repository identity could not be verified"), { code: "ROOT_IDENTITY_UNVERIFIED" });
  }
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function verifyRepositoryRoot(item) {
  let rootPath;
  try { rootPath = await realpath(item.rootPath); }
  catch { throw Object.assign(new Error("local repository root is unavailable"), { code: "ROOT_IDENTITY_UNVERIFIED" }); }
  const expectedRemote = normalizeGitRemote(item.expectedGitRemote);
  const gitRoot = await gitOutput(rootPath, ["rev-parse", "--show-toplevel"]);
  let canonicalGitRoot;
  try { canonicalGitRoot = await realpath(gitRoot); }
  catch { throw Object.assign(new Error("local repository identity could not be verified"), { code: "ROOT_IDENTITY_UNVERIFIED" }); }
  assert(samePath(rootPath, canonicalGitRoot), "ROOT_IDENTITY_MISMATCH", "configured path is not the Git root for this repository");
  const actualRemote = normalizeGitRemote(await gitOutput(rootPath, ["remote", "get-url", "origin"]));
  assert(actualRemote === expectedRemote, "ROOT_IDENTITY_MISMATCH", "local Git origin does not match the configured repository identity");
  return rootPath;
}

async function normalizeRoots(roots, selected) {
  closed(roots, ["format", "version", "repositories"], "roots");
  assert(roots.format === PROJECT_CONTEXT_ROOTS_FORMAT && roots.version === 1, "INVALID_CONTEXT_ROOTS", "unsupported project-context roots version");
  assert(Array.isArray(roots.repositories) && roots.repositories.length > 0 && roots.repositories.length <= 101, "INVALID_CONTEXT_ROOTS", "roots.repositories must list 1 to 101 repositories");
  const required = new Set(selected.map((source) => source.repositoryId));
  const result = new Map();
  for (const [index, item] of roots.repositories.entries()) {
    closed(item, ["repositoryId", "rootPath", "expectedGitRemote"], `roots.repositories[${index}]`);
    assert(typeof item.repositoryId === "string" && /^[a-z][a-z0-9._-]{1,79}$/.test(item.repositoryId), "INVALID_CONTEXT_ROOTS", `roots.repositories[${index}].repositoryId is invalid`);
    assert(typeof item.rootPath === "string" && isAbsolute(item.rootPath), "INVALID_CONTEXT_ROOTS", `roots.repositories[${index}].rootPath must be an absolute local path`);
    assert(typeof item.expectedGitRemote === "string", "INVALID_CONTEXT_ROOTS", `roots.repositories[${index}].expectedGitRemote is required`);
    assert(required.has(item.repositoryId), "INVALID_CONTEXT_ROOTS", `root supplied for unselected repository: ${item.repositoryId}`);
    assert(!result.has(item.repositoryId), "INVALID_CONTEXT_ROOTS", `duplicate repository root: ${item.repositoryId}`);
    result.set(item.repositoryId, await verifyRepositoryRoot(item));
  }
  assert([...required].every((repositoryId) => result.has(repositoryId)), "INVALID_CONTEXT_ROOTS", "a selected source repository has no local root");
  return result;
}

function rejectDuplicateJsonKeys(content, sourceId) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(content[index] || "")) index += 1; };
  const string = () => {
    const start = index;
    index += 1;
    while (index < content.length) {
      if (content[index] === "\\") { index += 2; continue; }
      if (content[index] === '"') {
        index += 1;
        return JSON.parse(content.slice(start, index));
      }
      index += 1;
    }
    throw new Error("invalid JSON string");
  };
  const value = () => {
    whitespace();
    if (content[index] === '"') { string(); return; }
    if (content[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (content[index] === "}") { index += 1; return; }
      while (index < content.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw Object.assign(new Error("JSON object contains duplicate keys"), { code: "SOURCE_JSON_DUPLICATE_KEY", sourceId });
        keys.add(key);
        whitespace();
        index += 1;
        value();
        whitespace();
        if (content[index] === "}") { index += 1; return; }
        index += 1;
      }
      throw new Error("invalid JSON object");
    }
    if (content[index] === "[") {
      index += 1;
      whitespace();
      if (content[index] === "]") { index += 1; return; }
      while (index < content.length) {
        value();
        whitespace();
        if (content[index] === "]") { index += 1; return; }
        index += 1;
      }
      throw new Error("invalid JSON array");
    }
    while (index < content.length && !/[\s,}\]]/.test(content[index])) index += 1;
  };
  try { value(); }
  catch (error) {
    if (error.code === "SOURCE_JSON_DUPLICATE_KEY") throw error;
    throw Object.assign(new Error("JSON source could not be safely inspected"), { code: "SOURCE_JSON_INVALID", sourceId });
  }
}

function parseJson(content, sourceId) {
  try {
    const value = JSON.parse(content);
    rejectDuplicateJsonKeys(content, sourceId);
    return value;
  }
  catch (error) {
    if (error.code === "SOURCE_JSON_DUPLICATE_KEY") throw error;
    throw Object.assign(new Error("source is not valid JSON"), { code: "SOURCE_JSON_INVALID", sourceId });
  }
}

function extractHeading(content, heading, sourceId) {
  const lines = content.split(/\r?\n/);
  const headings = [];
  let fence = null;
  let inHtmlComment = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[index]);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const fenceMatch = inHtmlComment ? null : /^ {0,3}(`{3,}|~{3,})/.exec(lines[index]);
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const masked = maskHtmlComments(lines[index], inHtmlComment);
    inHtmlComment = masked.inComment;
    const visibleLine = masked.line;
    const match = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(visibleLine);
    if (match) headings.push({ index, level: match[1].length, title: match[2].trim() });
  }
  const matches = headings.filter((item) => item.title === heading);
  if (matches.length !== 1) throw Object.assign(new Error("heading locator is missing or ambiguous"), { code: matches.length ? "LOCATOR_AMBIGUOUS" : "LOCATOR_NOT_FOUND", sourceId });
  const selected = matches[0];
  const next = headings.find((item) => item.index > selected.index && item.level <= selected.level);
  const end = next?.index ?? lines.length;
  return lines.slice(selected.index, end).join("\n");
}

function maskHtmlComments(line, initialState) {
  let index = 0;
  let inComment = initialState;
  let masked = "";
  while (index < line.length) {
    if (inComment) {
      const close = line.indexOf("-->", index);
      if (close < 0) {
        masked += " ".repeat(line.length - index);
        index = line.length;
        continue;
      }
      masked += " ".repeat(close + 3 - index);
      index = close + 3;
      inComment = false;
      continue;
    }
    const open = line.indexOf("<!--", index);
    if (open < 0) {
      masked += line.slice(index);
      index = line.length;
      continue;
    }
    masked += line.slice(index, open) + " ".repeat(4);
    index = open + 4;
    inComment = true;
  }
  return { line: masked, inComment };
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
  const root = rootPath;
  let file;
  try {
    const declaredPath = resolve(root, ...source.path.split("/"));
    let currentPath = root;
    for (const segment of source.path.split("/")) {
      currentPath = resolve(currentPath, segment);
      const item = await lstat(currentPath);
      assert(!item.isSymbolicLink(), "SOURCE_SYMLINK_BLOCKED", "declared source path traverses a symbolic link");
    }
    file = await realpath(declaredPath);
  } catch (error) {
    if (error.code === "SOURCE_SYMLINK_BLOCKED") throw error;
    throw Object.assign(new Error("declared source is unavailable or uses a symbolic link"), { code: "SOURCE_UNAVAILABLE", sourceId: source.id });
  }
  const relativeFile = relative(root, file);
  if (!relativeFile || relativeFile === ".." || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
    throw Object.assign(new Error("declared source resolves outside its repository root"), { code: "SOURCE_PATH_ESCAPE", sourceId: source.id });
  }
  let handle;
  let bytes;
  try {
    handle = await open(file, "r");
    const info = await handle.stat({ bigint: true });
    assert(info.isFile(), "SOURCE_NOT_FILE", "declared source is not a regular file");
    const currentPath = await stat(file, { bigint: true });
    assert(info.dev === currentPath.dev && info.ino === currentPath.ino, "SOURCE_CHANGED_DURING_READ", "declared source changed while being opened");
    bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    const afterPath = await stat(file, { bigint: true });
    assert(info.dev === afterRead.dev && info.ino === afterRead.ino && info.size === afterRead.size && info.mtimeNs === afterRead.mtimeNs, "SOURCE_CHANGED_DURING_READ", "declared source changed while being read");
    assert(info.dev === afterPath.dev && info.ino === afterPath.ino && info.size === afterPath.size && info.mtimeNs === afterPath.mtimeNs, "SOURCE_CHANGED_DURING_READ", "declared source path changed while being read");
  } catch (error) {
    if (error.code) throw Object.assign(error, { sourceId: source.id });
    throw Object.assign(new Error("declared source is unavailable"), { code: "SOURCE_UNAVAILABLE", sourceId: source.id });
  } finally { await handle?.close(); }
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
  return deepFreeze({ ...unsigned, digest: `sha256:${sha256(unsigned)}` });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function verifyProjectContextPacket(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_CONTEXT_PACKET", "packet must be an object");
  const keys = ["format", "version", "projectId", "status", "scopeDigest", "selected", "findings", "digest"];
  assert(Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)), "INVALID_CONTEXT_PACKET", "packet fields do not match the contract");
  assert(value.format === PROJECT_CONTEXT_PACKET_FORMAT && value.version === 1, "INVALID_CONTEXT_PACKET", "unsupported packet version");
  const idPattern = /^[a-z][a-z0-9._-]{1,79}$/;
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  const sourceKeys = ["id", "projectId", "repositoryId", "path", "locator", "dependencyId", "purpose", "content", "contentDigest"];
  const requiredSourceKeys = ["id", "projectId", "repositoryId", "path", "locator", "purpose", "content", "contentDigest"];
  const findingKeys = ["code", "sourceId", "projectId", "repositoryId", "path"];
  const validPath = (path) => typeof path === "string"
    && path.length >= 1 && path.length <= 240
    && !path.startsWith("/") && !/^[a-z]:/i.test(path)
    && !/[\\:*?\[\]\0\r\n]/.test(path)
    && !path.split("/").some((part) => !part || part === "." || part === "..");
  const validLocator = (locator) => typeof locator === "string"
    && locator.length <= 240
    && /^(heading|json-pointer|record):\S[^*?\r\n]*$/.test(locator);
  const validPurpose = (purpose) => typeof purpose === "string"
    && purpose.length >= 12 && purpose.length <= 500
    && !/[\0\r\n]/.test(purpose);

  assert(typeof value.projectId === "string" && idPattern.test(value.projectId), "INVALID_CONTEXT_PACKET", "packet projectId is invalid");
  assert(["READY", "BLOCKED"].includes(value.status) && Array.isArray(value.selected) && value.selected.length <= 1000 && Array.isArray(value.findings), "INVALID_CONTEXT_PACKET", "packet status or collections are invalid");
  assert(digestPattern.test(value.scopeDigest) && digestPattern.test(value.digest), "INVALID_CONTEXT_PACKET", "packet digest fields are invalid");
  if (value.status === "READY") assert(value.findings.length === 0, "INVALID_CONTEXT_PACKET", "ready packet cannot contain findings");
  if (value.status === "BLOCKED") assert(value.selected.length === 0 && value.findings.length > 0, "INVALID_CONTEXT_PACKET", "blocked packet cannot release partial content");
  for (const source of value.selected) {
    assert(source && typeof source === "object" && !Array.isArray(source), "INVALID_CONTEXT_PACKET", "selected source is invalid");
    const sourceFields = Object.keys(source);
    assert(requiredSourceKeys.every((key) => sourceFields.includes(key)) && sourceFields.every((key) => sourceKeys.includes(key)), "INVALID_CONTEXT_PACKET", "selected source fields do not match the contract");
    assert(typeof source.id === "string" && idPattern.test(source.id)
      && typeof source.projectId === "string" && idPattern.test(source.projectId)
      && typeof source.repositoryId === "string" && idPattern.test(source.repositoryId)
      && (source.dependencyId === undefined || (typeof source.dependencyId === "string" && idPattern.test(source.dependencyId))), "INVALID_CONTEXT_PACKET", "selected source identity is invalid");
    assert(validPath(source.path) && validLocator(source.locator) && validPurpose(source.purpose), "INVALID_CONTEXT_PACKET", "selected source location or purpose is invalid");
    assert(typeof source.content === "string" && digestPattern.test(source.contentDigest), "INVALID_CONTEXT_PACKET", "selected source content or digest is invalid");
    assert(source.contentDigest === `sha256:${sha256(source.content)}`, "INVALID_CONTEXT_PACKET", "selected source digest does not match its content");
  }
  for (const finding of value.findings) {
    assert(finding && typeof finding === "object" && !Array.isArray(finding), "INVALID_CONTEXT_PACKET", "packet finding is invalid");
    const fields = Object.keys(finding);
    assert(fields.length === findingKeys.length && findingKeys.every((key) => fields.includes(key)), "INVALID_CONTEXT_PACKET", "packet finding fields do not match the contract");
    assert(typeof finding.code === "string" && /^[A-Z][A-Z0-9_]{1,79}$/.test(finding.code)
      && typeof finding.sourceId === "string" && idPattern.test(finding.sourceId)
      && typeof finding.projectId === "string" && idPattern.test(finding.projectId)
      && typeof finding.repositoryId === "string" && idPattern.test(finding.repositoryId)
      && validPath(finding.path), "INVALID_CONTEXT_PACKET", "packet finding metadata is invalid");
  }
  const unsigned = Object.fromEntries(keys.filter((key) => key !== "digest").map((key) => [key, value[key]]));
  assert(value.digest === `sha256:${sha256(unsigned)}`, "INVALID_CONTEXT_PACKET", "packet digest does not match its content");
  return true;
}

export async function materializeProjectContext({ manifest, sources, roots } = {}) {
  const scope = validateProjectContextScope({ manifest, sources });
  if (scope.status !== "READY") {
    const result = packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected: [], findings: scope.findings });
    verifyProjectContextPacket(result);
    return result;
  }
  if (scope.selected.length === 0) {
    const result = packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected: [], findings: [] });
    verifyProjectContextPacket(result);
    return result;
  }
  const rootMap = await normalizeRoots(roots, scope.selected);
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
  const result = packet({ projectId: scope.projectId, scopeDigest: scope.digest, selected, findings });
  verifyProjectContextPacket(result);
  return result;
}
