# P0-DATA-01 R6 — Change Summary

**Branch:** `claude/p0-data-01-r6-destination-lifecycle-convergence`
**Base (R5):** `088310c3bd2d597cc9ed0f6e2e8bcf38568f7d10` (`fix: converge production entry lifecycle`)
**Commit subject:** `fix: unify entries destination lifecycle`
**Changed files:** `index.html`, `test/dashboard/entries-lifecycle.test.mjs`, `artifacts/p0-data-01-r6/` (12). Package/lockfiles byte-identical to R5.

## R5 closure claims Codex invalidated

Codex's R5 review (CHANGES_REQUIRED) proved, with VM probes over the real R5 code:

- **Cross-writer ordering (R3-007):** only supplier edits entered the coordinator; main-save / delete / clear-all / employee-labor called `persistEntries` **directly** and could overlap the same `biz:{bizId}:entries` destination — a direct newer write committed first, an older supplier write committed last, persisted `100` while UI showed `100`/`999`.
- **Queued-edit invalidation (R3-007):** queued revs behind a retired lane were neither dispatched nor settled — waiters `rev2`/`rev3` hung forever.
- **Firebase local-before-ack (R3-007/40):** the scalar `expectedEchoes` incremented **after** ack while the own local echo arrived **before** ack, so a later legitimate external payload was swallowed as `ignored_own_echo`.
- **Supplier error isolation (R3-006):** the lane-local `latest` flag let an OLD-selection result set/clear the CURRENT selection's supplier error.
- **Insight null-to-owner (R3-003):** the once-created `insightUiLoaderRef` closed over the initial `loggedInUser?.role`; a null-role mount that later logged in as owner kept skipping insight loads.
- **Save-UI invalidation (R3-005):** business switch cleared `entrySaveInFlight`, but tenant / logout / unmount did not.

## Implementation (index.html only)

**A. ONE destination-wide entries lane.** `createEntriesWriteCoordinator` rewritten with a generic `submit(op)`: `op.rows` = wholesale REPLACE (main save wins wholesale, clear-all → []), `op.transform(desired)` = map the LATEST desired canonical rows (supplier, labor, delete). EVERY full-blob entries writer now routes through the single lane instance; the raw transport (`persistEntriesRaw`, wired as `io.commit`) is **private to the lane** — no UI/runtime caller invokes it directly. GLOBAL single-flight per destination across generations → logical order wins, newest commits last.

**B. Explicit waiter settlement.** `invalidate()` settles every NOT-YET-DISPATCHED waiter exactly once with `cancelled_selection_changed`; the active write finishes against its captured destination and finalizes only its retired lane. Pending accounting is per-generation and non-negative.

**C. Content-fingerprint echo ownership.** The scalar `expectedEchoes` is removed. Each dispatch registers the canonical payload **fingerprint** BEFORE ack; an echo whose fingerprint matches an unconsumed own record is our own (local-before-ack OR post-ack) → consumed+ignored; a non-matching payload is external — applied when quiescent, **deferred** while a local op is pending, never consumed by a counter. Own fingerprints are bounded (last 16) so an identical FUTURE remote payload is not permanently blacklisted. The listener subscription delegates to `onListenerEcho(val, ctxAtSetup)`; duplicate self-heal runs through the same lane (captured-tenant transport), recognised by fingerprint (no loop).

**D. Supplier error ownership.** New `createSupplierResultOwnership` binds each submission to tenant+business+generation (captured ctx) + operation token + mount. `setSupPayDate` begins a token, submits through the lane, and settles the result through the wrapper — it mutates the visible `supplierWriteError` only if mounted, ctx still live, and the token still current. Old-selection / superseded / unmounted results cannot touch the current error.

**E. Insight role lifecycle.** A `insightRoleRef` is updated every render; the once-created insight loader's `candidatesReady` reads `insightRoleRef.current` at CALL time, so null→owner login re-enables loads on the same instance.

**F. Save-UI across all invalidation paths.** `createSaveUiRunner` gains `mounted`, `clearInFlight()`, and `unmount()`. `invalidateSelection` clears the observable `entrySaveInFlight` (and supplier error) for the still-mounted UI on business/tenant/logout; the unmount effect calls `runner.unmount()` + `supplierOwnership.unmount()` BEFORE invalidating, so no post-unmount React state update occurs. Same-selection double-submit stays blocked; nav timers stay selection-bound.

**G. Exception ownership composed with save.** Tests compose the real `createExceptionOwnership` store with `executeEntrySave` for T1/A vs T2/A op-ID isolation and replay safety (production wiring already routes op-IDs/state through the store and invalidates it on selection change).

## Preserved
R2 date-identity/replay/canonicalization; explicit-save-wins-wholesale; VAT/forecast/food-cost/labor/fixed/profit formulas; RTDB schema/paths/Rules; structured-exception API. Incident canonical **₪580,483** reproduced from the R6 helper.
