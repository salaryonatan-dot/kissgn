# Rules — structural enforcement, no serialization

Every V2 validator uses child/path semantics. There is no regex over row content anywhere
in the V2 rules; the only patterns are on identifiers (a uuid v4 for a key, a generation
token) and on the entries-key name itself.

## What was added, at one location

Under `tenants/$tenantId/$dataKey`, all conditional on
`$dataKey.matches(/^biz:[^:]+:entries$/)`:

```
".validate"      newData.schemaVersion === 2 ? V2_NODE : ( !WAS_V2 && LEGACY_NODE )
"schemaVersion"  newData.val() === 2 && (!data.exists() || data.val() === 2)
"generation"     isString() && matches(/<uuid v4>/)
"_v"             root…schemaVersion === 2 ? newData.val() === data.val() : LEGACY_V
"rows/$rowId"    $rowId.matches(/<uuid v4>/)
                 && newData.hasChildren(['id','gen','date'])
                 && newData.child('id').val() === $rowId
                 && newData.child('gen').val() === newData.parent().parent().child('generation').val()
                 && newData.child('date').isString()
"rows/$rowId/id"    newData.isString() && newData.val() === $rowId
"rows/$rowId/gen"   newData.isString()
"rows/$rowId/date"  newData.isString()
```

`LEGACY_NODE` and `LEGACY_V` are the accepted R10.1 expressions, reused verbatim for
businesses that have not been converted.

Two details worth the reviewer's attention:

- The generation comparison uses `newData.parent().parent()`, not `root`. `root` is the
  pre-write tree, and during the cutover the generation does not exist yet, so a `root`
  comparison would deny the very write that creates it. `newData` is the resulting tree,
  so the same expression is correct for a whole-node cutover and for a single-row write.
- `_v` becomes immutable rather than forbidden once a business is V2. The clear-all
  transaction re-emits the whole node, including the frozen snapshot byte-identically, so
  an equality check is the right constraint; any change of value is denied.

## Proven against the real Rules engine

| Requirement | Case | Result |
|---|---|---|
| a row is a real child under `rows/{rowId}` | `V2-I01` | allow |
| top-level `id` required, equal to the key | `V2-I02` | mismatch denied |
| a nested `meta.id` cannot satisfy identity | `V2-I03` | denied |
| an arbitrary nested id cannot satisfy identity | `V2-I03` | denied |
| malformed top-level id | `V2-I04` | denied |
| non-canonical child key | `V2-I04` | denied |
| the immutable id cannot be changed | `V2-I08` | denied |
| duplicate ids unrepresentable | `V2-I05` | two-rows-one-id denied; writing one id twice is one row |
| duplicate dates across distinct ids | `V2-I06` | allowed |
| free text incl. `},{`, braces, quotes, newlines, Hebrew | `V2-I07` | allowed, stored verbatim |
| business isolation and role gating unchanged | `V2-A01` | cross-business, viewer, unauthenticated denied; owner allowed |
| legacy businesses unaffected | R10.1 rules matrix 30/30 | unchanged |
| whole authorization surface unaffected | authorization matrix 108/108 | unchanged |

## Semantic validation stayed proportional

Beyond `id`, `gen` and `date`, row fields are not type-constrained — the same floor the
codebase had before. Widening that would have been a data-model redesign, which this task
explicitly excludes. `KNOWN_LIMITATIONS.md` §3 records it.

## The S0 guard

`database.rules.json` remains a forbidden path in the S0 anti-migration guard. The
previously approved content-verified exception was **extended, not broadened in kind**: the
guard now also accepts the three V2 validators at that one location, and still requires
that the rules tree with exactly the authorized additions removed is deep-equal to the base,
that each addition is shaped exactly as authorized (a validator and nothing else beside it),
that the row contract contains its identity and generation clauses verbatim, and that no
addition is inert. Three mutation probes confirm it is still narrow — see
`REGRESSION_RESULTS.md`. Every VAT assertion is unchanged.

The rules file diff is large (205/180) because it was re-serialized with a consistent
indent. The content check above, not the line count, is what proves nothing else moved.
