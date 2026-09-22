# Storage V2 Hardening R2 — Change Summary

Candidate: the child of `6c879b66df98e41a1e88b641b3688e24ce4c8675` that carries this
directory, branch `claude/p0-data-01-storage-v2`. Scope: the three Codex candidate
blockers of the R1 review (`marjin-reviews/2026-09-22/storage-v2-hardening-r1-review/`)
— R1-F1, R1-F2, R1-F3 — and nothing else. Row-keyed schema, migration CAS, cutover
Rules, generation monotonicity, rows-map Rules, legacy-client refusal, S0/VAT guard,
stale-delete contract, duplicate-date policy and server readers are untouched
(`database.rules.json`, `upgrade.mjs`, `rules-authorized-delta.mjs`, `vat-invariant`,
all server files: byte-identical).

| File | Change |
|---|---|
| `index.html` — dashboard init block | R1-F1: `mutate: (intent, ctx, binding) => entriesStorageRouterRef.current.mutate(intent, ctx, binding)` — the adapter forwards the binding the coordinator captured at submission (one line; nothing fabricated downstream) |
| `index.html` — `createEntriesWriteCoordinator` | R1-F2: `onListenerEcho` records the storage epoch a parked echo was received under (via the existing `storageBinding` seam); a committed collection result (`res.rows`) whose epoch is at or below a parked echo's epoch no longer overwrites it — the marker is dropped and the lane converges on the newer snapshot (`convergeDeferred`). Legacy results (no epoch) and older parked echoes behave exactly as before. Helper `isGenerationEpoch` |
| `index.html` — `MarjinStorageV2` | R1-F3: `canonicalMapField` / `canonicalRowValue`: for the two MAP fields (`MAP_FIELDS` = `supplier_payments`, `hourly_payroll`) an array is the RTDB readback of an integer-key map and canonicalizes to `{index: value}` (null = absent key); `canonicalRowKey` and `stampRow` use it; every other array keeps order; numeric-key objects outside map fields are not reinterpreted. Exports `MAP_FIELDS`, `canonicalMapField`, `canonicalRowValue` |
| `tools/storage-v2/preflight.mjs` | R1-F3: requires `mapFields`; reports `normalization.numericKeyMaps` (map fields RTDB will read back as arrays); blocks `numeric_key_object_outside_map_field` (`unrepresentable_value`); a null inside a map-field array is an absent key, not a hole |
| `test/support/dashboard-wiring-harness.mjs` (new) | runs the ACTUAL dashboard init block + selection-effect listener block from `index.html` in a vm sandbox (only `useRef`/`setEntries`/`window.storage` substituted); in-memory RTDB with CAS, async listeners and interleaving hooks; Admin-SDK transport for the emulator |
| `test/dashboard/entries-storage-v2-production-wiring.test.mjs` (new, 15) | B1 A–H (incl. legacy lane and the parent-commit negative control), B2 A–F, B3 unit + runtime |
| `test/emulator/storage-v2-matrix.mjs` (42 → 46) | `V2-W01…W04`: production wiring over the real SDK; `mapFields` dep |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` | `mapFields` dep; `normalization` shape (+`numericKeyMaps`) |
| `test/emulator/README.md` | counts + R2 description |

Nothing else changed. No Rules, migration, generation, clear_all, lifecycle-redesign,
Labor UI, server-reader, dependency, push, deploy or Production/Preview activity.
