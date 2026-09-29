# HF-1 — Setup Wizard config preservation — Executive Status

| Item | Value |
|---|---|
| Defect | T2: editing a business in the Setup Wizard overwrote `biz:{bizId}:config` and silently deleted `employees`, `pettyCashCategories`, legacy region/checklist settings and any other key. Classified P0 (permanent silent data loss; pilot blocker) |
| Status | **CLOSED** by one local commit (SHA in the external handoff) |
| Base | `05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661` — the Codex-APPROVED P0 scheduled-auth release candidate (P0_AUTH / RELEASE_MANIFEST / DEPLOYMENT_SEQUENCE: APPROVED, 2026-09-29), parent `f5d0a8ed` (approved P0 chain). Its `index.html` blob `b9c5f220…` equals the one the approved release manifest pins |
| Branch / worktree | `claude/hf1-setup-config-preservation` / `/Users/yonatan/Documents/marjin/kissgn-hf1-setup-config-preservation` |
| Files changed | `index.html` (+71/−1: one helper block + the edit-mode `onComplete`), `test/dashboard/setup-config-preservation.test.mjs` (new, 23 tests), this folder |
| Reproduction | the new suite at the base: **4 pass / 19 fail** (employees, categories, nested and unknown keys lost; malformed config overwritten; `lat: null` added) — doc 01 |
| After the fix | focused 23/23; full suite **988/988** (base 965 + 23); tsc 22 × TS2742 (baseline, unchanged); all four `index.html` scripts parse |
| Release note | HF-1 changes the `index.html` blob. It is **not** part of the approved P0 release candidate; including it in that release needs a separate decision and a manifest update (the pinned client blob changes) |
| HF-2 (`resolveCredit`) | **DOCUMENTED, not implemented** — intended behaviour is ambiguous (doc 03 §HF-2) |

No Production access, no deploy, no push, no Rules change, no B1/EV-1/P0-auth change.
