// ─────────────────────────────────────────────────────────────────────────────
// entryDelta.js — pure, deterministic "did revenue/analytics-material data change?"
//
// Used to decide whether a save needs an analytics/insights rebuild. Compares only
// the fields that materially affect dailyBuilder / revenue forecast / insights.
// EXCLUDES exception governance and UI-only/transient fields. New entry ⇒ changed.
// Numeric-string vs number compare equal; missing vs zero both normalize to 0;
// supplier_payments compared by key-union (ignoring "skip"); no JSON.stringify.
// ─────────────────────────────────────────────────────────────────────────────

// Material numeric fields consumed downstream (dailyBuilder revenue/food/labor/P&L).
// NOTE: weather_impact/security_event/notes do NOT affect analytics/forecast/insights
//   (war_day is derived from `alerts`, not the entry) and are intentionally excluded.
export const REVENUE_MATERIAL_FIELDS = [
  "sales", "deliveries", "other_income", "food_cost", "payroll", "hourly_payroll", "other_expense",
];

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function normSupplierPayments(sp) {
  const out = {};
  if (sp && typeof sp === "object") {
    for (const [k, v] of Object.entries(sp)) { if (v === "skip") continue; out[k] = num(v); }
  }
  return out;
}

/** @returns {boolean} whether a rebuild-relevant material field changed. */
export function revenueChanged(previousEntry, proposedEntry) {
  if (!previousEntry) return true; // new-entry creation is always a material change
  for (const f of REVENUE_MATERIAL_FIELDS) {
    if (num(previousEntry[f]) !== num(proposedEntry[f])) return true;
  }
  const a = normSupplierPayments(previousEntry.supplier_payments);
  const b = normSupplierPayments(proposedEntry.supplier_payments);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] || 0) !== (b[k] || 0)) return true;
  }
  return false;
}

/** Final rebuild decision (mirrors the client). */
export function shouldRebuild(revChanged, exResponse) {
  if (revChanged) return true;
  return !!(exResponse && exResponse.applied === true && exResponse.rebuildRequired === true);
}

/**
 * Canonical mirror of the client `__applyExc(o, strip, prev)`: strips exception
 * governance from an entry; when NOT stripping, PRESERVES the prior entry's
 * pre-existing legacy fields verbatim (never writes NEW governance). Prevents
 * app-first/rules-later silent legacy loss for non-editors.
 */
export function stripOrPreserveException(entry, strip, prevEntry) {
  const c = { ...entry };
  for (const k of ["is_exception", "exception_reason", "exception_note", "exception_set_at", "exception_set_by"]) delete c[k];
  if (!strip && prevEntry && prevEntry.is_exception === true) {
    c.is_exception = true;
    for (const k of ["exception_reason", "exception_note", "exception_set_at", "exception_set_by"]) {
      if (prevEntry[k] !== undefined) c[k] = prevEntry[k];
    }
  }
  return c;
}
