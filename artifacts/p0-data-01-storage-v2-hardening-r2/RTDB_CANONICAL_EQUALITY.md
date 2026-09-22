# RTDB Canonical Equality — numeric-key maps (Codex R1-F3)

## Finding
`hourly_payroll: {"0":10,"1":20}` is a valid row value (supplier / employee ids are often
numeric strings). RTDB stores it as children `0`, `1` and the SDK reads a dense integer-key
map back as the ARRAY `[10, 20]`. R1's canonical form compared the submitted object with
the stored array → an identical same-epoch create retry reported `id_collision`. Preflight
accepted such rows without reporting the representation change.

## Which fields, and why only those
`MAP_FIELDS = ["supplier_payments", "hourly_payroll"]` (the lifecycle's own constant, used
by patch/base paths and `rowDiffPaths`). Their domain shape is a map keyed by supplier /
employee id: element ORDER carries no meaning, keys do. For these two fields — and only
these — an array is therefore the same value as `{ String(index): element }`, and a `null`
element (RTDB hole) is an absent key. Every other field keeps array semantics (order is
content), and a numeric-key object anywhere else is NOT reinterpreted (it would differ on
readback; preflight blocks it: `unrepresentable_value / numeric_key_object_outside_map_field`).

`canonicalRowValue(row)`: top-level map fields → `canonicalMapField` (array → indexed map →
`canonicalStorageValue`), everything else → `canonicalStorageValue` (unchanged R1 rules:
null/undefined/{}/[] absent). `canonicalRowKey` = `stableStringify(canonicalRowValue)`;
`stampRow` writes the canonical map form (identical RTDB storage either way). The delete
precondition, create idempotency and `id_collision` detection all use it. Content
differences remain differences: a changed amount, a changed cardinality, a changed key,
swapped amounts. Immutable-id collision protection is untouched.

Preflight now reports `normalization.numericKeyMaps: {rowsAffected, rows:[{index, fields}]}`
so the conversion's representation change is visible up front, and treats a null inside a
map-field array as an absent key rather than a blocking hole.

## Proof
Unit B3-unit: equality table (object ≡ array readback; hole ≡ absent key; amount /
cardinality / order-of-amounts / key changes differ; non-map array order preserved;
numeric-key object outside map fields not reinterpreted; existing canonical equality
unchanged; written form is the canonical map); NEGATIVE CONTROL: the pre-R2 comparator
(`canonicalStorageValue` over the whole row) reports the false difference.
Unit B3-runtime (in-memory RTDB with array readback): create → retry `committed_idempotent /
already_created` → changed amount / cardinality / key → `id_collision`.
Emulator `V2-W04` (REAL SDK readback `[10,20]`): A create, B readback array, C identical
retry `already_created`, D changed value collides, E changed cardinality collides,
F swapped amounts differ (unit), G ordinary object equality unchanged, H negative control
old comparator false collision; plus the conversion path: legacy row with a numeric-key
payroll map → preflight REPORTS it → converted → array readback → identical retry
idempotent. Three consecutive rounds.

Result: NORMALIZED_MAP_IDEMPOTENCY PASS · REAL_CONTENT_COLLISION PASS.
