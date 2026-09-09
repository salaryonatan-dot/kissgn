# R10 final candidate — change summary

Branch `claude/p0-data-01-r10`, base `b854054cce5d27dcef7a2a442c15e32eadca20f3` (R9).
Worktree `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10`.

This round takes the previously uncommitted R10 body and adds four things: real-emulator
validation of its central claim, the L-GAP-1 labor UI fix, the D-GAP-1 duplicate-delete
path, and a repair of the git-context assumption that was failing the VAT S0 guard.

## Runtime — `index.html` only

| Change | ID | What |
|---|---|---|
| Labor result propagation | **R10-GATE-014** | `setDailyLabor` now binds the typed result of `submitLaborEntry` and routes every non-commit outcome through the production `describeSaveOutcome`; `EmployeesScreen` renders an operator-facing banner (`data-testid="labor-save-error"`); a commit clears it. Previously the result was awaited and discarded and the screen had no error surface at all. |
| Two precise refusal texts | **R10-GATE-014** | `describeSaveOutcome` gained `reason === "ambiguous_date_requires_id"` (duplicate business date) and `status === "invalid_date"`. Both previously fell through to catch-all text. Additive: no existing branch changed. |
| Duplicate rows visible and deletable | **R10-GATE-015** | The dashboard day list keeps only the first row per business date, so a row R10 deliberately preserves was invisible. A `dupExtras` map now collects the rows beyond the first for the displayed month, and the day card lists each one with a single-row delete that calls `deleteEntryById(dup.id)` behind an explicit `window.confirm`. |

Nothing else in runtime changed: no destination routing, no identity or collision
semantics, no conflict detection, no retry or re-base behaviour, no clear-all
confirmation ownership, no Rules, no configuration, no dependency, no migration and no
repair path. `git diff --numstat` for `index.html`: **+765 / −212** against `b854054`,
of which +700/−211 is the pre-existing uncommitted R10 body.

## Tests and harnesses

| File | State | Purpose |
|---|---|---|
| `test/emulator/entries-remote-atomic-emulator.mjs` | new, 604 lines | 16-case validation of the production write path against a REAL local RTDB emulator, including the R9 negative control. Deliberately not `*.test.mjs`. |
| `test/dashboard/entries-labor-screen.test.mjs` | new, 250 lines | 14 tests driving the RENDERED daily-labor `onChange` end to end to a visible UI state (L-GAP-1). |
| `test/dashboard/entries-duplicate-delete.test.mjs` | new, 177 lines | 10 tests driving the RENDERED duplicate-row delete button (D-GAP-1). |
| `test/support/git-context.mjs` | new, 87 lines | Resolves this working tree's git context at run time so a relocated checkout cannot make a guard fail for the wrong reason. |
| `test/support/ui-call-site-harness.mjs` | extended | Two new production extractors (`jsxAttrExpression`, `jsxAttrOnTag`) and two new call sites (`laborScreen`, `dupDeleteOnClick`), plus the `laborSaveError` state spy. Existing extraction and cases untouched. |
| `test/finance/vat-invariant.test.mjs` | +9 / −3 | Invokes git through the resolved context instead of bare `spawnSync`. **Every assertion is unchanged.** |
| `test/emulator/README.md` | +51 | How to run the new validation, and the JAR-cache note. |
| `test/dashboard/entries-{lifecycle,ui-call-sites,concurrency-matrix,clear-all-matrix,topology-sentinel,remote-atomic,id-contract}.test.mjs`, `test/support/{cross-writer-harness,entries-id-offline-transformer}.mjs`, `artifacts/p0-data-01-r10/` | pre-existing R10 body | Unchanged in this round except `entries-lifecycle.test.mjs`, which carries the Gate 4 conversion already recorded in `R9_FINDINGS_CLOSURE.md`. |

## Worktree git identity — repaired

`kissgn-p0-data-01-r10/.git` and its admin `gitdir` both named a dead sandbox mount path
from the session that produced R10, so plain `git` failed from inside the worktree.
Both were restored to the host paths, matching `…-r8` and `…-r9`. This is a metadata
repair; no tracked file was affected.

## Not done, deliberately

No push, no merge, no rebase, no cherry-pick, no deploy, no Production or Preview RTDB
access, no backfill, no migration, no cron, no email, no credential, role or permission
change, no dependency change, and nothing touched in the Codex weekday worktree or the
stale Desktop clone.
