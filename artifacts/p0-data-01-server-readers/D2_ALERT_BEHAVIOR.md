# CTO D2 — ALERT CHECKERS: storage converged, externally NON-FIRING

**Decision:** `checkSupplierAnomaly` and `checkExpensiveEmployee` never fired in production
(their `orderByKey().startAt(date).endAt(date)` query addressed the entries node whose
children are `_v` / `generation` / `rows` / `schemaVersion`, never dates → always `null`).
Converging their storage access must not turn them on. They stay non-firing through an
explicit kill-switch constant; activation is a separately reviewed change.

## Implementation (`src/alerts/checkers.ts`)

```ts
export const ENTRIES_ANOMALY_CHECKS_ENABLED = false;
…
export async function checkSupplierAnomaly(…) {
  const alerts: FiredAlert[] = [];
  if (!ENTRIES_ANOMALY_CHECKS_ENABLED) return alerts;   // CTO D2: non-firing, no read
  …
  const snap = await db.ref(`tenants/${tenantId}/biz:${bizId}:entries`).once("value");
  const rows = rowsInRange(requireEntriesRows(snap.val(), { tenantId, bizId, site }), start, today);
```

Same shape in `checkExpensiveEmployee`. `src/alerts/runner.ts` is **not** modified — it still
calls both checkers, receives `[]`, saves nothing for them and sends no digest naming them.
The other checkers (`checkLaborPct`, `checkFoodCostPct`, …) are untouched.

## Proof

| Test | What it proves |
|---|---|
| `entries-reader-checkers.test.mjs` "[D2 source pin]" | constant is literally `false`; in BOTH functions the guard textually precedes the first `db.ref(`; the dead `orderByKey` query is gone; the prepared path uses `requireEntriesRows` + `rowsInRange`; the compiled module exports `false` |
| "[D2 behaviour]" | anomaly bait (28 days ending today, supplier + employee spikes) in **legacy, V2, stale-`_v`-poisoned and malformed** nodes: both checkers return `[]`; **zero reads of the entries node** (a malformed node cannot even throw); `runAlertsForBiz` persists no `supplier_anomaly` / `expensive_employee` alert; no digest attributable to them; no `supplier:` / `employee:` error strings |
| "[D2 prepared path — evidence only]" | with the constant flipped in an injected module copy (never in the tree): legacy vs V2 results identical (modulo `firedAt`), exactly one supplier and one employee alert on the bait, malformed node → typed `EntriesStorageError` (fail closed, no alert) |
| Emulator `SR-08` | on the real RTDB + real Admin SDK + real `runAlertsForBiz`: four node forms → `[]`, `[]`, no such alert under `tenants/{t}/alerts/{biz}`, no digest, no error |

`saveAlert` / digest paths therefore see no new alert types from this slice.
