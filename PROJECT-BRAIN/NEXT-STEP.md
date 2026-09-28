# Next BAH step

## Publish the approved BAH project-boundary update — owner GO given, source-sharing gate blocked

The owner authorized updating and publishing `https://boundedagentharness.com` on 2026-09-28. The candidate changes the public test count from 165 to the verified 170 passed / 0 failed / 1 host skip and describes project-bound checkpoint identity, while explicitly stating that host-level context injection is not enforced. Target remains the BAH static site only; rollback is Netlify deploy `6ab7542de0a386f0d1ec894f`.

The source branch `codex/project-brain-ownership-20260928` is committed locally but is not on GitHub. The GitHub connector returned HTTP 403 for branch creation; this checkout's `origin` points to another local worktree, its Git lacks the HTTPS remote helper, Edge is signed out of GitHub, and no SSH key is available. Netlify is signed in, but publishing before the source commit is reachable would expose a release receipt/source snapshot whose GitHub URL cannot be opened. Restore an authenticated GitHub write route and publish this exact branch without force-pushing or moving another branch. Verify the remote SHA before the already-approved website build/upload. Do not treat the local branch as portable before that readback.

**Outcome:** make project-scoped context selection an enforced host boundary rather than a library/materializer capability that a host may forget to call.

**Build:** add one host-neutral retrieval/injection adapter that reads a project's own `PROJECT-BRAIN/PROJECT.json` and scope manifest, checks the declared project ID and repository root, resolves only allowlisted sources, and keeps sibling-project pointers as references unless an exact dependency is declared and admitted by the existing scope gate.

**Acceptance:**

- a USB run cannot receive BAH current state by default, and a BAH run cannot receive USB current state by default;
- a mismatched `project_id` or repository is rejected before prompt/context construction;
- an exact, outcome-linked cross-project dependency admits only its declared locator, not the referenced project's whole brain;
- failed source resolution emits no partial context packet;
- tests cover independent projects, explicit references, mismatch, and restart/recall of the selected packet.

Use the existing project-scope gate and source materializer; do not add a second scope engine. After publishing the website update, continue the host-integration task below. Do not redeploy other sites or add BAH Project Brain details to the public snapshot.

Separate parked note: Google/Bing indexing credentials were unavailable in the last recorded check, and IndexNow was `PENDING_KEY_VERIFICATION`, not proof of indexing. Do not fold this into the active context-boundary task.
