# Storage V2 Hardening R1 — Change Summary

Candidate under review: **child of `cb8ac84e2dbc5c23b6fe0eee2083be6f326d3894`** on
`claude/p0-data-01-storage-v2` (the commit that carries this directory).
Base of the S0 anti-migration guard: `686b4350c6b6186c81d7f821d8c26a960428d30b`.

Scope: the nine Codex candidate findings (SV2-01…SV2-09) from
`reviews/2026-09-15/storage-v2-codex/` — nothing else. Architecture unchanged: row-keyed
entries, `row.id === child key`, V2 rows authoritative after cutover, frozen `_v`,
per-row transactions, epoch protection. Server readers untouched (see
KNOWN_LIMITATIONS.md — still the PRE-CUTOVER blocker).

## Files changed

| File | Change |
|---|---|
| `database.rules.json` + byte-identical `test/emulator/database.rules.json` | cutover-permanence guard appended to the entries `.write` branch (authorization predicate byte-identical); V2 envelope validator now enforces the epoch transition contract, `rows` map shape and `_v` type; `generation` validator: numeric, `+1` only when rows are gone, starts at 1; `rows/.validate` map shape; row stamp moved to reserved `_gen`; `schemaVersion` may only be written inside a complete envelope |
| `index.html` — `MarjinStorageV2` | integer epoch contract (`GENERATION_FIRST`, `nextGenerationOf`, `ROW_GEN_KEY`); `canonicalStorageValue` / `canonicalRowKey` / `stampRow`; `applyRowIntent` compares canonical forms and rejects the reserved key; V2 mutator takes `mode()` + a submission-time `binding`, initialises an absent collection into V2 on its first create, derives the next epoch inside the clear-all CAS, refuses caller-supplied `nextGeneration`, maps Rules denials to `blocked/rules_rejected`; router sends `absent` to the V2 engine |
| `index.html` — `MarjinSaveLifecycle` | coordinator captures `io.storageBinding()` at `submitIntent` and dispatches it with the job; a rows-less commit converges on the parked authoritative echo instead of discarding it; `convergeDeferred` also refreshes the raw snapshot; `parseEntriesNode` classifies any V2-structured node as `storage_v2_node`; legacy mutator returns `blocked/storage_mode_mismatch` on it; `describeSaveOutcome` text for `generation_retired` / `storage_mode_mismatch` / `rules_rejected` |
| `index.html` — component wiring | V2 engine reads `mode: () => entriesStorageModeRef.current`; coordinator gets `storageBinding`; mode ref reset to `null` on every selection change; absent probe sets `{mode:"absent"}` only while the mode is still unknown; listener stores `generation` as given (null for legacy) |
| `tools/storage-v2/preflight.mjs` | requires `rowGenKey`; new blockers `reserved_field_present`, `unrepresentable_field_key`, `unrepresentable_value`; reports `normalization` (the approved canonicalization, per row) |
| `tools/storage-v2/upgrade.mjs` | epoch is no longer a caller input (`generation_not_callable`); rows stamped through the runtime's `stampRow`; result carries `normalization` |
| `test/support/rules-authorized-delta.mjs` (new) | the pinned, semantic S0 rules exception |
| `test/finance/vat-invariant.test.mjs` | rules-exception closure delegates to the semantic module (VAT assertions byte-identical; verified by test) |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` (new, 30) | deterministic runtime proof of every finding + production wiring pins |
| `test/emulator/storage-v2-matrix.mjs` (32 → 42) | contract updates; `V2-M04` now a real ETag barrier race; `V2-H01…H10` |
| `test/emulator/storage-v2-rules-guard-mutations.mjs` (new, 12) | emulator proof that every guard rejection is a real loss of enforcement |
| `test/emulator/README.md` | run instructions for the above |

## Findings → closure (one line each; full map in CODEX_REREVIEW_GUIDE.md)

1. SV2-01 whole-node delete / legacy recreate → `.write` cutover guard (CUTOVER_PERMANENCE.md)
2. SV2-02 generation reuse/rollback/restamp → integer monotonic epoch, submission binding, Rules transitions (GENERATION_CONTRACT.md)
3. SV2-03 coordinator drops authoritative echo → converge on parked echo (LISTENER_ORDERING.md)
4. SV2-04 clear_all lacks nextGeneration → derived in the CAS; call site unchanged and now works (CLEAR_ALL_INTEGRATION.md)
5. SV2-05 absent bootstrap unknown mode → `absent` state, first create initialises V2, reset per selection (ABSENT_BUSINESS_BOOTSTRAP.md)
6. SV2-06a migration overwrites `gen` → reserved `_gen`, preflight representation policy (MIGRATION_PRESERVATION.md)
7. SV2-06b identical create replay collides → canonical-form idempotency (IDEMPOTENT_CREATE.md)
8. SV2-07 scalar rows → `rows` map validators (RULES_MAP_VALIDATION.md)
9. SV2-08 old client false success → legacy engine refuses V2 nodes (OLD_CLIENT_BEHAVIOR.md)
10. SV2-09 S0 accepts inert validators → semantic pinned delta + emulator mutation probe (S0_GUARD_HARDENING.md)

## Not done, deliberately

- Server-reader convergence (nine read sites) — out of scope, still PRE_CUTOVER_BLOCKER.
- Codex P2 "non-entries `$dataKey/rows/*` newly invalid" — not one of the nine; left as is (KNOWN_LIMITATIONS.md).
- Direct deletion of the frozen `_v` child remains possible (documented before; not one of the nine).
- No push, no deploy, no Production/Preview access, no dependency change.
