# R3 Writer & Async Lifecycle Matrix

## Full-blob entry writers (state array vs persisted array)
| Writer | State array | Persisted array | Canonicalization point | Failure behavior | Captured t/b/gen | Verdict |
|---|---|---|---|---|---|---|
| Main daily save (`executeEntrySave`) | `persistResult.canonical` (same ref) | canonical in `persist` | `upsertEntryByDate` + `persist.canonicalizeEntries` | no state change; error msg; op-id kept for replay | yes (ctx captured at start, re-checked each await) | PASS |
| Supplier grid (`applySupplierPaymentBound`) | canonical optimistic, then `res.canonical` | canonical in `persist` | `upsertEntryByDate` before state | revert to previous canonical | yes | PASS |
| Delete (`deleteEntryByDate`) | canonical next / previous canonical | canonical in `persist` | `canonicalizeEntries` before state | revert to previous canonical | yes | PASS |
| Clear-all | `[]` | `[]` (trivially canonical) | n/a (empty) | n/a | current selection (synchronous) | PASS |
| Employee daily labor (`setDailyLabor`) | (persist only) | canonical in `persist` | `upsertEntryByDate` + persist | persist returns not-ok | synchronous keystroke | PASS |
| Fixed-expense handlers (`persist(entries,u)`) | fixedList (not entries) | entries canonicalized in `persist` | `persist.canonicalizeEntries` | persist returns not-ok | synchronous | PASS (entries pass-through canonicalized) |
| Demo hydration | `canonicalizeEntries(demoEntries)` | n/a (local demo) | at setEntries | n/a | invalidates to demo_biz first | PASS |
| Listener self-heal | `canonicalizeEntries(val)` | canonical write-back | in listener | bounded by `live` + tenant | R2 binding preserved | PASS |

## Awaited boundaries in the save seam (each followed by an isLive re-check)
structured exception fetch → json → (stale? return) ; persist → (stale? return) ; rebuild → (stale? return) ; insight readback → (stale? return) ; on failure: onInsightsFailure/suppress only if live ; resetForm/setSaved/scheduleNav only if live. Request bodies (exception set/clear, rebuild) use captured ctx.tenantId/ctx.bizId exclusively.

## Verdict
Every reachable full-blob writer applies only canonical arrays to React state and persists the same canonical array; every async continuation is bound to the originating (tenant, business, generation).
