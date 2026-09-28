import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(websiteRoot, "..");
const outputDirectory = path.join(websiteRoot, "public");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim().toLowerCase();

if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("Review downloads require a full Git source commit");
}

function gitBuffer(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

const trackedPaths = gitBuffer("ls-tree", "-r", "--name-only", sourceCommit)
  .toString("utf8")
  .trim()
  .split("\n")
  .filter(Boolean);

const publicDocuments = new Set([
  "README.md",
  "PRODUCT.md",
  "OPERATOR-GUIDE.md",
  "PROOF-STATUS.md",
  "PROOF-STATUS.v1.json",
  "THREAT-MODEL.md",
  "SECURITY.md",
  "COMMERCIAL-LICENSING.md",
  "GOVERNANCE.md",
  "CONTRIBUTING.md",
  "ROADMAP.md",
  "LICENSE",
  "package.json",
]);

const reviewFiles = trackedPaths.filter((file) =>
  publicDocuments.has(file)
  || /^(src|contracts|examples|bin)\/.*\.(mjs|json|md)$/.test(file)
);
const testFiles = trackedPaths.filter((file) => /^test\/.*\.test\.mjs$/.test(file));

if (reviewFiles.length === 0 || testFiles.length === 0) {
  throw new Error(`Refusing incomplete public snapshot (${reviewFiles.length} review files, ${testFiles.length} test files)`);
}

const repositoryUrl = "https://github.com/cexplayer01/bounded-agent-harness";
const sourceUrl = `${repositoryUrl}/tree/${sourceCommit}`;

async function writeSnapshot(filename, title, files, scopeNote) {
  const sections = [
    `${title}\nRepository: ${repositoryUrl}\nSource commit: ${sourceCommit}\nSource URL: ${sourceUrl}\n\n${scopeNote}\n\nFiles (${files.length}):\n${files.join("\n")}`,
  ];

  for (const file of files) {
    sections.push(`\n\n===== BEGIN FILE: ${file} =====\n`);
    sections.push(gitBuffer("show", `${sourceCommit}:${file}`).toString("utf8"));
    sections.push(`\n===== END FILE: ${file} =====\n`);
  }

  const output = sections.join("");
  await writeFile(path.join(outputDirectory, filename), output, "utf8");
  process.stdout.write(`${filename}: ${files.length} files, ${Buffer.byteLength(output)} bytes, ${sourceCommit}\n`);
}

await Promise.all([
  writeSnapshot(
    "harness-review.txt",
    "Bounded Agent Harness — public source and proof snapshot",
    reviewFiles,
    "This snapshot contains the public documentation, implementation, contracts, examples, and proof record at the exact commit shown above. The proof record states what was run, what passed, and the limits of each result. Inclusion here does not make unsupported claims or grant authority to operate external systems. Private add-ons, credentials, project checkpoints, deployment receipts, and Git history are excluded.",
  ),
  writeSnapshot(
    "harness-tests.txt",
    "Bounded Agent Harness — checked-in automated test sources",
    testFiles,
    "This is the test source at the exact public commit shown above, not a test-run receipt. Actual results and host-specific skips are recorded in PROOF-STATUS.md at that commit. Follow the repository instructions to run the tests in your own environment.",
  ),
]);
