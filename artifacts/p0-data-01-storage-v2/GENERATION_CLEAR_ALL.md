# Generation / clear-all

Clear-all is the one collection-wide operation, and the one irreversible one. V2 keeps
R10's compare-and-swap for it and adds an epoch so a client that never saw the clear
cannot put a row back.

## The contract

- `generation` is a canonical uuid v4 at the collection node.
- Every row stores the `gen` it was written under.
- Rules require `row.gen === the live generation` (`newData.parent().parent().child('generation')`).
- Clear-all is **one transaction on the whole entries node**: it checks the operator's
  confirmed content fingerprint, drops `rows`, and writes a new `generation`.

Rotating the generation is what retires the old epoch. It is not a timestamp, not a
counter and not a timing window: a row carrying a retired `gen` is refused by the server.

## Properties, and where each is proven

| Property | Case | Evidence |
|---|---|---|
| clear-all atomically invalidates the previous generation | `V2-G01` | `generation` rotated, `rows` gone, `_v` still frozen |
| existing rows are cleared | `V2-G01` | node has no `rows` |
| a stale client cannot recreate an old row | `V2-G02` | client create does not commit **and** a raw write with the retired `gen` is denied by Rules |
| new writes belong to the active generation | `V2-G03` | a client on the new generation creates immediately |
| ordinary write vs clear-all is deterministic | `V2-G04` | the edit lands; the clear-all is refused (`precondition_failed`), nothing is cleared, the edit survives |
| delete vs clear-all is deterministic | `V2-G05` | the delete lands; the clear-all is refused; the remaining rows survive |
| no silent resurrection | `V2-G02` | denied at the server, not merely at the client |
| no whole-collection lost update | `V2-G04`, `V2-G05` | the fingerprint precondition means a clear-all can never discard a write it did not see |

`V2-G02` is deliberately proven twice — once through the production mutator and once as a
raw write against the Rules engine — because a client-side check alone would be exactly
the "timing-only solution" this design had to avoid.

## Why clear-all keeps collection scope

Ordinary mutations moved to per-row transactions precisely so they stop contending. Clear-all
is the opposite case: it is *about* the whole collection, and R10's operator-confirmed
content fingerprint is the property that makes it safe. Expressing it as a multi-path
`update()` would have been atomic but not compare-and-swap, and would have reintroduced the
whole-collection lost update. Keeping one node-level CAS preserves the accepted contract
and costs nothing, because clear-all is rare and already requires an explicit confirmation.

## Interaction with hydration

A client learns the active generation from the entries listener. If it holds a retired one,
its next write is refused at the server and the listener has already delivered the new
state, so the client converges rather than retrying blindly. A client that has not
hydrated at all has no generation and the V2 mutator returns `blocked_unhydrated` before
any I/O.
