# Gate 3 — independent-writer concurrency and clear-all exact-state matrices (P0-DATA-01 R10)

Worktree `kissgn-p0-data-01-r10`, branch `claude/p0-data-01-r10`, base/unchanged HEAD
`b854054cce5d27dcef7a2a442c15e32eadca20f3`. **NOT COMMITTED.**

## Gate 3 status: APPROVED — CLOSED

| Field | Value |
|---|---|
| Independent reviewer | **Codex** |
| Verdict | **`APPROVED`** |
| Gate 3 | **CLOSED** |
| Topology sentinel | 14/14 ×3 |
| Concurrency matrix | 41/41 ×3 |
| Clear-all matrix | 42/42 ×3 |
| Lifecycle suite | 112/112 ×3 |
| Complete repository suite | 585/585 across 39 files |
| Gate 3 findings by severity | **none at any severity** |
| Commit recommended | **No** |
| Gates open at time of approval | Gate 5 and Gate 7 |

Review history: the first Gate 3 submission returned **`CHANGES_REQUIRED`** — the cross-writer
harness was not destination-partitioned, so the destination-transition cells could not prove
remote destination isolation. That finding was accepted, the claim was withdrawn, and the
remediation recorded below was implemented. The re-review of that remediation returned
**`APPROVED`**.

The accepted destination-partitioned harness, topology sentinel, concurrency matrix and
clear-all matrix are now fixed. They are not to be reopened or redesigned unless a later gate
exposes a direct regression.

## The defect in the previous proof (accepted)

The previous submission's harness (`test/support/cross-writer-harness.mjs`) was **not**
destination-partitioned. It held:

- one global `state.node`;
- one global `state.version`;
- one global listener collection;
- destination-agnostic `rows`, `setRowsDirect`, `removeNode`, `subscribe`, `emitAll` and
  interleaving state;
- `transact(tenantId, key, txnFn)` that **recorded** `key` but read and wrote that single
  global node;
- no physical distinction between `(T1, biz:A:entries)`, `(T1, biz:B:entries)` and
  `(T2, biz:A:entries)`.

Consequently C-12, C-17, C-18, K-29a and K-29b could assert only *local* lane state — a fresh
generation, `desired === null`, `isHydrated() === false` — against **one** global remote value.
They could not prove that a late write reached the destination it captured, nor that the newly
selected destination was left untouched. The previous report described those cells as proving
destination isolation; it did not. That claim is withdrawn.

## The corrected topology

The remote is now a **destination-partitioned service**. A destination is the exact pair the
production transport addresses:

    [ tenantId , key ]        where key === `biz:${bizId}:entries`

**Anti-aliasing design.** Identity is a **nested Map** — `Map<tenantId, Map<key, destination>>`.
No delimiter concatenation is used anywhere, so `("T1","biz:A:entries")` cannot alias
`("T1:biz","A:entries")`, `("T1|biz","A:entries")`, `("T1b","iz:A:entries")` or any
whitespace variant. TS-13 proves this behaviourally, including that a write to a forged pair
lands only at the forged destination and that the transaction log records the captured pair
unencoded.

Each destination independently owns: node value, version, listener list, transaction/CAS
attempts, transport-rejection state, retry limit, interleaving hooks, in-flight holds and
transaction log. `transact` **captures** `(tenantId, key)` at dispatch and thereafter reads,
writes, versions and notifies only that destination — including across any selection, business,
tenant or generation change. An aborted, rejected or exhausted transaction leaves every
destination byte-intact.

Every remote helper is destination-explicit via `remote.at(tenantId, bizId)` /
`remote.atKey(tenantId, key)`: `rows`, `version`, `exists`, `seed`, `setRowsDirect`,
`setRawNode`, `removeNode`, `subscribe`, `emitAll`, `failListener`, `failNextTransports`,
`setMaxRetries`, `interleave`, `interleaveOnEveryAttempt`, `holdNext`, `log`,
`outstandingHolds`. Service-level: `snapshot()` (a **list** of `{tenantId, key, rows}`, never a
concatenated map), `allLogs()`, `destinations()`, `inFlight()`.

A default destination exists only where a fixture **explicitly declares** it: `makeRemote(rows)`
declares `(T1, biz:A:entries)` — the default selection every client in these suites starts from
— and its delegating accessors are bound to that declared destination. All transition cells use
explicit `remote.at(...)` handles and multi-destination fixtures.

`makeClient.attach()` subscribes to the destination derived from the ctx captured at setup, and
`pull()` reads the destination derived from the client's current selection — matching production
listener routing. Transaction logs record both the captured `tenantId` and the exact `key`.

The accepted single-destination RTDB semantics are preserved unchanged: callback re-execution,
CAS retry, abort, transport rejection, retry exhaustion, committed snapshots, absent-node
behaviour, and the deterministic 60-tick watchdog (unchanged threshold; no sleeps, no automatic
acknowledgement of unknown transports, no swallowed rejections, no cleanup that conceals a
stranded operation).

## Topology sentinel suite — `test/dashboard/entries-topology-sentinel.test.mjs`

**14 tests, 14 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**; three consecutive identical runs.

Three destinations are seeded with deliberately distinct exact states — different immutable ids,
**overlapping** business dates, different financial values, non-sorted row order and different
unknown fields — so aliasing cannot false-green any equality check:

| Destination | Seeded rows (exact) |
|---|---|
| `T1 / biz:A:entries` | `[{id:…t1a-02, date:2026-08-02, sales:1002, deliveries:0, other_income:0, note_t1a:"alpha"}, {id:…t1a-01, date:2026-08-01, sales:1001, deliveries:7, other_income:0}]` |
| `T1 / biz:B:entries` | `[{id:…t1b-01, date:2026-08-01, sales:2001, deliveries:0, other_income:3, tag_t1b:{k:"beta"}}, {id:…t1b-09, date:2026-08-09, sales:2009, …}, {id:…t1b-05, date:2026-08-05, sales:2005, …}]` |
| `T2 / biz:A:entries` | `[{id:…t2a-03, date:2026-08-03, sales:3003, deliveries:0, other_income:0, legacy_t2a:42}]` |

Every assertion is complete deep equality over the **whole** three-destination snapshot.

| Cell | Proves |
|---|---|
| TS-01 | three `[tenantId,key]` pairs hold three independent, exactly distinct nodes; `(T1,A)`, `(T1,B)` and `(T2,A)` are distinct objects |
| TS-02 / TS-03 / TS-04 | a committed mutation at T1/A, T1/B or T2/A changes only that destination; the other two are byte-intact; the mutating client's converged view is its own node |
| TS-05 | a listener fires only for its registered destination; the other clients' `applied` counts and local states are unchanged |
| TS-06 | a pull returns only the requested destination; no client's view equals another's node |
| TS-07 | version advances only for the mutated destination |
| TS-08 | the transaction log records the exact captured `tenantId` and `key`; other destinations' logs are empty; exactly one transaction service-wide |
| TS-09 | a rejected transport leaves all three destinations byte-intact and reaches no destination |
| TS-10 | retry exhaustion leaves all three destinations byte-intact |
| TS-11 | the same `bizId` under different tenants is a different physical node; each tenant's `biz:A:entries` receives exactly its own row |
| TS-12 | a committed clear-all empties only its own destination |
| TS-13 | the partition key cannot be forged by delimiter concatenation (five forgery pairs) |
| TS-14 | an in-flight transaction keeps its captured destination across a selection change |

**Anti-regression verification.** The sentinel suite was executed against a faithful simulation
of the former single-node topology (a scratch copy in the build container, with `destFor`
patched to resolve every pair to one global destination; the worktree was not touched, and the
scratch copy was removed afterwards). Result: **0 pass, 14 fail** — the suite fails by
construction against the topology it replaces. The strengthened transition cells were run the
same way: concurrency **37 pass / 4 fail** (C-12, C-17, C-18, C-19) and clear-all
**37 pass / 5 fail** (K-29a, K-29b, K-29c, K-29d, K-29e), confirming those cells now depend on
real remote routing rather than on local lane state.

## Concurrency matrix — `test/dashboard/entries-concurrency-matrix.test.mjs`

**41 tests, 41 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**; three consecutive identical runs.
(Count unchanged from the previous submission; five cells were *strengthened*, none added,
deleted, skipped, weakened or consolidated.)

The non-transition cells are unchanged and are documented in the previous revision of this
artifact: independent creates (C-01 … C-05b), date edits (C-06 … C-11), conflict/rebase/retry/
abort/rejection/exhaustion (C-13 … C-16c), ordering permutations and multi-writer schedules
(C-20 … C-23), and negative controls (C-N1, C-N2, C-N3, C-N4, C-N5, C-N6).

### Strengthened destination-transition cells

C-12, C-17 and C-18 now run against **four** seeded destinations — the old one, the new one and
two sentinels — each with a distinct exact state (distinct ids, overlapping dates, distinct
values, non-sorted order, distinct unknown fields):

| Destination | Seeded rows |
|---|---|
| `T1 / biz:A:entries` | `[{…x-t1a-02, 2026-08-02, 1002, note_t1a:"alpha"}, {…x-t1a-01, 2026-08-01, 1001, deliveries:7}]` |
| `T1 / biz:B:entries` | `[{…x-t1b-01, 2026-08-01, 2001, other_income:3, tag_t1b:{k:"beta"}}, {…x-t1b-09, 2026-08-09, 2009}]` |
| `T2 / biz:A:entries` | `[{…x-t2a-03, 2026-08-03, 3003, legacy_t2a:42}]` |
| `T2 / biz:B:entries` | `[{…x-t2b-07, 2026-08-07, 4007, deliveries:1}, {…x-t2b-04, 2026-08-04, 4004, extra_t2b:["z"]}]` |

| Cell | Transition | Storage axis |
|---|---|---|
| C-12 | `(T1/A) → (T2/B)` | an owner change that is **also** a tenant **and** business change, therefore a physical destination transition. Owner alone is **not** an RTDB storage axis; the storage axes are `tenantId` and the `biz:${bizId}:entries` key. |
| C-17 | `(T1/A) → (T1/B)` | business |
| C-18 | `(T1/A) → (T2/A)` | tenant |

Each of the three asserts, in order:

1. exact initial state of all four destinations, and that the client hydrated **its own**
   destination exactly;
2. a date mutation is dispatched at `(T1, biz:A:entries)` and **held physically in flight**;
3. the client switches destination (controller invalidated, lane retired, old listener dropped);
   the new lane's generation differs and the client now addresses the new `[tenantId, key]`;
4. on release, the write commits — and `svc.at("T1","A").log()` equals exactly
   `[{tenantId:"T1", key:"biz:A:entries", runs:1, committed:true}]`, while the new destination's
   and both sentinels' logs are `[]` and `allLogs().length === 1`;
5. exact final state of **all four** destinations: only the captured one moved (its row's `date`
   became `2026-08-19`, in place, order preserved); the new and sentinel destinations are
   byte-intact;
6. the old acknowledgement applied nothing into the new lane (`applied.length` unchanged,
   `desired === null`, `isHydrated() === false`, `ownPending === 0` — no old marker survived);
7. an old-destination listener payload delivered with the retired ctx returns `stale`, applies
   nothing, and leaves the new lane unhydrated with `desired === null`;
8. the new destination's **own** listener then hydrates it with exactly its own value, which is
   asserted **not** deep-equal to the old destination's post-write state — no old payload,
   marker or result was consumed;
9. hydrating the new destination mutated nothing anywhere.

**C-19 is a same-destination case.** A new generation of `(T1, biz:A:entries)`. Generation is a
local ordering/ownership device, not an RTDB storage axis, so C-19 proves lane and generation
isolation *without* pretending a new node exists: it asserts the physical destination is
unchanged, the write lands there, the other three destinations are byte-intact, the retired
generation's result never reaches the new lane, its marker does not survive, its callback is
`stale`, and the new generation hydrates from the same node.

## Clear-all exact-state matrix — `test/dashboard/entries-clear-all-matrix.test.mjs`

**42 tests, 42 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**; three consecutive identical runs.
(Previously 40; **two cells added** — K-29d and K-29e. Nothing deleted, skipped or weakened.)

Node shapes (K-01 … K-13b), readiness and precondition gates (K-14 … K-18), races
(K-20 … K-28), no-partial-clear and no-premature-success (K-30a … K-32) and negative controls
(K-N1 … K-N4) are unchanged and documented in the previous revision. The `allLogs()`
assertions were tightened from "no transaction at the declared destination" to "no transaction
at **any** destination".

### Strengthened and added clear-all transition cells

K-29a and K-29b run against the same four-destination fixture (seeded with the `k-…` id family).

| Cell | Transition | Proves |
|---|---|---|
| K-29a | `(T1/A) → (T1/B)` | see below |
| K-29b | `(T1/A) → (T2/A)` | see below |

Each asserts: exact initial four-destination state; the clear is confirmed against T1/A's content
and held in flight; the client switches destination; on release the clear commits **only** at
`(T1, biz:A:entries)` — that destination becomes exactly `[]` while the new and both sentinel
destinations are byte-intact; the log records the exact captured `tenantId`/`key` and no
transaction was attempted at the new or sentinel destinations (`allLogs().length === 1`); the
acknowledgement applied nothing into the new lane, which stays fresh, unhydrated and with
`ownPending === 0`; the cleared payload delivered with the retired ctx is `stale`, applies
nothing, and the new destination is **not** marked cleared; the new destination's own listener
then hydrates it with exactly its own value, asserted **not** equal to `[]`; and the old
confirmation **cannot be reused** against the new destination — re-submitting it returns
`blocked` / `precondition_failed`, mutates nothing anywhere, and the new destination's
fingerprint is its own.

**K-29c** is the same-destination generation case: the physical destination is unchanged, the
clear commits there, the other three destinations are byte-intact, the retired generation's
result never reaches the new lane, its callback is `stale`, and the new generation hydrates from
the same (now empty) node.

**K-29d (new)** — an in-flight clear that is **rejected** during a destination transition:
`failed`, zero mutation across all four destinations, `allLogs().length === 0`, and the new
destination is not marked cleared.

**K-29e (new)** — an in-flight clear whose **retries are exhausted** during a destination
transition: `failed` / `not_committed` (never a phantom or partial clear), every row at every
destination survives, and the new destination is not marked cleared.

## Runtime defect discovered by the corrected harness: **No**

The destination-partitioned harness exposed **no** production-path failure. `index.html` was
**not modified** during this remediation; its SHA-256 is byte-identical before and after (see
*File integrity* below).

## R10-GATE-011 — corrected description

The previous artifact overstated this finding. Corrected:

R10-GATE-011 was a **lost idempotency classification / caller-observability defect**. The
coordinator's committed settle branch did not forward the transformation's `reason`
(`already_created`, `already_applied`, `empty_patch`), so a caller received a bare
`committed_idempotent` and could not tell which condition made the operation a no-op.

- It caused **no data loss and no incorrect remote mutation**. Remote state was correct in
  every case; only the classification was dropped before reaching the caller.
- It is **not equivalent in severity or mechanics** to the R9 date-edit defect. That defect was
  a genuine data-loss/no-op-write bug in which an edit silently did not move data; this one is
  an observability gap on an operation that behaved correctly.
- The accepted correction — forwarding `res.reason` on the committed settle branch — **remains
  intact** and is unchanged by this remediation.
- Coverage remains: C-16 (`already_applied`), C-16b (`empty_patch`), C-04 and K-09b / K-26
  (`already_empty`), and negative control C-16c (an ordinary commit carries no idempotency
  reason).

## Files changed in this remediation

| File | Change |
|---|---|
| `test/support/cross-writer-harness.mjs` | rewritten: destination-partitioned service, explicit destination handles, destination-bound `attach`/`pull`, per-destination logs/holds/interleaving |
| `test/dashboard/entries-topology-sentinel.test.mjs` | **new** — 14 topology sentinel cells |
| `test/dashboard/entries-concurrency-matrix.test.mjs` | C-12, C-17, C-18, C-19 rewritten as multi-destination proofs; `allLogs()` tightening |
| `test/dashboard/entries-clear-all-matrix.test.mjs` | K-29a, K-29b, K-29c rewritten as multi-destination proofs; K-29d and K-29e added; `allLogs()` tightening |
| `artifacts/p0-data-01-r10/GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md` | this artifact |
| `artifacts/p0-data-01-r10/_STATUS_CHANGES_STILL_REQUIRED.md` | updated |

**Runtime files changed: none.**

## File integrity — what is and is not provable

`index.html`, `test/dashboard/entries-lifecycle.test.mjs` and `test/finance/vat-invariant.test.mjs`
are **tracked**; `git diff` shows `vat-invariant.test.mjs` unmodified against
`b854054`, which is an authoritative statement about that file relative to the base commit.

The remaining files below are **untracked**. Git cannot attest to their history, and no commit
or previously recorded digest exists for them, so **their identity prior to this remediation
cannot be established from an authoritative source**. What is recorded here is narrower and
accurate: digests taken at the *start* of this remediation, before any edit, compared with
digests taken after it. This establishes only that the files were untouched *during this
remediation*.

| File | SHA-256 before this remediation | After | Verdict |
|---|---|---|---|
| `index.html` (tracked) | `5b180821965448bb48792b3bf8c5ba39d4a9ba633b9015daef02a95af1a2e54d` | identical | untouched in this remediation |
| `test/dashboard/entries-lifecycle.test.mjs` (tracked) | `0fbc8957482f9a081412d57e8d5a92cffcd966cd5de4c9448c1ab8e1aab47990` | identical | untouched in this remediation |
| `test/finance/vat-invariant.test.mjs` (tracked) | `822cd21ced9f474a77eda4b734d56cede847c171e26d31b0e5e28f7968c371f4` | identical | untouched; also unmodified vs `b854054` per `git diff` |
| `test/dashboard/entries-remote-atomic.test.mjs` (untracked) | `fd613f421d296e99b5f1b71911a806992ced71b54877f4558e6b1c4fbebadf73` | identical | untouched in this remediation |
| `test/dashboard/entries-id-contract.test.mjs` (untracked) | `40b57e1d46a04dd9ca9909b277c859d8b57c0bd9564b6e1171608bba66e68758` | identical | untouched in this remediation |
| `test/support/entries-id-offline-transformer.mjs` (untracked) | `ea44dca594c5adcb371c99ff156e2da003c968a26091d49ef3b32cf4a3375f45` | identical | untouched in this remediation |
| `test/support/cross-writer-harness.mjs` (untracked) | `b2efc177adc3876f523e2d4b558fbc30d25467559207707fc86bc199e7d06060` | `5b0f9ce53367f9877a144ba61907f2768a1a1e94ecbe65354b837bd9bc24bbe0` | **rewritten** |
| `test/dashboard/entries-concurrency-matrix.test.mjs` (untracked) | `a18957f896b2ccf43b8292bb0a370552b5359302bf5229a2eca05713663d3c83` | `008c20bd2892f944d12c668aefa95c89c9e92792112a04582ba267ba2e092c3a` | **strengthened** |
| `test/dashboard/entries-clear-all-matrix.test.mjs` (untracked) | `8f51cd6c887098d030fe5c2f040394d1b216866b39114528fde2d85d9a1f8205` | `86cb1f399deea39cb1f544a25b9ac58773345d89856d498cd1aae6806f66f124` | **strengthened + 2 cells** |
| `test/dashboard/entries-topology-sentinel.test.mjs` (untracked) | — | `d2c1ff5be12defedf2c9a4f350f0e1881620b1c2abb2d7c73ba6eef6cc5b5f1b` | **new** |

## Final validation

Run after the final edit, with no changes between runs.

| Check | Result |
|---|---|
| topology sentinel ×3 | 14/14 · 14/14 · 14/14 |
| concurrency matrix ×3 | 41/41 · 41/41 · 41/41 |
| clear-all matrix ×3 | 42/42 · 42/42 · 42/42 |
| lifecycle suite ×3 | 112/112 · 112/112 · 112/112 |
| prior cross-writer suite | 23/23 |
| UUID/id-contract + transformer/runtime-boundary | 12/12 |
| focused R10-GATE-011 coverage | C-04, C-16, C-16b, C-16c, K-09b, K-26 — all pass |
| H1–H6 | all six pass (lifecycle 107–112) |
| VAT S0 guard | 5/5; file unmodified vs `b854054` |
| complete repository suite | **39 files, 585 tests, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| syntax | `node --check` clean on all four changed/new `.mjs` |
| inline `index.html` scripts | all 4 parse clean under a JSX-aware parser |
| TypeScript vs untouched R9 | exit 2, 22 diagnostics, all `TS2742` in `src/firebase/refs.ts` — **unchanged**, no new diagnostic |
| `git diff --check` | exit 0 |

All stability runs had identical discovered test counts and zero failures, cancellations,
unexpected skips, todos, hangs or unhandled rejections. The watchdog threshold remains 60
deterministic ticks; no sleeps were added, no transport is auto-acknowledged, and cleanup does
not conceal a stranded operation (C-N3 and K-N3 prove this).

`node_modules`, `test/.DS_Store` and `artifacts/.DS_Store` are incidental and were neither
staged nor deleted. The worktree `.git` pointer was not modified.

## Remaining R10 work

- **Gate 3** — `APPROVED` by Codex, **CLOSED**.
- **Gate 5** — real UI call-site coverage across every outcome status.
- **Gate 7** — artifact completion and final validation.

Historical recovery is **not** complete, P0-DATA-01 is **not** closed, and nothing here asserts
Production readiness.
