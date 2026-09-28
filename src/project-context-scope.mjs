import { sha256 } from "./canonical-json.mjs";
import { assert } from "./errors.mjs";

export const PROJECT_SCOPE_MANIFEST_FORMAT = "agent-harness.project-scope-manifest.v1";
export const PROJECT_CONTEXT_SCOPE_RESULT_FORMAT = "agent-harness.project-context-scope-result.v1";

const ID = /^[a-z][a-z0-9._-]{1,79}$/;
const LOCATOR = /^(heading|json-pointer|record):[^*?]+$/;

function object(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), "INVALID_PROJECT_SCOPE", `${label} must be an object`);
  return value;
}

function closed(value, keys, label) {
  object(value, label);
  const allowed = new Set(keys);
  assert(Object.keys(value).every((key) => allowed.has(key)), "INVALID_PROJECT_SCOPE", `${label} contains an unknown field`);
}

function id(value, label) {
  assert(typeof value === "string" && ID.test(value), "INVALID_PROJECT_SCOPE", `${label} must be a stable lowercase ID`);
  return value;
}

function prose(value, label) {
  assert(typeof value === "string" && value.trim().length >= 12 && value.length <= 500 && !/[\0\r\n]/.test(value), "INVALID_PROJECT_SCOPE", `${label} must be 12 to 500 characters on one line`);
  return value;
}

function path(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 240, "INVALID_PROJECT_SCOPE", `${label} must be a repository-relative path`);
  assert(!value.startsWith("/") && !/^[a-z]:/i.test(value) && !value.includes("\\") && !value.includes(":") && !/[\0\r\n*?\[\]]/.test(value), "INVALID_PROJECT_SCOPE", `${label} must be a canonical, non-glob repository path`);
  assert(!value.split("/").some((part) => !part || part === "." || part === ".."), "INVALID_PROJECT_SCOPE", `${label} contains an unsafe path segment`);
  return value;
}

function locator(value, label) {
  assert(typeof value === "string" && value.length <= 240 && LOCATOR.test(value) && !/[\0\r\n]/.test(value) && value.slice(value.indexOf(":") + 1).trim().length > 0, "INVALID_PROJECT_SCOPE", `${label} must identify one heading, JSON pointer, or record`);
  return value;
}

function normalizeDeclaration(value, label) {
  closed(value, ["id", "path", "locator", "purpose"], label);
  return Object.freeze({
    id: id(value.id, `${label}.id`),
    path: path(value.path, `${label}.path`),
    locator: locator(value.locator, `${label}.locator`),
    purpose: prose(value.purpose, `${label}.purpose`),
  });
}

function sourceList(value, label, seenSourceIds) {
  assert(Array.isArray(value) && value.length > 0 && value.length <= 500, "INVALID_PROJECT_SCOPE", `${label} must be an array with 1 to 500 sources`);
  return Object.freeze(value.map((item, index) => {
    const source = normalizeDeclaration(item, `${label}[${index}]`);
    assert(!seenSourceIds.has(source.id), "INVALID_PROJECT_SCOPE", `duplicate source ID: ${source.id}`);
    seenSourceIds.add(source.id);
    return source;
  }));
}

export function validateProjectScopeManifest(manifest) {
  closed(manifest, ["format", "version", "project", "dependencies"], "manifest");
  assert(manifest.format === PROJECT_SCOPE_MANIFEST_FORMAT && manifest.version === 1, "INVALID_PROJECT_SCOPE", "unsupported project-scope manifest version");
  closed(manifest.project, ["id", "repositoryId", "capabilities", "sources"], "manifest.project");
  assert(Array.isArray(manifest.project.capabilities) && manifest.project.capabilities.length > 0 && manifest.project.capabilities.length <= 200, "INVALID_PROJECT_SCOPE", "manifest.project.capabilities must list at least one project outcome");
  const capabilities = manifest.project.capabilities.map((value, index) => id(value, `manifest.project.capabilities[${index}]`));
  assert(new Set(capabilities).size === capabilities.length, "INVALID_PROJECT_SCOPE", "manifest.project.capabilities contains a duplicate");
  const project = Object.freeze({
    id: id(manifest.project.id, "manifest.project.id"),
    repositoryId: id(manifest.project.repositoryId, "manifest.project.repositoryId"),
    capabilities: Object.freeze(capabilities),
    sources: sourceList(manifest.project.sources, "manifest.project.sources", new Set()),
  });

  const seenDependencyIds = new Set();
  const seenSourceIds = new Set(project.sources.map((source) => source.id));
  assert(Array.isArray(manifest.dependencies) && manifest.dependencies.length <= 100, "INVALID_PROJECT_SCOPE", "manifest.dependencies must be an array with at most 100 dependencies");
  const dependencies = Object.freeze(manifest.dependencies.map((dependency, index) => {
    const label = `manifest.dependencies[${index}]`;
    closed(dependency, ["id", "projectId", "repositoryId", "rationale", "affectedCapabilities", "sources"], label);
    const dependencyId = id(dependency.id, `${label}.id`);
    const projectId = id(dependency.projectId, `${label}.projectId`);
    const repositoryId = id(dependency.repositoryId, `${label}.repositoryId`);
    assert(!seenDependencyIds.has(dependencyId), "INVALID_PROJECT_SCOPE", `duplicate dependency ID: ${dependencyId}`);
    seenDependencyIds.add(dependencyId);
    assert(projectId !== project.id || repositoryId !== project.repositoryId, "INVALID_PROJECT_SCOPE", `${label} must identify a different project or repository`);
    const rationale = prose(dependency.rationale, `${label}.rationale`);
    assert(Array.isArray(dependency.affectedCapabilities) && dependency.affectedCapabilities.length > 0 && dependency.affectedCapabilities.length <= 50, "INVALID_PROJECT_SCOPE", `${label}.affectedCapabilities must identify at least one project outcome`);
    const affectedCapabilities = dependency.affectedCapabilities.map((value, capabilityIndex) => id(value, `${label}.affectedCapabilities[${capabilityIndex}]`));
    assert(new Set(affectedCapabilities).size === affectedCapabilities.length, "INVALID_PROJECT_SCOPE", `${label}.affectedCapabilities contains a duplicate`);
    assert(affectedCapabilities.every((capability) => project.capabilities.includes(capability)), "INVALID_PROJECT_SCOPE", `${label}.affectedCapabilities must reference declared project capabilities`);
    const sources = sourceList(dependency.sources, `${label}.sources`, seenSourceIds);
    return Object.freeze({ id: dependencyId, projectId, repositoryId, rationale, affectedCapabilities: Object.freeze(affectedCapabilities), sources });
  }));

  return Object.freeze({ format: PROJECT_SCOPE_MANIFEST_FORMAT, version: 1, project, dependencies });
}

function normalizeCandidate(value, index) {
  const label = `sources[${index}]`;
  closed(value, ["id", "projectId", "repositoryId", "path", "locator", "dependencyId"], label);
  return Object.freeze({
    id: id(value.id, `${label}.id`),
    projectId: id(value.projectId, `${label}.projectId`),
    repositoryId: id(value.repositoryId, `${label}.repositoryId`),
    path: path(value.path, `${label}.path`),
    locator: locator(value.locator, `${label}.locator`),
    ...(value.dependencyId === undefined ? {} : { dependencyId: id(value.dependencyId, `${label}.dependencyId`) }),
  });
}

function sameDeclaration(candidate, declaration) {
  return candidate.id === declaration.id && candidate.path === declaration.path && candidate.locator === declaration.locator;
}

function finding(code, source) {
  return Object.freeze({ code, sourceId: source.id, projectId: source.projectId, repositoryId: source.repositoryId, path: source.path });
}

/**
 * Fail closed on any context reference not explicitly owned by the current
 * project or declared as a narrow, outcome-linked project dependency.
 * This validates references before retrieval; it does not classify prose.
 */
export function validateProjectContextScope({ manifest, sources } = {}) {
  const scope = validateProjectScopeManifest(manifest);
  assert(Array.isArray(sources) && sources.length <= 1000, "INVALID_CONTEXT_SOURCES", "sources must be an array with at most 1000 references");
  const normalizedSources = Object.freeze(sources.map(normalizeCandidate));
  const duplicateIds = new Set();
  const findings = [];
  for (const source of normalizedSources) {
    if (duplicateIds.has(source.id)) {
      findings.push(finding("DUPLICATE_CONTEXT_SOURCE", source));
      continue;
    }
    duplicateIds.add(source.id);
    if (source.projectId === scope.project.id && source.repositoryId === scope.project.repositoryId) {
      if (source.dependencyId !== undefined) findings.push(finding("PRIMARY_SOURCE_HAS_DEPENDENCY_ID", source));
      else if (!scope.project.sources.some((item) => sameDeclaration(source, item))) findings.push(finding("UNREGISTERED_PRIMARY_SOURCE", source));
      continue;
    }
    const dependency = scope.dependencies.find((item) => item.id === source.dependencyId);
    if (!dependency) {
      findings.push(finding("UNDECLARED_PROJECT_DEPENDENCY", source));
      continue;
    }
    if (source.projectId !== dependency.projectId || source.repositoryId !== dependency.repositoryId) {
      findings.push(finding("DEPENDENCY_OWNER_MISMATCH", source));
      continue;
    }
    if (!dependency.sources.some((item) => sameDeclaration(source, item))) findings.push(finding("UNREGISTERED_DEPENDENCY_SOURCE", source));
  }
  const selected = Object.freeze(findings.length ? [] : [...normalizedSources]);
  const frozenFindings = Object.freeze(findings);
  const unsigned = {
    format: PROJECT_CONTEXT_SCOPE_RESULT_FORMAT,
    version: 1,
    projectId: scope.project.id,
    status: findings.length ? "BLOCKED" : "READY",
    manifestDigest: `sha256:${sha256(scope)}`,
    sourcesDigest: `sha256:${sha256(normalizedSources)}`,
    selected,
    findings: frozenFindings,
  };
  return Object.freeze({ ...unsigned, digest: `sha256:${sha256(unsigned)}` });
}

export function assertProjectContextScope(input) {
  const result = validateProjectContextScope(input);
  assert(result.status === "READY", "PROJECT_CONTEXT_SCOPE_BLOCKED", "context includes an unregistered or out-of-scope project source", result.findings);
  return result;
}
