# 06 — Offline test matrix (`test/finance/ev1-collector.test.mjs`, 25 tests; no network, no Production)

| Required case | Test | Asserted result |
|---|---|---|
| 1 all clean scopes | `01 all clean scopes` | `evidenceComplete: true`; all 19 invariants hold; counters: 2 tenants, 3 businesses, 4 rows |
| 2 tenant discovery/read failure | `02 tenant discovery / tenant keys / registry read failure` | false; failure recorded; failed tenant list ⇒ 0 discovered, I01 + I15 fail |
| 3 one business read failure | `03 one business read failure` | false; the other businesses still read; I08 fails |
| 4 successful empty business | `04/25 registered business with NO entries node` | true; `READ_OK_EMPTY`; `empty == 2` (absent node + empty array); `registeredWithoutStoredData == 1` |
| 5 malformed entries node | `05 malformed entries node` | six shapes (bad `_v` JSON, non-array `_v`, number, V2 bad generation, unsupported schema, stripped V2) ⇒ `STRUCTURE_BLOCKED`, false |
| 6 JSON/transport parse failure | `06 unparseable HTTP-200 body` | tenant list / keys / registry / entries ⇒ `json_parse`, false |
| — malformed discovery shapes | `malformed discovery shapes` | array / string / number shallow responses ⇒ `*_malformed`, false |
| 7 classifier throws | `07 classifier throws or returns unusable output` | `CLASSIFIER_FAILED`, false; also null output, wrong version, non-count leaf ⇒ `classifier_output_invalid` |
| 8 discovered business silently omitted | `08 … silently omitted (or never attempted)` | I05 / I06 fail for an omitted or `NOT_ATTEMPTED` business; I18 fails for a missing entries read; I19 fails for a shrunken scope; I13 fails for a tampered counter |
| 9 duplicate discovery hides no failure | `09 duplicate discovery` | one record; `duplicateRegistration` flag; failure kept; false; entries reads == attempted |
| — registry / key edge cases | `discovery: registry entry without an id …` | id-less entry, `_v` object, unknown shape, `biz::entries`, unaddressable id, listed-but-absent race ⇒ false |
| — scope completeness | `scope: unregistered stored data, self-id and explicitly-inactive …` | a deleted-from-registry business with data, a `tenantId == bizId` business and an `active:false` business are all censused; complete |
| 10 valid IDs | `10–22 every EV1/3 row state …` | `validIdRows` = 16 |
| 11 missing IDs | ″ | 1 |
| 12 malformed IDs | ″ | 1 |
| 13 duplicate IDs | ″ | `duplicateIdValues` 1, `duplicateIdRows` 2 |
| 14 invalid calendar date | ″ | `impossibleDateRows` 1 (+ `badShapeDateRows` 1, `futureRows` 1) |
| 15 supplier + legacy collision | ″ | 1 |
| 16 supplier zero | ″ | 1 |
| 17 supplier skip | ″ | 1 |
| 18 supplier invalid | ″ | 1 |
| 19 legacy food zero / invalid | ″ | 1 / 1 |
| 20 payroll + hourly_payroll | ″ | `payrollAndHourlyPayrollRows` 1; `legacyHourlyPayrollRows` 2 |
| 21 notes-only | ″ | 1 |
| 22 no-financial-value | ″ | `noFinancialValueRows` 3 (notes-only + empty + hourly-only); `emptyRows` 1; `malformedRows` (non-object) 1 ⇒ unclassifiable 1; I12 holds on real classifier output |
| 23 forbidden/mismatched environment | `23/24 forbidden or mismatched environment` | 23 cases, each exit 2 with **zero** fetch calls (list in 05), plus dirty tree |
| 24 emulator leakage | ″ | `FIREBASE_DATABASE_EMULATOR_HOST`, `?ns=` URL, localhost URL ⇒ refused before transport |
| 25 successful null value | `25 successful null values` + `04/25` | empty tenant root ⇒ complete with 0 tenants; absent registry ⇒ `state: absent`; null entries ⇒ `READ_OK_EMPTY` |
| — production path, success | `production path (fake fetch) …` | exit 0; non-GET = [token, IAM]; all DB requests GET; one entries read per business; no token/email/key in the bundle; verify ok |
| — production path, credential refusals | `production path: broad credential, IAM failure or token failure` | exit 3 with zero database requests (4 variants) |
| — production path, read failures | `production path: 401/403, 5xx, unparseable body and network errors` | exit 10; bundle preserved with `evidenceComplete: false`; `network` failure recorded |
| — JWT | `JWT assertion is RS256-signed …` | signature verifies with the public key; audience and scopes exact |
| — bundle | `bundle: private modes …` | dir 0700, files 0600, four files, COMPLETE binds digests + scope/source digests; payload/name/email/amount/row-id/date leak check; tamper ⇒ verify fails; no reuse of the out dir |
| — incomplete bundle | `bundle: incomplete evidence is preserved` | `COMPLETE.evidenceComplete: false`; verify ok but incomplete |
| — secret scan | `secret scan refuses …` | `report_would_leak_secret` |
| — CLI | `CLI: offline fixture run …` | exit 0 / 10; `--verify` 0 / 10; fixture refuses production inputs; zero network |
| — read-only static | `read-only proof …` | exact module graph and builtins; no write API; `fetch` only in the transport; pinned git argv; method literals `POST, POST, GET, GET` |
| — fail-open static | `fail-open patterns are absent …` | no `catch → []/{}/null`, no empty `catch` |

**Mutation check (manual, recorded in 08).** I seeded these faults one at a time; each was caught by the suite:
- treat a failed entries read as empty;
- treat HTTP ≠ 200 as `null`;
- accept a non-map shallow response as empty;
- ignore id-less registry rows;
- drop the environment check;
- decouple `evidenceComplete` from the invariants;
- keep row-id lists;
- swallow classifier exceptions.
