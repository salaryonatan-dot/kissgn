# Conversion Data Preservation (Codex SV2-06, first half)

## Finding
The epoch stamp was written under `gen`, so a legacy row carrying its own `gen` field was
overwritten and the reader stripped it. Values RTDB cannot hold (`null`, `{}`, `[]`) also
vanished without being reviewed.

## What `gen` is
`gen` does not appear in the UI row template (`EMPTY_ENTRY`) or any runtime writer, but a
legacy JSON row can carry any field, and the preflight promises to preserve all legitimate
legacy business fields. So it is treated as **application data** and the lifecycle
metadata gets a name that is structurally reserved for infrastructure, following the
existing `_v` convention: **`_gen`** (`ROW_GEN_KEY`).

- The reader strips only `_gen`; `gen` (any value) is application data and survives.
- A legacy row that already carries `_gen` is a preflight BLOCKER
  (`reserved_field_present`, remedy `operator_resolution_required`) — never overwritten.
- Rules validate `_gen`; a row stamped under `gen` is denied (`V2-H02`, mutation probe).
- The runtime refuses `_gen` in a create/patch (`reserved_field`).

## Representation policy (explicit, reviewed up front)
`canonicalStorageValue` is the ONE approved transformation: `null` / `undefined` / `{}` /
`[]` are absent in the store (RTDB semantics). The conversion writes rows through the same
`stampRow` the runtime uses, so what is written equals what is stored. Preflight now:
- REPORTS `normalization: {rowsAffected, rows:[{index, paths}]}` — every value the
  conversion will drop, per row, so the operator reviews the transformation before
  converting;
- BLOCKS `unrepresentable_field_key` (key with `. # $ / [ ]` or control chars, at any depth)
  and `unrepresentable_value` (`null` inside an array, non-finite number) — anything RTDB
  would alter in a way the canonical form does not express.
The epoch is not a caller input any more (`generation_not_callable`); a converted business
starts at epoch 1.

## Proof
`[H6]` unit ×2 and `V2-H08` emulator: legacy row `{gen:"legacy-domain-value", nullable:null,
supplier_payments:{}, hourly_payroll:{}, list:[], notes:""}` → preflight ok with
`normalization.rows[0].paths = nullable,supplier_payments,hourly_payroll,list`; conversion
committed; stored row has `gen:"legacy-domain-value"`, `_gen:1`, `notes:""`; the semantic
row reads back `gen` intact without `_gen`; the three representation blockers each block.
`V2-M01/M04/M05`: all rows, duplicate dates and a concurrent legacy write preserved (M04 now a
real ETag barrier: `runs=2`, one HTTP 412, four rows).

Result: **PASS** (MIGRATION_GEN_PRESERVATION).
