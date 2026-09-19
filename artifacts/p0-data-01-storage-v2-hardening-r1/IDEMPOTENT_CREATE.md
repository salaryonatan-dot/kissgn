# Idempotent Create Retry (Codex SV2-06, second half)

## Finding
`EMPTY_ENTRY` has `supplier_payments: {}`; RTDB drops the empty map; an exact retry of the
create compared the original JSON shape with the stored row and reported `id_collision`.

## Semantic idempotency
same immutable id + same **canonical** row content + same epoch ⇒ `committed_idempotent /
already_created`; same id with genuinely different content ⇒ `blocked / invalid_identity /
id_collision`.

`canonicalRowKey(row) = stableStringify(canonicalStorageValue(row))` where the canonical
form removes exactly what the store cannot hold (`null`/`undefined`/`{}`/`[]`, recursively)
and keeps everything else verbatim — `""`, `0`, `false`, types, nesting. So `{a:1, b:{}}`
equals `{a:1}` but `{a:1}` ≠ `{a:"1"}` ≠ `{a:1, b:0}`. The V2 engine writes the canonical
form (`stampRow`), so client comparison, written value and stored value coincide. The
delete precondition uses the same equality (the R10.1 complete-row contract, expressed at
the level of what is storable). Collision detection is not weakened: only differences the
store itself cannot express are forgiven.

## Proof
`[H7]` unit ×3: canonical-form table; exact retry with dropped empty map → `already_created`;
changed field / extra field / non-empty map / reserved key → collision (or `reserved_field`);
what the engine writes is the canonical form.
`V2-H09` emulator with the real `EMPTY_ENTRY`: create committed (store holds no empty map),
exact replay `committed_idempotent/already_created`, changed replay `blocked` with
`detail: id_collision`, first value stands. `V2-H07`: the identical first save of a new
business, repeated, is idempotent through the real coordinator.

Result: **PASS** (IDEMPOTENT_CREATE_RETRY).
