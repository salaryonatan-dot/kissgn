# Generation Contract (Codex SV2-02)

## Findings
Same-generation clear reported success; empty clear did not rotate; the mutator stamped an
old intent with the live generation read at dispatch; Rules accepted generation-only
updates, rollback and any well-formed token.

## The canonical contract (client and server agree; server enforces)
The generation is a **strictly increasing integer epoch**.

| Transition | Client | Rules |
|---|---|---|
| absent/legacy → V2 (bootstrap / conversion) | `generation = 1` (`GENERATION_FIRST`); never a caller input (`generation_not_callable`) | node validator: `data.schemaVersion !== 2 ? newData.generation === 1`; `generation` validator: `!data.exists() → parent.schemaVersion === 2 && val === 1` |
| ordinary row write | row stamped `_gen = bound epoch`; refused before dispatch if `bound !== live` (`generation_retired`); inside the CAS a row of another epoch is `conflict/generation_changed` | `rows/$rowId`: `_gen` is a number and `=== newData.parent().parent().generation`; envelope validator (evaluated on every write under the node) requires `newData.generation === data.generation` |
| clear-all | next epoch **derived inside the CAS** as `current + 1`; `nextGeneration` in the intent → `blocked/next_generation_not_callable`; an EMPTY collection still rotates; result `{generation, retiredGeneration}` | `newData.generation === data.generation + 1 && !newData.rows.exists()` — only when the result has no rows |
| anything else | — | denied: skip (+2), rollback, string/float, generation-only advance while rows exist |

No timestamps anywhere. A retired epoch can never be written again (strictly increasing),
so no row stamped by a retired client is representable.

## Binding (the "old intent gets the new generation" case)
`createEntriesWriteCoordinator.submitIntent` captures `io.storageBinding()` — the mode and
epoch known at SUBMISSION — and stores it on the queued job; `pump` dispatches
`io.mutate(intent, ctx, job.binding)`. The V2 engine never reads the live epoch to stamp a
row; it reads it only to REFUSE (`generation_retired`) when the bound epoch is no longer
live. The listener still updates `entriesStorageModeRef` freely — that is how new intents
learn the new epoch — but nothing already queued is restamped. In the UI an intent is formed
and submitted in the same tick, so "formed under" and "submitted under" coincide.

## Proof
Unit (`entries-storage-v2-hardening.test.mjs` [H2] ×5): token/type contract; +1 per clear
incl. empty; caller-chosen value refused; bound-vs-live refusal with nothing sent; server
fence mapped to `blocked/rules_rejected`; CAS-time re-check.
Emulator: `V2-H02` (deny ×10 / allow ×6 raw transitions, incl. bootstrap at 5 denied,
conversion at 2 denied), `V2-G01/G02/G03`, `V2-H04` (empty rotates; retired work refused
client-side `generation_retired` and server-side `rules_rejected`), `V2-H05` (live listener
observed the rotation; the old intent is still refused; a new intent succeeds).
Mutation probe: "epoch step loosened", "epoch rollback permitted", "inert generation
wrapper" each ALLOW a denied write once applied; all rejected by the S0 guard.

Result: **PASS** — GENERATION_MONOTONICITY and STALE_GENERATION_RESURRECTION.
