# P0-DATA-01 R4 — Test Results

All runs are local, offline, non-production, in the R4 worktree
(`kissgn-p0-data-01-r4`, branch `claude/p0-data-01-r4-production-lifecycle-hardening`,
HEAD = R4 commit, parent `eed85e23`). No dependency install; no Firebase/RTDB/production/
external API calls; storage and API exercised through deferred stub transports.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **46 pass / 0 fail** |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** (UI 33, P0 54) |
| 4 | `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **387 pass / 0 fail** |
| 5a | `./node_modules/.bin/tsc --noEmit` | 2 | **22 `TS2742`**, all in `src/firebase/refs.ts` — 0 new/different (known symlink-portability set) |
| 5b | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 6 | `git diff --check eed85e23 HEAD` | 0 | clean |
| 7a | `git status --short --branch` | — | tracked clean; untracked = `node_modules` symlink only |
| 7b | `git diff --name-status eed85e23 HEAD` | — | `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs`, `A artifacts/p0-data-01-r4/*` |
| 8 | `package.json` / `package-lock.json` vs R2 | — | **byte-identical** (sha256 `db386420…` / `44f81f5d…`) |

## Focused suite composition (46)

- **30 `[prod-helper]`** — run the real `window.MarjinSaveLifecycle` factories
  (`createPersistence`, `createEntriesWriteCoordinator`, `createSaveOwnership`,
  `createInsightReadback`), `loadExceptionsBound`, and `executeEntrySave` (wired to the
  **real** persistence + insight readback) with deferred storage/API transports and spies.
- **9 `[prod-entries]`** — run the real `window.MarjinEntries` canonicalization/upsert helpers.
- **7 `[source-guard]`** — supplementary static-source wiring assertions on `index.html`.

## Baseline reconciliation (this session, matches Codex VERIFICATION_RESULTS)

- R2 focused **37**, R2 full **378**.
- R3 focused **35**, R3 full **376**.
- R4 focused **46**, R4 full **387** (net +11 focused; no other suite changed).

## TypeScript diagnostic detail

The 22 `TS2742` diagnostics are the pre-existing symlink-portability set, every one in
`src/firebase/refs.ts` ("The inferred type of X cannot be named without a reference to
`.../node_modules/@firebase/database`"). This is identical to the R2/R3 baseline; `--preserveSymlinks`
resolves them and exits 0. No new or different diagnostic category was introduced by R4.

## Incident recomputation (independent, from the R4 helper)

`raw duplicate = 608236`, `canonical = 580483`, `rows = 24`, `july24 = 27753`, `delta = 27753`.
