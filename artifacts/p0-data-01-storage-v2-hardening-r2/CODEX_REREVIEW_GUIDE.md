# Codex Re-review Guide — Storage V2 Hardening R2

Candidate: the commit carrying this directory (parent `6c879b66df98e41a1e88b641b3688e24ce4c8675`,
branch `claude/p0-data-01-storage-v2`). Your R1 review: `marjin-reviews/2026-09-22/storage-v2-hardening-r1-review/`.

Reproduce:
```
node --test test/dashboard/entries-storage-v2-production-wiring.test.mjs               # 15
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 734
<emulators:exec …> "node test/emulator/storage-v2-matrix.mjs"                          # 46 (V2-W01…W04 new)
```
Your `probes.mjs` `actualWiring()` slice (`const entriesMutatorRef = useRef(null);` … `// Collision-resistant id`)
still applies; the repository harness (`test/support/dashboard-wiring-harness.mjs`) slices the
same block (extended through `submitLaborEntry`) plus the selection-effect listener block.

| # | Codex blocker | Reproduction | Fix | Focused regression | Emulator evidence | Exact result |
|---|---|---|---|---|---|---|
| 1 | R1-F1 `index.html:4370` two-argument adapter drops the binding; V2 create/edit/delete/clear and absent first-save refuse before any transaction | `probes.mjs` `production-dashboard-binding-dropped`; reproduced in-repo by B1-H (parent commit's `index.html` through the same harness: 5× `intent_not_bound_to_generation`, 0 transactions) | adapter forwards `binding` (one line); nothing fabricated downstream | B1-A…G + legacy (15-case file) | `V2-W01` (absent → gen 1, create, edit, delete, clear → gen 2 through the real wiring), `V2-W02` (retired binding refused before transaction; business switch bound to the new node) | PASS ×3 rounds |
| 2 | R1-F2 `index.html:1395` clear completion (`rows=[]`) clears a newer parked listener snapshot; row 777 disappears from display | your two-SDK-client race with exact listener barrier | parked echoes stamped with the storage epoch (`storageBinding` at echo time); a collection result at or below a parked echo's epoch converges on the echo instead of overwriting it; marker dropped; older/legacy parked echoes unchanged | B2-A…F | `V2-W03` (B creates 777 in epoch 2 after A's clear committed; A's listener receives it before A's promise resolves; A displays 777) | PASS ×3 |
| 3 | R1-F3 numeric-key `hourly_payroll` accepted by preflight without report; SDK array readback makes an identical same-epoch retry `id_collision` | your migration + retry probe | `canonicalMapField`/`canonicalRowValue` for `MAP_FIELDS` only (array ≡ indexed map; hole ≡ absent key); `stampRow` writes the canonical map; preflight reports `numericKeyMaps` and blocks numeric-key objects outside map fields | B3-unit (equality table + old-comparator negative control), B3-runtime (array readback retry) | `V2-W04` (real readback `[10,20]`; retry `already_created`; changed amount/cardinality/key collide; ordinary equality unchanged; old comparator false collision; conversion reported + idempotent) | PASS ×3 |

Preserved (re-run): identity/concurrency/generation/compatibility/authorization cases of the
Storage V2 matrix (`V2-L01…V2-H10`) 42/42 within 46/46; authorization 108/108 ×3; remote atomic
19/19 ×3; legacy Rules 30/30 ×3; guard mutations 12/12 ×3; stale delete 31; Labor UI 14;
duplicate delete 10; lifecycle 112; VAT/S0 5; full suite 734/734; `tsc` baseline unchanged.

Not in scope, still open: server-reader convergence, old-build fence, `_v`/rows raw-deletion
residuals, real-data preflight / backup / canary (KNOWN_LIMITATIONS.md).
