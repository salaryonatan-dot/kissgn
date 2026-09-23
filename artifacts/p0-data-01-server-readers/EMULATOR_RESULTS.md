# EMULATOR RESULTS — real Firebase RTDB emulator (demo-marjin-rules, 127.0.0.1:9000)

Host: macOS, Temurin JDK 21.0.5+11, firebase-tools from the worktree's `node_modules`,
proxy variables unset, `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_CONFIG` /
`FIREBASE_DATABASE_URL` unset, project `demo-marjin-rules`, rules copy byte-identical to
`database.rules.json` (safety abort otherwise). Scripts run one at a time.

## `test/emulator/server-readers-matrix.mjs` (NEW) — 3 consecutive rounds

Real compiled server modules (`test/support/server-reader-harness.mjs`, Admin seam →
the real `admin.database()`), real `upgradeBusinessToV2` transaction for conversions,
outbound `fetch` fenced to the emulator host.

| case | area | R1 | R2 | R3 | notes |
|---|---|---|---|---|---|
| SR-01 | legacy | PASS | PASS | PASS | sales=1000 food=1234 payroll=400; 12 daily records; snapshot ok |
| SR-02 | migrated | PASS | PASS | PASS | converted gen=1; doc/repos/snapshot/exceptions identical before/after; numeric-key map read back as array tolerated |
| SR-03 | native-v2 | PASS | PASS | PASS | no `_v`; gen 3; sales=5000; 8 records; absent date absent |
| SR-04 | no-fallback | PASS | PASS | PASS | doc 555 / 2 records / no stale exception |
| SR-05 | malformed | PASS | PASS | PASS | 8 variants fail closed in 7 readers; no analytics/insights/email |
| SR-06 | isolation | PASS | PASS | PASS | 2 docs / 2 typed failures; snapshots for 3 of 4 |
| SR-07 | duplicate-date | PASS | PASS | PASS | both forms: typed refusal, sibling date ok, both rows aggregated, legacy_ambiguous, node untouched |
| SR-08 | alerts-d2 | PASS | PASS | PASS | 4 node forms: [] / [] / no persisted alert / no digest |
| SR-09 | preflight | PASS | PASS | PASS | reported, not blocked; 3 rows survive conversion; reader agrees |
| SR-10 | conversion | PASS | PASS | PASS | rows 999 / deleted absent / stale `_v` exception unseen |

Totals each round: `total=10 passed=10 failed=0 — ALL CASES PASSED` (exit 0).
Round timings (ms, R1/R2/R3): SR-01 1251/1074/960 · SR-02 630/506/452 · SR-05 1290/1353/1065 · SR-08 1074/1160/910; all others < 900.

## Storage V2 core regression (same worktree, unchanged core)

| script | result |
|---|---|
| `storage-v2-matrix.mjs` | `total=46 passed=46 failed=0 — ALL CASES PASSED` |
| `storage-v2-rules-guard-mutations.mjs` | `mutations=12 proven_weakening_and_guard_rejected=12 failed=0` |
| `rtdb-authorization-matrix.mjs` | `total=108 expected_allow=37 expected_deny=71 passed=108 failed=0` |
| `entries-remote-atomic-emulator.mjs` | `total=19 passed=19 failed=0` |
| `entries-rules-validation-matrix.mjs` | `total=30 expected_allow=13 expected_deny=17 passed=30 failed=0` |

## Observations (not defects in this slice)

- Two matrix fixes during bring-up, both in the test, not in production code:
  (a) `dailyBuilder` copies `config.region_ids` / `config.subregion_ids` verbatim into
  `meta.location`; the real Admin SDK rejects `undefined` inside a `set()` payload, so the
  matrix seeds both as `[]`. **Pre-existing production behaviour**: a business whose config
  lacks both keys would fail `saveAnalyticsDoc` with `value argument contains undefined`
  (the in-memory harness JSON-round-trips and hides it). Recorded in KNOWN_LIMITATIONS.
  (b) `DailyMetric` exposes `revenue`, not `sales` (assertion fixed).
- Expected noise in the log: `[analytics/weather] failed: network fenced…` /
  `[analytics/oref] failed: network fenced…` (the fence working), and
  `[analytics] biz … failed: …` lines for the deliberately ambiguous / malformed businesses.
