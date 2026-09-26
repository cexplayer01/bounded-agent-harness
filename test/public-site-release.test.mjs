import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { createReleaseMetadata, treeDigest } from "../website/scripts/create-public-release.mjs";

test("public release metadata binds source, proof, and website digests", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const metadata = await createReleaseMetadata({ sourceCommit: commit });
  assert.equal(metadata.format, "bounded-agent-harness-public-release.v1");
  assert.equal(metadata.sourceCommit, commit);
  assert.match(metadata.websiteSourceSha256, /^[0-9a-f]{64}$/);
  assert.match(metadata.proofStatusSha256, /^[0-9a-f]{64}$/);
  assert.match(metadata.sourceUrl, new RegExp(`${commit}/website$`));
  assert.match(metadata.proofStatusUrl, new RegExp(`${commit}/PROOF-STATUS\\.md$`));
});

test("public release digest excludes provider-local Netlify state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bounded-agent-harness-release-"));
  try {
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(path.join(root, "public", "index.html"), "baseline\n", "utf8");
    const before = await treeDigest(root);

    await mkdir(path.join(root, ".netlify"), { recursive: true });
    await writeFile(path.join(root, ".netlify", "state.json"), JSON.stringify({ deploy: "local-only" }), "utf8");

    assert.equal(await treeDigest(root), before);
    assert.equal(await readFile(path.join(root, ".netlify", "state.json"), "utf8"), JSON.stringify({ deploy: "local-only" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
