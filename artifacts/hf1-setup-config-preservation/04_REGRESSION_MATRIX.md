# 04 — Regression Matrix

Suite: `test/dashboard/setup-config-preservation.test.mjs` (23 tests, production text executed in `node:vm`). "Base" = run against the unmodified `05bf5a59` `index.html`.

| # | Case | Test | Base | HF-1 |
|---|---|---|---|---|
| 1 | Edit business name ⇒ employees + every non-owned key preserved | 1 | FAIL | PASS |
| 2 | Edit rent/royalty metadata ⇒ petty-cash categories preserved | 2 | FAIL | PASS |
| 3 | Edit targets ⇒ employees preserved; unknown `targets.*` sub-keys preserved | 3 | FAIL | PASS |
| 4 | Edit employees / petty-cash categories after a wizard edit ⇒ unrelated settings preserved (real `saveEmp`, `removeEmp`, `saveCats`, `saveBusinessConfig`) | 4 | FAIL | PASS |
| 5 | Absent optional fields stay absent (no `lat: null`, no invented employees/categories) | 5 | FAIL | PASS |
| 6 | No key deleted; only owned keys change, by explicit value | 6 | FAIL | PASS |
| 7 | Unknown / future keys survive | 7 | FAIL | PASS |
| 8 | Nested unrelated objects survive byte-for-byte (employees array, `oref_areas`, `shiftChecklists`, nested future module) | 8 | FAIL | PASS |
| 9 | Malformed stored config — unparseable JSON, array, `null`, number, JSON string ⇒ no write at all, alert, wizard stays open | 9 ×5 | FAIL ×5 | PASS ×5 |
| 9b | Read error other than "not found" (PERMISSION_DENIED) ⇒ no write | 9b | FAIL | PASS |
| 9c | Selection changes during the read ⇒ no write | 9c | FAIL | PASS |
| 10 | Repeated identical edit is idempotent | 10 | PASS | PASS |
| 11 | Create-new-business path unchanged (`completeSetup`, fresh id) | 11 | PASS | PASS |
| 11b | Edit of a business whose config was never stored ⇒ wizard fields only | 11b | PASS | PASS |
| 12 | First business (`bizId === tenantId`) edited in place under its own key | 12 | FAIL | PASS |
| — | Suppliers, fixed costs and the business list still written, same order | owned lists | PASS | PASS |
| — | Ownership list = exactly the keys of the real wizard `cfg` | helper | FAIL (no helper) | PASS |
| — | Merge is pure; ignores non-owned keys offered by the caller; never deletes | helper | FAIL | PASS |
| — | Stored-config decoding: absent / valid / malformed | helper | FAIL | PASS |

Totals: base 4 pass / 19 fail; HF-1 23 / 23.

Other config structures covered by the same mechanism: `targets` (nested, partly owned) — test 3; location lists (`region_ids`, `subregion_ids`, `lat`/`lon`) — tests 5, 6; legacy `oref_areas` / `custom_oref_areas` / `shiftChecklists` — tests 1, 8.

Not covered here: Firebase emulator Rules tests (`test/emulator/*`) need the emulator and were not run; HF-1 changes no Rules and no Rules-relevant path.
