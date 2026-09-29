// Financial Core B1 — the analytics daily builder over the canonical server API: DB-01…12.
// Real compiled dailyBuilder through the server-reader harness; external fetches offline;
// clock injected (asOfBusinessDate 2026-09-29).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { AS_OF, NOW_MS, T, B, asLegacy, asV2, badValues, configWithGlobal, entry, env, permutations, seedRaw, uid } from "../support/b1-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const DB = await srv.import("src/analytics/dailyBuilder.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const INS = await srv.import("src/insights/buildInsights.js");
const strip = (doc) => { const d = JSON.parse(JSON.stringify(doc)); delete d.meta.createdAt; delete d.meta.builtAt; return d; };
async function build(entries, date, { config = env(configWithGlobal("3000")), nowMs = NOW_MS, exception } = {}) {
  const db = installDb(seedRaw(makeDb(), { entries, config }));
  if (exception) db.seed(`tenants/${T}/entry_exceptions/${B}/${date}`, exception);
  return { db, doc: await DB.buildAnalyticsForBiz(T, B, date, { nowMs }) };
}
const D = "2026-09-10";
const full = () => [entry(uid(1), D, { sales: "1000", deliveries: "200", other_income: "50", supplier_payments: { s1: "300" }, payroll: "100" })];

test("DB-01 a complete day: legacy fields equal the CanonicalDailyMetric numbers; fin carries exact strings", async () => {
  const { doc } = await build(asLegacy(full()), D);
  const inputs = await CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "t", nowMs: NOW_MS, need: { config: true, fixed: false } });
  const [m] = CM.canonicalDailySeries(inputs, { from: D, to: D }).days;
  assert.deepEqual(
    { sales: doc.revenue.sales, deliveries: doc.revenue.deliveries, other_income: doc.revenue.other_income, total: doc.revenue.total, food_cost: doc.revenue.food_cost, payroll: doc.revenue.payroll },
    { sales: 1000, deliveries: 200, other_income: 50, total: m.revenue, food_cost: m.foodCost, payroll: m.laborCost });
  assert.equal(doc.revenue.total, 1250); assert.equal(doc.revenue.payroll, 200, "payroll 100 + 3000/30");
  assert.equal(doc.revenue.had_entry, true); assert.equal(doc.revenue.has_sales, true);
  assert.equal(doc.fin.inActual, true); assert.deepEqual(doc.fin.revenue, { state: "present", value: "1250" }); assert.deepEqual(doc.fin.purchases, { state: "present", value: "300", bySource: [{ source: "supplier:s1", amount: "300" }] });
  assert.deepEqual(doc.fin.hourlyEmployerCost, { state: "present", value: "100" }); assert.equal(doc.fin.derived.laborCost, 200); assert.equal(doc.fin.derived.globalLaborCost, 100);
  assert.equal(doc.fin.api, "MARJIN_FIN_SERVER/1"); assert.equal(doc.fin.asOfBusinessDate, AS_OF); assert.equal(doc.fin.windowRule, "completed_days_through_d_minus_1");
});

test("DB-02 the current day (date = asOf) ⇒ a non-Actual context doc (no financial legacy field); empty insights; the readback contract holds", async () => {
  const { db, doc } = await build(asLegacy([entry(uid(1), AS_OF, { sales: "999", supplier_payments: { s1: "1" }, payroll: "5" })]), AS_OF);
  assert.equal(doc.fin.inActual, false); assert.equal(doc.fin.outsideActualReason, "current_day");
  for (const k of ["sales", "deliveries", "other_income", "total", "food_cost", "payroll"]) assert.ok(!(k in doc.revenue), k + " omitted");
  assert.equal(doc.revenue.had_entry, true, "presence of the current day is context, not Actual"); assert.equal(doc.revenue.has_sales, false);
  await DB.saveAnalyticsDoc(doc); await DB.buildAndSaveInsights(T, B, AS_OF, doc);
  const saved = db.read(`tenants/${T}/biz:${B}:analytics:daily:${AS_OF}`); assert.equal(saved.date, AS_OF); assert.equal(saved.fin.inActual, false);
  const ins = db.read(`tenants/${T}/biz:${B}:insights:daily:${AS_OF}`); assert.ok(ins && ins.date === AS_OF, "an insights doc exists for the date");
  assert.deepEqual(ins.insights || [], []);
});

test("DB-03 a future date (date > asOf) ⇒ future_date, same non-Actual shape", async () => {
  const { doc } = await build(asLegacy([entry(uid(1), "2026-10-03", { sales: "5" })]), "2026-10-03");
  assert.equal(doc.fin.inActual, false); assert.equal(doc.fin.outsideActualReason, "future_date");
  assert.deepEqual(Object.keys(doc.revenue).sort(), ["had_entry", "has_sales"]); assert.equal(doc.revenue.had_entry, false);
});

test("DB-04 duplicate business date ⇒ one aggregated doc, no EntriesAmbiguityError (VD-04)", async () => {
  const rows = [entry(uid(1), D, { sales: "100", supplier_payments: { s1: "10" }, payroll: "1" }), entry(uid(2), D, { sales: "500", supplier_payments: { s1: "50" }, payroll: "4" })];
  for (const node of [asLegacy(rows), asV2(rows)]) {
    const { doc } = await build(node, D);
    assert.equal(doc.revenue.sales, 600); assert.equal(doc.revenue.food_cost, 60); assert.equal(doc.revenue.payroll, 105); assert.equal(doc.fin.rowCount, 2);
  }
});

test("DB-05 omission: missing purchases ⇒ food_cost absent; missing payroll or global ⇒ payroll absent; partial revenue ⇒ total absent; no undefined/null/NaN in revenue or fin", async () => {
  const noPurch = (await build(asLegacy([entry(uid(1), D, { sales: "100", payroll: "1" })]), D)).doc;
  assert.ok(!("food_cost" in noPurch.revenue)); assert.equal(noPurch.fin.purchases.state, "absent");
  const noPayroll = (await build(asLegacy([entry(uid(1), D, { sales: "100", supplier_payments: { s1: "1" } })]), D)).doc;
  assert.ok(!("payroll" in noPayroll.revenue)); assert.equal(noPayroll.fin.derived.laborCostComplete, false);
  const noGlobal = (await build(asLegacy(full()), D, { config: env({ employees: [{ id: "g1", type: "global" }] }) })).doc;
  assert.ok(!("payroll" in noGlobal.revenue), "global employer cost missing ⇒ labor incomplete ⇒ omitted"); assert.ok(!("globalLaborCost" in noGlobal.fin.derived));
  const noConfig = (await build(asLegacy(full()), D, { config: null })).doc;
  assert.ok(!("payroll" in noConfig.revenue)); assert.equal(noConfig.fin.derived.laborCostComplete, false, "config absent ⇒ global employer cost unknown ⇒ labor incomplete"); assert.equal(noConfig.fin.configState, "absent");
  const partial = (await build(asLegacy([entry(uid(1), D, { sales: "100", deliveries: "abc", supplier_payments: { s1: "1" }, payroll: "1" })]), D)).doc;
  assert.ok(!("total" in partial.revenue), "partial revenue ⇒ total omitted"); assert.equal(partial.revenue.sales, 100); assert.ok(!("deliveries" in partial.revenue));
  assert.equal(partial.fin.revenue.state, "partial_invalid"); assert.equal(partial.revenue.has_sales, false);
  for (const doc of [noPurch, noPayroll, noGlobal, noConfig, partial]) {
    assert.deepEqual(badValues({ revenue: doc.revenue, fin: doc.fin }), []);
    assert.ok(!JSON.stringify({ r: doc.revenue, f: doc.fin }).includes("null"), "no null in revenue / fin");
    assert.ok(!JSON.stringify({ r: doc.revenue, f: doc.fin }).includes("[]"), "no empty array (RTDB drops them: the doc reads back identical)");
  }
});

test("DB-06 presence: zero-only ⇒ had_entry true / has_sales false; payroll-only ⇒ had_entry true, total absent; notes-only ⇒ had_entry false", async () => {
  const zero = (await build(asLegacy([entry(uid(1), D, { sales: "0", supplier_payments: { s1: "0" } })]), D)).doc;
  assert.equal(zero.revenue.had_entry, true); assert.equal(zero.revenue.has_sales, false); assert.equal(zero.revenue.total, 0);
  const payrollOnly = (await build(asLegacy([entry(uid(1), D, { payroll: "80" })]), D)).doc;
  assert.equal(payrollOnly.revenue.had_entry, true); assert.ok(!("total" in payrollOnly.revenue)); assert.equal(payrollOnly.revenue.payroll, 180);
  const notes = (await build(asLegacy([entry(uid(1), D, { notes: "closed?" })]), D)).doc;
  assert.equal(notes.revenue.had_entry, false); assert.equal(notes.fin.presence.day, "missing"); assert.equal(notes.meta.sources.entry, "missing");
});

test("DB-07 labor: payroll = hourly `payroll` + global allocation; hourly_payroll never counted", async () => {
  const { doc } = await build(asLegacy([entry(uid(1), D, { sales: "1000", supplier_payments: { s1: "1" }, payroll: "200", hourly_payroll: { w1: "70", w2: "30" } })]), D);
  assert.equal(doc.revenue.payroll, 300); assert.deepEqual(doc.fin.legacyHourlyPayroll, { counted: false, recorded: true });
  assert.ok(doc.fin.flagCodes.includes("legacy_hourly_payroll_not_counted"));
});

test("DB-08 exceptions: structured envelope wins; one exception row on a duplicate date ⇒ its metadata; disagreeing rows ⇒ metadata null + flag", async () => {
  const active = { state: { status: "active", reasonCode: "closure", reasonText: "storm", updatedAt: 5, updatedBy: "u1" } };
  const s = (await build(asLegacy([entry(uid(1), D, { sales: "1", is_exception: false })]), D, { exception: active })).doc;
  assert.equal(s.is_exception, true); assert.deepEqual(s.exception, { reason: "closure", note: "storm", set_at: 5, set_by: "u1" });
  const cleared = (await build(asLegacy([entry(uid(1), D, { sales: "1", is_exception: true, exception_reason: "holiday" })]), D, { exception: { state: { status: "cleared" } } })).doc;
  assert.equal(cleared.is_exception, false); assert.equal(cleared.exception, null);
  const one = (await build(asLegacy([entry(uid(1), D, { sales: "1", is_exception: true, exception_reason: "holiday", exception_note: "חג" }), entry(uid(2), D, { sales: "2" })]), D)).doc;
  assert.equal(one.is_exception, true); assert.deepEqual(one.exception, { reason: "holiday", note: "חג", set_at: null, set_by: null });
  const dis = (await build(asLegacy([entry(uid(1), D, { sales: "1", is_exception: true, exception_reason: "holiday" }), entry(uid(2), D, { sales: "2", is_exception: false })]), D)).doc;
  assert.equal(dis.is_exception, true, "an exception is recorded on the date"); assert.deepEqual(dis.exception, { reason: null, note: null, set_at: null, set_by: null }, "no winner row's metadata");
  assert.ok(dis.fin.flagCodes.includes("exception_rows_disagree"));
  const two = (await build(asLegacy([entry(uid(1), D, { sales: "1", is_exception: true, exception_reason: "a" }), entry(uid(2), D, { sales: "2", is_exception: true, exception_reason: "b" })]), D)).doc;
  assert.equal(two.is_exception, true); assert.equal(two.exception.reason, null, "two exception rows: no winner");
});

test("DB-09 fin safety: no row id, note, supplier name or free text; bySource is an array; strings from the allowed vocabulary or exact amounts", async () => {
  const rows = [entry(uid(77), D, { sales: "100", supplier_payments: { s1: "40" }, payroll: "1", notes: "SECRET-NOTE", exception_note: "SECRET-EXC", weather_impact: "SECRET-W" })];
  installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env(configWithGlobal("3000")), suppliers: env([{ id: "s1", name: "SECRET-SUPPLIER" }]) }));
  const doc = await DB.buildAnalyticsForBiz(T, B, D, { nowMs: NOW_MS });
  const fin = JSON.stringify(doc.fin);
  for (const secret of [uid(77), "SECRET-NOTE", "SECRET-EXC", "SECRET-W", "SECRET-SUPPLIER"]) assert.ok(!fin.includes(secret), secret);
  assert.ok(Array.isArray(doc.fin.purchases.bySource));
  const strings = []; const walk = (v) => { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); }; walk(doc.fin);
  const allowed = /^(?:-?\d+(?:\.\d+)?(?:\/\d+)?|\d{4}-\d{2}-\d{2}|[A-Za-z_][A-Za-z0-9_:./-]*)$/;
  for (const s of strings) assert.match(s, allowed, "fin string: " + s);
});

test("DB-10 insights: a non-Actual doc ⇒ empty insights; an Actual doc ⇒ the engine result for identical legacy inputs", async () => {
  const { db, doc } = await build(asLegacy(full()), D);
  await DB.saveAnalyticsDoc(doc); await DB.buildAndSaveInsights(T, B, D, doc);
  const saved = db.read(`tenants/${T}/biz:${B}:insights:daily:${D}`);
  const expected = INS.buildInsights(doc, []);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...saved, generatedAt: 0 })), JSON.parse(JSON.stringify({ ...expected, generatedAt: 0 })));
  const cur = (await build(asLegacy([entry(uid(1), AS_OF, { sales: "999" })]), AS_OF)).doc;
  await DB.buildAndSaveInsights(T, B, AS_OF, cur);
  assert.deepEqual(globalThis.__DB.read(`tenants/${T}/biz:${B}:insights:daily:${AS_OF}`).insights || [], []);
});

test("DB-11 determinism: byte-identical doc (minus createdAt/builtAt) across storage forms, row orders and UUIDs", async () => {
  const vals = [["100.1", "10"], ["200.2", "20"], ["300.3", "30"]];
  const out = new Set();
  for (const ids of permutations([uid(1), uid(2), uid(3)])) for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0]]) {
    const rows = order.map((k) => entry(ids[k], D, { sales: vals[k][0], supplier_payments: { s1: vals[k][1] }, payroll: "1" }));
    for (const node of [asLegacy(rows), asV2(rows), asV2(rows.slice().reverse(), { keepV: true })]) out.add(JSON.stringify(strip((await build(node, D)).doc)));
  }
  assert.equal(out.size, 1); assert.equal(JSON.parse([...out][0]).revenue.total, 600.6);
});

test("DB-12 buildAnalyticsForAll: healthy + duplicate-id + malformed businesses ⇒ docs for the healthy ones only, typed failures recorded (unchanged loop)", async () => {
  const date = "2026-08-10";
  const db = installDb(makeDb());
  const bizzes = [["h1", asLegacy([entry(uid(1), date, { sales: "10" })])], ["dupid", asLegacy([entry("X", date, { sales: "1" }), entry("X", "2026-08-11", { sales: "2" })])], ["bad", { schemaVersion: 2, generation: 1, rows: "corrupt" }], ["h2", asV2([entry(uid(2), date, { sales: "20" })])]];
  for (const [biz, node] of bizzes) seedRaw(db, { biz, entries: node, businesses: bizzes.map(([b]) => ({ id: b, name: "Biz " + b })) });
  db.seed("proactive_biz_index", Object.fromEntries(bizzes.map(([b]) => [`${T}_${b}`, { tenantId: T, bizId: b, active: true }])));
  const { docs, failures } = await DB.buildAnalyticsForAll(date);
  assert.deepEqual(docs.map((d) => d.bizId).sort(), ["h1", "h2"]);
  assert.deepEqual(failures.map((f) => f.bizId).sort(), ["bad", "dupid"]);
  assert.match(failures.find((f) => f.bizId === "dupid").error, /duplicate_row_id/); assert.match(failures.find((f) => f.bizId === "bad").error, /malformed_v2/);
  const persisted = db.writes.filter((w) => w.op === "set").map((w) => w.path);
  assert.ok(!persisted.some((p) => p.includes("biz:dupid:") || p.includes("biz:bad:")), "nothing derived persisted for failed businesses");
  assert.ok(persisted.some((p) => p.includes("biz:h1:analytics:daily")) && persisted.some((p) => p.includes("biz:h2:analytics:daily")));
});
