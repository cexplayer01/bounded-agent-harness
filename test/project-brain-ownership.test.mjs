import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const project = JSON.parse(await readFile(new URL("../PROJECT-BRAIN/PROJECT.json", import.meta.url), "utf8"));
const brain = await readFile(new URL("../PROJECT-BRAIN/README.md", import.meta.url), "utf8");

test("BAH project brain has an explicit BAH identity and a narrow USB reference", () => {
  assert.equal(project.schema_version, "agent-harness.project-brain.v1");
  assert.equal(project.project_id, "bounded-agent-harness");
  assert.equal(project.repository, "https://github.com/cexplayer01/bounded-agent-harness");
  assert.equal(project.brain_root, "PROJECT-BRAIN");
  assert.deepEqual(project.references, [{
    project_id: "usb-website-platform",
    repository: "https://github.com/cexplayer01/USB-Website-platform",
    path: "Project Brain/README.md",
    scope: "Only consult for an explicitly cited BAH integration-evidence question; do not import USB current status or general product context."
  }]);
});

test("BAH brain keeps cross-project state out and forbids private add-on details in the public repo", () => {
  assert.match(brain, /This brain belongs only to the `bounded-agent-harness` project/);
  assert.match(brain, /Every independent product\/repository owns its own current state/);
  assert.match(brain, /A pointer to another project's brain is not permission to copy its status/);
  assert.match(brain, /Never add credentials, private owner records, or the implementation\/specification of proprietary HITL Removal or Danger Mode add-ons/);
  assert.doesNotMatch(brain, /\.codex-temp\/hitl-removal-private\/SPEC\.md/);
});
