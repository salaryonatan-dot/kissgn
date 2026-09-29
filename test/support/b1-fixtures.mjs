// Financial Core B1 — synthetic fixtures (no Production data, no network).
//
// Every EV-1 category is represented synthetically (counts from the accepted EV-1 bundle are
// used only as fixture PARAMETERS, never values). Entries are built in BOTH physical storage
// forms (legacy `_v` and Storage V2 rows); config / fixed-cost envelopes are built present,
// absent and unreadable; the clock is injected (asOfBusinessDate 2026-09-29 unless stated).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
  const exceptionsState = opts.exceptionsState || (opts.exceptionsByDate ? "present" : "not_loaded");
  if (exceptionsState === "unreadable") issues.push("exceptions_unreadable");
  return { ...i, tenantId: T, bizId: B, storageMode: "legacy", configState: i.config.state, fixedState: opts.fixedState || (opts.fixed === undefined ? "not_loaded" : i.fixed.state), exceptionsState, inputIssues: issues };
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

// ── AMEND-02 per-slice core-consumer allowlist (data + pure validator) ─────────
// Every slice that makes a runtime file load the Financial Core adds ONE data file
// `test/finance/core-consumers/<slice>.json` = {slice, consumers[], serverApiConsumers[]}.
// fincore-guards G-B2 reads the UNION of those files through this validator; the G2-*
// mutation tests (b1-guards) exercise the same implementation. Pure (no test registration).
export const SLICES = Object.freeze(["B1", "B2", "C1", "C2", "F1", "F2", "D", "E", "P1", "P2"]);
/** Slices allowed to list `index.html` (browser surfaces start at C1). */
export const INDEX_HTML_SLICES = Object.freeze(["C1", "C2", "F1", "F2", "D", "E", "P1", "P2"]);
export const ALLOWED_KEYS = Object.freeze(["slice", "consumers", "serverApiConsumers"]);
export const CORE_DIRS = Object.freeze(["src/finance", "src/metrics", "src/policy", "src/presenters", "src/browser"]);
export const SERVER_API_DIR = "src/finance-server";

const SPEC = String.raw`["']([^"']+)["']`;
const IMPORT_RES = [new RegExp(String.raw`(?:import|export)\s[^;]*?from\s+` + SPEC, "g"), new RegExp(String.raw`import\(\s*` + SPEC, "g"), new RegExp(String.raw`^\s*import\s+` + SPEC, "gm")];
/** Import specifiers of a source file (static, re-export, side-effect and dynamic). */
export function importSpecifiers(src) {
  const out = new Set();
  for (const re of IMPORT_RES) for (const m of String(src).matchAll(re)) out.add(m[1]);
  return [...out];
}
export const importsCore = (src) => importSpecifiers(src).some((s) => /(?:^|\/)(?:finance|metrics|policy|presenters|browser)\//.test(s)) || /fincore|MarjinFinance/.test(src);
export const importsServerApi = (src) => importSpecifiers(src).some((s) => /(?:^|\/)finance-server\//.test(s));

/** An entry must be ONE existing file by exact repo-relative path (no glob, no directory, no `..`). */
export function entryProblem(rel, kindOf) {
  if (typeof rel !== "string" || !rel) return "not_a_string";
  if (/[*?[\]{}()|^$\\]/.test(rel)) return "glob";
  if (rel.startsWith("/") || rel.endsWith("/") || rel.includes("..") || rel.includes("//") || rel.startsWith("./")) return "not_exact_path";
  const kind = kindOf(rel);
  if (kind === "dir") return "directory";
  if (kind !== "file") return "missing_file";
  return null;
}

/**
 * Pure validation of the allowlist files. `files` = [{name, json}] (json = parsed value or a
 * parse error marker {__parseError}); `kindOf(rel)` → "file" | "dir" | null.
 * Returns {ok, errors[], consumers:Set, serverApiConsumers:Set}.
 */
export function validateConsumerFiles(files, kindOf) {
  const errors = [];
  const consumers = new Set(), serverApiConsumers = new Set(), seen = new Map();
  for (const { name, json } of files) {
    if (!json || typeof json !== "object" || Array.isArray(json) || json.__parseError) { errors.push(`${name}: not a JSON object`); continue; }
    const slice = json.slice;
    if (!SLICES.includes(slice)) { errors.push(`${name}: unknown slice ${JSON.stringify(slice)}`); continue; }
    if (name !== `${slice.toLowerCase()}.json`) errors.push(`${name}: file name must be ${slice.toLowerCase()}.json`);
    for (const k of Object.keys(json)) if (!ALLOWED_KEYS.includes(k)) errors.push(`${name}: unknown key ${k}`);
    for (const key of ["consumers", "serverApiConsumers"]) {
      const list = json[key] === undefined ? [] : json[key];
      if (!Array.isArray(list)) { errors.push(`${name}: ${key} must be an array`); continue; }
      for (const rel of list) {
        const p = entryProblem(rel, kindOf);
        if (p) { errors.push(`${name}: ${key} entry ${JSON.stringify(rel)}: ${p}`); continue; }
        if (rel === "index.html" && !INDEX_HTML_SLICES.includes(slice)) errors.push(`${name}: index.html may be listed only by a slice >= C1`);
        // One owner per path: the same path may appear ONCE across every category and every
        // slice file (a consumer in one slice and a serverApiConsumer in another is a collision).
        if (seen.has(rel)) { errors.push(`${name}: duplicate ${key} entry ${rel} (also in ${seen.get(rel)})`); continue; }
        seen.set(rel, name + ":" + key);
        (key === "consumers" ? consumers : serverApiConsumers).add(rel);
      }
    }
  }
  return { ok: errors.length === 0, errors, consumers, serverApiConsumers };
}

/**
 * Pure importer verdict: every non-core file that loads the core must be a listed consumer;
 * every file outside src/finance-server that imports the server API must be a listed
 * serverApiConsumer. `sources` = {[rel]: text}.
 */
export function importerVerdict(sources, { consumers, serverApiConsumers }) {
  const unlistedCore = [], unlistedServer = [];
  for (const [rel, src] of Object.entries(sources)) {
    if (CORE_DIRS.some((d) => rel.startsWith(d + "/"))) continue;
    if (importsCore(src) && !consumers.has(rel)) unlistedCore.push(rel);
    if (!rel.startsWith(SERVER_API_DIR + "/") && importsServerApi(src) && !serverApiConsumers.has(rel)) unlistedServer.push(rel);
  }
  return { ok: unlistedCore.length === 0 && unlistedServer.length === 0, unlistedCore: unlistedCore.sort(), unlistedServer: unlistedServer.sort() };
}

/** Real inputs from the repository. */
export function loadConsumerFiles(repo) {
  const dir = join(repo, "test", "finance", "core-consumers");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
  return names.map((name) => { try { return { name, json: JSON.parse(readFileSync(join(dir, name), "utf8")) }; } catch { return { name, json: { __parseError: true } }; } });
}
export const repoKindOf = (repo) => (rel) => { const p = join(repo, rel); if (!existsSync(p)) return null; return statSync(p).isDirectory() ? "dir" : "file"; };
