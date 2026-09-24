# Firebase RTDB Emulator — Authorization Matrix

Deterministic authorization matrix that runs the **real** Realtime Database
Emulator Rules engine (`database.rules.json`) against synthetic fixtures. It is a
local-only, credential-free test. It never touches Production, never deploys, and
never uses a real project ID.

## What it verifies

108 authorization cases (37 expected‑allow, 71 expected‑deny) across: tenant &
auth isolation, `biz_access` business isolation, role tiers
(viewer/shift_manager/manager/owner/super_owner), manager‑tier biz keys, shift‑tier
operational keys, server‑mediated checklist paths, legacy & flat analytics/insights,
PIN & unknown/malformed keys, `entry_exceptions`, security metadata
(`roles`/`members`/`biz_access`/`access_meta`), delete semantics, validation and
multi‑location writes. Read/create/update/delete/patch are all exercised.

## How authentication is enforced (no extra dependency)

Uses only the repo's existing `firebase-admin`. Each synthetic identity gets its
own Admin app initialized with `databaseAuthVariableOverride`:

- `undefined` → admin (bypasses Rules) — used **only** to seed fixtures;
- `null` → unauthenticated (`auth === null` in Rules);
- `{ uid, token: { email } }` → that authenticated user; the emulator evaluates
  Rules as that principal.

This is the documented Admin‑SDK emulator mechanism. The harness is self‑defending:
if Rules were somehow bypassed, the 71 deny cases would all report unexpected
allows and the script would exit non‑zero — a false PASS is not possible.

## Safety

The script aborts before any request unless: project `demo-marjin-rules`,
namespace `demo-marjin-rules-default-rtdb`, host `127.0.0.1`, port `9000`,
`FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000`, `GOOGLE_APPLICATION_CREDENTIALS`
absent, and no Production Firebase URL in the environment. All I/O is localhost.

`test/emulator/firebase.json` configures only the Database emulator (UI disabled),
binds `127.0.0.1:9000`, and references `database.rules.json`. firebase-tools
requires the Rules file to live under the config directory, so
`test/emulator/database.rules.json` is a **byte-identical copy** of the canonical
repo-root `database.rules.json`. The harness verifies this at startup and aborts
if the two ever differ, so the matrix can never run against stale Rules. If you
edit the canonical Rules, refresh the copy:

```
cp database.rules.json test/emulator/database.rules.json
```

There is no `.firebaserc`, no project alias, no deploy target.

## Run it (host with Temurin Java 21)

Requires Java 21+ (firebase-tools 15.23.0 refuses older Java) and the repo-local
Firebase CLI. Run from the repository root:

```
env -u GOOGLE_APPLICATION_CREDENTIALS \
    -u FIREBASE_CONFIG \
    -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules \
    GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
    PATH="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec \
      --only database \
      --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/rtdb-authorization-matrix.mjs"
```

No Firebase login is required for the emulator. The first run downloads the RTDB
emulator JAR to the local firebase cache (localhost thereafter).

## Expected result

A per‑case table, then:

```
=== TOTALS ===
total=108 expected_allow=37 expected_deny=71 passed=108 failed=0
unexpected_allow=0 unexpected_deny=0 errored=0

ALL CASES PASSED
```

Process exit code `0`. `emulators:exec` then shuts the emulator down cleanly.

## Failure

Any unexpected allow/deny, harness error, safety/startup failure, or incomplete
matrix totals makes the script exit non‑zero. It prints a `=== FAILURES ===`
section with, per case: id, policy area, identity, operation, path, expected,
actual, and a severity hint (unexpected allow = P0/P1; unexpected deny = P2).
Do not modify `database.rules.json` to make a case pass — investigate first.

## Run the R10 concurrency validation

`entries-remote-atomic-emulator.mjs` drives the ACTUAL production write path
(`createRemoteEntriesMutator`, `createEntriesWriteCoordinator`, `applyEntryIntent`,
vm-extracted from `index.html`) against this same emulator. It is deliberately not
named `*.test.mjs`, so the repository glob `node --test test/**/*.test.mjs` — which
runs with no emulator — can never pick it up.

Run it from the repository root, exactly like the matrix above but with this script:

```
env -u GOOGLE_APPLICATION_CREDENTIALS \
    -u FIREBASE_CONFIG \
    -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules \
    GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
    PATH="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec \
      --only database \
      --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/entries-remote-atomic-emulator.mjs"
```

Expected: a per-case table, then

```
=== TOTALS ===
total=16 passed=16 failed=0

ALL CASES PASSED
```

Exit code `0`. Any unexpected result, safety abort or incomplete matrix exits nonzero.

What it covers: two genuinely independent clients (separate apps, connections, caches,
selection controllers, coordinators and mutators) over one real node — both completion
orders and true simultaneity; the R9 full-node read-modify-write **negative control**,
which must still reproduce the historical lost update, proving the suite can see the
bug; eight-way contention with real CAS retries; conflict with exact `conflictPaths`;
idempotent re-submission; `id_collision`; Rules-enforced cross-business, cross-tenant
and viewer denial; stale/no-owner refusal with zero I/O; and the cold-cache abort
behaviour of a real RTDB transaction, which no in-process fake store can model.

If the emulator JAR cannot be downloaded on the machine you are running on, copy an
existing `firebase-database-emulator-v*.jar` into `~/.cache/firebase/emulators/`
before running; the CLI uses the cached copy and needs no network for the emulator
itself. Java 21+ is required by firebase-tools 15.23.0 regardless.

## Run the entries Rules validation matrix

`entries-rules-validation-matrix.mjs` exercises the server-side `.validate` added for
`biz:{bizId}:entries` in R10.1 against the REAL Rules engine — 13 allow cases covering
everything the R10 runtime legitimately writes, and 17 deny cases covering the malformed
writes an authorized manager could previously make, including the direct `_v` child write
that would otherwise bypass the parent rule. Like the other two scripts it is not named
`*.test.mjs`.

```
env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules \
    GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
    PATH="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec \
      --only database \
      --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/entries-rules-validation-matrix.mjs"
```

Expected:

```
=== TOTALS ===
total=30 expected_allow=13 expected_deny=17 passed=30 failed=0
unexpected_allow=0 unexpected_deny=0 errored=0

ALL CASES PASSED
```

## Running all three emulator scripts together

Each script reseeds the database root, so they must run ONE AT A TIME against a single
emulator — never concurrently. A convenient single session:

```
... emulators:exec --only database --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/rtdb-authorization-matrix.mjs && \
       node test/emulator/entries-remote-atomic-emulator.mjs && \
       node test/emulator/entries-rules-validation-matrix.mjs"
```

This is also why `node --test test/**/*.mjs` is not a valid regression command for this
repository: it sweeps the three emulator scripts in with the unit suites, runs them in
parallel, and — with no emulator — trips their safety gate. Use
`node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`
for regressions and the commands above for the emulator work.

## Run the Storage V2 matrix

`storage-v2-matrix.mjs` proves the row-keyed entries contract against the real Rules
engine and the real transaction protocol: legacy mode still works, the preflight refuses
unconvertible data, the per-business cutover is atomic and cannot lose a concurrent legacy
write (with a negative control that does), row key == top-level id is structurally
enforced, duplicate ids are unrepresentable, duplicate dates survive, free text containing
`},{` is accepted, ordinary row writes stop contending, the R10.1 stale-delete contract
still holds, clear-all rotates a generation so nothing can be resurrected, and a legacy
client cannot corrupt a business after cutover.

Hardening R1 (cases `V2-H01`…`V2-H10`, closing Codex SV2-01…SV2-09) adds: the cutover is
irreversible on the server (no whole-node delete, downgrade or legacy re-creation once a
business is V2); the generation is a strictly monotonic integer epoch that only clear-all
advances, by exactly one, with an empty collection rotating too; an intent is bound to the
epoch it was submitted under and is refused — never restamped — when the epoch moved on;
the REAL coordinator converges on the authoritative listener value after row commits; an
absent business initialises straight into V2; the conversion preserves a legacy `gen`
domain field (the epoch stamp lives under the reserved `_gen` key) and reports its
approved canonicalization; an exact create retry with the UI template is idempotent; the
row map cannot be replaced by a scalar; and the legacy engine refuses a V2 node instead of
reporting success against the frozen `_v`. `V2-M04` now forces the cutover race with a real
ETag barrier (one HTTP 412 retry, `runs=2`).

Hardening R2 (cases `V2-W01`…`V2-W04`, closing Codex R1-F1…R1-F3) runs the ACTUAL dashboard
initialization block and selection-effect listener block of `index.html`
(`test/support/dashboard-wiring-harness.mjs`) over the real SDK: absent first save, create,
edit, delete and clear-all through the production wiring; a retired binding refused before
any transaction and no cross-business binding reuse; a clear completion that never
overwrites a newer authoritative listener snapshot; and numeric-key MAP fields whose real
RTDB array readback is idempotent on an identical retry while real changes still collide.

```
env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules \
    GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
    PATH="/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec \
      --only database \
      --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/storage-v2-matrix.mjs"
```

Expected:

```
=== TOTALS ===
total=46 passed=46 failed=0

ALL CASES PASSED
```

## Run the Rules-guard mutation probe

`storage-v2-rules-guard-mutations.mjs` proves that the S0 anti-migration guard's rejections
of the entries Rules contract are meaningful. The guard (`test/support/rules-authorized-delta.mjs`,
consumed by `test/finance/vat-invariant.test.mjs`) pins the authorized delta as literal
expressions and compares a whitespace-normalized expression tree, so an inert wrapper such as
`true || (…)` is rejected. This probe loads each rejected mutation into the real emulator
through its local settings endpoint, shows that a write the shipped Rules deny becomes
allowed, restores the shipped Rules and shows it is denied again.

```
... emulators:exec --only database --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/storage-v2-rules-guard-mutations.mjs"
```

Expected:

```
=== TOTALS ===
mutations=12 proven_weakening_and_guard_rejected=12 failed=0

ALL MUTATIONS PROVEN: each guard rejection corresponds to a real loss of server enforcement
```

## Run the server-reader convergence matrix

`server-readers-matrix.mjs` proves the P0-DATA-01 server-reader convergence against the
real emulator with the REAL compiled server modules (`test/support/server-reader-harness.mjs`
compiles `src/` + `lib/` with only the Admin-SDK and email seams replaced; the Admin seam is
then pointed at the real Admin SDK database). Every converged reader — `dailyBuilder`,
`snapshotBuilder`, the three analytics repositories and `fetchPlannedData` routing,
`entryExceptionsRepo`, the two non-firing alert checkers through `runAlertsForBiz`, and the
legacy preflight report — runs through the shared reader (`lib/analytics/entriesReader.js`)
against nodes stored by RTDB, including nodes converted by the approved
`upgradeBusinessToV2` transaction, so RTDB's own readback normalization (numeric-key maps
read back as arrays) is what the readers see.

Cases `SR-01`…`SR-10`: legacy business; migrated V2 (identical analytics doc, repository
metrics, snapshot and exceptions before and after conversion); native V2 without `_v`;
stale-`_v` poison (rows win, the stale exception flag is never surfaced); every malformed
V2 variant fails closed in every reader with nothing persisted and no email; healthy
siblings continue when a business is ambiguous or malformed (`buildAnalyticsForAll`,
`buildSnapshotForAll`); CTO D1 duplicate-date ambiguity in both physical forms (typed
refusal, both rows aggregated, `legacy_ambiguous` exception fallback, node untouched);
CTO D2 non-firing checkers on anomaly bait in four node forms; the preflight duplicate-date
report (informational, conversion keeps both rows); a post-conversion direct row change
that every reader sees while the frozen `_v` still holds the old value; and (`SR-11`, server
readers R1 / Codex SR-F1) the ACTUAL proactive flow (`runForBiz`) on a duplicate "yesterday"
in eight logically identical representations (legacy `[A,B]` / `[B,A]`, V2 keyed both ways,
each with the UUID lexical order reversed) — one daily metric per date, the same persisted
insight (`currentValue` = the aggregate) and the same digest every time; and (`SR-12`, R2) the
Codex decimal counterexample (17×600, 812, 500, 500 + {100.1, 200.2, 300.3}) in 24
representations — exactly 600.6, detector null, identical persisted insight-set and digest.
Outbound `fetch`
is fenced to the emulator host, so the weather / oref lookups fail closed as they do
offline.

```
... emulators:exec --only database --project demo-marjin-rules \
      --config test/emulator/firebase.json \
      "node test/emulator/server-readers-matrix.mjs"
```

Expected:

```
=== TOTALS ===
total=12 passed=12 failed=0

ALL CASES PASSED
```

There are now SIX emulator scripts, and they all reseed the database root (the mutation
probe also swaps the loaded Rules), so they still must run one at a time against a single
emulator.
