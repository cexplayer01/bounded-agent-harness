import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { assert } from "./errors.mjs";

const CHANGE_KINDS = new Set(["DOCUMENTATION", "LOCAL_IMPLEMENTATION", "PUBLIC_INTERFACE", "SCHEMA_OR_POLICY", "EXTERNAL_EFFECT_BOUNDARY"]);
const TIERS = Object.freeze(["TIER_0_STATIC", "TIER_1_DIRECT", "TIER_2_BOUNDARY", "TIER_3_FULL"]);
const TIER_ORDER = new Map(TIERS.map((tier, index) => [tier, index]));
const CODE_EXTENSIONS = new Set([".cjs", ".css", ".html", ".js", ".json", ".mjs", ".ps1", ".ts", ".tsx"]);
const TEXT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ".md", ".txt", ".toml", ".yml", ".yaml"]);
const DEFAULT_IGNORED = Object.freeze([".git", ".agent-harness", "build", "coverage", "dist", "node_modules"]);

function portablePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 240, "INVALID_IMPACT_PATH", `${label} must be a nonempty relative path`);
  const normalized = value.replaceAll("\\", "/");
  assert(!isAbsolute(value) && !/^[a-z]:/i.test(normalized), "INVALID_IMPACT_PATH", `${label} must be relative`);
  assert(!normalized.split("/").some((part) => !part || part === "." || part === ".."), "INVALID_IMPACT_PATH", `${label} contains an unsafe segment`);
  assert(!/[\0\r\n]/.test(normalized), "INVALID_IMPACT_PATH", `${label} contains a control character`);
  return normalized;
}

function uniqueSorted(values, label, maximum, normalizer = (value) => value) {
  assert(Array.isArray(values) && values.length <= maximum, "INVALID_CHANGE_IMPACT", `${label} must contain at most ${maximum} values`);
  const normalized = values.map((value, index) => normalizer(value, `${label}[${index}]`));
  assert(new Set(normalized).size === normalized.length, "INVALID_CHANGE_IMPACT", `${label} contains a duplicate`);
  return normalized.sort();
}

function token(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 120, "INVALID_IMPACT_TOKEN", `${label} must be a short nonempty string`);
  assert(!/[\0\r\n\t ]/.test(value), "INVALID_IMPACT_TOKEN", `${label} must not contain whitespace or control characters`);
  return value;
}

function classify(path) {
  if (/(^|\/)(?:test|tests)(\/|$)|\.(?:spec|test)\.[^.]+$/i.test(path)) return "TEST";
  if ([".md", ".txt"].includes(extname(path).toLowerCase())) return "DOCUMENTATION";
  return "SOURCE";
}

function normalizeCatalog(entries) {
  assert(Array.isArray(entries) && entries.length > 0 && entries.length <= 100, "INVALID_VERIFICATION_CATALOG", "verification_catalog must contain 1 to 100 entries");
  const ids = new Set();
  return entries.map((entry, index) => {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), "INVALID_VERIFICATION_CATALOG", `verification_catalog[${index}] must be an object`);
    const allowed = new Set(["id", "tier", "command", "covers"]);
    assert(Object.keys(entry).every((key) => allowed.has(key)), "INVALID_VERIFICATION_CATALOG", `verification_catalog[${index}] contains an unknown field`);
    assert(typeof entry.id === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(entry.id), "INVALID_VERIFICATION_CATALOG", `verification_catalog[${index}].id is invalid`);
    assert(!ids.has(entry.id), "INVALID_VERIFICATION_CATALOG", `duplicate verification id: ${entry.id}`);
    ids.add(entry.id);
    assert(TIER_ORDER.has(entry.tier), "INVALID_VERIFICATION_CATALOG", `${entry.id} has an unsupported tier`);
    assert(typeof entry.command === "string" && entry.command.length > 0 && entry.command.length <= 500 && !/[\r\n\0]/.test(entry.command), "INVALID_VERIFICATION_CATALOG", `${entry.id} command is invalid`);
    const covers = entry.covers;
    assert(covers && typeof covers === "object" && !Array.isArray(covers), "INVALID_VERIFICATION_CATALOG", `${entry.id}.covers must be an object`);
    const coverAllowed = new Set(["paths", "prefixes", "tokens", "global"]);
    assert(Object.keys(covers).every((key) => coverAllowed.has(key)), "INVALID_VERIFICATION_CATALOG", `${entry.id}.covers contains an unknown field`);
    const paths = uniqueSorted(covers.paths ?? [], `${entry.id}.covers.paths`, 100, portablePath);
    const prefixes = uniqueSorted(covers.prefixes ?? [], `${entry.id}.covers.prefixes`, 100, portablePath).map((value) => value.endsWith("/") ? value : `${value}/`);
    const tokens = uniqueSorted(covers.tokens ?? [], `${entry.id}.covers.tokens`, 50, token);
    const global = covers.global === true;
    assert(global || paths.length || prefixes.length || tokens.length, "INVALID_VERIFICATION_CATALOG", `${entry.id} must declare coverage`);
    if (entry.tier === "TIER_3_FULL") assert(global, "INVALID_VERIFICATION_CATALOG", `${entry.id} full-suite coverage must be global`);
    return Object.freeze({ id: entry.id, tier: entry.tier, command: entry.command, covers: Object.freeze({ paths, prefixes, tokens, global }) });
  });
}

function normalizeRequest(request) {
  assert(request && typeof request === "object" && !Array.isArray(request), "INVALID_CHANGE_IMPACT", "change-impact request must be an object");
  const allowed = new Set(["schema_version", "change_id", "outcome", "change_kind", "changed_paths", "reference_tokens", "verification_catalog", "external_gates", "ignored_prefixes"]);
  assert(Object.keys(request).every((key) => allowed.has(key)), "INVALID_CHANGE_IMPACT", "change-impact request contains an unknown field");
  assert(request.schema_version === "change-impact-request.v1", "INVALID_CHANGE_IMPACT", "unsupported change-impact request schema");
  assert(typeof request.change_id === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(request.change_id), "INVALID_CHANGE_IMPACT", "change_id is invalid");
  assert(typeof request.outcome === "string" && request.outcome.length > 0 && request.outcome.length <= 240 && !/[\r\n\0]/.test(request.outcome), "INVALID_CHANGE_IMPACT", "outcome is invalid");
  assert(CHANGE_KINDS.has(request.change_kind), "INVALID_CHANGE_IMPACT", "change_kind is unsupported");
  const changedPaths = uniqueSorted(request.changed_paths, "changed_paths", 50, portablePath);
  assert(changedPaths.length > 0, "INVALID_CHANGE_IMPACT", "changed_paths must not be empty");
  const referenceTokens = uniqueSorted(request.reference_tokens ?? [], "reference_tokens", 30, token);
  if (["PUBLIC_INTERFACE", "SCHEMA_OR_POLICY", "EXTERNAL_EFFECT_BOUNDARY"].includes(request.change_kind)) {
    assert(referenceTokens.length > 0, "INVALID_CHANGE_IMPACT", `${request.change_kind} requires at least one reference token`);
  }
  const externalGates = uniqueSorted(request.external_gates ?? [], "external_gates", 20, token);
  const ignoredPrefixes = uniqueSorted(request.ignored_prefixes ?? [], "ignored_prefixes", 50, portablePath).map((value) => value.endsWith("/") ? value : `${value}/`);
  return Object.freeze({
    schemaVersion: request.schema_version,
    changeId: request.change_id,
    outcome: request.outcome,
    changeKind: request.change_kind,
    changedPaths,
    referenceTokens,
    verificationCatalog: normalizeCatalog(request.verification_catalog),
    externalGates,
    ignoredPrefixes
  });
}

function entryMatches(entry, paths, tokens) {
  if (entry.covers.global) return true;
  if (paths.some((path) => entry.covers.paths.includes(path) || entry.covers.prefixes.some((prefix) => path.startsWith(prefix)))) return true;
  return tokens.some((value) => entry.covers.tokens.includes(value));
}

function entryCoversConsumer(entry, consumer) {
  return entry.covers.global
    || entry.covers.paths.includes(consumer.path)
    || entry.covers.prefixes.some((prefix) => consumer.path.startsWith(prefix))
    || consumer.matched_tokens.some((value) => entry.covers.tokens.includes(value));
}

function verifiable(path) { return CODE_EXTENSIONS.has(extname(path).toLowerCase()); }

export function analyzeChangeImpact(request, repositoryEntries) {
  const input = normalizeRequest(request);
  assert(Array.isArray(repositoryEntries) && repositoryEntries.length <= 20_000, "INVALID_REPOSITORY_INVENTORY", "repository inventory must contain at most 20000 entries");
  const seen = new Set();
  const consumers = [];
  for (const [index, item] of repositoryEntries.entries()) {
    assert(item && typeof item === "object" && !Array.isArray(item), "INVALID_REPOSITORY_INVENTORY", `repository entry ${index} must be an object`);
    assert(Object.keys(item).every((key) => ["path", "text"].includes(key)), "INVALID_REPOSITORY_INVENTORY", `repository entry ${index} contains an unknown field`);
    const path = portablePath(item.path, `repository entry ${index} path`);
    assert(!seen.has(path), "INVALID_REPOSITORY_INVENTORY", `duplicate repository entry: ${path}`);
    seen.add(path);
    assert(typeof item.text === "string", "INVALID_REPOSITORY_INVENTORY", `repository entry ${path} text must be a string`);
    if (input.changedPaths.includes(path)) continue;
    const matched = input.referenceTokens.filter((value) => item.text.includes(value));
    if (matched.length) consumers.push(Object.freeze({ path, kind: classify(path), matched_tokens: matched }));
  }
  consumers.sort((a, b) => a.path.localeCompare(b.path));
  const impactedPaths = [...new Set([...input.changedPaths, ...consumers.map((item) => item.path)])].sort();
  const needsBoundary = ["PUBLIC_INTERFACE", "SCHEMA_OR_POLICY", "EXTERNAL_EFFECT_BOUNDARY"].includes(input.changeKind);
  const fullSuiteRequired = needsBoundary;
  const selected = input.verificationCatalog
    .filter((entry) => (entry.tier !== "TIER_3_FULL" || fullSuiteRequired) && entryMatches(entry, impactedPaths, input.referenceTokens))
    .sort((a, b) => TIER_ORDER.get(a.tier) - TIER_ORDER.get(b.tier) || a.id.localeCompare(b.id));
  const focused = selected.filter((entry) => ["TIER_1_DIRECT", "TIER_2_BOUNDARY"].includes(entry.tier));
  const gaps = [];
  if (input.changeKind !== "DOCUMENTATION") {
    for (const path of input.changedPaths.filter(verifiable)) {
      if (!selected.some((entry) => entry.tier === "TIER_1_DIRECT" && entryMatches(entry, [path], input.referenceTokens))) gaps.push({ code: "DIRECT_TEST_MISSING", path });
    }
    for (const consumer of consumers.filter((item) => item.kind !== "DOCUMENTATION" && verifiable(item.path))) {
      if (!focused.some((entry) => entryCoversConsumer(entry, consumer))) gaps.push({ code: "CONSUMER_TEST_MISSING", path: consumer.path });
    }
  }
  if (needsBoundary && !selected.some((entry) => entry.tier === "TIER_2_BOUNDARY")) gaps.push({ code: "BOUNDARY_TEST_MISSING", path: null });
  if (fullSuiteRequired && !selected.some((entry) => entry.tier === "TIER_3_FULL")) gaps.push({ code: "FULL_SUITE_MISSING", path: null });
  gaps.sort((a, b) => a.code.localeCompare(b.code) || String(a.path).localeCompare(String(b.path)));
  const status = gaps.length ? "NEEDS_VERIFICATION_MAPPING" : "READY_FOR_TIERED_VERIFICATION";
  const executionOrder = selected.map((entry) => entry.id);
  const result = {
    schema_version: "change-impact.v1",
    change_id: input.changeId,
    status,
    change_kind: input.changeKind,
    changed_paths: input.changedPaths,
    reference_tokens: input.referenceTokens,
    consumers,
    verification: {
      selected: selected.map((entry) => ({ id: entry.id, tier: entry.tier, command: entry.command })),
      gaps,
      full_suite_required: fullSuiteRequired,
      execution_order: executionOrder
    },
    active_card: {
      current_outcome: input.outcome,
      current_change: `${input.changeKind}: ${input.changedPaths.join(", ")}`,
      affected_consumers: consumers.length,
      focused_proof: selected.filter((entry) => entry.tier !== "TIER_3_FULL").map((entry) => entry.id),
      full_suite: fullSuiteRequired ? (selected.some((entry) => entry.tier === "TIER_3_FULL") ? "REQUIRED_ONCE_AT_MILESTONE" : "REQUIRED_BUT_UNMAPPED") : "NOT_REQUIRED_BY_CHANGE_KIND",
      exact_next_action: gaps.length ? "MAP_MISSING_VERIFICATION_COVERAGE" : "RUN_SELECTED_TESTS_IN_ORDER",
      external_gates: input.externalGates
    }
  };
  return Object.freeze(result);
}

async function collectTextEntries(root, ignoredPrefixes) {
  const entries = [];
  const ignored = new Set(DEFAULT_IGNORED);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      const path = relative(root, full).split(sep).join("/");
      if (!path || path.startsWith("../") || isAbsolute(path)) continue;
      if (entry.isDirectory()) {
        if (ignored.has(entry.name) || ignoredPrefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
      const info = await lstat(full);
      if (info.isSymbolicLink() || info.size > 1_000_000) continue;
      entries.push({ path, text: await readFile(full, "utf8") });
      assert(entries.length <= 20_000, "REPOSITORY_SCAN_LIMIT", "repository scan exceeded 20000 text files");
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function scanChangeImpact({ rootDirectory, request }) {
  assert(typeof rootDirectory === "string" && rootDirectory.length > 0, "INVALID_REPOSITORY_ROOT", "rootDirectory is required");
  const root = resolve(rootDirectory);
  const info = await lstat(root).catch(() => null);
  assert(info?.isDirectory() && !info.isSymbolicLink(), "INVALID_REPOSITORY_ROOT", "rootDirectory must be a real directory");
  const input = normalizeRequest(request);
  const entries = await collectTextEntries(root, input.ignoredPrefixes);
  return analyzeChangeImpact(request, entries);
}

export { CHANGE_KINDS, TIERS };
