# P0-DATA-01 Test Results

Validation ran in `/Users/yonatan/Documents/marjin/kissgn-p0-data-01` at the committed tree.

## Before editing (baseline at b16f5567)
- VAT invariant: 5/5 · forecast: 2/2 files · full suite: **341/341** · tsc: exit 0

## After editing
| Command | Result |
|---|---|
| `node --test test/dashboard/entries-lifecycle.test.mjs` (focused P0) | **16 pass / 0 fail** |
| `node --test test/finance/vat-invariant.test.mjs` | **5 pass / 0 fail** |
| `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | **2 files pass / 0 fail** |
| Full suite `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **357 pass / 0 fail** (341 baseline + 16 new; no new failure) |
| `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | exit 0 |
| `git diff --check` | clean |
| Changed files | `index.html` (M), `test/dashboard/` (new), `artifacts/p0-data-01/` (new) — nothing else |
| `package.json` / `package-lock.json` | sha1 unchanged (`d3757926…` / `4c267787…`) — no dependency change |
| Lint | no lint script configured in `package.json`; none run |

## Key assertions proven by the focused tests
- Incident fixture stays **₪580,483** under: re-save of 2026-07-24 (upsert), raw doubled payload (canonicalize), full doubled blob — **₪608,236 is unreachable**.
- Exactly one 2026-07-24 row reaches the month view; 2026-07-24 and 2026-07-25 never merge; equal revenue on two dates is kept twice.
- Explicit save wins wholesale (documented precedence, incl. zeroing); legacy merge never sums revenue; supplier payments sum per supplier.
- Round-trip save→hydration is stable; canonicalization and upsert replay are idempotent; undated rows can't enter the collection.
- Source guards: no index-based append/replace remains in `saveEntry`; listener uses the shared canonicalizer; `persist` canonicalizes before every write; effect cleanup unsubscribes; stale-business guards present; chart+MTD share `monthEntries`.

## Environment notes (full transparency)
- `node_modules` is an untracked relative symlink to the sibling S0 worktree's install (no install or dependency change was performed). Plain `tsc --noEmit` reports 3 pre-existing-style TS2742 "not portable" errors that are **artifacts of the symlink realpath**, not of this change (the identical source at b16f5567 passes plain `tsc --noEmit` with a real `node_modules`, as recorded in the accepted S0 validation). `--preserveSymlinks` reflects the real project layout and exits 0 both before and after the change.
- The two focused-test failures observed mid-development were cross-realm `deepEqual` artifacts of the vm-extraction harness and were fixed in the test file (JSON normalization), not by weakening any assertion.
