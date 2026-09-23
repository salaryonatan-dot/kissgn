// Marjin — P0-DATA-01 SERVER READER CONVERGENCE, proven against a REAL local Firebase
// RTDB emulator with the REAL compiled server modules and the REAL Admin SDK.
//
// Every converged server reader (dailyBuilder, snapshotBuilder, the three analytics
// repositories + fetchPlannedData routing, entryExceptionsRepo, the two non-firing
// alert checkers, the preflight report) is exercised through the shared reader
// (`lib/analytics/entriesReader.js`) against nodes stored in the emulator — including
// nodes converted by the approved `upgradeBusinessToV2` transaction, so RTDB's own
// readback normalization (numeric-key maps → arrays, absent empties) is what the readers
// see, not an in-memory imitation.
//
// CTO decisions under proof:
//   D1 — no silent duplicate-date winner (typed `duplicate_business_date`; aggregators
//        count every row; exceptions fallback returns `legacy_ambiguous`; nothing
//        deleted or merged; the preflight only REPORTS duplicates).
//   D2 — the supplier / expensive-employee checkers stay externally non-firing.
//   D3 — schemaVersion 2 never falls back to `_v`; malformed V2 fails closed with a
//        typed error and no stale analytics / email; a bad business never stops a
//        healthy sibling.
//
// Deliberately NOT named *.test.mjs — it must never be swept up by the emulator-free
// repository glob. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { createLegacyPreflight } from "../../tools/storage-v2/preflight.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, loadClientStorageV2, plain, row, uuid } from "../support/entries-fixtures.mjs";
import { readEntriesNode, duplicateDates, isEntriesStorageError, isEntriesAmbiguityError } from "../../lib/analytics/entriesReader.js";
import { LEGACY_AMBIGUOUS } from "../../lib/entryExceptions.js";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
const DEMO = new Set(["https://demo-marjin-rules.firebaseio.com", "https://demo-marjin-rules-default-rtdb.firebaseio.com"]);
const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));

function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) {
    const u = String(process.env.FIREBASE_DATABASE_URL);
    if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`);
  }
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
}

// ─── Outbound network fence: only the emulator is reachable. dailyBuilder's weather /
// oref lookups fail closed exactly as they do offline; nothing else may leave the host.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === "string" ? input : (input && input.url) || input);
  if (isLocal(url)) return realFetch(input, init);
  throw new Error("network fenced: " + url.slice(0, 60));
};

// ─── production client contract (vm-extracted) for the preflight / upgrader ───
const W = loadClientStorageV2();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
const { preflightLegacyNode } = createLegacyPreflight({
  parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId,
  isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r),
  entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS,
});
const { upgradeBusinessToV2 } = createStorageV2Upgrader({
  preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST,
});

// ─── real server modules (compiled once; only the admin/email seams replaced) ──
const srv = compileServer();
const DBLD = await srv.import("src/analytics/dailyBuilder.js");
const SB = await srv.import("src/snapshot/snapshotBuilder.js");
const DM = await srv.import("src/repositories/analytics/dailyMetricsRepo.js");
const LR = await srv.import("src/repositories/analytics/laborRepo.js");
const PR = await srv.import("src/repositories/analytics/purchasesRepo.js");
const AS = await srv.import("src/services/analyticsService.js");
const EX = await srv.import("lib/repositories/entryExceptionsRepo.js");
const CK = await srv.import("src/alerts/checkers.js");
const RN = await srv.import("src/alerts/runner.js");

// ─── apps / seeding ──────────────────────────────────────────────────────────
const T = "tenantA";
const KEY = (biz, tenant = T) => `tenants/${tenant}/biz:${biz}:entries`;
let app = null;
const db = () => app.database();
const io = () => ({
  transactNode: async (t, key, fn) => { const r = await db().ref(`tenants/${t}/${key}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; },
  readNode: async (t, key) => { const s = await db().ref(`tenants/${t}/${key}`).once("value"); return s.exists() ? s.val() : null; },
  writeNode: async (t, key, v) => { await db().ref(`tenants/${t}/${key}`).set(v); },
});
const readNode = async (biz) => { const s = await db().ref(KEY(biz)).once("value"); return s.exists() ? s.val() : null; };
const readPath = async (p) => { const s = await db().ref(p).once("value"); return s.exists() ? s.val() : null; };

const israel = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
const MONTH = `${israel.getFullYear()}-${String(israel.getMonth() + 1).padStart(2, "0")}`;
const md = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const monthRows = (n = 6, seed = "m") => Array.from({ length: n }, (_, i) => row(seed + i, md(i + 1), { sales: String(1000 + i * 10), deliveries: String(i), other_income: i % 3 ? "0" : "7", supplier_payments: { s1: String(100 + i), s2: i % 2 ? "skip" : "5" }, hourly_payroll: { e1: 40 + i }, payroll: "10", other_expense: "3" }));
// region_ids/subregion_ids are present-but-empty: the Admin SDK rejects `undefined` inside a
// `set()` payload, and dailyBuilder copies both config fields verbatim into meta.location.
const CONFIG = { region_ids: [], subregion_ids: [], rentType: "pct", rentPct: 8, hasRoyalty: true, royaltyPct: 4, targetSales: 500000, targetFoodCost: 30, targetLabor: 25, employees: [{ type: "global", monthlySalary: 9000 }] };
const FIXED = [{ amount: 1000 }, { amount: 500, disabled: true }, { amount: 700, rentPct: 1 }];
const SUPPLIERS = [{ id: "s1", name: "ספק אחד" }, { id: 7, name: "seven" }];

/** Fresh root per case: businesses = { bizId: entriesNode|null } (null ⇒ absent node). */
async function reseed(businesses, extra = {}) {
  const tenant = { members: { u_owner: true }, roles: { u_owner: "owner" }, biz_access: {} };
  const list = Object.keys(businesses).map((b) => ({ id: b, name: "Biz " + b }));
  tenant.app = { business: { _v: JSON.stringify(list) } };
  const index = {};
  for (const [b, node] of Object.entries(businesses)) {
    if (node !== null && node !== undefined) tenant[`biz:${b}:entries`] = node;
    tenant[`biz:${b}:config`] = { _v: JSON.stringify({ businessName: "Biz " + b, lat: 32.1, lon: 34.8, ...CONFIG }) };
    tenant[`biz:${b}:fixed`] = { _v: JSON.stringify(FIXED) };
    tenant[`biz:${b}:suppliers`] = { _v: JSON.stringify(SUPPLIERS) };
    tenant.biz_access[b] = { u_owner: true };
    index[`${T}_${b}`] = { tenantId: T, bizId: b, active: true };
  }
  await db().ref("/").set({ tenants: { [T]: tenant }, proactive_biz_index: index, ...extra });
  globalThis.__EMAILS = [];
}

// ─── runner ──────────────────────────────────────────────────────────────────
const results = []; let failures = 0;
async function run(id, area, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, area, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, area, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); };
const rejects = async (p, pred, m) => { let e = null; try { await p(); } catch (x) { e = x; } if (!e) throw new Error(m + ": did not throw"); if (!pred(e)) throw new Error(m + ": wrong error: " + (e && (e.status || e.message))); return e; };
const stripDoc = (doc) => { const d = plain(doc); delete d.meta.createdAt; delete d.meta.builtAt; return d; };
const stripSnap = (s) => { const x = plain(s); delete x.date; return x; };
const sortRecs = (a) => a.slice().sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
const noFired = (k, v) => (k === "firedAt" ? undefined : v);
const analyticsPath = (biz, date) => `tenants/${T}/biz:${biz}:analytics:daily:${date}`;
const insightsPath = (biz, date) => `tenants/${T}/biz:${biz}:insights:daily:${date}`;
const repoAll = async (biz, from = "2000-01-01", to = "2099-12-31") => ({
  daily: sortRecs(plain(await DM.getDailyMetrics(T, from, to, biz))), latest: await DM.getLatestDailyDate(T, biz),
  labor: sortRecs(plain(await LR.getLaborMetrics(T, from, to, biz))), purchases: sortRecs(plain(await PR.getPurchaseMetrics(T, from, to, biz))),
});
const listEx = (biz, from = "2000-01-01", to = "2099-12-31") => EX.listEntryExceptions({ tenantId: T, bizId: biz, fromDate: from, toDate: to });
const today = new Date().toISOString().slice(0, 10);
const shiftTo = (rows, target) => { const last = rows[rows.length - 1].date; const delta = new Date(target) - new Date(last); return rows.map((r) => ({ ...r, date: new Date(new Date(r.date).getTime() + delta).toISOString().slice(0, 10) })); };
const BAIT = shiftTo(FIXTURES.F9_anomaly_bait, today);

async function main() {
  assertSafe();
  app = admin.initializeApp({ databaseURL: DB_URL }, "server-readers");
  globalThis.__DB = db();   // the compiled modules' getDb() seam → the REAL Admin SDK database

  // ══ 1. LEGACY business (unchanged) ═══════════════════════════════════════════
  await run("SR-01", "legacy", "legacy `_v` business: dailyBuilder / repos / exceptions / snapshot read through the shared reader with expected values", async () => {
    await reseed({ bizA: asLegacy([...FIXTURES.F4_variety, ...FIXTURES.F7_exceptions.map((r) => ({ ...r, id: uuid("x" + r.id), date: r.date.replace("2026-08", "2026-07") })), ...monthRows(6)]) });
    eq(readEntriesNode(await readNode("bizA")).mode, "legacy", "mode");
    const doc = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01");
    eq(doc.revenue.sales, 1000, "sales"); eq(doc.revenue.food_cost, 1234, "supplier sum → food_cost"); eq(doc.revenue.payroll, 400, "hourly payroll");
    const ex = await listEx("bizA", "2026-07-01", "2026-07-31");
    expect(Object.keys(ex).length >= 1, "embedded exceptions surfaced via fallback");
    const r = await repoAll("bizA"); expect(r.daily.length > 0 && r.labor.length > 0 && r.purchases.length > 0, "repos non-empty");
    const s = await SB.buildSnapshotForBiz(T, "bizA"); expect(s && s.bizId === "bizA", "snapshot built");
    return `sales=${doc.revenue.sales} food=${doc.revenue.food_cost} payroll=${doc.revenue.payroll}; ${r.daily.length} daily records; snapshot ok`;
  });

  // ══ 2. MIGRATED V2 via the approved conversion — equivalence under RTDB readback ══
  await run("SR-02", "migrated", "same business before and after upgradeBusinessToV2: identical analytics doc / repo metrics / snapshot / exceptions (numeric-key maps read back as arrays)", async () => {
    const rows = [...FIXTURES.F4_variety, ...FIXTURES.F10_numeric_maps.map((r) => ({ ...r, id: uuid("n" + r.id), date: r.date.replace("2026-08", "2026-06") })), ...monthRows(5)];
    await reseed({ bizA: asLegacy(rows) });
    const before = { doc: stripDoc(await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01")), doc2: stripDoc(await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-06-01")),
      repos: await repoAll("bizA"), snap: stripSnap(await SB.buildSnapshotForBiz(T, "bizA")), ex: await listEx("bizA") };
    const up = await upgradeBusinessToV2(io(), { tenantId: T, bizId: "bizA" });
    eq(up.status, "committed", "conversion");
    const node = await readNode("bizA");
    eq(readEntriesNode(node).mode, "v2", "mode after conversion");
    const numericRow = node.rows[uuid("n" + FIXTURES.F10_numeric_maps[0].id)];
    expect(numericRow && (Array.isArray(numericRow.hourly_payroll) || Array.isArray(numericRow.supplier_payments)), "RTDB read a numeric-key map back as an array");
    const after = { doc: stripDoc(await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01")), doc2: stripDoc(await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-06-01")),
      repos: await repoAll("bizA"), snap: stripSnap(await SB.buildSnapshotForBiz(T, "bizA")), ex: await listEx("bizA") };
    deq(after, before, "post-conversion equivalence");
    return `converted gen=${node.generation}; doc/repos/snapshot/exceptions identical; array readback tolerated`;
  });

  // ══ 3. NATIVE V2 without `_v` ═══════════════════════════════════════════════
  await run("SR-03", "native-v2", "a business that never had `_v` (new after cutover) builds analytics, repos, snapshot and exceptions", async () => {
    const rows = [...FIXTURES.F1_one, ...FIXTURES.F7_exceptions.map((r) => ({ ...r, id: uuid("y" + r.id), date: r.date.replace("2026-08", "2026-07") })), ...monthRows(4)];
    await reseed({ bizA: asV2(rows, { generation: 3 }) });
    const node = await readNode("bizA");
    expect(!("_v" in node), "no `_v` stored"); eq(node.generation, 3, "generation");
    const doc = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01");
    eq(doc.revenue.sales, 5000, "sales"); eq(doc.revenue.food_cost, 1200, "food"); eq(doc.revenue.payroll, 400, "payroll");
    const ex = await listEx("bizA", "2026-07-01", "2026-07-31"); expect(Object.keys(ex).length >= 1, "exceptions via rows");
    const r = await repoAll("bizA"); expect(r.daily.length === rows.length, "every row is a daily record");
    const s = await SB.buildSnapshotForBiz(T, "bizA"); expect(s && s.bizId === "bizA", "snapshot");
    // and the ambiguous absence: a date with no row is simply absent
    const none = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-09"); eq(none.revenue.had_entry, false, "absent date");
    return `no _v; gen 3; sales=${doc.revenue.sales}; ${r.daily.length} records`;
  });

  // ══ 4. STALE `_v` POISON — never a fallback ══════════════════════════════════
  await run("SR-04", "no-fallback", "schemaVersion 2 with a stale `_v` that disagrees: every reader derives from rows only", async () => {
    const { node } = noFallbackNode();
    await reseed({ bizA: node });
    const doc = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-10");
    eq(doc.revenue.sales, 555, "rows value, not the stale 100/500");
    const gone = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-12"); eq(gone.revenue.had_entry, false, "row present only in `_v` is absent"); eq(gone.is_exception, false, "its stale exception flag is unseen");
    const r = await repoAll("bizA"); eq(r.daily.length, 2, "two current rows"); eq(r.daily.map((d) => d.date).sort().join(","), "2026-08-10,2026-08-11", "dates");
    const ex = await listEx("bizA", "2026-08-01", "2026-08-31"); eq(Object.keys(ex).length, 0, "stale exception never surfaces");
    return "doc 555 / 2 records / no stale exception";
  });

  // ══ 5. MALFORMED V2 — fail closed ════════════════════════════════════════════
  await run("SR-05", "malformed", "every malformed V2 variant: typed failure in every reader, no analytics/insights persisted, no email", async () => {
    const seen = [];
    for (const [name, node] of Object.entries(malformedNodes())) {
      await reseed({ bizA: node });
      const isStorage = (e) => isEntriesStorageError(e) && (e.status === "malformed_v2" || e.status === "malformed_storage");
      await rejects(() => DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01"), isStorage, name + " dailyBuilder");
      await rejects(() => SB.buildSnapshotForBiz(T, "bizA"), isStorage, name + " snapshot");
      await rejects(() => DM.getDailyMetrics(T, "2000-01-01", "2099-12-31", "bizA"), isStorage, name + " dailyMetrics");
      await rejects(() => LR.getLaborMetrics(T, "2000-01-01", "2099-12-31", "bizA"), isStorage, name + " labor");
      await rejects(() => PR.getPurchaseMetrics(T, "2000-01-01", "2099-12-31", "bizA"), isStorage, name + " purchases");
      await rejects(() => listEx("bizA"), isStorage, name + " exceptions");
      const plan = { intent: "x", metrics: ["daily"], dimensions: [], filters: {}, timeRange: { start: "2026-08-01", end: "2026-08-31" }, requiresBaseline: false, requiresComparison: false, requiresAnomalyDetection: false };
      await rejects(() => AS.fetchPlannedData(plan, { tenantId: T, bizId: "bizA", timezone: "Asia/Jerusalem", locale: "he", nowIso: new Date().toISOString(), userQuestion: "q" }), isStorage, name + " fetchPlannedData");
      eq(await readPath(analyticsPath("bizA", "2026-08-01")), null, name + ": no analytics persisted");
      eq(await readPath(insightsPath("bizA", "2026-08-01")), null, name + ": no insights persisted");
      eq((globalThis.__EMAILS || []).length, 0, name + ": no email");
      seen.push(name);
    }
    return `${seen.length} variants fail closed: ${seen.join(",")}`;
  });

  // ══ 6. HEALTHY SIBLING CONTINUES (D3 isolation) ═════════════════════════════
  await run("SR-06", "isolation", "buildAnalyticsForAll / buildSnapshotForAll over [healthy legacy, ambiguous, malformed, healthy V2]: healthy docs persisted, bad ones typed & skipped", async () => {
    const date = "2026-08-10";
    await reseed({ h1: asLegacy([row("h1", date, { sales: "10" }), ...monthRows(2, "h1m")]), amb: asV2(FIXTURES.F3_dup), bad: malformedNodes().gen_mismatch, h2: asV2([row("h2", date, { sales: "20" }), ...monthRows(2, "h2m")]) });
    const { docs, failures: f } = await DBLD.buildAnalyticsForAll(date);
    deq(docs.map((d) => d.bizId).sort(), ["h1", "h2"], "docs");
    deq(f.map((x) => x.bizId).sort(), ["amb", "bad"], "failures");
    expect(/duplicate_business_date/.test(f.find((x) => x.bizId === "amb").error), "amb typed");
    expect(/malformed_v2/.test(f.find((x) => x.bizId === "bad").error), "bad typed");
    expect(await readPath(analyticsPath("h1", date)) && await readPath(analyticsPath("h2", date)), "healthy analytics persisted");
    eq(await readPath(analyticsPath("amb", date)), null, "no analytics for ambiguous"); eq(await readPath(analyticsPath("bad", date)), null, "no analytics for malformed");
    eq(await readPath(insightsPath("amb", date)), null, "no insights for ambiguous"); eq(await readPath(insightsPath("bad", date)), null, "no insights for malformed");
    const snaps = await SB.buildSnapshotForAll();
    deq(snaps.map((s) => s.bizId).sort(), ["amb", "h1", "h2"], "snapshot: aggregator keeps the duplicate-date business (both rows counted), skips only the malformed one");
    return "2 docs / 2 typed failures; snapshots for 3 of 4";
  });

  // ══ 7. DUPLICATE-DATE AMBIGUITY (D1) ═════════════════════════════════════════
  await run("SR-07", "duplicate-date", "D1 in both physical forms: typed refusal for the date, other dates fine, aggregators count both, exceptions fallback → legacy_ambiguous, nothing deleted/merged", async () => {
    for (const [form, node] of [["legacy", asLegacy(FIXTURES.F3_dup)], ["v2", asV2(FIXTURES.F3_dup, { keepV: true })]]) {
      await reseed({ bizA: node });
      const before = plain(await readNode("bizA"));
      const e = await rejects(() => DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-10"), (x) => isEntriesAmbiguityError(x) && x.status === "duplicate_business_date" && x.count === 2, form + " dailyBuilder");
      deq(e.ids, [uuid("f3a"), uuid("f3b")].sort(), form + " ids named");
      eq(await readPath(analyticsPath("bizA", "2026-08-10")), null, form + ": nothing persisted");
      const ok = await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-11"); eq(ok.revenue.sales, 700, form + " unique date builds");
      const r = await repoAll("bizA"); eq(r.daily.filter((d) => d.date === "2026-08-10").length, 2, form + " repo keeps both rows");
      const ex = await listEx("bizA", "2026-08-10", "2026-08-10");
      const rec = ex["2026-08-10"];
      expect(rec && rec.origin === "legacy_ambiguous" && rec.source === "legacy_ambiguous" && rec.duplicateCount === 2, form + " exceptions fallback is explicit ambiguity, not a winner");
      deq(plain(await readNode("bizA")), before, form + ": node untouched (no auto delete/merge)");
      const dup = duplicateDates(readEntriesNode(await readNode("bizA")).rows); deq(dup, [{ date: "2026-08-10", ids: [uuid("f3a"), uuid("f3b")].sort() }], form + " duplicateDates");
    }
    return "both forms: typed refusal, sibling date ok, both rows aggregated, legacy_ambiguous, node untouched";
  });

  // ══ 8. D2 — checkers stay externally non-firing ══════════════════════════════
  await run("SR-08", "alerts-d2", "anomaly bait in legacy, V2, poisoned and malformed nodes: supplier/employee checkers return [], runAlertsForBiz persists no such alert and no digest names them", async () => {
    eq(CK.ENTRIES_ANOMALY_CHECKS_ENABLED, false, "kill switch");
    for (const [form, node] of [["legacy", asLegacy(BAIT)], ["v2", asV2(BAIT, { keepV: true })], ["poison", noFallbackNode().node], ["malformed", malformedNodes().rows_scalar]]) {
      await reseed({ bizA: node });
      deq(await CK.checkSupplierAnomaly(T, "bizA", { supplierDeviationPct: 30 }), [], form + " supplier");
      deq(await CK.checkExpensiveEmployee(T, "bizA", { employeeDeviationPct: 40 }), [], form + " employee");
      const res = await RN.runAlertsForBiz(T, "bizA");
      const alerts = (await readPath(`tenants/${T}/alerts/bizA`)) || {};
      const bad = Object.values(alerts).filter((a) => a && (a.type === "supplier_anomaly" || a.type === "expensive_employee"));
      eq(bad.length, 0, form + ": no supplier/employee alert persisted");
      deq(res.errors.filter((x) => /^supplier:|^employee:/.test(x)), [], form + ": silent, no error");
      const digests = (globalThis.__EMAILS || []).filter((m) => m.kind === "digest" && m.alerts.some((a) => a.type === "supplier_anomaly" || a.type === "expensive_employee"));
      eq(digests.length, 0, form + ": no digest attributable");
    }
    return "4 node forms: [] / [] / no persisted alert / no digest";
  });

  // ══ 9. PREFLIGHT DUPLICATE REPORT (informational) ═══════════════════════════
  await run("SR-09", "preflight", "legacy node with duplicate dates: preflight ok=true, duplicateDates reported, conversion proceeds keeping both rows; report agrees with the reader", async () => {
    await reseed({ bizA: asLegacy(FIXTURES.F3_dup) });
    const rep = preflightLegacyNode(await readNode("bizA"));
    eq(rep.ok, true, "not a blocker"); deq(rep.duplicateDates, [{ date: "2026-08-10", ids: [uuid("f3a"), uuid("f3b")].sort() }], "report");
    const up = await upgradeBusinessToV2(io(), { tenantId: T, bizId: "bizA" }); eq(up.status, "committed", "conversion");
    const node = await readNode("bizA"); eq(Object.keys(node.rows).length, 3, "all three rows kept");
    const read = readEntriesNode(node); eq(read.mode, "v2", "v2"); deq(duplicateDates(read.rows), rep.duplicateDates, "reader agrees post-conversion");
    eq(preflightLegacyNode(node).ok, false, "already_v2 afterwards");
    return "reported, not blocked; 3 rows survive conversion; reader agrees";
  });

  // ══ 10. CONVERSION OBSERVATION — `_v` frozen, never consulted again ═════════
  await run("SR-10", "conversion", "after conversion a direct row change is visible to every reader while the frozen `_v` still holds the old value", async () => {
    const rows = [row("c1", "2026-08-01", { sales: "100", is_exception: true, exception_reason: "holiday" }), row("c2", "2026-08-02", { sales: "200" }), ...monthRows(3, "cm")];
    await reseed({ bizA: asLegacy(rows) });
    eq((await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01")).revenue.sales, 100, "pre-conversion");
    eq((await upgradeBusinessToV2(io(), { tenantId: T, bizId: "bizA" })).status, "committed", "conversion");
    await db().ref(KEY("bizA") + "/rows/" + uuid("c1")).update({ sales: "999", is_exception: false });
    await db().ref(KEY("bizA") + "/rows/" + uuid("c2")).remove();
    const node = await readNode("bizA");
    expect(typeof node._v === "string" && node._v.includes('"100"') && node._v.includes(uuid("c2")), "frozen `_v` still carries the old rows");
    eq((await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-01")).revenue.sales, 999, "doc from rows");
    eq((await DBLD.buildAnalyticsForBiz(T, "bizA", "2026-08-02")).revenue.had_entry, false, "deleted row absent");
    const r = await repoAll("bizA"); eq(r.daily.find((d) => d.date === "2026-08-01").revenue, 999, "repo from rows"); eq(r.daily.some((d) => d.date === "2026-08-02"), false, "repo: deleted row absent");
    const ex = await listEx("bizA", "2026-08-01", "2026-08-31"); eq(Object.keys(ex).length, 0, "the stale exception flag in `_v` is not surfaced");
    const s = await SB.buildSnapshotForBiz(T, "bizA"); expect(s && s.bizId === "bizA", "snapshot builds from rows");
    return "rows 999 / deleted absent / stale `_v` exception unseen";
  });

  // ─── report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 8)} ${w("area", 16)} ${w("status", 6)} ${w("ms", 6)} notes`);
  console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 16)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 10;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED}, ran ${results.length}`); process.exitCode = 3; return; }
  if (failures) {
    console.error("\n=== FAILURES ===");
    for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} [${r.area}] ${r.description}\n    ${r.notes}`);
    process.exitCode = 1; return;
  }
  console.log("\nALL CASES PASSED");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4;
                              await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
