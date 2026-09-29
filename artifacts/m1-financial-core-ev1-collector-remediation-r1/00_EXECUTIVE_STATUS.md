# EV-1 collector — Codex remediation R1: executive status

| Item | Value |
|---|---|
| Parent (reviewed candidate) | `19ae5eb49b9bd75e7fcf9a50b5ff2af903c355b8` |
| Branch | `claude/m1-financial-core-ev1-collector` |
| Review closed | `~/Documents/marjin-reviews/2026-09-29/codex-ev1-collector-rereview/` (CHANGES_REQUIRED: P1, P2) |
| P1 unclassifiable rows | **CLOSED**: any unclassifiable row ⇒ `rows_unclassifiable` failure + invariant I20 false ⇒ `evidenceComplete: false`; `--verify` recomputes it |
| P2 bundle closure | **CLOSED**: `--verify` requires the directory to contain exactly the four manifest files as regular files; any other entry fails |
| GCLOUD env policy | **RELAXED** exactly as recommended in Codex re-review 04 (`GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` only) |
| Files changed | `tools/finance-core/ev1-collector.mjs`, `tools/finance-core/ev1-preflight.mjs`, `test/finance/ev1-collector.test.mjs`, 4 prior artifacts (02, 03, 05, 07) updated in place for accuracy, 6 new artifacts in this folder |
| Not changed | classifier, transport, scope enumeration, read accounting, network surface, IAM guard, runtime code, Rules, packages |
| Tests | focused 49/49 (collector 40 = 25 + 15 new, classifier 9); full suite 1198/1198 (baseline 1183 + 15) |
| Typecheck | 22 × TS2742 in unchanged `src/firebase/refs.ts`, identical to baseline; 0 other |

EV-1 was **not** executed. No Production access, no credential access, no push, no deploy.
