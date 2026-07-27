# P0-DATA-01 R4 — Root Cause & Invariants

## The eight R3 root causes

R3's extracted seam checked liveness after its own awaits, but the **adapters it called** and the **React wrapper around it** did not. The defects lived one layer below the seam.

| Finding | Root cause in R3 | R4 structural fix |
|---|---|---|
| R3-001 | `persist(e,f,ctx)` checked ctx once, then wrote entries and (if `f`) wrote fixed with **no** post-await re-check; path used render-closure `currentBizId`; tenant from mutable global. | `persist` removed. `persistEntries`/`persistFixed` are **single-domain**, derive tenant+key from captured `ctx`, and re-check liveness before dispatch. No entries→fixed multi-write exists. |
| R3-002 | Fixed-expense and employee-labor callers called `persist(...)` with **no ctx**, bypassing the guard. | Every writer captures ctx at the event boundary and calls a domain-specific mandatory-context helper; a missing context is rejected before any request. |
| R3-003 | `loadDashboardInsights`/`readDashboardInsightCandidate` had no captured ctx; `apiGetDailyRange` read `window._currentTenantId`; cancellation checked only **after** the whole candidate loop. | `createInsightReadback.loadRange(ctx,…)` derives identity from ctx and checks cancellation **before and after every candidate await**; `apiGetDailyRange` takes an explicit tenant. |
| R3-004 | `loadExceptionsBound` issued the list request, then checked liveness only after `resp.json`. | A **preflight** `isLive(ctx)` gate precedes URL construction and `apiFetch`. |
| R3-005 | Boolean `entrySaveInFlightRef` was shared across selections; the unconditional `finally` cleared a newer selection's state; `invalidateSelection` did not clear it. | `createSaveOwnership` token (opId+tenant+biz+gen). `finally` clears only if still owning; `invalidateSelection` frees ownership synchronously. |
| R3-006 | Supplier updates passed `fixedList`; entries-success/fixed-failure left state and persistence inconsistent; revert-on-failure discarded a persisted value. | Supplier writes are **entries-only** via the coordinator; failure never regresses; no multi-domain "wholly successful" is ever reported. |
| R3-007 | No per-operation sequence — an older completion overwrote a newer supplier value. | Monotonic sequence in the coordinator; `mySeq === seq` gates any state apply. |
| R3-008 | Tests injected safe `persistRows`/`loadInsights` **mocks around unsafe adapters**; the R2 baseline count was misstated (357 vs the real 378). | Tests execute the **real** production factories with deferred **transports** only; baseline corrected to R2 37/378 · R3 35/376. |

## System-level invariants now enforced

1. **Mandatory immutable selection context** — `{tenantId, bizId, generation}` captured at the event boundary; `persistEntries`/`persistFixed`/`loadRange` reject a missing/partial context before any I/O.
2. **Operation identity where overlap is possible** — save ownership token; supplier operation sequence.
3. **No request after the context is stale** — preflight gates in exceptions, insights, and both persistence helpers; the supplier coordinator's post-await `sel.isLive(ctx)` guard.
4. **Identity from captured context** — storage tenant is `ctx.tenantId` (via `storage.setFor`); storage key is `` `biz:${ctx.bizId}:entries|fixed` ``; insight/exception requests use `ctx.tenantId`/`ctx.bizId`. No production writer reads `currentBizId`/`_currentTenantId` for selection-bound identity.
5. **Liveness/ownership check after every relevant await** — persistence (before dispatch + after write), supplier coordinator (after persist), save seam (after each await), insight loop (before + after each candidate), exception load (preflight + after response + after JSON).
6. **Domain isolation** — an entries action never writes fixed; a fixed action never writes entries. Enforced structurally (separate single-domain helpers) and asserted by tests.
7. **Newer edit wins** — older same-selection completions/failures and older listener echoes can never overwrite a newer value (sequence gate + pending-echo suppression).
8. **Tests execute production boundaries** — the helpers under test are the exact helpers the UI calls; only terminal I/O (storage/API transport, spies, timers) is injected.

## Replay/canonicalization invariants preserved

Explicit save wins wholesale; earliest-non-zero scalar precedence for hydrated duplicates; nested-map key union with earliest value winning; identical nested keys never summed; canonicalization deterministic and idempotent; listener/self-heal write-back stays tenant/selection-bound. Incident canonical total **₪580,483**.
