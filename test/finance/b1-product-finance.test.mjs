// Financial Core B1 — the shared product composition (src/policy/productFinance.ts).
//   AMEND-01 parity  PFN-01…04: server (tsc-compiled src) ≡ browser (fresh fincore) ≡ committed fincore/v1
//   AMEND-03 R-17    R17-01…10: missing fixed list = valid zero; unreadable = invalid; missing amount/rate = incomplete
//   AMEND-04         PRJ-01…05: month projection composition, no clock read inside the core
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import {
  AS_OF, NOW_MS, CONFIG_EMPTY, ENVELOPE_MATRIX, configWithGlobal, entry, env, fixedItems, inputs, stableJson, uid,
} from "../support/b1-fixtures.mjs";

const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const SERVER = await compileServer().import("src/policy/productFinance.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const serializeReport = BROWSER.metrics.report.serializeReport;

// ── fixtures: every B1 category in one synthetic dataset ─────────────────────
function datasetRows() {
  let n = 0; const id = () => uid(++n);
  const rows = [];
  for (let d = 1; d <= 31; d++) rows.push(entry(id(), `2026-08-${String(d).padStart(2, "0")}`, { sales: "1000", deliveries: "100.5", supplier_payments: { s1: "300" }, payroll: "100" }));
  rows.push(
    entry(id(), "2026-09-01", { sales: "0" }),                                   // explicit zero (VD-23)
    entry(id(), "2026-09-02", { supplier_payments: { s1: "0" }, food_cost: "70" }), // supplier explicit zero wins over food_cost (C-19)
    entry(id(), "2026-09-03", { sales: "500", supplier_payments: { s1: "-40" } }),  // negative / refund (VD-17)
    entry(id(), "2026-09-04", { sales: "200", payroll: "50", hourly_payroll: { w1: "70" } }), // hourly_payroll never counted
    entry(id(), "2026-09-05", { notes: "notes only" }),                             // no financial value ⇒ missing
    entry(id(), "2026-09-06", { sales: "abc" }),                                    // invalid cell
    entry(id(), "2026-09-07", { sales: "100" }), entry(id(), "2026-09-07", { sales: "200", supplier_payments: { s2: "skip" } }), // duplicate date
    entry(null, "2026-09-08", { sales: "321" }),                                    // missing id (fingerprint)
    entry(id(), "2026-09-09", { sales: "1,234", payroll: "0" }),                    // thousands separator (VD-10)
    entry(id(), AS_OF, { sales: "999" }),                                           // current day (never Actual)
    entry(id(), "2026-10-05", { sales: "999" }),                                    // future
    entry(id(), "2026-02-30", { sales: "1" }),                                      // impossible date
  );
  return rows;
}
const CONFIGS = [["config {}", CONFIG_EMPTY], ["global 3000", configWithGlobal("3000")], ["global missing", { employees: [{ id: "g1", type: "global" }] }], ["config absent", null]];
const FIXEDS = [["fixed absent", null], ["fixed [3100]", fixedItems("3100")], ["fixed unreadable", { state: "unreadable", reason: "envelope_json" }]];
const allInputs = () => CONFIGS.flatMap(([cn, c]) => FIXEDS.map(([fn, f]) => [`${cn} / ${fn}`, inputs(datasetRows(), { config: c, fixed: f })]));

test("PFN-01 server ≡ browser ≡ committed: productDailyMetrics / productDays / productDayRecord on every B1 fixture", () => {
  for (const [name, inp] of allInputs()) {
    for (const range of [{ from: "2026-08-01", to: "2026-12-31" }, { from: "2026-09-01", to: "2026-09-28" }, { from: "2026-09-07", to: "2026-09-07" }]) {
      const out = ENGINES.map(([e, P]) => [e, stableJson({ m: P.productDailyMetrics(inp, range), d: P.productDays(inp, range) })]);
      for (const [e, s] of out) assert.equal(s, out[0][1], `${name} ${range.from}..${range.to}: ${e} ≠ server`);
    }
    for (const date of ["2026-09-01", "2026-09-05", "2026-09-07", AS_OF, "2026-10-05"]) {
      const out = ENGINES.map(([, P]) => stableJson(P.productDayRecord(inp, date)));
      assert.equal(new Set(out).size, 1, `${name} day record ${date}`);
    }
  }
});

test("PFN-02 server ≡ browser ≡ committed: productMonthReport (serializeReport byte-identical)", () => {
  for (const [name, inp] of allInputs()) {
    for (const sel of [{ kind: "closed_month", month: "2026-08" }, { kind: "open_month", month: "2026-09" }, { kind: "open_month", month: "2026-10" }]) {
      const out = ENGINES.map(([, P]) => serializeReport(P.productMonthReport(inp, sel)));
      assert.equal(new Set(out).size, 1, `${name} ${sel.kind} ${sel.month}`);
    }
  }
});

test("PFN-03 decodeEnvelope: the envelope matrix gives identical states server ≡ browser ≡ committed; never {} / [] for a non-value", () => {
  for (const [label, raw, kind, expected] of ENVELOPE_MATRIX) {
    const out = ENGINES.map(([, P]) => P.decodeEnvelope(raw, kind));
    for (const o of out) assert.deepEqual(o, out[0], label);
    assert.equal(out[0].state, expected, label);
    if (expected !== "present") assert.ok(!("value" in out[0]), label + ": no defaulted value");
    if (expected === "unreadable") assert.ok(["envelope_json", "envelope_shape"].includes(out[0].reason), label);
  }
  assert.equal(SERVER.decodeEnvelope({ _v: "{bad" }, "object").reason, "envelope_json");
  assert.equal(SERVER.decodeEnvelope({ _v: "[1]" }, "object").reason, "envelope_shape");
});

test("PFN-04 productFinance.ts is pure and binds the product policies (no clock, no Number/Math, no I/O, no basis/source parameter)", () => {
  const raw = readFileSync(join(REPO, "src/policy/productFinance.ts"), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  for (const re of [/Date\.now/, /new Date\(/, /\bNumber\(/, /Math\./, /\.toFixed\(/, /parseFloat/, /parseInt/, /from\s+["']node:/, /firebase/, /fetch\(/, /process\./, /1\.18/, /VAT_RATE/])
    assert.doesNotMatch(code, re, "productFinance.ts must not match " + re);
  assert.equal((code.match(/JSON\.parse\(/g) || []).length, 1, "JSON.parse only inside decodeEnvelope");
  assert.ok(code.indexOf("JSON.parse(") > code.indexOf("export function decodeEnvelope(raw: unknown, expect: \"object\" | \"array\")"));
  for (const m of code.matchAll(/import\s[^;]*?from\s+["']([^"']+)["']/g)) assert.ok(m[1].startsWith("./") || m[1].startsWith("../finance/") || m[1].startsWith("../metrics/") || m[1] === "../forecast/revenueForecast.js", "import " + m[1]);
  // no exported function takes a basis / labor source / calendar parameter
  for (const m of code.matchAll(/export function (\w+)\(([^)]*)\)/g)) assert.doesNotMatch(m[2], /basis|laborSource|calendar|closure/i, m[1] + " exposes a policy parameter");
  assert.match(code, /productPurchaseBasis\(\)/); assert.match(code, /productLaborSource\(\)/); assert.match(code, /NO_DECLARED_CLOSURES/);
  assert.equal(SERVER.PRODUCT_FINANCE_VERSION, "MARJIN_PRODUCT/1");
  assert.equal(BROWSER.versions.product, "MARJIN_PRODUCT/1"); assert.equal(COMMITTED.versions.product, "MARJIN_PRODUCT/1");
});

// ── AMEND-03 / R-17 ───────────────────────────────────────────────────────────
const augRows = () => Array.from({ length: 31 }, (_, i) => entry(uid(i + 1), `2026-08-${String(i + 1).padStart(2, "0")}`, { sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" }));
const aug = (P, { config = CONFIG_EMPTY, fixedNode } = {}) => {
  const fixed = fixedNode === undefined ? { state: "absent" } : P.decodeEnvelope(fixedNode, "array");
  return P.productMonthReport({ rows: augRows(), config: { state: "present", value: config }, fixed, asOfBusinessDate: AS_OF }, { kind: "closed_month", month: "2026-08" });
};
const R17 = {
  "R17-01": { fixedNode: undefined, fx: "complete", op: "complete" },
  "R17-02": { fixedNode: { _v: "[]" }, fx: "complete", op: "complete" },
  "R17-03": { fixedNode: { _v: "[bad" }, fx: "invalid_components", op: "invalid_components" },
  "R17-04": { fixedNode: { _v: JSON.stringify({ a: 1 }) }, fx: "invalid_components", op: "invalid_components" },
  "R17-05": { fixedNode: [{ id: "f1", amount: "10" }], fx: "invalid_components", op: "invalid_components" },
  "R17-06": { fixedNode: env([{ id: "f1", name: "no amount" }]), fx: "incomplete_components", op: "incomplete_components" },
  "R17-07": { config: { rentType: "pct" }, fx: "incomplete_components", op: "incomplete_components" },
  "R17-08": { config: { hasRoyalty: true }, fx: "incomplete_components", op: "incomplete_components" },
};
for (const [id, c] of Object.entries(R17)) {
  test(`${id} R-17 fixed-cost semantics: ${JSON.stringify(c.fixedNode ?? c.config)} ⇒ fixedAccrual ${c.fx}, operating profit ${c.op}`, () => {
    const r = aug(SERVER, c);
    assert.equal(r.actual.fixedAccrual.state, c.fx);
    assert.equal(r.actual.operatingProfit.state, c.op);
    if (c.fx === "complete") {
      assert.equal(r.actual.fixedAccrual.total, "0", "a missing / empty fixed list is a VALID ZERO");
      assert.equal(r.actual.operatingProfit.value, "18600", "31 × (1000 − 300 − 100)");
    } else {
      assert.equal(r.actual.fixedAccrual.total, null, "never 0"); assert.equal(r.actual.operatingProfit.value, null, "never a plausible profit");
    }
    if (c.fx === "invalid_components") {
      assert.ok(r.flags.some((f) => f.code === "invalid_fixed_amount" && f.key === "__fixed_list_unreadable__" && f.reason === "wrong_type"), "the AMEND-03 sentinel flag");
      assert.equal(r.actual.fixedAccrual.issues[0].kind, "invalid");
    }
    if (c.fx === "incomplete_components") assert.equal(r.actual.fixedAccrual.issues[0].kind, "missing");
  });
}

test("R17-09 a READABLE fixed list never emits the unreadable sentinel key", () => {
  for (const node of [undefined, { _v: "[]" }, env(fixedItems("3100")), env([{ id: "f1" }]), env([{ id: "f1", amount: "abc" }]), env([{ id: "rent", amount: "500" }]), env([{ disabled: true }])]) {
    const r = aug(SERVER, { fixedNode: node });
    assert.ok(!JSON.stringify(r).includes("__fixed_list_unreadable__"), JSON.stringify(node));
    const fixed = node === undefined ? { state: "absent" } : SERVER.decodeEnvelope(node, "array");
    assert.ok(!JSON.stringify(SERVER.productTimeline({ rows: [], config: { state: "present", value: {} }, fixed, asOfBusinessDate: AS_OF })).includes("__fixed_list_unreadable__"));
  }
  assert.equal(SERVER.FIXED_LIST_UNREADABLE_KEY, "__fixed_list_unreadable__");
});

test("R17-10 browser (fincore fresh + committed) gives identical R-17 states for R17-01…08", () => {
  for (const [id, c] of Object.entries(R17)) {
    const s = serializeReport(aug(SERVER, c));
    assert.equal(serializeReport(aug(BROWSER.product, c)), s, id + " browser");
    assert.equal(serializeReport(aug(COMMITTED.product, c)), s, id + " committed");
  }
});

// ── AMEND-04: month projection ────────────────────────────────────────────────
const histRows = () => {
  const rows = []; let n = 0;
  for (let d = 0; d < 120; d++) { const date = new Date(Date.UTC(2026, 5, 1) + d * 86400000).toISOString().slice(0, 10); if (date < AS_OF) rows.push(entry(uid(++n), date, { sales: String(900 + (d % 7) * 25), supplier_payments: { s1: "250" }, payroll: "120" })); }
  return rows;
};

test("PRJ-01 productMonthProjection ≡ the direct composition toForecastDay → computeRevenueForecast → applyProjection", () => {
  const inp = inputs(histRows(), { config: configWithGlobal("3000"), fixed: fixedItems("3100") });
  const report = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  const got = SERVER.productMonthProjection(inp, report, { nowMs: NOW_MS });
  const F = BROWSER;
  const n = F.finance.normalize.normalizeRows(inp.rows, { asOfBusinessDate: AS_OF });
  const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-06-01", to: "2026-09-28" });
  const history = days.map((d) => F.metrics.adapters.legacyNumber.toForecastDay(d)).filter((x) => x !== null);
  const fc = F.forecast.computeRevenueForecast({ tenantId: "", bizId: "", targetMonth: "2026-09", today: AS_OF, nowMs: NOW_MS, history });
  assert.ok(fc.monthEndForecastRevenue !== null, "fixture has enough history");
  const expected = F.metrics.projected.applyProjection(report, { formulaId: fc.formulaId, month: "2026-09", projectedRevenue: fc.monthEndForecastRevenue }, SERVER.productTimeline(inp));
  assert.equal(serializeReport(got.projection), serializeReport(expected));
  assert.deepEqual(got.forecast, { formulaId: "REV_FORECAST/v1", projectedRevenue: fc.monthEndForecastRevenue, warnings: fc.warnings });
});

test("PRJ-02 insufficient history ⇒ projection null + warning insufficient_history (never a fabricated month-end)", () => {
  for (const rows of [[], [entry(uid(1), "2026-09-27", { sales: "100" })]]) {
    const inp = inputs(rows);
    const r = SERVER.productMonthProjection(inp, SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" }), { nowMs: NOW_MS });
    assert.equal(r.projection, null); assert.equal(r.forecast.projectedRevenue, null);
    assert.ok(r.forecast.warnings.includes("insufficient_history"), JSON.stringify(r.forecast.warnings));
  }
  assert.throws(() => SERVER.productMonthProjection(inputs([]), SERVER.productMonthReport(inputs([]), { kind: "open_month", month: "2026-09" }), {}), (e) => e.name === "FinanceContractError" && /now_required/.test(e.message));
});

test("PRJ-03 the Actual report is byte-identical before and after the projection (a separate object, never Actual)", () => {
  const inp = inputs(histRows(), { config: configWithGlobal("3000"), fixed: fixedItems("3100") });
  const report = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  const before = serializeReport(report);
  const p = SERVER.productMonthProjection(inp, report, { nowMs: NOW_MS });
  assert.equal(serializeReport(report), before);
  assert.equal(serializeReport(SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" })), before, "recomputation identical");
  assert.ok(p.projection && p.projection.kind, "projection is its own object");
  assert.notEqual(p.projection, report);
});

test("PRJ-04 no clock read inside the core when nowMs is given (Date.now / new Date() spy)", () => {
  const inp = inputs(histRows());
  const report = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  const realNow = Date.now, RealDate = globalThis.Date; let calls = 0;
  try {
    Date.now = () => { calls++; return realNow(); };
    globalThis.Date = new Proxy(RealDate, { construct(T, args) { if (args.length === 0) calls++; return new T(...args); } });
    SERVER.productMonthProjection(inp, report, { nowMs: NOW_MS });
    SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
    SERVER.productDailyMetrics(inp, { from: "2026-06-01", to: "2026-09-30" });
  } finally { Date.now = realNow; globalThis.Date = RealDate; }
  assert.equal(calls, 0, "the core read no clock");
});

test("PRJ-05 browser parity: productMonthProjection server ≡ browser ≡ committed", () => {
  for (const rows of [histRows(), []]) {
    const inp = inputs(rows, { config: configWithGlobal("3000"), fixed: fixedItems("3100") });
    const out = ENGINES.map(([, P]) => { const rep = P.productMonthReport(inp, { kind: "open_month", month: "2026-09" }); const r = P.productMonthProjection(inp, rep, { nowMs: NOW_MS }); return serializeReport(r); });
    assert.equal(new Set(out).size, 1);
  }
});
