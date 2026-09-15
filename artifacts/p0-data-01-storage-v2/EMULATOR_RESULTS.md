# Emulator results — Storage V2

Local only: project `demo-marjin-rules`, namespace `demo-marjin-rules-default-rtdb`, host
`127.0.0.1:9000`, credentials absent. Every script aborts before any request if that is
untrue. **No Production or Preview RTDB was read or written.**

Four scripts, each reseeding the database root, so they run one at a time.

## Rounds

| Script | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `storage-v2-matrix.mjs` | **32/32** | 32/32 | 32/32 |
| `rtdb-authorization-matrix.mjs` | **108/108** | 108/108 | 108/108 |
| `entries-remote-atomic-emulator.mjs` | **19/19** | — | — |
| `entries-rules-validation-matrix.mjs` | **30/30** | — | — |

All four exited 0 in the combined round. The two R10/R10.1 suites were re-run unchanged
against the new rules; the legacy path is untouched.

## Storage V2 matrix — 32 cases

```
V2-L01  legacy         legacy read/write intact
V2-P01  preflight      ok, 3 rows, node untouched
V2-P02  preflight      blocked: missing_entry_id
V2-P03  preflight      blocked
V2-P04  preflight      blocked
V2-M01  cutover        3 rows, schemaVersion=2, generation set, _v frozen
V2-M02  cutover        refused
V2-M03  cutover        refused: missing_entry_id
V2-M04  cutover        4 rows — concurrent legacy write preserved
V2-M05  cutover        lost update reproduced, as required of a negative control
V2-I01  identity       allow
V2-I02  identity       deny
V2-I03  identity       deny, deny
V2-I04  identity       deny, deny
V2-I05  identity       structurally impossible
V2-I06  identity       allow, allow
V2-I07  identity       allow — the serialization artifact is gone
V2-I08  identity       deny
V2-C01  concurrency    both committed, 2 callback runs for 2 writes — no contention
V2-C02  concurrency    conflictPaths=["sales"]
V2-C03  concurrency    refused
V2-C04  concurrency    committed, no false stale
V2-C05  concurrency    committed
V2-G01  generation     rotated
V2-G02  generation     client=failed, rules=deny
V2-G03  generation     committed
V2-G04  generation     refused: blocked/precondition_failed
V2-G05  generation     refused: blocked
V2-X01  compatibility  deny ×3, node unchanged
V2-X02  compatibility  fail-closed, twice
V2-X03  compatibility  blocked_unhydrated ×2
V2-A01  authorization  deny ×3, allow ×1

=== TOTALS ===
total=32 passed=32 failed=0
ALL CASES PASSED
```

## The four results that carry the most weight

**`V2-C01` — contention is gone.** Two independent clients edit two different rows in
parallel: both commit, and the mutator reports **1 callback run each**. In legacy, the same
schedule is a whole-node compare-and-swap where one writer re-runs against the other. This
is the explicit V2 goal, measured rather than asserted.

**`V2-M04` / `V2-M05` — the cutover is really atomic.** A legacy writer commits during the
cutover. The transactional path re-runs on the fresher value and the row is present
afterwards (4 rows). The negative control, given the same schedule, reports success and the
row is gone (3 rows). The suite can see the bug it is claiming to prevent.

**`V2-I05` — duplicate ids are unrepresentable.** Writing two children that share one id is
denied, and writing the same id twice simply addresses the same node: the assertion is that
one id yields exactly one row, not that a duplicate was detected.

**`V2-G02` — no resurrection.** A client holding the retired generation cannot recreate a
cleared row, and the refusal is proven at the Rules engine as well as at the client, so it
is not a timing-only guarantee.

## Commands

See `test/emulator/README.md`. The V2 matrix runs the same way as the others:

```
… firebase emulators:exec --only database --project demo-marjin-rules \
    --config test/emulator/firebase.json \
    "node test/emulator/storage-v2-matrix.mjs"
```

Expected `total=32 passed=32 failed=0`, `ALL CASES PASSED`, exit 0. Java 21+ required; if
the emulator JAR cannot be downloaded, place `firebase-database-emulator-v4.11.2.jar` in
`~/.cache/firebase/emulators/`; if rules loading reports *Request was cancelled*, unset the
proxy variables for the command.
