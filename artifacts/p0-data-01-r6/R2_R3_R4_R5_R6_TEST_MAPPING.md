# P0-DATA-01 — R2 → R3 → R4 → R5 → R6 Test Mapping & Count Reconciliation

## Counts (independently reproduced; match Codex)

| Suite | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|
| Focused `entries-lifecycle.test.mjs` | 37 | 35 | 46 | 53 | **55** |
| Full glob suite | 378 | 376 | 387 | 394 | **396** |

- R6 focused **55** = ≈44 `[prod-helper]` + 8 `[prod-entries]` + 3 `[source-guard]`.
- R6 full **396** = R5 full 394 − 53 + 55 (net +2 focused; no other suite changed).
- The R3 artifact's "357" R2 baseline was wrong; the true R2 full is 378.

## R5 → R6 focused delta (53 → 55, not reduced)

R6 did NOT reduce the 53. It re-pointed the supplier/coordinator tests at the destination-wide lane
composed with real persistence and a committing store, and added the missing mandatory races:

- **Added/strengthened:** `R6-1` cross-writer supplier+main-save ordering (persisted 999); `R6-2`
  all six intents through the lane; `R6-3` cross-writer transform preservation; `R6-4(success/failure)`
  queued waiter settlement; `R6-5` switch-away-and-back; `R6-6/6b` Firebase local-before-ack;
  `R6-7` complete listener race; `R6-8/8b` convergence + deferred external; `R6-9/9b/9c` supplier
  error ownership; `R6-10/10b` insight null-to-owner; `R6-11(business/tenant/logout/unmount)` save-UI;
  `R6-12` exception composed with executeEntrySave; `R6-13` explicit-tenant storage.
- **Carried at ≥ strength:** `S1-S16`, `S23`, `S29-S43`, `S41/S42/S10`, all `[prod-entries]`.

## R2 assertion preservation

Every R2 date-identity / canonicalization / replay / hydration / explicit-save-precedence / incident
assertion is covered by `[prod-entries]` `S34, S34b/S35, S36, S37+S38, S39, S40, S43` + the incident
fixture — identical helpers, identical or stronger expectations. R2 lifecycle/wiring assertions
(persist canonicalization, selection binding, listener hydration, delete-by-date, clear-all) are
covered at greater strength by R6 `[prod-helper]` runtime tests (the destination lane + real
persistence + committing store). No R2 assertion dropped or weakened.

## Source-guard discipline

3 `[source-guard]` tests assert static wiring only (all writers route through the lane; fingerprint
ownership present, no scalar `expectedEchoes`; supplier ownership / save-UI clear / insight role port
wired). They are supplementary. No mandatory race scenario is closed by a source guard.
