# 07 — Interaction with the A-G6 Preview Proof

**Recommendation: BOTH** (negative evidence before, positive evidence after). **Nothing was deployed.**

The two changes answer different questions:
- **A-G6:** is `/fincore/v1/*.js` served as JavaScript despite the catch-all? The rule "the filesystem wins" makes a PASS likely.
- **This hardening:** does that same rule serve files that should never be public? And does `.vercelignore` stop it?

## Plan (both runs are Preview-only; CTO authorization CT-3, extended)
| Run | Deployed tree | Adds to the A-G6 procedure | Expected |
|---|---|---|---|
| **P-BEFORE** (negative evidence) | `0bcd1753` export, as prepared in `release-integration-fast-path/06` | also GET `/docs/production-readiness/rollback-plan.md`, `/artifacts/p0-data-01/<one file>`, `/test/security/security-context.test.mjs`, `/tools/storage-v2/CANARY_OPERATOR.md`, `/database.rules.json`, `/SECURITY.md`, `/admin.js` (record status, content-type, sha256 = git blob, **no body archive needed**) | each returns 200 with its own bytes ⇒ **exposure mechanism confirmed** on a Preview; fincore PASS/FAIL per A-G6 |
| **P-AFTER** (positive evidence) | `0bcd1753` export **plus this commit's `.vercelignore`** copied into the export directory (so fincore and the allowlist are tested together; record the `.vercelignore` blob) | the same probes + the A-G6 fincore probes + `vercel inspect` function list | every probe of an excluded file returns the **catch-all `index.html`** (200 `text/html`, body sha = `index.html` blob); fincore JS PASS; `index.html`/`landing.html` OK; **12 functions** and 4 crons listed |

**Git-path check:** CLI Previews prove the CLI upload path only. Before promotion, the release commit's Git-integration Preview (created when the release branch is pushed, a separately authorized step) must repeat three P-AFTER probes. This proves `.vercelignore` is honoured by Git builds.

**Pre-check (owner, read-only dashboard):**
- The project has no Ignored Build Step command that uses `git`. The allowlist removes `.git` in builds that honour `.vercelignore`.
- Framework, Output and Root-Directory overrides are unset.

**Order:** P-BEFORE → P-AFTER (they can run in the same session), and only then the Git Preview of the release commit. If P-BEFORE shows excluded-category files are **not** served, the severity in doc 08 drops to P2 and the change remains a defence-in-depth improvement.
