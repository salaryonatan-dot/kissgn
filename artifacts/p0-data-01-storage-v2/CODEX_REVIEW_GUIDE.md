# Codex review guide — P0-DATA-01 Storage V2

**No approval is claimed. P0-DATA-01 remains OPEN.** This candidate implements the storage
shape the CTO chose after the R10.2 feasibility gate established that RTDB Rules cannot
enforce row identity or uniqueness while rows live inside one JSON string.

## Identity

| Field | Value |
|---|---|
| Repository | `/Users/yonatan/Documents/marjin/kissgn` |
| Worktree | `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-storage-v2` |
| Branch | `claude/p0-data-01-storage-v2` |
| **Base SHA** | `f9168213bfe027995ad4a38ab084071e97824823` — the R10.1 candidate, untouched |
| **Candidate SHA** | the single commit on this branch whose parent is the base — `git rev-parse claude/p0-data-01-storage-v2`. Not transcribed: this file is inside that commit. |
| Pushed / merged / deployed | **no, no, no** |
| Production data accessed | **no** — no Production or Preview read, write, enumeration or rollout |

```
git diff f9168213bfe027995ad4a38ab084071e97824823 claude/p0-data-01-storage-v2
git show --stat --oneline claude/p0-data-01-storage-v2
```

## Exact changes

| File | +/− | What |
|---|---|---|
| `index.html` | +290 / −7 | the `MarjinStorageV2` module; two transports (`subscribeNode`, `mutateForPath`); mutator/router wiring; the dual-mode hydration listener |
| `database.rules.json` | +205 / −180 | three V2 validators at one location (the rest is re-indentation — see `RULES_PROOF.md`) |
| `test/emulator/database.rules.json` | +205 / −180 | the byte-identical copy the emulator loads |
| `test/finance/vat-invariant.test.mjs` | +26 / −2 | the content-verified S0 exception, extended to the V2 validators; **VAT assertions unchanged** |
| `test/emulator/storage-v2-matrix.mjs` | **new**, 32 cases | the whole V2 proof |
| `tools/storage-v2/preflight.mjs` | **new** | read-only preflight, pure, injected helpers |
| `tools/storage-v2/upgrade.mjs` | **new** | atomic cutover + the negative control |
| `artifacts/p0-data-01-storage-v2/` | **new**, 12 docs | this evidence set |

Unchanged: `applyEntryIntent`, `buildEntryUpsertIntent`, `buildEntryDeleteIntent`,
`rowDiffPaths`, the write coordinator, the save-UI runner, every delete/labor/clear-all
call site, and every existing test file except the S0 guard.

## Storage trees

LEGACY (unchanged):
```
biz:{bizId}:entries/ _v : "<JSON array as one string>"
```

V2:
```
biz:{bizId}:entries/
  schemaVersion : 2
  generation    : "<uuid v4>"
  rows/{rowId}/ { id === {rowId}, gen === generation, date, …fields }
  _v : "<frozen pre-cutover snapshot, immutable>"
```

## The cutover transaction

One CAS at the business entries node; `_v` is parsed **inside** the callback, so a legacy
writer that commits between read and commit causes a re-run against the fresher value. See
`MIGRATION_DESIGN.md` for the exact code.

## Preflight behaviour

Read-only, pure, deterministic, never repairs. Blockers: `already_v2`, `malformed_node`,
`not_an_array`, `unsupported_row_shape`, `missing_entry_id` (defers to the approved offline
entry-id action), `duplicate_entry_id` (defers to an operator), `invalid_entry_date`.
`rows` is present in the report only when it passes. See `MIGRATION_PREFLIGHT.md`.

## Old-client rejection proof

`V2-X01`: after cutover, a legacy whole-node write, a direct `_v` child write and a schema
downgrade are each denied, and the node is asserted byte-intact afterwards. Operator-facing
behaviour in `LEGACY_CLIENT_CUTOVER.md`.

## Clear-all concurrency proof

`V2-G01`…`V2-G05`. The generation is rotated inside one node-level CAS against the
operator-confirmed content fingerprint, so a clear-all can never discard a write it did not
see (`V2-G04`, `V2-G05` both refuse and leave the concurrent change standing), and a client
holding the retired generation cannot recreate a row — denied at the Rules engine, not only
at the client (`V2-G02`).

## Emulator commands and results

```
… emulators:exec --only database --project demo-marjin-rules \
    --config test/emulator/firebase.json "node test/emulator/storage-v2-matrix.mjs"
total=32 passed=32 failed=0      ALL CASES PASSED      (×3 rounds)
```

Unchanged suites re-run against the new rules: authorization `total=108 … failed=0` (×3),
R10 concurrency `total=19 passed=19 failed=0`, R10.1 rules validation
`total=30 … failed=0`. The three scripts each reseed the database root and must run one at
a time. Full detail: `EMULATOR_RESULTS.md`.

## Regression totals

```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 689   # pass 689   # fail 0      (×3)
```

`tsc --noEmit` exit 2 with exactly 22 `TS2742` in `src/firebase/refs.ts` — the documented
baseline. `git diff --check` exit 0. Two changed test assumptions, both documented in
`REGRESSION_RESULTS.md`, with three mutation probes proving the S0 exception is still narrow.

## Where to push hardest

1. **`KNOWN_LIMITATIONS.md` §1** — the three server-side readers still unwrap `_v` only.
   For a converted business they would read the frozen snapshot. This is the largest
   remaining gap and it must close before any Production business is converted. Is
   landing this candidate without it acceptable, or should the readers be in the same commit?
2. **The generation comparison** uses `newData.parent().parent().child('generation')`
   rather than `root`, because during the cutover the generation does not exist pre-write.
   Confirm that reasoning against the Rules evaluation model.
3. **`_v` immutability rather than prohibition** after cutover — clear-all re-emits the node
   and therefore rewrites `_v` byte-identically. Is an equality constraint the right call?
4. **Row order** is now (date, id) rather than stored array order (`§2`).
5. **The extended S0 exception** — three additions instead of two, still content-verified.
6. **Rollback becomes one-way at the first V2 write** (`ROLLBACK_BOUNDARY.md`), and that
   boundary is knowable but not recorded. Should it be recorded before rollout?

## Reading order

`ARCHITECTURE.md` → `LEGACY_VS_V2_CONTRACT.md` → `RULES_PROOF.md` →
`MIGRATION_PREFLIGHT.md` → `MIGRATION_DESIGN.md` → `GENERATION_CLEAR_ALL.md` →
`LEGACY_CLIENT_CUTOVER.md` → `ROLLBACK_BOUNDARY.md` → `EMULATOR_RESULTS.md` →
`REGRESSION_RESULTS.md` → `KNOWN_LIMITATIONS.md`. Prior context:
`~/Documents/marjin/reviews/2026-09-15/r10-2-schema-decision/`.
