// M1 integration R5 (LOCAL; pending independent Codex review) — R4 review blocker A1/A2: the nightly discovery keyed a
// tenant/business pair as `${tenantId}|${bizId}`. The shared identity rules admit "|" in BOTH ids, so the distinct registered
// pairs (tenantId "t|x", bizId "y") and (tenantId "t", bizId "x|y") produced the same key: the second business was never
// built while the run (HTTP response AND durable analytics_runs record) said `completed`.
// Through the REAL endpoint api/analytics/daily-builder.ts, the REAL src/analytics/dailyBuilder.ts and the REAL
// lib/businessRegistry.js over the in-memory RTDB. Every case runs in BOTH discovery orders (tenant insertion order).
//   PI-01  both colliding pairs are built: one analytics + one insights write per pair, each at its OWN business-scoped path,
//          each from its OWN entries (distinct revenue), docs carry the exact registered ids (no trim / coercion / alias)
//   PI-02  the real cron: HTTP 200 `completed`, totalBusinesses 2, and the durable run record counts 2 successes
//   PI-03  one colliding pair's build fails: the run is HTTP 500 `partial`; the failure names exactly that pair (response and
//          record); the other pair is built
//   PI-04  ambiguity is scoped to the exact pair: an ambiguous registry identity ("t|x","y") never suppresses the distinct
//          registered pair ("t","x|y"); the ambiguous one is reported, the registered one is built
//   PI-05  cross-source: an index-only pair ("t|x","y") never merges with the registered pair ("t","x|y"); the registered pair
//          is built under ITS ids, the index-only pair is skipped (never built under the other pair's ids)
//   PI-06  the pair key is collision-free for the shared id alphabet (delimiter-bearing ids, both orders)
//   PI-07  BOTH colliding pairs ambiguous: each is reported as its own ambiguity failure (exactly once), nothing is built
//   PI-08  an ambiguous pair that the index also carries is suppressed by ITS exact pair: reported once as ambiguous, never
//          counted as index-only, and the colliding registered pair is built
//   PI-09  padded tenant ids are distinct tenants: ("t","b") and (" t","b") are both built under their exact ids (no trim)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { compileServer, makeDb, installDb, offlineFetch, ROOT } from "../support/server-reader-harness.mjs";
import { entry, env, seedRaw, uid } from "../support/b1-fixtures.mjs";
import { isRegistryBizId } from "../../lib/businessRegistry.js";
import { isValidId } from "../../lib/securityContext.js";

offlineFetch();
const srv = compileServer();
const dir = mkdtempSync(join(tmpdir(), "m1-r5-pair-"));
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

const SECRET = "m1-r5-test-cron-secret"; // test-only value
const DAY = DBLD.yesterdayInIsrael();
const RUN = `analytics_runs/daily/${DAY}`;
const P1 = { tenantId: "t|x", bizId: "y", sales: "500" };
const P2 = { tenantId: "t", bizId: "x|y", sales: "700" };
const ORDERS = [["P1 first", [P1, P2]], ["P2 first", [P2, P1]]];
const analyticsPath = (p) => `tenants/${p.tenantId}/biz:${p.bizId}:analytics:daily:${DAY}`;
const insightsPath = (p) => `tenants/${p.tenantId}/biz:${p.bizId}:insights:daily:${DAY}`;
const mkRes = () => { const x = { statusCode: 0, body: null }; x.setHeader = () => {}; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };
const ids = (list) => list.map((x) => [x.tenantId, x.bizId]).sort();

/** seed every pair (in the given order: tenant insertion order drives discovery order) */
function world(pairs, { registry = {}, index } = {}) {
  const db = makeDb();
  for (const [i, p] of pairs.entries()) {
    seedRaw(db, { tenant: p.tenantId, biz: p.bizId, entries: env([entry(uid(10 + i), DAY, { sales: p.sales, supplier_payments: { s1: "80" }, payroll: "40" })]) });
    db.seed(`tenants/${p.tenantId}/app/business`, registry[p.tenantId] ?? env([{ id: p.bizId, name: "Biz " + p.tenantId + "/" + p.bizId }]));
  }
  if (index) db.seed("proactive_biz_index", index);
  return db;
}
function failingEntries(db, pair) {
  return { ...db, ref: (p, q) => {
    const r = db.ref(p, q);
    return p === `tenants/${pair.tenantId}/biz:${pair.bizId}:entries` ? { ...r, once: async () => { throw new Error("read refused"); } } : r;
  } };
}
async function cron(db) {
  installDb(db);
  const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try { const res = mkRes(); await API.default({ method: "GET", headers: { authorization: "Bearer " + SECRET }, query: {}, body: {} }, res); return res; }
  finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
}

test("PI-00 precondition: both pairs are legal under the shared identity rules and collide under the old concatenation", () => {
  for (const p of [P1, P2]) { assert.equal(isValidId(p.tenantId), true); assert.equal(isRegistryBizId(p.bizId), true); }
  assert.notDeepEqual([P1.tenantId, P1.bizId], [P2.tenantId, P2.bizId]);
  assert.equal(`${P1.tenantId}|${P1.bizId}`, `${P2.tenantId}|${P2.bizId}`);
});

for (const [label, pairs] of ORDERS) {
  test(`PI-01 [${label}] both colliding pairs are built, each at its own path from its own entries, with exact ids`, async () => {
    const db = installDb(world(pairs));
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(r.failures, []);
    assert.deepEqual(ids(r.docs), ids([P1, P2]));
    for (const p of [P1, P2]) {
      const doc = db.read(analyticsPath(p));
      assert.ok(doc, "analytics written at " + analyticsPath(p));
      assert.ok(db.read(insightsPath(p)), "insights written at " + insightsPath(p));
      assert.equal(doc.tenantId, p.tenantId);
      assert.equal(doc.bizId, p.bizId);
      assert.equal(Number(doc.revenue?.sales), Number(p.sales), "each business is built from its own entries");
    }
    const analyticsWrites = db.writes.filter((w) => w.path.includes(":analytics:daily:")).map((w) => w.path).sort();
    assert.deepEqual(analyticsWrites, [analyticsPath(P1), analyticsPath(P2)].sort(), "exactly one analytics write per pair, no other");
  });

  test(`PI-02 [${label}] the real cron reports both: HTTP 200 completed, 2 businesses, durable record 2 successes`, async () => {
    const db = world(pairs);
    const res = await cron(db);
    assert.deepEqual([res.statusCode, res.body.status, res.body.totalBusinesses, res.body.failureCount], [200, "completed", 2, 0]);
    const rec = db.read(RUN);
    assert.deepEqual([rec.current.state, rec.current.successCount, rec.current.failureCount], ["completed", 2, 0]);
    for (const p of [P1, P2]) assert.ok(db.read(analyticsPath(p)));
  });

  for (const failing of [P1, P2]) {
    test(`PI-03 [${label}] a failed build of ${failing.tenantId}/${failing.bizId} stays visible and attributed to that exact pair`, async () => {
      const other = failing === P1 ? P2 : P1;
      const base = world(pairs);
      const db = failingEntries(base, failing);
      const res = await cron(db);
      assert.deepEqual([res.statusCode, res.body.status, res.body.totalBusinesses, res.body.failureCount], [500, "partial", 2, 1]);
      assert.deepEqual(res.body.failures.map((f) => [f.tenantId, f.bizId]), [[failing.tenantId, failing.bizId]]);
      const rec = base.read(RUN);
      assert.deepEqual([rec.current.state, rec.current.successCount, rec.current.failureCount], ["partial", 1, 1]);
      assert.deepEqual(rec.current.failures.map((f) => [f.tenantId, f.bizId]), [[failing.tenantId, failing.bizId]]);
      assert.ok(base.read(analyticsPath(other)), "the other pair is built");
      assert.equal(base.read(analyticsPath(failing)), null, "nothing is written for the failed pair");
    });
  }

  test(`PI-04 [${label}] an ambiguous identity is scoped to its exact pair and never suppresses the colliding registered pair`, async () => {
    const SIB = { tenantId: P1.tenantId, bizId: "z", sales: "300" };
    const reg = env([{ id: "y", name: "Y one" }, { id: "y", name: "Y two" }, { id: "z", name: "Z" }]);
    const db = installDb(world(pairs, { registry: { [P1.tenantId]: reg } }));
    seedRaw(db, { tenant: SIB.tenantId, biz: SIB.bizId, entries: env([entry(uid(50), DAY, { sales: SIB.sales, supplier_payments: { s1: "5" }, payroll: "5" })]) });
    db.seed(`tenants/${P1.tenantId}/app/business`, reg); // seedRaw seeds a default registry: restore the ambiguous one
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(ids(r.docs), ids([P2, SIB]), "the registered pair and the ambiguous pair's registered sibling are built");
    assert.deepEqual(r.failures.map((f) => [f.tenantId, f.bizId, f.error]), [[P1.tenantId, P1.bizId, "business_registry_ambiguous"]]);
    assert.equal(db.read(analyticsPath(P1)), null);
    assert.ok(db.read(analyticsPath(P2)));
    assert.equal(Number(db.read(analyticsPath(SIB)).revenue?.sales), 300, "the sibling is built from its own entries");
  });

  test(`PI-07 [${label}] both colliding pairs ambiguous: each is its own ambiguity failure, exactly once; nothing is built`, async () => {
    const dup = (id) => env([{ id, name: id + " one" }, { id, name: id + " two" }]);
    const db = installDb(world(pairs, { registry: { [P1.tenantId]: dup(P1.bizId), [P2.tenantId]: dup(P2.bizId) } }));
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(r.docs, []);
    assert.deepEqual(r.failures.map((f) => [f.tenantId, f.bizId, f.error]).sort(),
      [[P1.tenantId, P1.bizId, "business_registry_ambiguous"], [P2.tenantId, P2.bizId, "business_registry_ambiguous"]].sort());
    const res = await cron(db);
    assert.deepEqual([res.statusCode, res.body.status, res.body.failureCount], [500, "failed", 2]);
    assert.deepEqual(db.read(RUN).current.failures.map((f) => [f.tenantId, f.bizId]).sort(), ids([P1, P2]));
  });

  test(`PI-08 [${label}] an index-carried ambiguous pair is suppressed by its exact pair, never counted index-only`, async () => {
    const index = { "k-amb": { tenantId: P1.tenantId, bizId: P1.bizId }, "k-reg": { tenantId: P2.tenantId, bizId: P2.bizId } };
    const db = installDb(world(pairs, { registry: { [P1.tenantId]: env([{ id: "y", name: "Y one" }, { id: "y", name: "Y two" }]) }, index }));
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(ids(r.docs), ids([P2]));
    assert.deepEqual(r.failures.map((f) => [f.tenantId, f.bizId, f.error]), [[P1.tenantId, P1.bizId, "business_registry_ambiguous"]]);
    assert.equal(r.skipped.indexOnly, 0, "the ambiguous pair is an ambiguity failure, not an index-only skip");
    assert.equal(db.read(analyticsPath(P1)), null);
  });
}

for (const [label, pads] of [["unpadded first", ["t", " t"]], ["padded first", [" t", "t"]]]) {
  test(`PI-09 [${label}] padded tenant ids are distinct tenants: both are built under their exact ids`, async () => {
    const pairs = pads.map((t, i) => ({ tenantId: t, bizId: "b", sales: String(100 + i) }));
    const db = installDb(world(pairs));
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(r.failures, []);
    assert.deepEqual(ids(r.docs), ids(pairs));
    for (const p of pairs) {
      const doc = db.read(analyticsPath(p));
      assert.equal(doc.tenantId, p.tenantId, "exact tenant id (no trim)");
      assert.equal(Number(doc.revenue?.sales), Number(p.sales));
    }
  });
}

for (const order of ["index first in key order", "index second in key order"]) {
  test(`PI-05 [${order}] an index-only pair never merges with the colliding registered pair`, async () => {
    // the index carries explicit ids for the index-only pair P1; only P2 is registered
    const index = order.startsWith("index first")
      ? { "a-index": { tenantId: P1.tenantId, bizId: P1.bizId } }
      : { "z-index": { tenantId: P1.tenantId, bizId: P1.bizId } };
    const db = installDb(world([P2], { index }));
    seedRaw(db, { tenant: P1.tenantId, biz: P1.bizId, entries: env([entry(uid(99), DAY, { sales: "999", supplier_payments: { s1: "1" }, payroll: "1" })]) });
    db.seed(`tenants/${P1.tenantId}/app/business`, null); // P1 has entries but NO registry: index-only
    assert.equal(db.read(`tenants/${P1.tenantId}/app/business`), null);
    const r = await DBLD.buildAnalyticsForAll(DAY);
    assert.deepEqual(ids(r.docs), ids([P2]));
    assert.deepEqual(r.failures, []);
    assert.equal(r.skipped.indexOnly, 1, "the index-only pair is accounted as index-only, not merged");
    assert.equal(db.read(analyticsPath(P1)), null, "the index-only pair is never built");
    assert.equal(Number(db.read(analyticsPath(P2)).revenue?.sales), 700);
  });
}

test("PI-06 the exported pair key is injective over delimiter-bearing ids", () => {
  const k = DBLD.analyticsPairKey;
  assert.equal(typeof k, "function");
  const pairs = [["t|x", "y"], ["t", "x|y"], ["t:x", "y"], ["t", "x:y"], ["t\"x", "y"], ["t", "\"x,y"], ["a,b", "c"], ["a", "b,c"], ["t\\", "x"], ["t", "\\x"]];
  const keys = pairs.map(([t, b]) => k(t, b));
  assert.equal(new Set(keys).size, pairs.length);
  for (const [t, b] of pairs) assert.equal(k(t, b), k(t, b), "deterministic");
});
