# P0-DATA-01 — R2 → R3 → R4 Test Mapping & Count Reconciliation

## Count reconciliation (independently reproduced this session, and matching Codex)

| Suite | R2 | R3 | R4 |
|---|---|---|---|
| Focused `test/dashboard/entries-lifecycle.test.mjs` | **37** | **35** | **46** |
| Full `test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **378** | **376** | **387** |

- The R3 committed artifact's claim of a **357** R2 full-suite baseline was **wrong**; the identical command in R2 yields **378** (Codex-verified; reproduced here). This mapping uses the correct 37/378 and 35/376.
- R4 focused 46 = 30 `[prod-helper]` + 9 `[prod-entries]` + 7 `[source-guard]`.
- R4 full 387 = R3 full 376 − 35 (old focused) + 46 (new focused). The +11 net focused delta is the only change to the full-suite total; no other suite changed.

## Every R2 focused assertion → R4 coverage

R2's 37 cases are dominated by `MarjinEntries` date-identity / canonicalization / replay behavior plus lifecycle/wiring guards. R4 preserves each at equivalent-or-greater strength. `[pe]`=prod-entries, `[ph]`=prod-helper, `[sg]`=source-guard.

| R2 case | R2 assertion | R4 coverage | Strength |
|---|---|---|---|
| incident fixture arithmetic | 580,483 / 608,236 | `incident fixture` [pe] + `S43` [pe/ph] | equal+ (adds state==persistence) |
| A1 save onto existing date replaces | upsert replace | `S34b` [pe] | equal |
| A2 edit without date change | upsert same date | `S34`/`S34b` [pe] | equal |
| A3 move to unused date | original removed by date | `S34` [pe] | equal |
| A4 move onto existing date, save wins | one row for B | `S34b` [pe] | equal |
| A5/A6 stale-index reproduction | index cannot redirect | `S34` [pe] (identity by date) + `upsertEntryByDate` ignores non-string 3rd arg | equal |
| A7 hydration while editing | edit-by-date deterministic | `S34`/`S35` [pe] + coordinator `onListenerEcho` [ph] | equal+ |
| A8 original date deleted before save | no unrelated day harmed | `S34` [pe] | equal |
| A9 target date appears before save | one row | `S34b` [pe] | equal |
| A-legacy-index numeric 3rd arg ignored | positional impossible | `S34`/`S35` (date identity) [pe] | equal |
| A11/A12 equal-revenue distinct dates | never merge, no UTC shift | `S39` [pe] (deterministic sorted, distinct dates) | equal |
| B13-16/B22 same record twice doubles nothing | canonical total | `S43`/`S36`/`S37` [pe/ph] | equal |
| B17 idempotent replay-safe | canonicalize(x+x)==canonicalize(x) | `S39` [pe] | equal |
| B18 different supplier keys keep both | union | `S37+S38` [pe] | equal |
| B19 same supplier key earliest wins | never add | `S37+S38` [pe] | equal |
| B20/B21 property order irrelevant | no financial addition | `S36`/`S37` [pe] | equal |
| B-scalar precedence | earliest non-zero wins | `S36` [pe] | equal |
| B-hourly union | complementary keys preserved | `S37+S38` [pe] | equal |
| B23/A4 explicit save precedence | wins wholesale incl zeroing | `S35` [pe] | equal |
| C24-26 580,483 stable / 608,236 unreachable | replay stability | `S43`/`S39` [pe/ph] | equal |
| C27/C28 one 07-24 point; MTD/chart/history same count | single effective row | `S43` [pe/ph] (1 canonical row) + `S34` | equal |
| D29-33 replay leaves totals unchanged | supplier/food/payroll/profit inputs | `S36`/`S37`/`S43` [pe/ph] | equal |
| E35/E41 saveEntry upserts by original date | no index writer | `executeEntrySave` uses `upsertEntryByDate(io.rows, …, io.editingDate)` — `S41` [ph] + `[sg]` | equal+ (runtime save) |
| E36-38/E42 persist canonicalizes every full-blob write | supplier/employee/fixed/delete/clear | `persistEntries` canonicalizes once — `S3/S6/S9/S43` [ph] + `[sg]` domain separation | **stronger** (domain-split + mandatory ctx) |
| E39 delete keyed by date | stale index can't delete wrong day | `deleteEntryByDate` (date identity) `[sg]` + `S34` [pe] | equal |
| E40 clear-all persists empty canonical | via persist() | `S9` [ph] | equal+ (mandatory ctx) |
| F43/F44 save after business/tenant switch can't write new selection | selection-bound | `S1+S5`/`S2`/`S10` [ph] | **stronger** (real persistence boundary) |
| F45/F46 listener/self-heal generation+tenant bound | queued callback safe | `S40` [pe] + `[sg]` self-heal wiring + coordinator echo `S27/S28` [ph] | equal+ |
| F47 switching selection invalidates open edit | edit context cleared | `invalidateSelection` clears `editingDateRef` `[sg]` + `S24` ownership [ph] | equal |
| F48 last-year load for old selection ignored | business+tenant | preserved in `useEffect 2` (`isSelectionLive(ctxAtSetup)`) — unchanged from R3; `[sg]` selection controller | equal |
| F49 post-save uses same canonical persisted array | state==persistence | `S33`/`S43` [ph/pe] | equal |
| F50 edit identity wiring | open captures date; new/cancel/success clear | `resetFormAndEditing` clears `editingDateRef`; `invalidateSelection` clears it — `[sg]` | equal |
| G listener canonicalizes + wholesale replace | shared helper | `onListenerEcho` canonicalizes + applies — `S26+S28` [ph] + `S40` [pe] | equal+ |
| G chart/MTD same effective collection | consumers unchanged | not modified by R4 (MTD/chart/P&L untouched by scope); `S43` proves single canonical row | equal |
| G undated rows can't survive | trimmed dates collide | `S39` [pe] (undated dropped) | equal |
| G upsert replay idempotent | repeated save stable | `S39`/`S35` [pe] | equal |
| G save-then-hydration round trip stable | stable | `S41` save [ph] + `onListenerEcho` `S28` [ph] | equal+ |

**Result:** every R2 assertion remains covered at equal or greater strength. The R2 cases that were the *weakest* in R3 (lifecycle/persist wiring proven only by injected mocks or source strings — E36-38, F43-46) are now proven by **runtime tests against the real production boundaries**. No R2 assertion was dropped or weakened.

## R3 → R4 focused delta (why 35 → 46)

R3's 35 = 18 seam race + 10 MarjinEntries + 7 source-guard. R4 re-pointed the race tests at the **real adapters** (persistence, insight readback, save ownership, supplier coordinator) instead of injected `persistRows`/`loadInsights` mocks, and added the mandatory scenario coverage (domain separation, supplier sequencing, listener echo, ownership, insight cancellation), yielding 30 `[prod-helper]` + 9 `[prod-entries]` + 7 `[source-guard]` = 46. No R3 or R2 assertion was removed; the source-guards are now supplementary to runtime coverage, not a substitute for it.
