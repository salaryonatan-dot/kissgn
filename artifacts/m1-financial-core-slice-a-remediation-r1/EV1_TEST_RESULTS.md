# EV-1 Test Results (fixture-only; no Production, no network, no credentials)

`node --test test/finance/ev1-classifier.test.mjs` → **9 pass / 0 fail** (also part of the full suite).

| Test | Covers |
|---|---|
| calendar | valid leap day `2028-02-29`, `2000-02-29`; invalid leap day `2027-02-29`, `2100-02-29`; `2026-02-30`, `2026-02-31`; invalid month `2026-13-01`, `2026-00-10`; invalid day `2026-04-31`, `2026-04-00`; bad shapes |
| identity states | valid UUID v4, missing (undefined/null/""), malformed (non-UUID, uppercase, non-v4, number) |
| cells | zero/−0, negative, grouped thousands, ambiguous comma, wrong type, float noise out of range, skip rules, whitespace |
| adversarial census (28-row fixture) | valid/missing/malformed/duplicate ids; bad-shape/impossible/future/actual-window dates; duplicate dates; supplier zero/skip/negative/invalid/offsetting/invalid map; legacy food positive/zero/invalid/legacy-only; VD-16 collision + selection change + supplier-with-invalid-legacy; labor present/zero; notes-only, empty, invalid-only, rows with invalid cells; VD-23 zero-only, not-entered-today, revenue-zero, labor-only, hourly-only, other-income-only, other-expense-only, purchases-only; invalid cells by reason/field; malformed (non-object) row |
| duplicate non-string ids | numeric duplicates counted; only canonical UUIDs emitted |
| safe output | no notes text, malformed id values, raw amounts, row dates or payload strings in the output; only canonical UUIDs |
| fail-closed | non-array rows, undecoded node object, invalid/undefined as-of ⇒ `Ev1InputError`; `summarize` incomplete for no businesses, any read failure or unknown failures |
| cross-check vs Financial Core (compiled + committed) | core rejects duplicate ids (EV-1 reports them); same VD-16 rows; same future count; same invalid-date count |

EV-1 contract status: **READY** (contract + classifier). Execution still requires the reviewed read-only collector and CTO authorization; B1 remains blocked on EV-1 evidence.
