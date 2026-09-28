# Current state — Bounded Agent Harness

Recorded 2026-09-28. This is BAH project state only.

- **Source:** public BAH repository, website candidate branch `codex/project-brain-scope-20260927`, source commit `34bffb1df3b053033048ba13699153f316c732b4`.
- **Verified implementation commit:** `fd9b30065907fea985f6c6ba32d4381e500f2706`; full-suite proof was run against this exact source tree. Later brain/checkpoint bookkeeping commits remain source-only and are not deployed; the exact current repository head is in the takeover checkpoint.
- **Published website:** https://boundedagentharness.com, Netlify deploy `6abab040fab4a059dfd96ad1`, ready and production-current when checked.
- **Published boundary:** exact static candidate; zero available, required, and edge functions. All 34 publicly served files matched the preserved candidate ZIP on the custom domain and deploy URL. `/release.json` bound source commit `34bffb1df3b053033048ba13699153f316c732b4` and website digest `ae48b6988939344df787de5c88927026b58536557068a66bf7a87178728287cc`.
- **Rollback:** Netlify deploy `6ab7542de0a386f0d1ec894f`, previously verified ready with zero functions.
- **Release evidence:** [`../releases/boundedagentharness.com/2026-09-28-6abab040fab4a059dfd96ad1.json`](../releases/boundedagentharness.com/2026-09-28-6abab040fab4a059dfd96ad1.json).
- **Current source proof:** `PROOF-STATUS.md` and `PROOF-STATUS.v1.json` are the BAH-owned proof records. USB/DFW Metro/FreeVibeApps entries there are scoped integration evidence, not separate project status or proof that BAH is hosted as their runtime.
- **This continuation change:** the checkpoint contract now has a generic project identity while still accepting the legacy USB version during migration. The website was not changed or redeployed for this documentation/control-plane update.
- **Local proof:** `node --test` reports 171 tests (170 passed, 0 failed, 1 existing Windows symlink-creation skip); `node bin/audit-package.mjs` is valid with no findings. The new project-brain test locks BAH identity and its one narrow USB reference. Host-level retrieval/injection is still the next unimplemented integration.

No DFW Metro, USB customer-site, database, DNS, payment, credential, or provider configuration was changed by this project-brain update.
