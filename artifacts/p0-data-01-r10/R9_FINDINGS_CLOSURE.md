# Gate 4 - lifecycle coverage ledger (P0-DATA-01 R10)

Worktree `kissgn-p0-data-01-r10` @ base `b854054` (R9). **NOT COMMITTED.**

`test/dashboard/entries-lifecycle.test.mjs` - **112 tests, 112 pass, 0 fail,
0 cancelled, 0 skipped, 0 todo, 0 unhandled rejections**, verified on three consecutive runs with
no code change between them.

Every test drives the ACTUAL production helpers vm-extracted from `index.html`. Only terminal I/O
is injected - held-open RTDB transactions that commit to a simulated store on resolution, plus
state/ref spies. The lane, its fingerprint echo ownership, waiter settlement, supplier result
ownership, save-UI runner, insight loader, exception store and the remote-atomic mutator under
test are the exact production-used code.

## Disposition summary

| Disposition | Count | Meaning |
|---|---|---|
| PRESERVED | 76 | R6-R9 invariant unchanged by R10; passes against the remote-atomic path with no modification |
| CONVERTED | 32 | the legacy assertion encoded a behaviour R10 deliberately removes; replaced with the R10-correct semantic, individually justified below |
| CORRECTED | 1 | a status-name error introduced by an earlier bulk rename in this track, not a semantic change |
| NEW | 3 | added this gate (R10-GATE-010 observability, plus the `applyLocally:false` premise guard) |

Nothing was deleted, skipped, weakened to a tautology, or routed through a compatibility shim.
Conversion patterns A-E are defined in `_STATUS_CHANGES_STILL_REQUIRED.md` (GATE 4B - COMPLETE).

## Ledger

### R6 - one destination lane

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 1 | [prod-helper] R6-1(R10): supplier + main-save share ONE lane; single-flight; a colliding second CREATE fails closed instead of overwriting | CONVERTED · B | Legacy asserted the later whole-row save won wholesale. R10: the second submission is a CREATE for an id that now exists with different content -> fail-closed `invalid_identity` / `id_collision`, zero remote mutation. Single-flight and ordering preserved. |
| 2 | [prod-helper] R6-1b(R10-GATE-010): describeSaveOutcome presents an id_collision distinctly and stays byte-compatible with a bare status | NEW · R10-GATE-010 | The create-ID collision is presented to the operator as its own actionable message; every legacy status string maps byte-identically in object form. |

### Wiring guards

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 3 | [source-guard] R6-1c(R10-GATE-010): the production save mapping preserves the transformation's precise classification | NEW · R10-GATE-010 | Source guard pinning all four propagation points (mutator -> coordinator -> save-UI adapter -> message mapper). |

### R6 - one destination lane

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 4 | [prod-helper] R6-2: supplier/main-save/delete/clear/labor/self-heal all route through the ONE lane | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 5 | [prod-helper] R6-3(R10): patches build on the LATEST authoritative row — different suppliers + labor all preserved; a later field patch never drops them | CONVERTED · C | Patches build on the latest AUTHORITATIVE row inside the transaction rather than on a client snapshot. |
| 6 | [prod-helper] R6-4(success): rev1 active, rev2/rev3 queued, invalidate → rev2/rev3 settle cancelled exactly once; no stale UI | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 7 | [prod-helper] R6-4(failure): rev1 active, rev2/rev3 queued, invalidate → rev2/rev3 settle cancelled exactly once; no stale UI | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 8 | [prod-helper] R6-5(R10): switch-away-and-back to T1/A — the new write waits behind the old physical write and can only commit re-based | CONVERTED · B | The re-selected generation edited from a base predating the OLD commit -> `conflict` with exact `conflictPaths`, committed value intact, then commits re-based. Cross-generation single-flight ordering preserved unchanged. |
| 9 | [prod-helper] R6-6(R10): a pre-ack payload is deferred (never consumed as own); the post-commit own echo is ignored; external 999 AFTER ack is applied | CONVERTED · A | Pre-ack payload is deferred and retained (never consumed as own); the true post-commit own echo is `ignored_own_echo`; a later external payload still applies. |
| 10 | [prod-helper] R6-6b: two serialized writes with local-before-ack echoes; two later external payloads both apply | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 11 | [prod-helper] R6-7(R10): 100 → 200 (correctly re-based) → own-echo(200) → delayed own-echo(100); final UI/persisted 200 | CONVERTED · B | The second edit now declares the base the first establishes (a correctly re-based sequential UI edit); both own echoes, newest and delayed-older, are still identified and ignored. |
| 12 | [prod-helper] R6-8: external payload after quiescence applies; an identical FUTURE remote payload is not permanently blacklisted | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 13 | [prod-helper] R6-8b: an external non-matching payload while a local write is pending is DEFERRED (never consumed as own) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 14 | [prod-helper] R6-9: supplier error ownership — latest live failure sets; older/old-selection results cannot touch current error; owned success clears | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 15 | [prod-helper] R6-9b: old-selection result after invalidation cannot set/clear the NEW selection's error | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 16 | [prod-helper] R6-9c: unmount → no supplier error mutation | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 17 | [prod-helper] R6-10: SAME loader instance created with null role; after role→owner it issues the request | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 18 | [prod-helper] R6-10b: owner loader, invalidate before/after readback → zero stale setter mutations | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 19 | [prod-helper] R6-11(business): invalidation clears the OBSERVABLE in-flight flag; new selection can save; old finally cannot clear new | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 20 | [prod-helper] R6-11(tenant): invalidation clears the OBSERVABLE in-flight flag; new selection can save; old finally cannot clear new | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 21 | [prod-helper] R6-11(logout): invalidation clears the OBSERVABLE in-flight flag; new selection can save; old finally cannot clear new | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 22 | [prod-helper] R6-11(unmount): after unmount the runner performs NO setInFlight; double-submit still blocked | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 23 | [prod-helper] R6-12: exception op-ID isolation composed with executeEntrySave — T1/A and T2/A same date get isolated op IDs | CONVERTED · C | `createPersistence.persistEntries` is gone; the compose harness drives the real `createRemoteEntriesMutator` over a committing store. |
| 24 | [prod-helper] R6-13: storage.setFor writes under captured tenant, {_v} envelope, no call on missing tenant | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### Carried-forward save / persistence / exception / readback

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 25 | [prod-helper] S9: clear-all writes entries with mandatory context (persisted []) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 26 | [prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted | CONVERTED · B | Two suppliers are DISJOINT absolute paths on one row, so the second transaction rebases onto the first commit - one physical row, patched twice, never replaced. |
| 27 | [prod-helper] S30: older FAILURE cannot roll back newer success (persisted 200) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 28 | [prod-helper] S31(R10): LATEST failure reported latest:true; no phantom value is rendered for a write that never committed | CONVERTED · no-optimistic-apply | Legacy asserted the optimistically applied 200 stayed rendered after its write failed. R10 renders only committed values; revision accounting (`latest:true` on the newest) is preserved. |
| 29 | [prod-helper] S32/S33(R10): duplicate business DATES with distinct ids are PRESERVED and independently addressable; state == persisted | CONVERTED · D | Duplicate business DATES with distinct ids are preserved and independently addressable; only the addressed id is patched. |
| 30 | [prod-helper] S23: production save runner blocks a same-selection double submit | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 31 | [prod-helper] applySupplierWriteResult pure mapping (latest-gated) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 32 | [prod-helper] S3(R10): a mutation with missing context is rejected before any transaction | CONVERTED · C | Missing context is refused before any transaction is opened. |
| 33 | [prod-helper] S4(R10): the transaction key is built from the CAPTURED ctx.bizId | CONVERTED · C | The transaction key is built from the captured ctx.bizId. |
| 34 | [prod-helper] S1+S5(R10): the transaction carries the CAPTURED tenant T1; switching to T2/B issues no later write for the retired selection | CONVERTED · C | R10 has no `staleAfterWrite` flag - there is no blind write left to report on. Not-committed is not success, and the retired ctx is refused before any transaction. |
| 35 | [prod-helper] S2: same biz id under new tenant rejected | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 36 | [prod-helper] S8: persistFixed writes ONLY the fixed key | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 37 | [prod-helper] S6/S7: persistEntries writes ONLY the entries key (supplier + labor domain separation) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 38 | [prod-helper] S15: already-stale loadExceptionsBound sends zero requests | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 39 | [prod-helper] S16: context stale during fetch applies nothing | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 40 | [prod-helper] S15b: live context issues one request and applies | CORRECTED | `onListenerEcho` legitimately returns `applied`; an earlier bulk rename in this track over-applied `committed` here. |
| 41 | [prod-helper] S11: first candidate deferred, invalidate, not found → no second request | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 42 | [prod-helper] S12: logout T1/login T2 same biz id — no second request | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 43 | [prod-helper] S13: every insight request uses captured tenant/business | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 44 | [prod-helper] S41: normal same-context save succeeds exactly once (real persistence+readback) | CONVERTED · C | Real mutator plus committing store; the single transaction is asserted on `biz:A:entries`. |
| 45 | [prod-helper] S42: delayed navigation scheduled with the captured live ctx | CONVERTED · C | Same rewiring; navigation-scheduling assertions unchanged. |
| 46 | [prod-helper] S10: a save whose selection changes mid-flight mutates nothing in the new selection | CONVERTED · C | The gated in-flight step is now the remote transaction rather than a blind storage write. |

### MarjinEntries domain (preserved R2 behaviour)

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 47 | [prod-entries] incident fixture arithmetic exact (608,236 / 580,483 / 27,753) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 48 | [prod-entries] S43(R10): duplicate incident rows aggregate to 580,483 for DISPLAY; the authoritative node is never rewritten by canonicalization | CONVERTED · D | Display-side aggregation still yields 580,483, but the authoritative node is never rewritten by canonicalization - both physical rows survive a patch to one id. |
| 49 | [prod-entries] S34: date-move edit keeps ONE row for the final date | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 50 | [prod-entries] S34b/S35: edit onto existing date / explicit save wins wholesale | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 51 | [prod-entries] S36: earliest-non-zero scalar precedence (never summed) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 52 | [prod-entries] S37+S38: nested map union earliest-wins; same keys never summed | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 53 | [prod-entries] S39: canonicalization deterministic/idempotent; undated dropped | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 54 | [prod-entries] S40 (behavioral): duplicate hydration merges to one canonical row | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### Wiring guards

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 55 | [source-guard] every entries writer routes through the ONE lane; the blind full-node entries write no longer exists | CONVERTED · wiring | Clear-all is now `submitClearAll` carrying the confirmed complete-content fingerprint; the wholesale-replace path, its `allowDrop` options-boolean and the full-node writer are all gone. |
| 56 | [source-guard] coordinator own-echo ownership is destination+generation scoped (R7; no scalar expectedEchoes) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 57 | [source-guard] supplier caller delegates to result ownership; save-UI + supplier error cleared on invalidation; unmount marks ports dead | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### R7 - destination+generation scoped echo ownership

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 58 | [prod-helper] R7-1: identical payload T1/A → T2/B hydrates the NEW destination (not ignored_own_echo) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 59 | [prod-helper] R7-2: identical payload T1/A → T2/A hydrates the NEW tenant | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 60 | [prod-helper] R7-3: identical payload T1/A → T1/B hydrates the NEW business | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 61 | [prod-helper] R7-4: switch T1/A → T2/B → back to T1/A — the NEW generation hydrates | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 62 | [prod-helper] R7-5: a DELAYED echo from an old listener context is stale and cannot mutate the active destination | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 63 | [prod-helper] R7-6(R10): a pre-ack payload is safely deferred; the real post-commit own echo is still ignored_own_echo | CONVERTED · A | Pre-ack deferral plus post-commit own-echo suppression (first exemplar of Pattern A). |

### Wiring guards

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 64 | [source-guard] R7-6b: local pre-ack echoes are suppressed at the transport (applyLocally:false) | NEW · source guard | Pins `{ applyLocally: false }` so Pattern A's premise cannot silently regress. |

### R7 - destination+generation scoped echo ownership

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 65 | [prod-helper] R7-7(R10): a foreign-destination listener cannot consume or clear the T1/A marker; the true post-commit own echo still lands | CONVERTED · A | A foreign listener cannot consume or clear the marker; the marker survives and is consumed only by its own destination's COMMITTED echo. |
| 66 | [prod-helper] R7-8: a FAILED write retires ONLY its own scoped marker; a later identical remote payload is not blacklisted | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 67 | [prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership | CONVERTED · A | Ownership isolation asserted on the committed T2/B value; a straggler carrying the old T1/A context is stale. |
| 68 | [prod-helper] R7-10(R10): two-edit ordering preserved with scoped echoes — a same-base second edit conflicts, then wins once re-based | CONVERTED · B | Same-base second edit conflicts, then wins once re-based; own echo scoped-consumed, a genuinely different remote payload still hydrates. |

### R8 - pending-write isolation

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 69 | [prod-helper] R8-1: old T1/A write in flight → T2/B initial payload hydrates; old success cannot mutate T2/B | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 70 | [prod-helper] R8-2: old write in flight → T2/B hydrates; old FAILURE cleanup affects only old ownership | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 71 | [prod-helper] R8-3: cross-tenant same business — T1/A→T2/A while old write in flight hydrates | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 72 | [prod-helper] R8-4: same tenant different business — T1/A→T1/B while old write in flight hydrates | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 73 | [prod-helper] R8-5: switch away and back — T1/A→T2/B→T1/A (new gen) hydrates before original settles | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 74 | [prod-helper] R8-6: behavior is NOT fingerprint-dependent — T2/B payload different from the old write still hydrates | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 75 | [prod-helper] R8-7: old completion AFTER new hydration leaves rendered/active/persistence current | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 76 | [prod-helper] R8-8: new lane WITH pending local intent is protected while old write is in flight; converges to local value | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 77 | [prod-helper] R8-9(R10): a pre-ack payload on the CURRENT lane is deferred; the same-tenant/business/generation own echo is STILL ignored_own_echo after the commit | CONVERTED · A | Pre-ack payload deferred; the same tenant/business/generation own echo is still ignored after the commit. |
| 78 | [prod-helper] R8-10: a deferred payload for one lane is not flushed/applied by another lane's completion | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 79 | [prod-helper] R8-11: old-generation completion cannot delete a marker/pending state created by the current generation | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 80 | [prod-helper] R8-12(R10): superseded same-lane revisions retain correct ack/marker/revision accounting; a stale-base revision cannot silently supersede | CONVERTED · B | Revision accounting preserved (`latest` on rev1/rev2); the stale-base revision cannot silently supersede; an identical future remote payload is not blacklisted. |
| 81 | [prod-helper] R8-13: invalidation during pending local work retires stale lane state; a later old callback is stale | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 82 | [prod-helper] R8-14: no pending local intent → normal live hydration remains applied | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### R9 - save-lifecycle hardening

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 83 | [prod-helper] R9-1: revenue save on a fully hydrated 160-date history preserves ALL dates | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 84 | [prod-helper] R9-2: revenue save before hydration is BLOCKED and emits no persistence intent | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 85 | [prod-helper] R9-3: food-cost save before hydration is BLOCKED and emits no persistence intent | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 86 | [prod-helper] R9-4: current-month filtered subset is REFUSED as a full-replacement payload | CONVERTED · C | A client collection is not a submittable intent - no transaction dispatched, all 153 pre-August rows remain addressable. |
| 87 | [prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date | CONVERTED · id-addressing | The food-cost edit is addressed by the row's immutable id; there is no date targeting in R10. |
| 88 | [prod-helper] R9-6(R10): hydration (incl. duplicate DATES) emits NO write intent; the node is stored verbatim and never self-healed | CONVERTED · D | The self-heal write-back was DELETED, not gated, so there is no collapse pass left to report; the node is stored verbatim and both duplicates stay independently addressable. |
| 89 | [prod-helper] R9-7: listener failure before hydration keeps writes BLOCKED (fail-closed) | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 90 | [prod-helper] R9-8: malformed owner context (no tenant/business) is refused | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 91 | [prod-helper] R9-9: logout during an in-flight write blocks new writes and never mutates the new context | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 92 | [prod-helper] R9-10: same-lane deferred payload + write FAILURE + NO further emit → deterministic convergence | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 93 | [prod-helper] R9-11: deferred payload + write SUCCESS → our newer committed value wins, deferral discarded | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 94 | [prod-helper] R9-12(R10): no own echo can exist while a write is pending; the pre-ack payload is RETAINED and a failed write converges onto it | CONVERTED · A | No own echo can exist while a write is pending; the pre-ack payload is RETAINED and a failed write converges onto it. |
| 95 | [prod-helper] R9-13(R10): a NEWER queued local edit suppresses convergence until it settles | CONVERTED · B | Convergence stays suppressed while a newer local edit is queued; no phantom local value is rendered before a commit. |
| 96 | [prod-helper] R9-14: a deferred payload is NEVER applied after the owner changed | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 97 | [prod-helper] R9-15: business switch while hydration pending — no write, old payload cannot hydrate the new business | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 98 | [prod-helper] R9-16: tenant switch while hydration pending behaves identically | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 99 | [prod-helper] R9-17: late listener callback from the previous business never mutates the current one | CONVERTED · E | History is delivered by a real listener echo - `markHydrated` models an ABSENT node and rejects a non-empty bootstrap (R9 invariant B). |
| 100 | [prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane | CONVERTED · E | Same hydration correction; the old-generation write is proven to have committed to its OWN captured destination and to have left the new one unchanged. |
| 101 | [prod-helper] R9-19: two rapid edits to the SAME date converge on the newest | CONVERTED · B | Stale-base conflict, then re-based commit. |
| 102 | [prod-helper] R9-20: two rapid edits to DIFFERENT dates both survive | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 103 | [prod-helper] R9-21(R10): a listener echo arriving BETWEEN queued edits is deferred and can never regress the lane | CONVERTED · B | The interleaved echo is deferred and can never regress the lane; the same-base edit fails closed, then lands re-based. |
| 104 | [prod-helper] R9-22: failed first write followed by a newer queued edit — the newer edit still persists | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 105 | [prod-helper] R9-23: retry after failure carries the CURRENT owner's payload and ordering | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### Wiring guards

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 106 | [source-guard] R9 wiring: hydration gate, fail-closed self-heal, bootstrap and listener-error are production-wired | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

### Harness self-regression (H1-H6)

| # | Test | R10 disposition | Justification |
|---|---|---|---|
| 107 | [harness] H1: a legitimate negative build (missing identity) is blocked and creates NO transport | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 108 | [harness] H2: a positive upsert() with an invalid fixture fails IMMEDIATELY with a full diagnostic | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 109 | [harness] H3: a queued, NOT-yet-dispatched submission is settled by lane invalidation | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 110 | [harness] H4: settling one transport dispatches the next; cleanup continues until ALL are settled | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 111 | [harness] H5: an un-acked dispatched operation fails THIS test deterministically instead of hanging | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |
| 112 | [harness] H6: a sentinel test after the deliberately stranded scenario still executes | PRESERVED | R6-R9 invariant unchanged by R10; passes against the remote-atomic path without modification. |

## Harness contract (H1-H6)

The harness is itself under test, because a defective harness is how this suite previously lost
measurability. H1 proves a legitimate negative build is blocked and creates NO transport. H2 proves
a positive fixture carrying an invalid id fails immediately with a full diagnostic instead of
leaving a pending promise. H3 proves a queued, not-yet-dispatched submission is settled by lane
invalidation. H4 proves settling one transport dispatches the next and that cleanup continues until
ALL are settled. H5 proves an un-acked DISPATCHED operation fails its own test deterministically
(60 `setImmediate` ticks, no timers and no sleeps) rather than hanging. H6 is the sentinel proving
a test following a deliberately stranded scenario still executes - i.e. the cancellation cascade
cannot recur silently.

## Guard suites verified alongside

- `test/dashboard/entries-id-contract.test.mjs` - 12/12 (UUID v4 contract, node-state contract,
  create idempotency, GATE-003 date-edit regression, offline transformer, runtime boundary)
- `test/dashboard/entries-remote-atomic.test.mjs` - 23/23 (two fully independent clients over one
  shared remote with genuine CAS retry, including the negative control reproducing the exact R9
  losing schedule)
- `test/finance/vat-invariant.test.mjs` - 5/5, file byte-unchanged; S0 added-line regex clean
- complete repository suite - 36 files, 488 tests, 0 fail, 0 cancelled, 0 skipped
- `index.html` - all four inline script blocks parse clean under a JSX-aware parser
- `tsc --noEmit` - exit 2, 22 diagnostics, all `TS2742` in `src/firebase/refs.ts`; identical to
  untouched R9, no new diagnostic
- `git diff --check` - exit 0
