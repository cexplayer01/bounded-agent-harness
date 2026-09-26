import assert from "node:assert/strict";
import { test } from "node:test";
import { createReleaseMetadata } from "../website/scripts/create-public-release.mjs";

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
