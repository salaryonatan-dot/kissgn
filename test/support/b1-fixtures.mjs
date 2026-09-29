// Financial Core B1 — synthetic fixtures (no Production data, no network).
//
// Every EV-1 category is represented synthetically (counts from the accepted EV-1 bundle are
// used only as fixture PARAMETERS, never values). Entries are built in BOTH physical storage
// forms (legacy `_v` and Storage V2 rows); config / fixed-cost envelopes are built present,
// absent and unreadable; the clock is injected (asOfBusinessDate 2026-09-29 unless stated).
import { asLegacy, asV2 } from "./entries-fixtures.mjs";

export { asLegacy, asV2 };

/** 2026-09-29 09:00Z = 12:00 Israel ⇒ asOfBusinessDate 2026-09-29; Actual ends 2026-09-28. */
export const NOW_MS = Date.UTC(2026, 8, 29, 9);
export const AS_OF = "2026-09-29";
/** A clock whose Israel business date is `date` (09:00Z is 11:00/12:00 in Israel). */
export const nowMsFor = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d, 9); };

// ── accepted EV-1 bundle parameters (counts only; 20260929T153417Z) ─────────────
export const EV1 = Object.freeze({
  bundle: "20260929T153417Z",
  collector: "213fb350019c3e212156eb032e34f4da8c179d6f",
  asOf: "2026-09-29",
  maxRowsTotal: 213,
  rowsObserved: 520,
  supplierExplicitZeroRows: 282,
  supplierNegativeRows: 2,
  missingIdRows: 520,
  payrollPresentRows: 439,
  legacyHourlyPayrollRows: 0,
  zeroOnlyRows: 2,
});

// ── identities ───────────────────────────────────────────────────────────────
/** Deterministic UUID-v4-shaped id (lower-case hex). */
export const uid = (n) => `b1b1b1b1-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** A stored entry row with EXACTLY the given fields (no implicit zero fields). */
export const entry = (id, date, fields = {}) => (id === null ? { date, ...fields } : { id, date, ...fields });

// ── envelopes ────────────────────────────────────────────────────────────────
export const env = (value) => ({ _v: JSON.stringify(value) });
export const CONFIG_EMPTY = Object.freeze({});
/** Config with global employees (monthly FULL employer cost; MARJIN_LABOR/2). */
export const configWithGlobal = (...amounts) => ({ employees: amounts.map((a, i) => ({ id: "g" + (i + 1), type: "global", name: "G" + (i + 1), monthlySalary: a })) });
export const fixedItems = (...amounts) => amounts.map((a, i) => ({ id: "f" + (i + 1), name: "F" + (i + 1), amount: a }));

/** Envelope matrix for decodeEnvelope (raw node → expected state). */
export const ENVELOPE_MATRIX = Object.freeze([
  ["null", null, "object", "absent"],
  ["undefined", undefined, "object", "absent"],
  ["{} (no _v)", {}, "object", "absent"],
  ["{_v:null}", { _v: null }, "object", "absent"],
  ["object present", { _v: JSON.stringify({ a: 1 }) }, "object", "present"],
  ["object bad json", { _v: "{bad" }, "object", "unreadable"],
  ["object got array", { _v: "[1]" }, "object", "unreadable"],
  ["object got scalar json", { _v: "5" }, "object", "unreadable"],
  ["plain object (not an envelope)", { a: 1 }, "object", "unreadable"],
  ["extra key next to _v", { _v: "{}", x: 1 }, "object", "unreadable"],
  ["_v not a string", { _v: 5 }, "object", "unreadable"],
  ["string node", "{}", "object", "unreadable"],
  ["array node", [1, 2], "object", "unreadable"],
  ["array present []", { _v: "[]" }, "array", "present"],
  ["array present", { _v: JSON.stringify([{ id: "f1", amount: "10" }]) }, "array", "present"],
  ["array got object", { _v: "{}" }, "array", "unreadable"],
  ["array bad json", { _v: "[" }, "array", "unreadable"],
  ["array absent", null, "array", "absent"],
]);

// ── RTDB seeding (harness db) ────────────────────────────────────────────────
export const T = "tenantA", B = "bizA";
export const entriesKey = (t = T, b = B) => `tenants/${t}/biz:${b}:entries`;
/**
 * Seed raw nodes. `config` / `fixed` are RAW node values (pass env({...}) for a normal
 * envelope, null to leave the node absent, or any malformed value).
 */
export function seedRaw(db, { tenant = T, biz = B, entries = null, config = env(CONFIG_EMPTY), fixed = null, suppliers = null, businesses } = {}) {
  if (entries !== null) db.seed(entriesKey(tenant, biz), entries);
  if (config !== null) db.seed(`tenants/${tenant}/biz:${biz}:config`, config);
  if (fixed !== null) db.seed(`tenants/${tenant}/biz:${biz}:fixed`, fixed);
  if (suppliers !== null) db.seed(`tenants/${tenant}/biz:${biz}:suppliers`, suppliers);
  db.seed(`tenants/${tenant}/app/business`, env(businesses || [{ id: biz, name: "Biz " + biz }]));
  return db;
}
/** A db wrapper that records every read path (loader I/O assertions). */
export function recordingDb(db) {
  const reads = [];
  return { reads, ref: (p) => { const r = db.ref(p); return { ...r, once: async (ev) => { reads.push(p); return r.once(ev); } }; } };
}

// ── in-memory ProductInputs (pure core; no storage) ───────────────────────────
const present = (value) => ({ state: "present", value });
export const ABSENT = Object.freeze({ state: "absent" });
export function inputs(rows, { config = CONFIG_EMPTY, fixed = null, asOf = AS_OF, exceptionsByDate } = {}) {
  const i = {
    rows,
    config: config === null ? ABSENT : config && config.state ? config : present(config),
    fixed: fixed === null ? ABSENT : fixed && fixed.state ? fixed : present(fixed),
    asOfBusinessDate: asOf,
  };
  return exceptionsByDate ? { ...i, exceptionsByDate } : i;
}
/** ServerInputs literal (what loadCanonicalInputs returns) for pure server-wrapper tests. */
export function serverInputs(rows, opts = {}) {
  const i = inputs(rows, opts);
  const issues = [];
  if (i.config.state === "unreadable") issues.push("config_unreadable");
  if (i.fixed.state === "unreadable") issues.push("fixed_unreadable");
  return { ...i, tenantId: T, bizId: B, storageMode: "legacy", configState: i.config.state, fixedState: opts.fixedState || (opts.fixed === undefined ? "not_loaded" : i.fixed.state), inputIssues: issues };
}

// ── storage-independent purchase contributions (doc 07, PF-*) ─────────────────
function decOf(amount) {
  const m = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/.exec(String(amount));
  if (!m) throw new Error("fixture amount must be a plain decimal: " + amount);
  let frac = m[3] || "";
  while (frac.length && frac.endsWith("0")) frac = frac.slice(0, -1);
  let c = BigInt(m[2] + frac); if (m[1] === "-") c = -c;
  return c === 0n ? { c: 0n, s: 0 } : { c, s: frac.length };
}
const ABSENT_METRIC = Object.freeze({ presence: "absent", partial: false, value: null });
/**
 * A NormalizedRow literal: purchases present with ONE contribution `{source, value}`, every
 * other metric absent. No entries storage, no `supplier_payments`, no RTDB (doc 07 PF-*).
 */
export function purchaseOnlyNormalizedRow(date, source, amount, id) {
  const value = decOf(amount);
  const flags = value.c < 0n ? [{ code: "negative_amount", rowId: id, field: "purchase", key: source }] : [];
  return {
    id,
    date,
    metrics: { revenue: ABSENT_METRIC, purchases: { presence: "present", partial: false, value }, hourlyLabor: ABSENT_METRIC, otherExpense: ABSENT_METRIC },
    revenueParts: { sales: ABSENT_METRIC, deliveries: ABSENT_METRIC, otherIncome: ABSENT_METRIC },
    purchaseSource: source.startsWith("supplier:") ? "supplier" : "legacy_food_cost",
    purchaseContributions: [{ source, value }],
    legacyHourlyPayroll: { recorded: false, entries: [] },
    isException: false,
    annotations: { notes: [], weather: [], exceptionReason: [], exceptionNote: [], securityEvent: false },
    flags,
  };
}

// ── generic helpers ──────────────────────────────────────────────────────────
export const permutations = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));
/** JSON with BigInt support (Dec values) for byte-identity comparisons. */
export const stableJson = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() + "n" : x));
/** Deep scan: no undefined / null / NaN / ±Infinity anywhere (RTDB-safe persisted doc). */
export function badValues(v, path = "$", out = []) {
  if (v === undefined) out.push(path + " undefined");
  else if (typeof v === "number" && !Number.isFinite(v)) out.push(path + " " + String(v));
  else if (Array.isArray(v)) v.forEach((x, i) => badValues(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) badValues(x, path + "." + k, out);
  return out;
}
/** ISO date n days before `date` (pure UTC arithmetic on the parts). */
export const daysBefore = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d) - n * 86400000).toISOString().slice(0, 10); };
