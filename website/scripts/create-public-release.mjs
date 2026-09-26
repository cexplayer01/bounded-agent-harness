import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(websiteRoot, "..");
const outputPath = path.join(websiteRoot, "public", "release.json");
const ignoredDirectories = new Set([".next", ".vinext", "node_modules", "out", ".wrangler", ".vercel"]);
const ignoredFiles = new Set(["release.json"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitCommit() {
  for (const candidate of [process.env.SOURCE_COMMIT, process.env.COMMIT_REF]) {
    if (candidate && /^[0-9a-f]{40}$/i.test(candidate)) return candidate.toLowerCase();
  }
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  } catch {
    // A deployment host without Git must provide SOURCE_COMMIT or COMMIT_REF.
  }
  throw new Error("Cannot bind public build: SOURCE_COMMIT or COMMIT_REF, or a Git HEAD, is required");
}

async function filesUnder(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await filesUnder(root, child));
    } else if (!ignoredFiles.has(entry.name)) {
      files.push(child.replaceAll(path.sep, "/"));
    }
  }
  return files;
}

async function treeDigest(root) {
  const files = await filesUnder(root);
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function maturityFrom(readme) {
  return readme.match(/LOCAL_CONTROL_PLANE_MILESTONE_[0-9.]+/)?.[0] ?? "UNSPECIFIED";
}

export async function createReleaseMetadata({ sourceCommit = gitCommit() } = {}) {
  const [websitePackage, harnessPackage, readme, proofStatus] = await Promise.all([
    readFile(path.join(websiteRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, "README.md"), "utf8"),
    readFile(path.join(repositoryRoot, "PROOF-STATUS.v1.json")),
  ]);
  return {
    format: "bounded-agent-harness-public-release.v1",
    sourceRepository: "https://github.com/cexplayer01/bounded-agent-harness",
    sourceCommit,
    sourcePath: "website/",
    sourceUrl: `https://github.com/cexplayer01/bounded-agent-harness/tree/${sourceCommit}/website`,
    proofStatusUrl: `https://github.com/cexplayer01/bounded-agent-harness/blob/${sourceCommit}/PROOF-STATUS.md`,
    harnessPackageVersion: harnessPackage.version,
    websitePackageVersion: websitePackage.version,
    capabilityMaturity: maturityFrom(readme),
    websiteSourceSha256: await treeDigest(websiteRoot),
    proofStatusSha256: sha256(proofStatus),
    generatedBy: "website/scripts/create-public-release.mjs",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = await createReleaseMetadata();
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${path.relative(repositoryRoot, outputPath)} for ${metadata.sourceCommit}\n`);
}
