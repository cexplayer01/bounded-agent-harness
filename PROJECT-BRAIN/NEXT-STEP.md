# Next BAH step

## Enforce project-scoped context at the host boundary

The BAH project-brain website candidate is published and verified. No GitHub, Netlify, or owner-access action is pending.

**Outcome:** make project-scoped context selection an enforced host boundary rather than a library/materializer capability that a host may forget to call.

**Build:** add one host-neutral retrieval/injection adapter that reads a project's own `PROJECT-BRAIN/PROJECT.json` and scope manifest, checks the declared project ID and repository root, resolves only allowlisted sources, and keeps sibling-project pointers as references unless an exact dependency is declared and admitted by the existing scope gate.

**Acceptance:**

- a USB run cannot receive BAH current state by default, and a BAH run cannot receive USB current state by default;
- a mismatched `project_id` or repository is rejected before prompt/context construction;
- an exact, outcome-linked cross-project dependency admits only its declared locator, not the referenced project's whole brain;
- failed source resolution emits no partial context packet;
- tests cover independent projects, explicit references, mismatch, and restart/recall of the selected packet.

Use the existing project-scope gate and source materializer; do not add a second scope engine. Do not redeploy any site for this local integration step.

Operational lesson: before reporting a GitHub access blocker, inspect the actual remote URL, Git ownership, repository installation visible to the plugin, and the bundled Git helper path. A connector `403` does not prove the existing Git credential route is unavailable. Follow `OPERATOR-GUIDE.md`.

Separate parked note: Google/Bing indexing credentials were unavailable in the last recorded check, and IndexNow was `PENDING_KEY_VERIFICATION`, not proof of indexing. Do not fold this into the active context-boundary task.
