// dailyBuilder (P0): legacy-vs-V2 equivalence, stale-`_v` poison, malformed V2, D1 ambiguity, D3 isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, KEY, T, B } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, plain, uuid, row } from "../support/entries-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const DB = await srv.import("src/analytics/dailyBuilder.js");
const R = await import("../../lib/analytics/entriesReader.js");
const strip = (doc) => { const d = plain(doc); delete d.meta.createdAt; delete d.meta.builtAt; return d; };

async function build(entriesNode, date, extra = {}) {
  const db = installDb(makeDb()); seedBusiness(db, { entries: entriesNode, ...extra });
  const doc = await DB.buildAnalyticsForBiz(T, B, date);
  return { db, doc };
}

test("equivalence: every fixture yields the same AnalyticsDoc from `_v` and from rows", async () => {
  const cases = [["F1_one", "2026-08-01"], ["F2_multi", "2026-09-05"], ["F2_multi", "2026-08-02"], ["F2_multi", "2026-08-09"], ["F4_variety", "2026-08-01"], ["F4_variety", "2026-08-02"], ["F4_variety", "2026-08-03"],
    ["F5_unicode", "2026-08-01"], ["F6_missing", "2026-08-01"], ["F7_exceptions", "2026-08-01"], ["F7_exceptions", "2026-08-02"], ["F8_month", "2026-08-17"], ["F10_numeric_maps", "2026-08-01"], ["F0_empty", "2026-08-01"]];
  for (const [name, date] of cases) {
    const rows = FIXTURES[name];
    const a = strip((await build(asLegacy(rows), date)).doc), b = strip((await build(asV2(rows, { keepV: true }), date)).doc);
    assert.deepEqual(b, a, `${name} @ ${date}`);
    if (name === "F4_variety" && date === "2026-08-01") { assert.equal(a.revenue.sales, 1000); assert.equal(a.revenue.deliveries, 250); assert.equal(a.revenue.food_cost, 1234, "supplier sum overrides food_cost; '1,234' parsed; 'skip'/''/0 ignored"); assert.equal(a.revenue.payroll, 400); assert.equal(a.revenue.had_entry, true); }
    if (name === "F4_variety" && date === "2026-08-02") assert.equal(a.revenue.food_cost, 300, "no supplier payments → food_cost");
    if (name === "F7_exceptions" && date === "2026-08-01") { assert.equal(a.is_exception, true); assert.equal(a.exception.reason, "holiday"); }
    if (name === "F0_empty" || date === "2026-08-09") { assert.equal(a.revenue.had_entry, false); assert.equal(a.revenue.total, 0); }
  }
  const absent = strip((await build(null, "2026-08-01")).doc); assert.equal(absent.revenue.had_entry, false);
});
test("native V2 business without `_v` builds normally", async () => {
  const { doc } = await build(asV2(FIXTURES.F1_one), "2026-08-01");
  assert.equal(doc.revenue.sales, 5000); assert.equal(doc.revenue.food_cost, 1200); assert.equal(doc.revenue.payroll, 400);
});
test("NO-FALLBACK poison: schemaVersion 2 with a stale `_v` — the doc derives from rows only", async () => {
  const { node } = noFallbackNode();
  const { doc } = await build(node, "2026-08-10");
  assert.equal(doc.revenue.sales, 555, "rows value, not the stale 100/500"); assert.equal(doc.is_exception, false);
  const gone = await build(node, "2026-08-12"); assert.equal(gone.doc.revenue.had_entry, false, "the row deleted in V2 (present only in `_v`) is absent"); assert.equal(gone.doc.is_exception, false, "its stale exception flag is not seen");
});
test("MALFORMED V2: typed EntriesStorageError before any write; healthy siblings continue in buildAnalyticsForAll", async () => {
  for (const [name, node] of Object.entries(malformedNodes())) {
    const db = installDb(makeDb()); seedBusiness(db, { entries: node });
    await assert.rejects(() => DB.buildAnalyticsForBiz(T, B, "2026-08-01"), (e) => R.isEntriesStorageError(e) && (e.status === "malformed_v2" || e.status === "malformed_storage") && e.bizId === B && e.site === "dailyBuilder", name);
    assert.deepEqual(db.writes, [], name + ": nothing persisted");
  }
});
test("D1: duplicate_business_date — typed, before any external fetch, nothing persisted; other dates of the same business unaffected", async () => {
  for (const node of [asLegacy(FIXTURES.F3_dup), asV2(FIXTURES.F3_dup, { keepV: true })]) {
    const db = installDb(makeDb()); seedBusiness(db, { entries: node });
    let fetched = 0; globalThis.fetch = async () => { fetched++; throw new Error("offline"); };
    await assert.rejects(() => DB.buildAnalyticsForBiz(T, B, "2026-08-10"), (e) => R.isEntriesAmbiguityError(e) && e.status === "duplicate_business_date" && e.date === "2026-08-10" && e.count === 2 && JSON.stringify(e.ids) === JSON.stringify([uuid("f3a"), uuid("f3b")].sort()) && e.bizId === B);
    assert.equal(fetched, 0, "no weather/oref fetch was attempted"); assert.deepEqual(db.writes, []);
    const ok = await DB.buildAnalyticsForBiz(T, B, "2026-08-11"); assert.equal(ok.revenue.sales, 700, "the unique date still builds");
  }
  offlineFetch();
});
test("D3/D1 orchestration: buildAnalyticsForAll over [healthy, ambiguous, malformed, healthy] → 2 docs, 2 typed failures, healthy docs persisted", async () => {
  const db = installDb(makeDb());
  const date = "2026-08-10";
  const bizzes = [["h1", asLegacy([row("h1", date, { sales: "10" })])], ["amb", asV2(FIXTURES.F3_dup)], ["bad", malformedNodes().rows_scalar], ["h2", asV2([row("h2", date, { sales: "20" })])]];
  for (const [biz, node] of bizzes) seedBusiness(db, { biz, entries: node, businesses: bizzes.map(([b]) => ({ id: b, name: "Biz " + b })) });
  db.seed("proactive_biz_index", Object.fromEntries(bizzes.map(([b]) => [`${T}_${b}`, { tenantId: T, bizId: b, active: true }])));
  const { docs, failures } = await DB.buildAnalyticsForAll(date);
  assert.deepEqual(docs.map((d) => d.bizId).sort(), ["h1", "h2"]);
  assert.deepEqual(failures.map((f) => f.bizId).sort(), ["amb", "bad"]);
  assert.match(failures.find((f) => f.bizId === "amb").error, /duplicate_business_date/); assert.match(failures.find((f) => f.bizId === "bad").error, /malformed_v2/);
  const persisted = db.writes.filter((w) => w.op === "set" && /analytics:daily|insights:daily/.test(w.path)).map((w) => w.path);
  assert.ok(persisted.some((p) => p.includes("biz:h1:analytics:daily")) && persisted.some((p) => p.includes("biz:h2:analytics:daily")), "healthy businesses persisted");
  assert.ok(!persisted.some((p) => p.includes("biz:amb:") || p.includes("biz:bad:")), "nothing persisted for the ambiguous / malformed business");
});
