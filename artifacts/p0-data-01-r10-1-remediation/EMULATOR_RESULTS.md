# Emulator results — R10.1

All emulator work is local-only: project `demo-marjin-rules`, namespace
`demo-marjin-rules-default-rtdb`, host `127.0.0.1:9000`, credentials absent. Each script
aborts before any request if that is not true. No Production or Preview RTDB was accessed.

Three scripts, each reseeding the database root, so they run **one at a time** against a
single emulator.

## Runs

Three consecutive rounds, identical results:

| Script | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `rtdb-authorization-matrix.mjs` | 108/108 | 108/108 | 108/108 |
| `entries-remote-atomic-emulator.mjs` | 19/19 | 19/19 | 19/19 |
| `entries-rules-validation-matrix.mjs` | 30/30 | 30/30 | 30/30 |

```
total=108 expected_allow=37 expected_deny=71 passed=108 failed=0
unexpected_allow=0 unexpected_deny=0 errored=0
total=19 passed=19 failed=0
total=30 expected_allow=13 expected_deny=17 passed=30 failed=0
unexpected_allow=0 unexpected_deny=0 errored=0
```

## R10 concurrency suite — 19 cases (16 from R10, 3 new)

Unchanged R10 behaviour under the new rules and the new delete contract:

```
EMU-A-A_then_B             independent-writers    PASS  both edits present, 160 dates retained
EMU-A-B_then_A             independent-writers    PASS  both edits present, 160 dates retained
EMU-A-parallel             independent-writers    PASS  both edits present under true simultaneity
EMU-B-negctl-A_then_B      r9-negative-control    PASS  edit at 2026-02-10 lost, as in the R9 incident
EMU-B-negctl-B_then_A      r9-negative-control    PASS  edit at 2026-02-11 lost, as in the R9 incident
EMU-B-r10-same-schedule    r9-negative-control    PASS  same schedule, zero loss
EMU-C-retry                transaction-semantics  PASS  8/8 committed, 38 txnFn runs for 8 transactions
EMU-C-conflict             transaction-semantics  PASS  conflictPaths=["sales"], node untouched, commits after re-base
EMU-C-idempotent           transaction-semantics  PASS  reason=already_applied
EMU-C-id-collision         transaction-semantics  PASS  status=blocked reason=invalid_identity detail=id_collision
EMU-D-cross-business       ownership              PASS  hydration denied=true, mutate=failed/permission_denied
EMU-D-cross-tenant         ownership              PASS  mutate=failed/permission_denied
EMU-D-viewer               ownership              PASS  mutate=failed/permission_denied
EMU-D-stale-selection      ownership              PASS  refused with zero I/O
EMU-D-no-owner             ownership              PASS  refused with zero I/O
EMU-E-cold-cache           rtdb-semantics         PASS  cold=blocked/target_not_found (fail-closed), warm=committed
```

The R9 negative control still reproduces the historical lost update, so the suite can
still detect the old bug — the rules and delete changes did not blunt it.

### New — the stale-delete contract on the real transport

```
EMU-F-stale-delete-supplier stale-delete  PASS  refused with conflictPaths=["supplier_payments.sup9"]
EMU-F-delete-unchanged      stale-delete  PASS  committed
EMU-F-unrelated-row         stale-delete  PASS  committed, no false stale
```

`EMU-F-stale-delete-supplier` is Codex's schedule end to end on a real RTDB: client A
holds the row as it saw it, client B commits `supplier_payments.sup9 = 500` through a real
transaction, A then deletes from its stale view. The delete is refused, the node is
byte-intact, the supplier payment survives and all 160 dates remain.

## Rules validation matrix — 30 cases

13 allow · 17 deny, `expected` vs `actual` identical in every row.

Allow: representative valid node · the create shape with `id` LAST · an ordinary edit · a
row removal · clear-all `[]` · duplicate dates with distinct ids · a 160-date history with
mixed key order · a row carrying only its id · free text containing braces · a direct `_v`
child write with a valid array · the owner role · a real RTDB transaction · escaped quotes
and Hebrew.

Deny: **non-JSON `_v`**, **id-less row JSON**, **object without `_v`** (the three Codex
proved) · an id-less row hidden among valid rows · `_v` that is not a string · truncated
JSON · uppercase id · wrong UUID version nibble · wrong variant nibble · array of scalars ·
object where an array is required · **the direct `_v` child write that would otherwise
bypass the parent rule** · id-less rows through the child path · beyond the size ceiling ·
cross-business · viewer role · unauthenticated.

## Commands

Exact commands, expected output and the environment notes (Java 21+, the cached emulator
JAR, and unsetting the proxy variables) are in `test/emulator/README.md`, sections
"Run the R10 concurrency validation", "Run the entries Rules validation matrix" and
"Running all three emulator scripts together".
