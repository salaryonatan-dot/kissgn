# P0-DATA-01 R2 Test Results

Environment: worktree `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r2` at base 74150537; untracked `node_modules` is a relative symlink to the sibling S0 worktree's install (read-only reuse; nothing installed).

## Pre-edit (baseline at 74150537)
- `node --test test/dashboard/entries-lifecycle.test.mjs` → 16/16 (exit 0)
- Pre-edit reproductions (temp analysis outside the repos, real vm-extracted helper): stale-index deletion of `07-01`/`07-30` reproduced; supplierA 100→200 on identical replay; same-key 100+70→170; `canonicalize(x+x) ≠ canonicalize(x)`. Temp analysis removed afterwards.

## Post-edit
| Command | Result | Exit |
|---|---|---|
| `node --test test/dashboard/entries-lifecycle.test.mjs` | **37 pass / 0 fail / 0 skipped** | 0 |
| `node --test test/finance/vat-invariant.test.mjs` | **5 pass / 0 fail** | 0 |
| `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | **2 files pass / 0 fail** | 0 |
| `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **378 pass / 0 fail** (base 341 + net +37 new/replaced focused tests; no new failure) | 0 |
| `./node_modules/.bin/tsc --noEmit` (plain) | 22 errors — **all TS2742 "not portable"**, every line citing the `kissgn-m1-s0-vat-invariant/node_modules` symlink target; zero non-symlink diagnostics; identical source class passes plain tsc with a real node_modules (recorded in accepted S0 validation) | 2 |
| `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | clean | 0 |
| `git diff --check` | clean | 0 |
| `git diff --name-status 74150537` | `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs` only | 0 |
| `package.json` / `package-lock.json` sha1 | `d3757926…` / `4c267787…` — byte-identical to base | 0 |
| Lint | no lint script configured; none run | — |

Local `npx` was not used (network-fetch risk); the local `node_modules/.bin/tsc` binary was invoked directly.

## Interim failures during development (transparency)
- The S0 VAT diff-guard (scans lines added since 686b435 for persistence tokens) initially flagged a rewritten `deleteEntry` line containing `persist(`. Resolved by keeping the original `deleteEntry` line byte-identical and adding the date-keyed `deleteEntryByDate` wrapper — the guard was not modified or weakened.

## Matrix coverage note
The 37 focused tests cover matrix rows A1–A12 (incl. the stale-index reproductions as behavioral tests), B13–B23, C24–C28, D29–D33, E35–E42, F43–F50 (source-guard + behavioral identity), G51–G56 (via the suites above; D34/G56 formula containment is proven by file containment + the passing VAT/forecast guards). Lifecycle rows F43–F48 are enforced by source guards on the exact runtime code plus behavioral tests of the identity primitives; full browser-session simulation is not possible in the monolithic inline app without building a new harness (out of scope by task constraint).
