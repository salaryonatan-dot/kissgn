# Rules: `rows` Must Remain a Map (Codex SV2-07)

## Finding
Writing a string to `/rows` succeeded: with no `$rowId` child there was nothing to
validate, and the whole row map was overwritten.

## Change (structural, no textual JSON parsing)
- `rows/.validate`: `!(entries) || newData.hasChildren()`.
- V2 envelope validator: `(!newData.child('rows').exists() || newData.child('rows').hasChildren())`
  and `(!newData.child('_v').exists() || newData.child('_v').isString())`, plus the numeric
  epoch checks — so a parent write cannot replace the envelope with malformed types either.
- Row children: `id` string `=== $rowId`, `_gen` number `=== parent generation`, `date`
  string; the row map is a map of such children or absent (clear-all).

The emulator shows RTDB evaluates the validators of every ancestor of a written path, so
the envelope clause and the `rows` clause both hold; the mutation probe loosens the
invariant in both places to prove it is load-bearing.

## Proof
`V2-H03`: string / number / boolean at `/rows` and a node-level write with scalar `rows` —
deny ×4, rows untouched. `V2-I01/I05/I06`, `V2-C*`, `V2-G*`, `V2-H07`: valid row maps,
individual row writes/deletes and the empty state after clear-all remain allowed.
`V2-X01`, `V2-H01/H02`: malformed / downgraded envelopes denied.

Result: **PASS** (ROWS_MAP_RULE).
