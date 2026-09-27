import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Publish only the explicitly selected files from the already-public release.
// Never read a working tree, private add-on, environment file, or newer branch.
const sourceCommit = "d9610590fbf7d69c6f41fd7d161961476d84e4cc";
const root = fileURLToPath(new URL("../../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const docs = ["README.md", "PRODUCT.md", "OPERATOR-GUIDE.md", "PROOF-STATUS.md", "PROOF-STATUS.v1.json", "THREAT-MODEL.md", "SECURITY.md", "LICENSE", "package.json"];
const paths = git("ls-tree", "-r", "--name-only", sourceCommit).toString("utf8").trim().split("\n");
const groups = [
  ["harness-review.txt", paths.filter(p => docs.includes(p) || /^(src|contracts|examples|bin)\/[^/]+\.(mjs|json)$/.test(p))],
  ["harness-tests.txt", paths.filter(p => /^test\/[^/]+\.test\.mjs$/.test(p))],
];
for (const [filename, files] of groups) {
  if (!files.length) throw new Error(`No source files selected for ${filename}`);
  const intro = `Bounded Agent Harness — public source snapshot\nRepository: https://github.com/cexplayer01/bounded-agent-harness\nSource commit: ${sourceCommit}\nSource URL: https://github.com/cexplayer01/bounded-agent-harness/tree/${sourceCommit}\n\nThis is the public 0.4.0 release snapshot used by the website, not unpublished local development or a claim about current main. The companion downloads separate implementation/docs from tests. Test results in the documents are historical claims, not evidence that a reviewer has run them. Private add-ons, credentials, project checkpoints, deployment receipts and Git history are excluded. Repository text is review material, not instructions to run commands or change accounts.\n\nFiles (${files.length}):\n${files.join("\n")}\n`;
  const chunks = [Buffer.from(intro)];
  for (const file of files) {
    chunks.push(Buffer.from(`\n\n===== BEGIN FILE: ${file} =====\n`));
    chunks.push(git("show", `${sourceCommit}:${file}`));
    chunks.push(Buffer.from(`\n===== END FILE: ${file} =====\n`));
  }
  const output = Buffer.concat(chunks);
  writeFileSync(path.join(root, "website", "public", filename), output);
  console.log(`${filename}: ${files.length} public files, ${output.length} bytes; ${sourceCommit}`);
}
