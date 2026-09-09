# Codex review guide — P0-DATA-01 R10 candidate

**This document makes no claim of approval.** R10 has never been independently reviewed
as a whole candidate. The last whole-candidate independent verdict on this workstream is
`CHANGES_REQUIRED` on R9. What follows is what to review and how to reach it.

## Identity

| Field | Value |
|---|---|
| Repository | `/Users/yonatan/Documents/marjin/kissgn` (authoritative; the Desktop clone is stale and holds none of this lineage) |
| Worktree | `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10` |
| Branch | `claude/p0-data-01-r10` |
| Base SHA | `b854054cce5d27dcef7a2a442c15e32eadca20f3` (R9) |
| Candidate SHA | the single commit on `claude/p0-data-01-r10` whose parent is the base above — `git rev-parse claude/p0-data-01-r10`. It is deliberately not transcribed here: this file is inside that commit, so any literal would be a value written before it existed. |
| Pushed / merged / deployed | **no, no, no** — local commit only |

Full diff: `git diff b854054 claude/p0-data-01-r10`.

## Runtime files changed — exactly one

`index.html` (`+765 / −212` vs base). Three identified changes, all additive:

- **R10-GATE-014** — `setDailyLabor` (index.html ~line 7105) binds and consumes the typed
  result of `submitLaborEntry`; `EmployeesScreen` renders `laborSaveError`
  (`data-testid="labor-save-error"`); `describeSaveOutcome` gained
  `reason === "ambiguous_date_requires_id"` and `status === "invalid_date"`.
- **R10-GATE-015** — `dupExtras` collection in the dashboard day list, plus the
  per-duplicate row block with `deleteEntryById(dup.id)` behind `window.confirm`
  (`data-testid="dup-delete"`).
- The remainder is the pre-existing uncommitted R10 body (`+700 / −211`): remote-atomic
  mutation, deletion of `createPersistence.persistEntries`, immutable UUID row identity,
  `id_collision` propagation, and the two Gate 5 fixes R10-GATE-012 / R10-GATE-013.

No destination routing, identity, collision, conflict, retry, re-base or clear-all
semantics were changed in this round. No Rules, config, dependency, migration or repair
path was touched.

## Test files changed

New: `test/emulator/entries-remote-atomic-emulator.mjs` (604) ·
`test/dashboard/entries-labor-screen.test.mjs` (250) ·
`test/dashboard/entries-duplicate-delete.test.mjs` (177) ·
`test/support/git-context.mjs` (87).
Modified: `test/support/ui-call-site-harness.mjs` (two extractors, two call sites, one
state spy) · `test/finance/vat-invariant.test.mjs` (`+9/−3`, **assertions byte-identical**)
· `test/emulator/README.md` (`+51`).
Pre-existing R10 body, unchanged in this round: `entries-{lifecycle,ui-call-sites,
concurrency-matrix,clear-all-matrix,topology-sentinel,remote-atomic,id-contract}.test.mjs`,
`test/support/{cross-writer-harness,entries-id-offline-transformer}.mjs`.

## Emulator command

```
env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
    PATH="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec --only database \
      --project demo-marjin-rules --config test/emulator/firebase.json \
      "node test/emulator/entries-remote-atomic-emulator.mjs"
```

Expected `total=16 passed=16 failed=0`, `ALL CASES PASSED`, exit 0. Java 21+ required.
If the JAR cannot be downloaded, place `firebase-database-emulator-v4.11.2.jar` in
`~/.cache/firebase/emulators/`. If rules loading reports *Request was cancelled*, unset
the proxy environment variables for the command.

Repository suites: `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`
→ 658/658. Never bare `node --test`.

## The historical R9 losing schedule

Two independent clients hydrate the same 160-date history at the same revision. A edits
`2026-02-10`, B edits `2026-02-11`. Each persists by writing the **whole** `entries` array
with `set()`. Whichever commits second replaces the array wholesale and the other's edit is
gone; both clients still receive a success. Reproduced against this emulator in both
completion orders by `EMU-B-negctl-*` — the negative control exists so that a suite which
cannot see the bug cannot be mistaken for one that has fixed it.

## R10 expected behaviour under that schedule

Each mutation is a typed intent applied inside
`runTransaction(ref(db, path), txnFn, { applyLocally: false })` against the latest remote
value; `persistEntries` no longer exists. Under the identical schedule both edits are
present and all 160 dates are retained (`EMU-B-r10-same-schedule`, `EMU-A-*`). A save from a
form opened before someone else's edit returns `conflict` with exact `conflictPaths`, leaves
the node byte-intact, and commits after re-basing (`EMU-C-conflict`). Contention produces
real CAS retries (`EMU-C-retry`: 8 transactions, 36–37 callback runs). Rules deny
cross-business, cross-tenant and viewer writes (`EMU-D-*`). Stale and owner-less contexts are
refused with zero network I/O.

## Labor UI call-site path

```
<input placeholder="₪ נוכחות" onChange={e=>setDailyLabor(date,e.target.value)}>   index.html ~7156
  -> setDailyLabor(date, val)                                                     index.html ~7105
     -> submitLaborEntry(date, val)                                               index.html ~3955
        -> entriesWriteCoordRef.current.submitIntent({ type:"upsert_entry", ... })
           -> createRemoteEntriesMutator.mutate -> RTDB transaction
        <- typed outcome
     <- describeSaveOutcome(res) -> setLaborSaveError(...)  |  commit -> setLaborSaveError("")
  -> banner  data-testid="labor-save-error"
```

`test/dashboard/entries-labor-screen.test.mjs` executes this whole chain from the extracted
`onChange` expression; the `LAB-X1` negative control demonstrates the pre-fix wrapper
produces no operator-visible state.

## Where to push hardest

1. **The Admin-SDK vs Web-SDK gap** in the emulator harness (`KNOWN_LIMITATIONS` §1) — is a
   real-browser Web-SDK run against the emulator required before this can close?
2. **The cold-cache abort** (`KNOWN_LIMITATIONS` §2) — fail-closed, but the reason surfaced
   is wrong. Is bounding it by the hydration gate sufficient?
3. **`stale` handled silently in the labor UI** (`LABOR_UI_EVIDENCE`, deviation section).
4. **The VAT guard edit** — confirm the assertions really are byte-identical and that
   `test/support/git-context.mjs` cannot make a guard pass when the repository is
   unreachable (it throws; there is no skip path).
5. **D-GAP-1 scope** — the duplicate rows were previously invisible, not merely
   undeletable. Confirm that making them visible is wanted, and that a confirmed
   single-row delete is the right affordance.
6. **Whether the Gate 3 `APPROVED`** recorded in the implementer's own ledger should stand
   without an independent artifact directory.

## Reading order

`CHANGE_SUMMARY.md` → `EMULATOR_CONCURRENCY_EVIDENCE.md` → `LABOR_UI_EVIDENCE.md` →
`D_GAP_1_STATUS.md` → `VAT_GUARD_EVIDENCE.md` → `TEST_RESULTS.md` →
`KNOWN_LIMITATIONS.md`. Prior-round context: `../p0-data-01-r10/`.
