# P0-DATA-01 R7 — R6-FIND-001 Closure Matrix

Every required case maps to production code, an executable test, and its result.
Production path (all in `index.html` → `createEntriesWriteCoordinator`):
- **[create]** dispatch marker `{ tenantId, bizId, gen, fp, rev }` from write ctx.
- **[consume]** `onListenerEcho` scoped match (tenant+biz+gen+fp) after liveness gate.
- **[stale]** liveness gate returns `stale` before any mutation.
- **[retire-fail]** failed write removes only its own marker.
- **[retire-inval]** `invalidate()` retires non-current-destination markers.

| # | Required case | Production path | Executable test | Expected | Actual | Closes R6-FIND-001 |
|---|---|---|---|---|---|---|
| 1 | Same payload T1/A → T2/B hydrates (not own echo) | [create]+[consume]+[retire-inval] | `R7-1` | `applied`, hydrated | `applied`, hydrated | Yes |
| 2 | Same payload T1/A → T2/A hydrates (new tenant) | [create]+[consume] | `R7-2` | `applied` | `applied` | Yes |
| 3 | Same payload T1/A → T1/B hydrates (new business) | [create]+[consume] | `R7-3` | `applied` | `applied` | Yes |
| 4 | Switch T1/A → other → T1/A: new generation hydrates | [create]+[consume]+generation isolation | `R7-4` | `applied` | `applied` | Yes |
| 5 | Delayed old-context echo rejected as stale; no active mutation | [stale] | `R7-5` | `stale`, no apply | `stale`, no apply | Yes |
| 6 | Same-generation local-before-ack own echo preserved | [create]+[consume] | `R7-6` (+ R6-6/6b/7/8) | `ignored_own_echo` | `ignored_own_echo` | N/A (preservation) |
| 7 | One destination's marker not consumed/cleared by another | [stale]+[consume] | `R7-7` | foreign `stale`; own still `ignored_own_echo` | as expected | Yes |
| 8 | Failed write retires only its own scoped marker | [retire-fail] | `R7-8` | ownPending 1→0; later echo `applied` | as expected | Yes |
| 9 | Identical fingerprints across dest/gen stay isolated | [create]+[consume]+[stale]+[retire-inval] | `R7-9` | own `ignored_own_echo`; straggler `stale`; ownPending 0 | as expected | Yes |
| 10 | Two-edit ordering + persisted-supplier ordering remain green | [create]+[consume] | `R7-10` (+ R6-1/7, S29/S30/S31) | newest wins; own ignored; different applied | as expected | N/A (regression) |

Closure is asserted on BOTH classification value AND observable state (rendered
entries via `applyRows`, persisted destination, `ownPending` count via `_state()`,
absence of cross-destination mutation) — not on green legacy tests alone, and not
on source-string assertions alone. See `ADVERSARIAL_PROBES.md` for the negative
control proving the same scenario fails on R6 and passes on R7.
