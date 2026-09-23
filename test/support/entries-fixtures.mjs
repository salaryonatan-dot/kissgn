// Marjin — DUAL-FORM ENTRIES FIXTURES for server reader convergence.
//
// Every logical dataset is materialised in BOTH physical storage forms so a reader can
// be proven equivalent across them:
//   asLegacy(rows)  → { _v: JSON.stringify(rows) }          (array order as given)
//   asV2(rows, …)   → { schemaVersion:2, generation, rows:{[id]: {...canonical(row), _gen}}, _v? }
// asV2 inserts map keys in a deliberately shuffled order and drops null / {} / [] values
// exactly as RTDB would (the client's approved canonical form); numeric-key MAP fields
// are written as the map (RTDB reads them back as arrays — the reader must not care).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const plain = (v) => JSON.parse(JSON.stringify(v));

// deterministic canonical ids
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };

// RTDB canonical form (mirror of the browser's canonicalStorageValue)
export function canonical(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { if (!v.length) return undefined; return v.map((x) => { const c = canonical(x); return c === undefined ? null : c; }); }
  if (typeof v === "object") { const out = {}; Object.keys(v).sort().forEach((k) => { const c = canonical(v[k]); if (c !== undefined) out[k] = c; }); return Object.keys(out).length ? out : undefined; }
  return v;
}
export const asLegacy = (rows) => ({ _v: JSON.stringify(rows) });
export function asV2(rows, { generation = 1, shuffleKeys = true, poisonV, keepV } = {}) {
  const ids = rows.map((r) => r.id);
  const order = shuffleKeys ? ids.slice().reverse() : ids.slice();
  const map = {};
  for (const id of order) { const r = rows.find((x) => x.id === id); map[id] = { ...(canonical(r) || {}), _gen: generation }; }
  const node = { schemaVersion: 2, generation };
  if (rows.length) node.rows = map;
  if (poisonV !== undefined) node._v = poisonV;
  else if (keepV) node._v = JSON.stringify(rows);
  return node;
}
export const bothForms = (rows, opts) => ({ legacy: asLegacy(rows), v2: asV2(rows, opts) });

// ── rows ─────────────────────────────────────────────────────────────────────
export const row = (seed, date, fields = {}) => ({ id: uuid(seed), date, sales: "0", deliveries: "0", other_income: "0", food_cost: "0", payroll: "0", other_expense: "0", ...fields });

export const FIXTURES = {
  F0_empty: [],
  F1_one: [row("f1a", "2026-08-01", { sales: "5000", deliveries: "300", other_income: "20", supplier_payments: { s1: "1200" }, hourly_payroll: { e1: 400 } })],
  F2_multi: [
    row("f2c", "2026-09-03", { sales: "300", supplier_payments: { s1: "100" } }),
    row("f2a", "2026-08-01", { sales: "100", deliveries: "10" }),
    row("f2e", "2026-09-05", { sales: 500, payroll: 200, hourly_payroll: { e1: 50, e2: 60 } }),
    row("f2b", "2026-08-02", { sales: "200", other_income: "5" }),
    row("f2d", "2026-09-04", { sales: "400", food_cost: "150" }),
  ],
  F3_dup: [
    row("f3a", "2026-08-10", { sales: "100", supplier_payments: { s1: "10" }, hourly_payroll: { e1: 1 } }),
    row("f3b", "2026-08-10", { sales: "500", supplier_payments: { s1: "50" }, hourly_payroll: { e1: 5 } }),
    row("f3c", "2026-08-11", { sales: "700" }),
  ],
  F4_variety: [
    row("f4a", "2026-08-01", { sales: 1000, deliveries: "250", other_income: "", food_cost: "90", supplier_payments: { s1: "1,234", s2: "skip", s3: "", s4: 0 }, hourly_payroll: { e1: "400", e2: 0 }, other_expense: "12" }),
    row("f4b", "2026-08-02", { sales: "0", food_cost: "300" }),                        // no supplier payments → food_cost used
    row("f4c", "2026-08-03", { sales: "80", supplier_payments: { s1: "40" }, food_cost: "999" }),   // supplier payments override food_cost
  ],
  F5_unicode: [row("f5a", "2026-08-01", { sales: "10", notes: 'סגור },{ פתוח {a} "ציטוט"\nשורה שנייה', exception_note: "},{", weather_impact: "{}" })],
  F6_missing: [row("f6a", "2026-08-01", { sales: "10", deliveries: null, supplier_payments: {}, hourly_payroll: null, notes: "" })],
  F7_exceptions: [
    row("f7a", "2026-08-01", { sales: "10", is_exception: true, exception_reason: "holiday", exception_note: "חג" }),
    row("f7b", "2026-08-02", { sales: "20", is_exception: false }),
    row("f7c", "2026-08-03", { sales: "30" }),
  ],
  F8_month: Array.from({ length: 31 }, (_, i) => row("f8-" + i, `2026-08-${String(i + 1).padStart(2, "0")}`, { sales: String(1000 + i * 10), deliveries: String(i), supplier_payments: { s1: String(100 + i) }, hourly_payroll: { e1: 40 + i }, payroll: "10" })),
  F9_anomaly_bait: (() => {
    // 28 days of supplier and hourly payments; the LAST value far exceeds every average
    const days = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(Date.UTC(2026, 8, 20) - i * 86400000).toISOString().slice(0, 10);
      const last = i === 0;
      days.push(row("f9-" + i, d, { sales: "100", supplier_payments: { s1: last ? "9000" : "100" }, hourly_payroll: { e1: last ? 5000 : 100, e2: 50 } }));
    }
    return days;
  })(),
  F10_numeric_maps: [row("f10a", "2026-08-01", { sales: "10", hourly_payroll: { "0": 10, "1": 20 }, supplier_payments: { "7": 30 } })],
};

// ── adversarial nodes ─────────────────────────────────────────────────────────
export const STALE_V_ROWS = [row("f3a", "2026-08-10", { sales: "100" }), row("f3b", "2026-08-10", { sales: "500" }), row("deleted", "2026-08-12", { sales: "999", is_exception: true })];
/** rows = CURRENT (sales 555 on 2026-08-10, one row); `_v` = STALE (100/500 on the same date, a deleted row, an exception) */
export function noFallbackNode() {
  const current = [row("f3a", "2026-08-10", { sales: "555" }), row("f3c", "2026-08-11", { sales: "700" })];
  return { node: asV2(current, { poisonV: JSON.stringify(STALE_V_ROWS) }), current, stale: STALE_V_ROWS };
}
/** malformed V2 variants — every one carries a valid-looking `_v` */
export function malformedNodes() {
  const ok = FIXTURES.F1_one; const v = JSON.stringify(ok); const id = ok[0].id;
  return {
    rows_scalar: { schemaVersion: 2, generation: 1, rows: "corrupt", _v: v },
    gen_mismatch: { schemaVersion: 2, generation: 1, rows: { [id]: { ...canonical(ok[0]), _gen: 9 } }, _v: v },
    bad_key: { schemaVersion: 2, generation: 1, rows: { "row-1": { ...canonical(ok[0]), id: "row-1", _gen: 1 } }, _v: v },
    id_key_mismatch: { schemaVersion: 2, generation: 1, rows: { [uuid("other")]: { ...canonical(ok[0]), _gen: 1 } }, _v: v },
    bad_generation: { schemaVersion: 2, generation: "g1", rows: { [id]: { ...canonical(ok[0]), _gen: "g1" } }, _v: v },
    stripped_marker: { generation: 1, rows: { [id]: { ...canonical(ok[0]), _gen: 1 } }, _v: v },
    unsupported_schema: { schemaVersion: 3, _v: v },
    legacy_unparseable: { _v: "not json" },
  };
}

// ── the browser reader, for parity ───────────────────────────────────────────
export function loadClientStorageV2() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  const f = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  if (start === -1 || f === -1) throw new Error("index.html anchors missing");
  const sandbox = { window: { crypto: globalThis.crypto }, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
