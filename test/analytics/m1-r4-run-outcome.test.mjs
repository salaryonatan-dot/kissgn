// M1 integration R4 (LOCAL; pending independent Codex review) — review finding A2: a cron run with failures returned HTTP 200
// `completed`. Through the REAL endpoint api/analytics/daily-builder.ts (GET = the scheduled run, POST = operator backfill),
// the REAL src/analytics/dailyBuilder.ts and the REAL lib/businessRegistry.js, over an in-memory RTDB with transaction
// semantics that records every write. Only the POS source, the token verifier and the role lookup are seams. Every run holds
// a CONTROL tenant (tenantK / bizK) whose analytics AND insights must be written in the same run.
//   RO-01  a clean run: HTTP 200 `completed`; the durable run record (analytics_runs/daily/{date}) says completed
//   RO-02  the review's partial run (control built, one ambiguous business): HTTP 500 `partial`; the control's docs are written
//          and listed; the failure is listed in the response AND in the run record
//   RO-03  the review's failed discovery (tenants read fails, nothing built): HTTP 500 `failed`; record `failed`
//   RO-04  a build failure, an analytics persistence failure and an insights persistence failure are each a failure of that
//          business (never a counted success); the business's already-saved analytics doc is kept; the control is built
//   RO-05  a failed index read is an incomplete discovery: reported, the run is `partial`
//   RO-05b both discovery sources fail: both failures are reported (one never hides the other); the run is `failed`
//   RO-06  repeated invocation for the same date: the same per-day doc paths are rewritten (no other / duplicate side effect),
//          the record counts both invocations and keeps both outcomes; a concurrent earlier invocation never overwrites the
//          later one's `current` state
//   RO-07  the record is written BEFORE anything is built (a run that dies mid-way stays `running`), and a run whose record
//          cannot be written is never HTTP 200 (`runRecord: "write_failed"`), while its built docs are kept
//   RO-08  operator backfill: a failed insights persistence is HTTP 502 `partial` (analytics doc kept), never `success`
//   RO-09  the deliberately-skipped businesses (explicitly inactive, index-only, the documented legacy self id) are accounted
//          for in `skipped`, never silently dropped and never counted as failures
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { compileServer, makeDb, installDb, offlineFetch, ROOT } from "../support/server-reader-harness.mjs";
import { T, B, entry, env, seedRaw, uid } from "../support/b1-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const dir = mkdtempSync(join(tmpdir(), "m1-r4-run-"));
cpSync(srv.dir, dir, { recursive: true });
cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"), { recursive: true });
cpSync(join(ROOT, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const compiled = spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href).catch((e) => { throw new Error("wrapper compile/import failed: " + e.message + "\n" + compiled.stdout); });
const DBLD = await srv.import("src/analytics/dailyBuilder.js");

const SECRET = "m1-r4-test-cron-secret";   // test-only value
const DAY = DBLD.yesterdayInIsrael();
const K = "tenantK", BK = "bizK";
const RUN = `analytics_runs/daily/${DAY}`;
const rec = (extra = {}) => ({ id: B, name: "Biz " + B, ...extra });
const docPaths = (tenant, biz) => [`tenants/${tenant}/biz:${biz}:analytics:daily:${DAY}`, `tenants/${tenant}/biz:${biz}:insights:daily:${DAY}`];
const mkRes = () => { const x = { statusCode: 0, body: null }; x.setHeader = () => {}; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };

function world(registry, { bizIds = [B], index, extraTenants = {} } = {}) {
  const db = makeDb();
  for (const biz of bizIds) seedRaw(db, { biz, entries: env([entry(uid(1), DAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) });
  if (registry !== undefined) db.seed(`tenants/${T}/app/business`, registry);
  seedRaw(db, { tenant: K, biz: BK, entries: env([entry(uid(2), DAY, { sales: "300", supplier_payments: { s1: "30" }, payroll: "20" })]) });
  for (const [t, reg] of Object.entries(extraTenants)) db.seed(`tenants/${t}/app/business`, reg);
  if (index) db.seed("proactive_biz_index", index);
  return db;
}
/** wrap `db` so writes / reads / transactions at matching paths fail */
function faulty(db, { failSet, failTxn, failRead } = {}) {
  return { ...db, ref: (p, q) => {
    const r = db.ref(p, q);
    return { ...r,
      set: async (v) => { if (failSet && failSet(p)) throw new Error("write refused " + p); return r.set(v); },
      transaction: async (fn) => { if (failTxn && failTxn(p)) throw new Error("transaction refused " + p); return r.transaction(fn); },
      once: async (e) => { if (failRead && failRead(p)) throw new Error("read refused " + p); return r.once(e); },
    };
  } };
}
async function cron(db, method = "GET", body = {}) {
  installDb(db);
  const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try { const res = mkRes(); await API.default({ method, headers: { authorization: "Bearer " + SECRET }, query: {}, body }, res); return res; }
  finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
}
const controlBuilt = (db) => docPaths(K, BK).every((p) => db.read(p));

test("RO-01 a clean run is HTTP 200 completed, and its durable record says so", async () => {
  const db = world(env([rec()]));
  const res = await cron(db);
  assert.deepEqual([res.statusCode, res.body.status, res.body.runRecord, res.body.invocation], [200, "completed", "recorded", 1]);
  assert.equal(res.body.failures, undefined);
  const r = db.read(RUN);
  assert.equal(r.invocations, 1);
  assert.deepEqual([r.current.state, r.current.successCount, r.current.failureCount], ["completed", 2, 0]);
  assert.equal(r.history.length, 1);
});

test("RO-02 the review's partial run: HTTP 500 partial; the control is built and listed; the failure is durable", async () => {
  const db = world(env([rec({ active: true }), rec({ active: false })]));
  const res = await cron(db);
  assert.deepEqual([res.statusCode, res.body.status, res.body.successCount, res.body.failureCount], [500, "partial", 1, 1]);
  assert.deepEqual(res.body.failures, [{ tenantId: T, bizId: B, error: "business_registry_ambiguous" }]);
  assert.deepEqual(res.body.summary.map((d) => [d.tenantId, d.bizId]), [[K, BK]], "the successful business stays listed");
  assert.ok(controlBuilt(db), "the successful business's docs are kept");
  const r = db.read(RUN);
  assert.deepEqual([r.current.state, r.current.successCount, r.current.failureCount], ["partial", 1, 1]);
  assert.deepEqual(r.current.failures, [{ tenantId: T, bizId: B, error: "business_registry_ambiguous" }]);
});

test("RO-03 the review's failed discovery: HTTP 500 failed, nothing built, the record says failed", async () => {
  const db = world(env([rec()]), { index: { [`${T}:${B}`]: true } });
  const res = await cron(faulty(db, { failRead: (p) => p === "tenants" }));
  assert.deepEqual([res.statusCode, res.body.status, res.body.successCount], [500, "failed", 0]);
  assert.deepEqual(res.body.failures, [{ tenantId: null, bizId: null, error: "business_discovery_failed" }]);
  assert.deepEqual(db.writes.filter((w) => !w.path.startsWith("analytics_runs/")), [], "nothing but the run record is written");
  assert.equal(db.read(RUN).current.state, "failed");
});

test("RO-04 build, analytics-persistence and insights-persistence failures are failures of that business, never successes", async () => {
  for (const [label, prep, error, analyticsKept] of [
    ["build (malformed entries node)", (db) => { db.seed(`tenants/${T}/biz:${B}:entries`, { _v: "{not json" }); return db; }, null, false],
    ["analytics persistence", (db) => faulty(db, { failSet: (p) => p === docPaths(T, B)[0] }), null, false],
    ["insights persistence", (db) => faulty(db, { failSet: (p) => p === docPaths(T, B)[1] }), "insights_persist_failed", true],
  ]) {
    const base = world(env([rec()]));
    const res = await cron(prep(base));
    assert.deepEqual([res.statusCode, res.body.status, res.body.successCount, res.body.failureCount], [500, "partial", 1, 1], label + ": " + JSON.stringify(res.body.failures));
    assert.equal(res.body.failures[0].tenantId, T, label); assert.equal(res.body.failures[0].bizId, B, label);
    if (error) assert.equal(res.body.failures[0].error, error, label);
    assert.deepEqual(res.body.summary.map((d) => d.bizId), [BK], label + ": only the control is a success");
    assert.equal(!!base.read(docPaths(T, B)[0]), analyticsKept, label + ": the analytics doc " + (analyticsKept ? "is kept" : "was never written"));
    assert.equal(base.read(docPaths(T, B)[1]), null, label + ": no insights doc");
    assert.ok(controlBuilt(base), label + ": the control is built");
    assert.equal(base.read(RUN).current.state, "partial", label);
  }
});

test("RO-05 a failed index read is an incomplete discovery: reported, the run is partial", async () => {
  const db = world(env([rec()]));
  const res = await cron(faulty(db, { failRead: (p) => p === "proactive_biz_index" }));
  assert.deepEqual([res.statusCode, res.body.status], [500, "partial"]);
  assert.deepEqual(res.body.failures, [{ tenantId: null, bizId: null, error: "business_index_read_failed" }]);
  assert.ok(docPaths(T, B).every((p) => db.read(p)) && controlBuilt(db), "every registered business is still built");
});

test("RO-05b both discovery sources fail: each failure is reported (one never hides the other); the run is failed", async () => {
  const db = world(env([rec()]));
  const res = await cron(faulty(db, { failRead: (p) => p === "proactive_biz_index" || p === "tenants" }));
  assert.deepEqual([res.statusCode, res.body.status, res.body.successCount], [500, "failed", 0]);
  assert.deepEqual(res.body.failures, [{ tenantId: null, bizId: null, error: "business_index_read_failed" }, { tenantId: null, bizId: null, error: "business_discovery_failed" }]);
});

test("RO-06 repeated and concurrent invocations: idempotent docs, both outcomes recorded, the later state never overwritten", async () => {
  const db = world(env([rec({ active: true }), rec({ active: false })]));
  const first = await cron(db);
  const writesAfterFirst = db.writes.length;
  const second = await cron(db);
  assert.deepEqual([first.body.invocation, second.body.invocation], [1, 2]);
  const docWrites = (ws) => ws.filter((w) => !w.path.startsWith("analytics_runs/")).map((w) => w.path).sort();
  assert.deepEqual(docWrites(db.writes.slice(writesAfterFirst)), docWrites(db.writes.slice(0, writesAfterFirst)), "the second run rewrites exactly the same doc paths, nothing else");
  assert.equal(new Set(docWrites(db.writes.slice(writesAfterFirst))).size, docWrites(db.writes.slice(writesAfterFirst)).length, "each path once per run");
  const r = db.read(RUN);
  assert.equal(r.invocations, 2);
  assert.deepEqual(r.history.map((h) => [h.invocation, h.state]), [[1, "partial"], [2, "partial"]]);
  assert.equal(r.current.invocation, 2);
  // concurrency: invocation 1 starts, invocation 2 starts and finishes, then invocation 1 finishes
  const c = world(env([rec()]));
  installDb(c);
  const s1 = await DBLD.recordAnalyticsRunStart(DAY, 1);
  const s2 = await DBLD.recordAnalyticsRunStart(DAY, 2);
  const skipped = { inactive: 0, indexOnly: 0, malformedEntries: 0, legacySelf: [], legacySelfCount: 0 };
  assert.equal(await DBLD.recordAnalyticsRunEnd(DAY, s2.invocation, { outcome: "completed", finishedAt: 3, successCount: 2, failures: [], skipped }), true);
  assert.equal(await DBLD.recordAnalyticsRunEnd(DAY, s1.invocation, { outcome: "failed", finishedAt: 4, successCount: 0, failures: [{ tenantId: null, bizId: null, error: "x" }], skipped }), true);
  const cr = c.read(RUN);
  assert.deepEqual([cr.current.invocation, cr.current.state], [2, "completed"], "the earlier invocation never overwrites the later one's state");
  assert.deepEqual(cr.history.map((h) => [h.invocation, h.state]), [[2, "completed"], [1, "failed"]], "… but its outcome is recorded");
  for (let k = 0; k < 12; k++) await DBLD.recordAnalyticsRunEnd(DAY, 99, { outcome: "completed", finishedAt: k, successCount: 0, failures: [], skipped });
  assert.equal(c.read(RUN).history.length, DBLD.ANALYTICS_RUN_HISTORY_KEEP, "the history is bounded");
});

test("RO-07 the record says `running` while building; an unrecordable run is never HTTP 200", async () => {
  {
    const db = world(env([rec()]));
    let seen = null;
    const spy = { ...db, ref: (p, q) => { if (p === `tenants/${T}/biz:${B}:entries` && seen === null) seen = JSON.parse(JSON.stringify(db.read(RUN))); return db.ref(p, q); } };
    const res = await cron(spy);
    assert.equal(res.statusCode, 200);
    assert.equal(seen && seen.current.state, "running", "marked running before the first business is built");
  }
  for (const [label, failTxn] of [["start", (p) => p === RUN], ["end", (() => { let n = 0; return (p) => p === RUN && ++n === 2; })()]]) {
    const db = world(env([rec()]));
    const res = await cron(faulty(db, { failTxn }));
    assert.deepEqual([res.statusCode, res.body.status, res.body.runRecord], [500, "completed", "write_failed"], label + ": the build completed, the run is not recorded — never 200");
    assert.ok(docPaths(T, B).every((p) => db.read(p)) && controlBuilt(db), label + ": the built docs are kept");
  }
});

test("RO-08 operator backfill: a failed insights persistence is 502 partial, never success", async () => {
  const db = world(env([rec()]));
  const res = await cron(faulty(db, { failSet: (p) => p === docPaths(T, B)[1] }), "POST", { tenantId: T, bizId: B, date: DAY });
  assert.deepEqual([res.statusCode, res.body.status, res.body.error, res.body.analyticsSaved], [502, "partial", "insights_persist_failed", true]);
  assert.ok(db.read(docPaths(T, B)[0]), "the analytics doc is kept");
  const ok = world(env([rec()]));
  const good = await cron(ok, "POST", { tenantId: T, bizId: B, date: DAY });
  assert.deepEqual([good.statusCode, good.body.status], [200, "success"], "control");
});

test("RO-09 deliberately skipped businesses are accounted for, never failures", async () => {
  const db = world(env([rec(), { id: "bizOff", name: "off", active: false }]), {
    bizIds: [B, "bizOff"], index: { [`${T}:bizIdx`]: true }, extraTenants: { selfT: env([{ id: "selfT", name: "self" }]) },
  });
  const res = await cron(db);
  assert.deepEqual([res.statusCode, res.body.status], [200, "completed"]);
  assert.deepEqual(res.body.skipped, { inactive: 1, indexOnly: 1, malformedEntries: 0, legacySelf: [{ tenantId: "selfT", bizId: "selfT" }], legacySelfCount: 1 });
  assert.deepEqual(db.read(RUN).current.skipped, { inactive: 1, indexOnly: 1, malformedEntries: 0, legacySelfCount: 1 });
});
