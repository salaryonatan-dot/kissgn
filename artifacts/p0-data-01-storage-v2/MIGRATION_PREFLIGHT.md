# Preflight — read-only, deterministic, never repairs

`tools/storage-v2/preflight.mjs`. Pure functions only; no I/O of any kind; no CLI; not
imported by the runtime. The production helpers are **injected** (`parseEntriesNode`,
`isValidEntryId`, `isPlainRow`, `entryDateKey`, `detectStorageMode`), so the preflight
cannot drift from the contract it is checking.

It answers one question: may this business be converted as it stands?

## Report

```
{ ok, mode, rowCount, rows?, blockers: [ { code, … } ] }
```

`rows` is present **only** when `ok` is true, so a blocked report cannot be fed onward by
accident (`V2-P02` asserts it).

| Blocker | Meaning | Remedy recorded |
|---|---|---|
| `already_v2` | the business is already converted | — |
| `malformed_node` | unparseable `_v`, or a malformed/unsupported node | operator investigation |
| `not_an_array` | the blob parses but is not an array | operator investigation |
| `unsupported_row_shape` | a non-object row, or an id that is not a canonical uuid v4 | operator investigation |
| `missing_entry_id` | one or more rows carry no immutable id | `approved_offline_entry_id_assignment` |
| `duplicate_entry_id` | two rows share an id | `operator_resolution_required` |
| `invalid_entry_date` | a row's date is not a usable `entryDateKey` | operator investigation |

Blockers are emitted in a fixed order and carry counts and indexes, so the same input
always produces the same report.

## Two remedies it will not perform

**`missing_entry_id`** names the contract of the separately approved offline entry-id data
action. The preflight does not assign ids, does not plan an assignment, and does not
import that transformer — the TEST-ONLY boundary test that guards it still passes
unchanged (`entries-id-contract.test.mjs`, 12/12).

**`duplicate_entry_id`** is not machine-resolvable: which of two rows sharing an id is the
real record is a business decision. It is reported and deferred.

## Absent nodes

A business with no entries yet is `ok` with zero rows, and converts to an empty V2
collection with a fresh generation. That is the correct outcome, not a special case.

## Evidence

`V2-P01` valid data passes and the node is byte-identical afterwards · `V2-P02` missing id
blocks and names the approved action · `V2-P03` duplicate ids block and defer to an
operator · `V2-P04` a malformed blob blocks · `V2-M03` the cutover refuses on any blocker
and leaves the business legacy.
