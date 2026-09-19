# Cutover Permanence (Codex SV2-01)

## Finding
`remove(entries)` was allowed on a V2 node, and the next legacy `set({_v})` restored legacy
authority — the schema marker was gone, so every "no downgrade" validator had nothing to
compare against. Root cause: RTDB evaluates `.validate` only for non-null results, so a
delete can only be constrained in `.write`.

## Change
`database.rules.json`, entries branch of `tenants/$tenantId/$dataKey/.write`:

```
(<authorization predicate, byte-identical to base> && (!(data.child('schemaVersion').val() === 2) || newData.child('schemaVersion').val() === 2))
```

Once the stored node is V2, every write at or under the node — including a delete — must
leave `schemaVersion === 2` in the result. The predicate is data-state only; who may write
is unchanged (the S0 guard verifies the `.write` rule equals the base rule plus exactly
this clause, and the authorization matrix is 108/108 unchanged). The clause also covers
schema-marker deletion, downgrade to 1, and `{_v}`-only / marker-less parent replacement.
A legacy (never converted) node keeps its previous behaviour, so nothing pre-cutover moves.

Clear-all is not a downgrade: it writes `{schemaVersion:2, generation:+1, _v}` and passes.

## Proof (real emulator, manager and owner identities)
`V2-H01` — deny ×11: whole-node `set(null)`, SDK `remove()`, legacy re-create `{_v}`,
schema marker delete, schema downgrade to 1, marker-less envelope, for both roles; node
byte-intact afterwards; the legacy business `bizB` can still be deleted (scope check).
`V2-X01` — legacy whole-node write / `_v` child write / downgrade still denied.
`V2-G01`, `V2-H04`, `V2-H06` — clear-all through the engine and the real coordinator allowed.
Mutation probe — dropping or weakening the clause makes the whole-node delete ALLOWED
(`storage-v2-rules-guard-mutations.mjs`, rows "cutover guard dropped/weakened"), and the
S0 guard rejects both mutations.

Result: **PASS** (3/3 rounds).
