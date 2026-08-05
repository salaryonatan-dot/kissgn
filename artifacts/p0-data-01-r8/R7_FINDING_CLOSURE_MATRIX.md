# P0-DATA-01 R8 — P0-DATA-01-R7-FIND-001 Closure Matrix

Production path (all `index.html` → `createEntriesWriteCoordinator`):
- **[owner]** each lane stamped with `{tenantId,bizId,gen}` at creation.
- **[wl]** `writingLane` records the exact in-flight write's lane.
- **[gate]** `onListenerEcho` defers only on `laneOwned && (writing && writingLane===ln || desiredRev>attemptedRev)`.
- **[iso]** old write settles against its own `writeLane` only.

| # | Scenario | Event order | Production path | Test | Expected | Actual classification | Actual state | Closes FIND-001 |
|---|---|---|---|---|---|---|---|---|
| 1 | Old success isolation | dispatch T1/A (in flight) → switch T2/B → T2/B initial → old cb → ack old | [owner][wl][gate][iso] | `R8-1` | applied; old stale; no mutation | applied / stale | hydrated=4321; desired unchanged after ack; no T2/B persist | Yes |
| 2 | Old failure isolation | same but fail old | [gate][iso] | `R8-2` | applied; old cleanup only | applied | desired unchanged; ownPending 0 | Yes |
| 3 | Cross-tenant same biz | T1/A→T2/A while pending | [owner][gate] | `R8-3` | applied | applied | hydrated=222 | Yes |
| 4 | Same tenant diff biz | T1/A→T1/B while pending | [owner][gate] | `R8-4` | applied | applied | hydrated=333 | Yes |
| 5 | Switch away-back | T1/A→T2/B→T1/A (new gen) while pending | [owner][wl][gate] | `R8-5` | applied | applied | hydrated=444 | Yes |
| 6 | Different payload | pending-switch, T2/B payload ≠ old | [gate] | `R8-6` | applied (not fp-gated) | applied | hydrated=999 | Yes |
| 7 | Old completion after hydration | apply T2/B → complete old | [iso] | `R8-7` | current unchanged | — | desired/render/persist/transports unchanged | Yes |
| 8 | New-lane pending intent | old in flight → T2/B local edit → external | [owner][gate] | `R8-8` | deferred; converge local | deferred_pending_local | persisted B=777 (local won) | Yes (preserves 5) |
| 9 | Same-gen own echo | local-before-ack current lane | [owner][gate] | `R8-9` | ignored_own_echo | ignored_own_echo | — | N/A (preservation) |
| 10 | Scoped deferred payload | defer T1/A ext → switch → complete old | [iso] | `R8-10` | no cross-lane replay | — | T2/B desired null; no extra apply | Yes |
| 11 | Old vs newer marker | old in flight → T2/B write queued → complete old | [wl][iso] | `R8-11` | current marker intact | — | ownPending≥1; persisted B=2 | Yes |
| 12 | Superseded revisions | two same-lane revs incl identical fp | [gate] | `R8-12` | newest wins; not blacklisted | ignored_own_echo then applied | persisted 200 | N/A (regression) |
| 13 | Invalidation during pending | T1/A pending → invalidate → old cb | [owner][gate] | `R8-13` | fresh lane; old stale | stale | pendingLocal false; desired null | Yes |
| 14 | No pending intent | fresh live lane → external | [gate] | `R8-14` | applied | applied | hydrated=321 | N/A (baseline) |

Closure is asserted on classification AND observable state (rendered entries via
`applyRows`/`last()`, active lane `desired`/`pendingLocal`/`owner` via `_state()`,
persisted destination `store["biz:*:entries"]`, transport count/ordering, marker
count, absence of cross-tenant/business/generation mutation). See
`ADVERSARIAL_PROBES.md` for the R7→R8 negative control.
