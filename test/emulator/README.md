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
