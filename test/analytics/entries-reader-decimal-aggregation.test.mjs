// SERVER READERS R2 — DETERMINISTIC DECIMAL ACCUMULATION (Codex R1 blocker, CTO D-R2-1/D-R2-2).
//
// dailyMetricsRepo sums the existing per-row components of a business date EXACTLY in
// decimal (BigInt coefficient + scale, one final Number conversion). This suite proves,
// through the REAL compiled repository:
//   • all 6 permutations × 6 UUID/value assignments × legacy/V2 forms × V2 insertion
//     orders of {100.1, 200.2, 300.3} give exactly Number("600.6");
//   • the adversarial numeric contract (scales, signs, cancellation, exponents, range,
//     intermediate overflow, non-finite categories, singleton passthrough);
//   • the Codex downstream counterexample through the ACTUAL proactive flow
//     (getDailyMetrics → fetchPlannedData → runForBiz → detector → persisted insight → digest);
//   • NEGATIVE CONTROL: the parent (c46c2727) repository, compiled from git, produces
//     600.5999999999999 for some permutations and flips the detector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, ROOT, T, B } from "../support/server-reader-harness.mjs";
import { plain } from "../support/entries-fixtures.mjs";
import { gitIn } from "../support/git-context.mjs";

offlineFetch();
const srv = compileServer();
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const AS = await srv.import("src/services/analyticsService.js");
const DET = await srv.import("src/agent/proactive/detectors/detectDailyRevenueUnderperformance.js");
const BL = await srv.import("src/agent/baseline/selectBaseline.js");
const PJ = await srv.import("src/agent/proactive/runProactiveJob.js");
const PARENT = "c46c27278966e517a02a91e7adc0911084012b20";

// ── helpers ──────────────────────────────────────────────────────────────────
const D = "2026-08-10";
const IDS = ["11111111-1111-4111-8111-000000000001", "11111111-1111-4111-8111-000000000002", "11111111-1111-4111-8111-000000000003"];
const uuidN = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const rowOf = (id, date, fields) => ({ id, date, sales: 0, deliveries: 0, other_income: 0, payroll: 0, ...fields });
const legacyNode = (rows) => ({ _v: JSON.stringify(rows) });
const v2Node = (rows) => { const map = {}; for (const r of rows) map[r.id] = { ...r, _gen: 1 }; return { schemaVersion: 2, generation: 1, rows: map }; };
const permutations = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
// NOTE: no JSON round-trip here — Infinity / NaN must survive for the non-finite cases.
async function metricsFor(node, from = "2000-01-01", to = "2099-12-31") { installDb(makeDb()); seedBusiness(globalThis.__DB, { entries: node }); return (await DM.getDailyMetrics(T, from, to, B)).map((x) => ({ ...x })); }
/** Every physical representation of `values` as separate same-date rows (field = which component). */
function representations(values, field = "sales", extraRows = []) {
  const n = values.length; const reps = [];
  const idSets = n === 3 ? permutations(IDS) : [IDS.slice(0, n).concat(Array.from({ length: Math.max(0, n - 3) }, (_, i) => uuidN(i + 10)))];
  for (const ids of idSets) {
    const rows = values.map((v, i) => rowOf(ids[i], D, { [field]: v }));
    for (const perm of (n <= 3 ? permutations(rows) : [rows, rows.slice().reverse()])) {
      const all = [...perm, ...extraRows];
      reps.push([`legacy ids=${ids.map((x) => x.slice(-1)).join("")} order=${perm.map((r) => r.id.slice(-1)).join("")}`, legacyNode(all)]);
      reps.push([`v2 ids=${ids.map((x) => x.slice(-1)).join("")} insertion=${perm.map((r) => r.id.slice(-1)).join("")}`, v2Node(all)]);
      reps.push([`v2 ids=${ids.map((x) => x.slice(-1)).join("")} insertion=rev(${perm.map((r) => r.id.slice(-1)).join("")}) extras-first`, v2Node([...extraRows, ...perm.slice().reverse()])]);
    }
  }
  return reps;
}
async function assertInvariant(values, expected, { field = "sales", pick = "revenue", extraRows = [], label = "" } = {}) {
  const reps = representations(values, field, extraRows);
  assert.ok(reps.length >= (values.length === 3 ? 108 : 6), "representation count " + reps.length);
  for (const [name, node] of reps) {
    const daily = await metricsFor(node);
    const rec = daily.find((d) => d.date === D);
    assert.ok(rec, name);
    if (Number.isNaN(expected)) assert.ok(Number.isNaN(rec[pick]), `${label} ${name}: expected NaN, got ${rec[pick]}`);
    else assert.ok(Object.is(rec[pick], expected), `${label} ${name}: expected ${String(expected)} (Object.is), got ${String(rec[pick])}`);
    assert.equal(daily.filter((d) => d.date === D).length, 1, name + ": one record per date");
  }
  return reps.length;
}

test("Codex decimal permutation defect: 100.1 + 200.2 + 300.3 → exactly Number('600.6') in every physical representation (6 perms × 6 uuid assignments × forms × insertion orders)", async () => {
  const n = await assertInvariant([100.1, 200.2, 300.3], Number("600.6"), { label: "revenue" });
  assert.ok(n >= 108);
  const daily = await metricsFor(legacyNode([100.1, 200.2, 300.3].map((v, i) => rowOf(IDS[i], D, { sales: v }))));
  assert.equal(String(daily[0].revenue), "600.6", "String form is the canonical decimal");
  // the same three values as laborCost (payroll + hourly map) and foodCost (supplier map / food_cost fallback)
  await assertInvariant([100.1, 200.2, 300.3], Number("600.6"), { field: "payroll", pick: "laborCost", label: "laborCost" });
  await assertInvariant([100.1, 200.2, 300.3], Number("600.6"), { field: "food_cost", pick: "foodCost", label: "foodCost" });
  // string inputs coerced by the UNCHANGED per-row boundary, then summed exactly
  await assertInvariant(["100.1", "200.2", "300.3"], Number("600.6"), { label: "string revenue" });
});

test("adversarial numeric contract (each list = separate same-date rows; exact Number expectations, Object.is)", async () => {
  const cases = [
    [[0.1, 0.2], Number("0.3"), "0.1 + 0.2"],
    [[10.01, 20.02, 30.03], Number("60.06"), "cents-like"],
    [[100, 0.25, 2], 102.25, "mixed integer + decimal"],
    [[1.2, 0.003, 0.00004], Number("1.20304"), "mixed scales, no cents truncation"],
    [[-1.25, 2.5, -0.125], 1.125, "signed"],
    [[0.1, 0.2, -0.3], 0, "cancellation to exact +0"],
    [[1e-7, 2e-8], Number("1.2e-7"), "exponent notation (Number.toString → 1e-7)"],
    [[5e-324, 5e-324], Number("1e-323"), "smallest denormals"],
    [[1e21, 1e21, 1e21], 3e21, "1e+21 exponent form (positive exponent)"],
    [[1e16, 1, -1e16], 1, "large cancellation — Kahan/pairwise can give 0"],
    [[1e20, 0.01, -1e20], 0.01, "no per-step Number conversion"],
    [[1e308, 1e308, -1e308], 1e308, "INTERMEDIATE OVERFLOW: some JS orders hit Infinity; exact final total is finite (D-R2-2)"],
    [[Number.MAX_VALUE, Number.MAX_VALUE], Infinity, "final exact total outside finite range → existing Number-output semantics (Infinity)"],
    [[-Number.MAX_VALUE, -Number.MAX_VALUE], -Infinity, "negative overflow of the final total"],
    [[123456789.123, 0.877, 1000000000], 1123456790, "large finite values"],
  ];
  for (const [values, expected, label] of cases) await assertInvariant(values, expected, { label });
  // 0.01 repeated 10,000 times (two physical orders, both forms) → exactly 100
  const many = Array.from({ length: 10000 }, (_, i) => rowOf(uuidN(i + 1), D, { sales: 0.01 }));
  for (const node of [legacyNode(many), legacyNode(many.slice().reverse()), v2Node(many), v2Node(many.slice().reverse())]) {
    const d = await metricsFor(node); assert.ok(Object.is(d[0].revenue, 100), "0.01 × 10000 = 100 exactly");
  }
  // foodCost per-row fallback semantics preserved: supplier map wins when truthy, else food_cost; never both
  const fb = await metricsFor(legacyNode([rowOf(IDS[0], D, { supplier_payments: { s1: 10.1 }, food_cost: 999 }), rowOf(IDS[1], D, { supplier_payments: {}, food_cost: 20.2 }), rowOf(IDS[2], D, { food_cost: "30.3" })]));
  assert.ok(Object.is(fb[0].foodCost, Number("60.6")), "10.1 (map) + 20.2 (fallback) + 30.3 (fallback)");
});

test("non-finite categories preserved (no new acceptance, no silent zeroing): +∞, −∞, both → NaN, NaN component → NaN", async () => {
  // "1e309" coerces to Infinity at the UNCHANGED scalar boundary (existing behaviour)
  await assertInvariant(["1e309", 5, 7], Infinity, { label: "+Infinity survives" });
  await assertInvariant(["-1e309", 5], -Infinity, { label: "-Infinity survives" });
  await assertInvariant(["1e309", "-1e309", 1], NaN, { label: "both infinities → NaN" });
  // a NaN COMPONENT (Infinity + -Infinity inside one row) propagates; it is not zeroed a second time
  const d = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: "1e309", deliveries: "-1e309" }), rowOf(IDS[1], D, { sales: 5 })]));
  assert.ok(Number.isNaN(d[0].revenue));
  const single = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: "1e309", deliveries: "-1e309" })]));
  assert.ok(Number.isNaN(single[0].revenue), "singleton NaN passthrough");
  // existing scalar coercions unchanged: '1,234' / 'skip' / null / '' → 0 ; true → 1 ; '0x10' → 16
  const c = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: "1,234", deliveries: "skip", other_income: null }), rowOf(IDS[1], D, { sales: true, deliveries: "0x10", other_income: "" })]));
  assert.equal(c[0].revenue, 17);
});

test("singleton passthrough and unique-date behaviour are byte-identical to R1 (per-row binary arithmetic untouched)", async () => {
  // singleton: 0.1 + 0.2 INSIDE one row stays the existing 0.30000000000000004 (D-R2-1: no per-row recomputation)
  const s = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: 0.1, deliveries: 0.2 })]));
  assert.ok(Object.is(s[0].revenue, 0.30000000000000004));
  // singleton supplier-map residual: .1+.2-.3 inside one row is a tiny binary residual (truthy) → NOT the food_cost fallback
  const m = await metricsFor(legacyNode([rowOf(IDS[0], D, { supplier_payments: { a: 0.1, b: 0.2, c: -0.3 }, food_cost: 7 })]));
  assert.ok(Object.is(m[0].foodCost, 0.1 + 0.2 - 0.3), "existing per-row residual preserved (not 7, not 0)");
  // distinct dates interleaved with the duplicate date; inclusive window; latest date; ratios from final sums
  const rows = [rowOf(IDS[0], "2026-08-09", { sales: 50, payroll: 5 }), rowOf(IDS[1], D, { sales: 100.1, payroll: 1.1, food_cost: 2.2 }), rowOf(uuidN(1), "2026-08-11", { sales: 70 }), rowOf(IDS[2], D, { sales: 200.2, payroll: 2.2, food_cost: 3.3 }), rowOf(uuidN(2), D, { sales: 300.3, payroll: 3.3, food_cost: 4.4 })];
  for (const node of [legacyNode(rows), legacyNode(rows.slice().reverse()), v2Node(rows), v2Node(rows.slice().reverse())]) {
    const d = await metricsFor(node);
    assert.deepEqual(d.map((x) => [x.date, x.revenue, x.laborCost, x.foodCost]), [["2026-08-09", 50, 5, 0], [D, Number("600.6"), Number("6.6"), Number("9.9")], ["2026-08-11", 70, 0, 0]]);
    assert.equal(d[1].laborPct, (Number("6.6") / Number("600.6")) * 100, "ratio from the deterministic final sums, never averaged");
    assert.equal(d[1].foodCostPct, (Number("9.9") / Number("600.6")) * 100);
    assert.deepEqual([d[1].transactionCount, d[1].avgTicket], [0, 0]);
    const win = await metricsFor(node, D, D); assert.deepEqual(win.map((x) => x.date), [D]);
    assert.equal(await DM.getLatestDailyDate(T, B), "2026-08-11");
  }
  // denominator zero / non-positive revenue → zero ratios (unchanged)
  const z = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: -5, payroll: 3 }), rowOf(IDS[1], D, { sales: 5, payroll: 4 })]));
  assert.deepEqual([z[0].revenue, z[0].laborCost, z[0].laborPct, z[0].foodCostPct], [0, 7, 0, 0]);
  const neg = await metricsFor(legacyNode([rowOf(IDS[0], D, { sales: -5, payroll: 3 })]));
  assert.deepEqual([neg[0].revenue, neg[0].laborPct], [-5, 0]);
  assert.deepEqual(await metricsFor(legacyNode([])), []);
});

// ── the Codex downstream counterexample through the ACTUAL proactive flow ────
const dayBefore = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const Y = dayBefore(1);
/** chronological history: 17 × 600, then 812, 500, 500 — the duplicate day is yesterday */
const HISTORY = [...Array.from({ length: 17 }, (_, i) => rowOf(uuidN(100 + i), dayBefore(21 - i), { sales: 600 })), rowOf(uuidN(200), dayBefore(4), { sales: 812 }), rowOf(uuidN(201), dayBefore(3), { sales: 500 }), rowOf(uuidN(202), dayBefore(2), { sales: 500 })];
const TRIPLE = [100.1, 200.2, 300.3];
function downstreamReps() {
  const reps = [];
  for (const ids of permutations(IDS)) {
    const rows = TRIPLE.map((v, i) => rowOf(ids[i], Y, { sales: v }));
    for (const perm of permutations(rows)) {
      reps.push([`legacy ids=${ids.map((x) => x.slice(-1)).join("")} order=${perm.map((r) => r.id.slice(-1)).join("")}`, legacyNode([...HISTORY, ...perm])]);
      reps.push([`v2 ids=${ids.map((x) => x.slice(-1)).join("")} insertion=${perm.map((r) => r.id.slice(-1)).join("")}`, v2Node([...perm, ...HISTORY])]);
    }
  }
  return reps;
}
const plan = { intent: "anomaly_detection", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: dayBefore(28), end: dayBefore(0) }, requiresBaseline: true, requiresComparison: false, requiresAnomalyDetection: true };
const ctx = { tenantId: T, bizId: B, timezone: "Asia/Jerusalem", locale: "he", nowIso: new Date().toISOString(), userQuestion: "proactive" };
const stripTime = (v) => JSON.parse(JSON.stringify(v, (k, x) => (/At$|^generatedAt$|^jobId$/.test(k) ? undefined : x)));
async function seed(node) { const db = installDb(makeDb()); seedBusiness(db, { entries: node }); db.seed(`tenants/${T}/biz:${B}:suppliers`, { _v: JSON.stringify([{ id: "s1", name: "S1" }]) }); return db; }

test("Codex counterexample (17×600, 812, 500, 500 + {100.1,200.2,300.3}): identical DailyMetric, baseline, detector (null), persisted insight and digest across 72 representations", async () => {
  const reps = downstreamReps(); assert.equal(reps.length, 72);
  const snapshots = [];
  for (const [name, node] of reps) {
    const db = await seed(node);
    const fetched = await AS.fetchPlannedData(plan, ctx);
    const daily = fetched.metrics.daily;
    const rec = daily.find((d) => d.date === Y);
    assert.ok(Object.is(rec.revenue, Number("600.6")), name + ": DailyMetric revenue");
    assert.equal(daily.length, 21, name + ": 21 logical dates");
    const baseline = BL.selectBaseline(plan, fetched, ctx);
    assert.equal(baseline.valid, true, name);
    const det = DET.detectDailyRevenueUnderperformance(fetched, baseline);
    assert.equal(det, null, name + ": 600.6 is not strictly below the 600.6 baseline → no streak, no anomaly");
    const result = await PJ.runForBiz(T, B);
    assert.deepEqual(result.errors, [], name);
    const insights = db.read(`tenants/${T}/proactive_insights/${B}`) || {};
    const digests = db.read(`tenants/${T}/proactive_digests/${B}`);
    assert.ok(digests && Object.keys(digests.daily || {}).length === 1, name + ": a digest was persisted (non-null)");
    assert.ok(!Object.values(insights).some((i) => i.type === "revenue_underperformance"), name + ": no revenue-underperformance insight persisted");
    snapshots.push([name, stripTime({ result, daily, baseline, insights, digests })]);
  }
  for (const [name, s] of snapshots) assert.deepEqual(s, snapshots[0][1], `${name} ≠ ${snapshots[0][0]}`);
  const digest = Object.values(snapshots[0][1].digests.daily)[0];
  assert.deepEqual([digest.totalDetected, digest.totalSuppressed], [0, 0], "this exact fixture: nothing detected, nothing suppressed");
});

test("positive persistence control: a genuine underperformance (600 vs ~1000 history) persists ONE identical insight and digest across representations", async () => {
  const hist = Array.from({ length: 20 }, (_, i) => rowOf(uuidN(300 + i), dayBefore(i + 2), { sales: 1000 }));
  const snaps = [];
  for (const ids of [IDS, IDS.slice().reverse()]) {
    const rows = [100, 200, 300].map((v, i) => rowOf(ids[i], Y, { sales: v }));
    for (const node of [legacyNode([...hist, ...rows]), legacyNode([...rows.slice().reverse(), ...hist]), v2Node([...hist, ...rows]), v2Node([...rows.slice().reverse(), ...hist])]) {
      const db = await seed(node);
      const result = await PJ.runForBiz(T, B);
      const insights = db.read(`tenants/${T}/proactive_insights/${B}`) || {};
      const ru = Object.values(insights).find((i) => i.type === "revenue_underperformance");
      assert.ok(ru && ru.currentValue === 600, "real persisted insight with currentValue 600");
      const digests = db.read(`tenants/${T}/proactive_digests/${B}`);
      assert.ok(digests && Object.values(digests.daily)[0].totalDetected >= 1, "non-empty digest");
      snaps.push(stripTime({ result, insights, digests }));
    }
  }
  for (const s of snaps) assert.deepEqual(s, snaps[0]);
});

test("NEGATIVE CONTROL — the parent (c46c2727) repository is order-dependent: 600.5999999999999 vs 600.6, intermediate overflow, and a flipped detector verdict", async () => {
  const show = gitIn(ROOT, ["show", `${PARENT}:src/repositories/analytics/dailyMetricsRepo.ts`]);
  assert.equal(show.status, 0, show.stderr);
  const ts = (await import(pathToFileURL(join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
  const prePath = join(srv.dir, "src", "repositories", "analytics", "dailyMetricsRepo.__parent__.js");
  writeFileSync(prePath, ts.transpileModule(show.stdout, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  const PRE = await import(pathToFileURL(prePath).href);
  const results = new Set();
  for (const perm of permutations(TRIPLE)) {
    installDb(makeDb()); seedBusiness(globalThis.__DB, { entries: legacyNode(perm.map((v, i) => rowOf(IDS[i], D, { sales: v }))) });
    results.add(String((await PRE.getDailyMetrics(T, "2000-01-01", "2099-12-31", B))[0].revenue));
  }
  assert.deepEqual([...results].sort(), ["600.5999999999999", "600.6"], "parent: the aggregate depends on physical order");
  // parent intermediate overflow: [1e308, 1e308, -1e308] → Infinity in some orders, 1e308 in others
  const ov = new Set();
  for (const perm of permutations([1e308, 1e308, -1e308])) {
    installDb(makeDb()); seedBusiness(globalThis.__DB, { entries: legacyNode(perm.map((v, i) => rowOf(IDS[i], D, { sales: v }))) });
    ov.add(String((await PRE.getDailyMetrics(T, "2000-01-01", "2099-12-31", B))[0].revenue));
  }
  assert.deepEqual([...ov].sort(), ["1e+308", "Infinity"], "parent: intermediate overflow depends on order");
  // parent downstream: the Codex fixture flips the detector between representations
  const verdicts = new Set();
  for (const perm of permutations(TRIPLE.map((v, i) => rowOf(IDS[i], Y, { sales: v })))) {
    installDb(makeDb()); seedBusiness(globalThis.__DB, { entries: legacyNode([...HISTORY, ...perm]) });
    const daily = plain(await PRE.getDailyMetrics(T, dayBefore(28), dayBefore(0), B));
    const fetched = { metrics: { daily }, completenessScore: 1, freshnessScore: 1, consistencyScore: 1 };
    const baseline = BL.selectBaseline(plan, fetched, ctx);
    verdicts.add(JSON.stringify(DET.detectDailyRevenueUnderperformance(fetched, baseline)));
  }
  assert.equal(verdicts.size, 2, "parent: two different detector verdicts from nothing but row order");
  assert.ok(verdicts.has("null"), "parent: one order → null");
  assert.ok([...verdicts].some((v) => v !== "null" && JSON.parse(v).severity === "high"), "parent: another order → high-severity streak (600.5999999999999 < 600.6)");
});

test("fixture discrimination: every rejected accumulator design fails at least one fixture that R2 passes", () => {
  const fixtures = [
    { v: [100.1, 200.2, 300.3], exact: Number("600.6") },
    { v: [1e16, 1, -1e16], exact: 1 },
    { v: [1e20, 0.01, -1e20], exact: 0.01 },
    { v: [1e308, 1e308, -1e308], exact: 1e308 },
    { v: [1.2, 0.003, 0.00004], exact: Number("1.20304") },
  ];
  const allPerms = (f) => permutations(f.v);
  const ordinary = (xs) => xs.reduce((a, b) => a + b, 0);
  const valueSorted = (xs) => ordinary(xs.slice().sort((a, b) => a - b));
  const kahan = (xs) => { let s = 0, c = 0; for (const x of xs) { const y = x - c; const t = s + y; c = (t - s) - y; s = t; } return s; };
  const pairwise = (xs) => xs.length <= 2 ? ordinary(xs) : pairwise(xs.slice(0, xs.length >> 1)) + pairwise(xs.slice(xs.length >> 1));
  const cents = (xs) => xs.reduce((a, b) => a + Math.round(b * 100), 0) / 100;
  const perStepNumber = (xs) => { let s = 0; for (const x of xs) s = Number(BigInt(Math.round(s * 1e6)) + BigInt(Math.round(x * 1e6))) / 1e6; return s; };
  const fails = (fn) => fixtures.some((f) => allPerms(f).some((p) => !Object.is(fn(p), f.exact)));
  for (const [name, fn] of Object.entries({ ordinary, valueSorted, kahan, pairwise, cents, perStepNumber })) assert.ok(fails(fn), name + " must be discriminated by the fixtures");
});
