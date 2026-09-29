# 02 — Fail-closed contract

## `evidenceComplete`
- Computed by `evaluateReport(report)` from the report JSON alone. The same function re-runs in `--verify`.
- `evidenceComplete` is the conjunction of I01–I20 (I20 and the per-business `rows.unclassifiable == malformedRows` equation added in remediation R1; see `../m1-financial-core-ev1-collector-remediation-r1/01_P1_UNCLASSIFIABLE_CLOSURE.md`).
- It is `true` only if **every** invariant holds; I15 includes "the failure list is empty".

| id | Invariant |
|---|---|
| I01 | tenant enumeration succeeded (list read ok, map-shaped, every id addressable) |
| I02 | `tenants.attempted == tenants.discovered`; tenant records equal the discovered list, in order, without duplicates |
| I03 | `tenants.succeeded + tenants.failed == tenants.attempted` (succeeded = keys listing ok + registry decoded + no unidentifiable entry or unattributable key) |
| I04 | `tenants.failed == 0` |
| I05 | exactly one business record per discovered `(tenant, business)`, same order, no duplicates |
| I06 | `businesses.attempted == businesses.discovered` |
| I07 | `businesses.readOk + businesses.readFailed == businesses.attempted` (readFailed = transport failures + structural blocks) |
| I08 | `businesses.readFailed == 0` |
| I09 | `businesses.classified + businesses.classifierFailed == businesses.readOk` |
| I10 | `businesses.classifierFailed == 0` |
| I11 | `rows.observed == rows.classified + rows.unclassifiable` |
| I12 | per business, see "Per-business equations" below |
| I13 | the `counters` block equals a recomputation from the scope records |
| I14 | the aggregate classification equals the sum of per-business classifications |
| I15 | `failures` is empty |
| I16 | run identity is consistent (see below) |
| I17 | transport read-only: every database request is GET; the only POSTs are `oauth_token` and `iam_test_permissions` |
| I18 | number of entries reads == `businesses.attempted` (exactly one per business) |
| I19 | recorded `scopeDigest` == digest recomputed from the tenant/business lists |
| I20 (R1) | zero unclassifiable rows: `counters.rows.unclassifiable == 0`, Σ per-business `rows.unclassifiable == 0` and Σ classifier `malformedRows == 0`; every business with such rows also carries a `rows_unclassifiable` failure (count only) |

**Per-business equations (I12).**
- Row counts:
  - `rowsTotal == rows.observed`;
  - `observed == classified + unclassifiable`.
- EV1/3 exclusive partitions:
  - `objectRows == validIds + missingIds + malformedIds`;
  - `objectRows == validDate + badShapeDate + impossibleDate`;
  - `validDateRows == futureRows + actualWindowRows`;
  - `noFinancialValueRows == legacyHourlyOnly + notesOnly + empty + invalidOnly`.
- `READ_OK_EMPTY` ⇔ zero rows.

**Run identity (I16).**
- `schemaVersion = EV1_COLLECTOR/1`, `classifierVersion = EV1/3`, a real as-of date and a `runId`.
- In production mode, additionally:
  - project and database equal the expected Production constants;
  - `repoSha == expectedCommit`;
  - the tree is clean.

## Terminal outcome per discovered business (exactly one)
| Outcome | Meaning | Counts as |
|---|---|---|
| `READ_OK` | HTTP 200, node decoded by `readEntriesNode`, ≥ 1 row | readOk |
| `READ_OK_EMPTY` | HTTP 200 with `null` (node absent), or a decoded empty array | readOk + empty |
| `READ_FAILED` | network, timeout, 401/403 (`unauthorized`), other status (`http_status`), unreadable body, unparseable HTTP-200 body (`json_parse`) | readFailed |
| `STRUCTURE_BLOCKED` | HTTP 200 but the node is undecodable (`entries_node_malformed`: legacy unparseable, V2 structure violation, unsupported schema) or listing/value inconsistent | readFailed |

Classification then yields `CLASSIFIED` or `CLASSIFIER_FAILED`: the classifier threw, returned a non-object, a version other than EV1/3, or any non-count leaf. Only `READ_OK*` businesses are classified, exactly once, with the complete decoded array.

## Rules
- **A failed read is never an empty value.**
  - Transport results are typed; only HTTP 200 `null` is an empty success.
  - Discovery decoders return `{ok:false}` on any unexpected shape.
- **No retry.** An ambiguous outcome is recorded; the operator reviews it. The collector never re-attempts.
- **No fail-open code.** `catch => [] / {} / null` and empty `catch {}` are prohibited; the test "fail-open patterns are absent" enforces this over the three collector modules.
- Every `catch` either returns a typed failure (`{ok:false, code}`) or throws a typed refusal.
- A preflight or transport refusal (credential or scope proof) exits before any database read, with no bundle (exit 2 / 3).
- A data, read or classifier problem produces a **complete bundle with `evidenceComplete: false`** (exit 10). The evidence is preserved.
- Output failure (secret scan, exclusive-create failure) ⇒ exit 4. `COMPLETE.json` is not written because it is written last.

| Exit | Meaning |
|---|---|
| 0 | complete |
| 2 | refused (usage/preflight) |
| 3 | transport refused (token / IAM / broad credential) |
| 4 | output failed |
| 10 | evidence incomplete / verify incomplete or invalid |
