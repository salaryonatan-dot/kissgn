# Codex Re-review Guide — Storage V2 Hardening R1

Candidate: the commit carrying this directory (parent `cb8ac84e2dbc5c23b6fe0eee2083be6f326d3894`,
branch `claude/p0-data-01-storage-v2`). Review artifacts you produced:
`reviews/2026-09-15/storage-v2-codex/`.

Reproduce:
```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 719
node --test test/dashboard/entries-storage-v2-hardening.test.mjs                                   # 30
<emulators:exec …> "node test/emulator/storage-v2-matrix.mjs"                                     # 42
<emulators:exec …> "node test/emulator/storage-v2-rules-guard-mutations.mjs"                      # 12
```
(see `test/emulator/README.md` for the exact emulator command; scripts one at a time.)

Contract change to expect: integer epoch + reserved `_gen` (KNOWN_LIMITATIONS.md). Your
`independent.mjs` / `extra.mjs` call `mutator.mutate(i, ctx)` with `generation: () => …`
— on this candidate that is `blocked_unhydrated / intent_not_bound_to_generation` by
design; use `mode: () => ({mode, generation})` and pass `binding` (see `v2Client` /
`parityClient` in the matrix).

| # | Codex finding | Original reproduction | Implementation change | Focused regression | Emulator evidence | Exact result |
|---|---|---|---|---|---|---|
| 1 | SV2-01 whole-node delete then legacy recreate restores legacy authority | `independent.mjs` `FINDING-parent-delete-restores-legacy-authority` (manager remove + legacy set) | `.write` entries branch: `&& (!(data.schemaVersion===2) \|\| newData.schemaVersion===2)`; authz predicate byte-identical | `[H8]`, `[H10]` (guard dropped/weakened rejected) | `V2-H01` deny ×11 (delete, remove(), legacy re-create, marker delete, downgrade, marker-less envelope; both roles); `V2-X01`; mutation probe rows 7–8 ALLOW the delete without the clause | PASS 3/3 |
| 2 | SV2-02 generation reuse / empty clear no-rotate / old intent restamped / server rollback | `FINDING-same-generation-clear-permits-resurrection`, `…empty-clear…`, `…live-generation-adopts-stale-create`, `…generation-only-update-and-rollback` | integer monotonic epoch; clear-all derives `+1` in the CAS, empty rotates, `nextGeneration` refused; coordinator binds the epoch at submission; Rules: `+1` only when rows gone, starts at 1, numeric | `[H2]` ×5, `[H3-E2]`, `[H4]` | `V2-H02` deny ×10/allow ×6, `V2-H04`, `V2-H05`, `V2-G01–G03`; mutation probe rows 4, 10, 11 | PASS 3/3 |
| 3 | SV2-03 row commit discards authoritative echo → stale UI | `FINDING-coordinator-drops-authoritative-row-echo` (real coordinator, real SDK) | coordinator keeps the parked echo on rows-less commits and converges on it; `convergeDeferred` refreshes `rawRows` | `[H3-A/B/C/C'/D/E/E2]`, `[H3]` ×2 | `V2-H06` with the real coordinator/router/engine: converged after edit, queued edits, foreign write, delete, clear-all; `deferredPending=false` | PASS 3/3 |
| 4 | SV2-04 production clear-all never supplies `nextGeneration` | `FINDING-production-clear-call-site-omits-next-generation` | requirement removed (unsafe); epoch derived under CAS; UI call site unchanged | `[H4]` ×2 | `V2-H06` (coordinator `submitClearAll` → committed, `generation 2`) | PASS 3/3 |
| 5 | SV2-05 absent bootstrap leaves mode unknown; ref not reset per business | `FINDING-absent-bootstrap-router-remains-unknown` | explicit `absent` state (probe sets it only while unknown), reset per selection, first create initialises V2 in one node CAS, router → V2 engine | `[H5]` ×4 | `V2-H07` real coordinator: V2 node at epoch 1, no `_v`, row lane afterwards, idempotent repeat, race `committed,conflict` typed | PASS 3/3 |
| 6a | SV2-06 migration overwrites `gen`; empties dropped silently | `FINDING-migration-drops-json-values-and-reserved-gen` | reserved `_gen`; preflight `reserved_field_present` / `unrepresentable_*` blockers + `normalization` report; upgrade stamps through runtime `stampRow` | `[H6]` ×2 | `V2-H08` (`gen` preserved, normalization reported, 3 blockers); `V2-M01/M04/M05` | PASS 3/3 |
| 6b | SV2-06 identical create replay → `id_collision` | `extra.mjs` standard create replay with `EMPTY_ENTRY` | canonical-form equality for create (and delete) preconditions; engine writes canonical form | `[H7]` ×3 | `V2-H09` with real `EMPTY_ENTRY`: committed → `already_created` → `id_collision` on change | PASS 3/3 |
| 7 | SV2-07 scalar overwrites `rows` | `FINDING-scalar-rows-accepted` | `rows/.validate hasChildren()`; envelope clause; `_v` type | `[H8]` | `V2-H03` deny ×4; mutation probe row 9 | PASS 3/3 |
| 8 | SV2-08 old client false idempotent success vs frozen `_v` | `extra.mjs` old-client probe | `parseEntriesNode` → `storage_v2_node`; legacy engine `blocked/storage_mode_mismatch`; operator text | `[H9]` ×2 | `V2-H10` ×2 (incl. request == frozen == current rows), node byte-identical; `V2-L01` legacy intact | PASS 3/3 |
| 9 | SV2-09 S0 exception accepts inert validators | `guard-probe.mjs` / `s0-mutations.json` (3/8 accepted) | pinned semantic delta module; `.write` = base + guard exactly; normalized subtree equality; VAT assertions byte-identical | `[H10]` ×2 (18 mutations rejected; whitespace accepted) | `storage-v2-rules-guard-mutations.mjs` 12/12: each rejected mutation ALLOWS a denied write on the real emulator | PASS 3/3 |

Also preserved (Phase 12): identity `V2-I01–I08`, duplicate dates `V2-I06`, free text
`V2-I07`, row concurrency `V2-C01–C05` (stale delete, unrelated-row no-conflict), clear-all
no-resurrection `V2-G02` (now `blocked/rules_rejected` + raw deny), old-client Rules denial
`V2-X01`, migration race `V2-M04` (stronger) + R9-style negative control `V2-M05`, R10 remote
atomic 19/19, Labor UI 14/14, duplicate delete 10/10, lifecycle 112/112, authorization
108/108, VAT/S0 5/5.

Not in scope, still open: server-reader convergence (PRE_CUTOVER_BLOCKER); the residuals in
KNOWN_LIMITATIONS.md.
