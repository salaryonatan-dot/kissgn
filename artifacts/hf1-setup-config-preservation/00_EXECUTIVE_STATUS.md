# HF-1 — Setup Wizard config preservation — Executive Status

| Item | Value |
|---|---|
| Defect | T2: editing a business in the Setup Wizard overwrote `biz:{bizId}:config` and silently deleted `employees`, `pettyCashCategories`, legacy region/checklist settings and any other key. Classified P0 (permanent silent data loss; pilot blocker) |
| Status | Original candidate `95d20d86` → Codex **CHANGES_REQUIRED** (HF1-F1 P0 non-atomic stale config write, HF1-F2 P1 stale selection across the sequence, HF1-F3 P2 security narrative). **R1 successor** (this commit, sole parent `95d20d86`) implements the remediation contract — docs 08–11 |
| Base | `05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661` — the Codex-APPROVED P0 scheduled-auth release candidate (P0_AUTH / RELEASE_MANIFEST / DEPLOYMENT_SEQUENCE: APPROVED, 2026-09-29), parent `f5d0a8ed` (approved P0 chain). Its `index.html` blob `b9c5f220…` equals the one the approved release manifest pins |
| Branch / worktree | candidate: `claude/hf1-setup-config-preservation` / `…/kissgn-hf1-setup-config-preservation` (unchanged); **R1: `claude/hf1-remediation-r1` / `/Users/yonatan/Documents/marjin/kissgn-hf1-remediation-r1`** |
| Files changed | candidate: `index.html` (+71/−1), new test file (23 tests), this folder. R1 on top: `index.html` (helper block + edit-mode `onComplete` + one `useRef`), the test file (harness + 28 scenarios, 3 expectations re-specified — doc 10), this folder (05 corrected, 08–11 added, superseded notes) |
| Reproduction | the new suite at the base: **4 pass / 19 fail** (employees, categories, nested and unknown keys lost; malformed config overwritten; `lat: null` added) — doc 01 |
| After the fix (candidate) | focused 23/23; full suite 988/988; tsc 22 × TS2742 |
| After R1 | focused **51/51** (23 + 28 mandatory scenarios; candidate 21/30, base 3/48); full suite **1016/1016** (988 + 28); P0 scheduled-auth 138/138; tsc 22 × TS2742 only; `index.html` blob `1055bedc…` |
| Release note | HF-1 changes the `index.html` blob. It is **not** part of the approved P0 release candidate; including it needs a separate decision and a manifest update re-pinned to the **R1** client blob (doc 11). The original candidate's blob `f2007386…` is superseded |
| HF-2 (`resolveCredit`) | **DOCUMENTED, not implemented** — intended behaviour is ambiguous (doc 03 §HF-2) |

No Production access, no deploy, no push, no Rules change, no B1/EV-1/P0-auth change (candidate and R1).
