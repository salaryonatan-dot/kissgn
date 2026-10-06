// M1 integration R2 (LOCAL; pending independent Codex review) — the analytics builder's TARGET IDENTITY through the REAL
// endpoint api/analytics/daily-builder.ts, the REAL src/analytics/dailyBuilder.ts (build, save, insights) and the REAL
// lib/businessRegistry.js + lib/securityContext.js, over an in-memory RTDB that records every write. Only the auth token
// verifier, the tenant-role lookup, the rate limiter and the POS source are seams.
//
// Review finding P2 (M1 R1): the rebuild picked the FIRST registry record carrying the requested id, so duplicate records
// gave order-dependent results (active-first 200 + build, inactive-first 404) while Core / P1 refuse both orders (503).
// Expected outcomes below are stated independently (literal statuses, literal node paths), never derived from the code:
//   DBR2-00  the shared module's resolveRegistryTarget: a record only for a registered target (never a first match)
//   DBR2-01  a uniquely registered business beside UNRELATED defective records (null, primitive, malformed, a duplicated
//            OTHER id): rebuild 200 — the analytics and insights docs are written
//   DBR2-02  the requested id duplicated (active + inactive) in BOTH orders: 503 business_registry_ambiguous, NO write
//   DBR2-03  duplicated with CONFLICTING settings (names / flags), both orders: 503, no write
//   DBR2-04  a colliding non-canonical record (trimmed id, numeric / null id coerced to the requested id): 503, no write;
//            a bare null beside the literal id "null" does not collide (P3)
//   DBR2-05  not registered → 404; uniquely registered but explicitly inactive → 404 (unchanged); no write
//   DBR2-06  registry shapes: absent node, invalid JSON, non-array JSON, a raw (non-envelope) array, an object map —
//            503 business_registry_unreadable, no write; the runtime `{_v:"<JSON array>"}` node is the supported shape
//   DBR2-07  malformed request ids (padded, ":"-bearing, non-string, tenant = business) → 400 before any read or write
//   DBR2-08  the registry read fails → 503 authorization_unavailable (never a definitive 404), no write
//   DBR2-09  the operator backfill (cron-authorized POST) follows the same identity rule: ambiguous in both orders →
//            503 and no write; registered → 200 and the doc is written; an explicitly inactive unique business stays
//            backfillable (the flag is a setting, not identity)
//   DBR2-10  the scheduled run (cron GET, discovery in src/analytics/dailyBuilder.ts): an ambiguous business is not built
//            and is reported as a failure of the run (both orders); a valid business beside it and beside a null is built
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
const dir = mkdtempSync(join(tmpdir(), "m1-r2-dbld-"));
cpSync(srv.dir, dir, { recursive: true });
cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"), { recursive: true });
cpSync(join(ROOT, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));   // the REAL shared rule (as committed)
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const compiled = spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href).catch((e) => { throw new Error("wrapper compile/import failed: " + e.message + "\n" + compiled.stdout); });
const BD = await srv.import("src/finance/businessDate.js");
const DBLD = await srv.import("src/analytics/dailyBuilder.js");

const SECRET = "m1-r2-test-cron-secret";   // test-only value
const TODAY = BD.israelBusinessDate(Date.now());
const YESTERDAY = DBLD.yesterdayInIsrael();
const analyticsPath = (date, biz = B) => `tenants/${T}/biz:${biz}:analytics:daily:${date}`;
const insightsPath = (date, biz = B) => `tenants/${T}/biz:${biz}:insights:daily:${date}`;
const mkRes = () => { const x = { statusCode: 0, body: null, headers: {} }; x.setHeader = (k, v) => { x.headers[k] = v; }; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };

/** One business with a day of revenue / purchases / payroll; `registry` is the RAW app/business node (undefined = default). */
function world(registry, { biz = B } = {}) {
  const db = makeDb();
  seedRaw(db, { biz, entries: env([entry(uid(1), TODAY, { sales: "700", supplier_payments: { s1: "100" }, payroll: "50" }), entry(uid(2), YESTERDAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) });
  db.seed(`tenants/${T}/app/users`, env([{ firebaseUid: "u1", role: "owner", allowedBizIds: [biz] }]));
  if (registry !== undefined) db.seed(`tenants/${T}/app/business`, registry);
  installDb(db);
  return db;
}
async function rebuild(body) {
  const res = mkRes();
  await API.default({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { action: "rebuild_after_entry_save", tenantId: T, bizId: B, date: TODAY, ...body } }, res);
  return res;
}
async function backfill(body) {
  const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try { const res = mkRes(); await API.default({ method: "POST", headers: { authorization: "Bearer " + SECRET }, query: {}, body: { tenantId: T, bizId: B, date: YESTERDAY, ...body } }, res); return res; }
  finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
}
const noWrites = (db, label) => {
  assert.deepEqual(db.writes, [], label + ": nothing was written");
  assert.equal(db.read(analyticsPath(TODAY)), null, label + ": no analytics doc");
  assert.equal(db.read(insightsPath(TODAY)), null, label + ": no insights doc");
};
const rec = (extra = {}) => ({ id: B, name: "Biz " + B, ...extra });

test("DBR2-00 resolveRegistryTarget (the shared module): the record only for a registered target — never a first match", async () => {
  const { resolveRegistryTarget } = await import(pathToFileURL(join(ROOT, "lib", "businessRegistry.js")).href);
  const r = (list, id = B) => resolveRegistryTarget(env(list), id);
  assert.deepEqual(r([null, rec({ active: false })]), { state: "registered", unrelatedDefects: 1, record: rec({ active: false }) });
  for (const [list, state] of [[[rec({ name: "first" }), rec({ name: "second" })], "ambiguous"], [[rec(), { id: " " + B }], "ambiguous"], [[{ id: "x" }], "not_registered"]]) {
    const t = r(list); assert.equal(t.state, state, JSON.stringify(list)); assert.equal(t.record, null, "no record for " + state);
  }
  for (const raw of [null, [rec()], { _v: "[" }]) assert.deepEqual([resolveRegistryTarget(raw, B).state, resolveRegistryTarget(raw, B).record], ["unreadable", null]);
  assert.deepEqual(resolveRegistryTarget(env([rec()]), "a:b"), { state: "invalid_request", record: null });
});

test("DBR2-01 a uniquely registered business beside unrelated defective records rebuilds: 200, analytics + insights written", async () => {
  for (const list of [
    [rec()],
    [null, rec()],
    [null, "bizX", 7, [B + "x"], { name: "no id" }, { id: "" }, { id: "bad:id" }, rec(), { id: "bizZ" }, { id: "bizZ", active: false }],
  ]) {
    const db = world(env(list));
    const res = await rebuild();
    assert.equal(res.statusCode, 200, JSON.stringify(list) + " → " + JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    const doc = db.read(analyticsPath(TODAY));
    assert.ok(doc && doc.bizId === B && doc.tenantId === T && doc.revenue.had_entry === true && doc.date === TODAY, "the analytics doc of the requested business (its entered day) is written: " + JSON.stringify(doc && { b: doc.bizId, t: doc.tenantId, r: doc.revenue }));
    assert.ok(db.read(insightsPath(TODAY)), "the insights doc is written");
    assert.ok(db.writes.every((w) => w.path.startsWith(`tenants/${T}/biz:${B}:`)), "writes stay in the requested business: " + db.writes.map((w) => w.path).join(", "));
  }
});

test("DBR2-02 the requested id duplicated (active + inactive): 503 ambiguous in BOTH orders, and nothing is built or written", async () => {
  for (const list of [[rec({ active: true }), rec({ active: false })], [rec({ active: false }), rec({ active: true })]]) {
    const db = world(env(list));
    const res = await rebuild();
    assert.equal(res.statusCode, 503, JSON.stringify(list));
    assert.deepEqual(res.body, { ok: false, error: "business_registry_ambiguous" });
    noWrites(db, JSON.stringify(list));
  }
});

test("DBR2-03 duplicates with conflicting settings (names, flags, extra keys), both orders: 503, no write", async () => {
  const a = rec({ name: "Branch A", status: "active" }), b = rec({ name: "Branch B", archived: true, extra: 1 });
  for (const list of [[a, b], [b, a], [a, rec({ name: "Branch A" })], [null, a, { id: "bizQ" }, a]]) {
    const db = world(env(list));
    const res = await rebuild();
    assert.equal(res.statusCode, 503, JSON.stringify(list)); assert.equal(res.body.error, "business_registry_ambiguous");
    noWrites(db, JSON.stringify(list));
  }
});

test("DBR2-04 colliding non-canonical identities are ambiguous; a bare null never collides (P3)", async () => {
  for (const list of [[rec(), { id: " " + B, name: "padded" }], [{ id: B + " " }, rec()], [rec(), B]]) {
    const db = world(env(list));
    const res = await rebuild();
    assert.equal(res.statusCode, 503, JSON.stringify(list)); assert.equal(res.body.error, "business_registry_ambiguous");
    noWrites(db, JSON.stringify(list));
  }
  // a numeric / null record id that String() turns into the requested id (the coercion the previous validators applied)
  for (const [biz, list, status] of [["5", [{ id: 5 }, { id: "5" }], 503], ["5", [{ id: "5" }, { id: 5 }], 503], ["null", [{ id: "null" }, { id: null }], 503], ["null", [{ id: "null" }, null], 200], ["5", [{ id: 5 }], 503]]) {
    const db = world(env(list), { biz });
    const res = await rebuild({ bizId: biz });
    assert.equal(res.statusCode, status, biz + " " + JSON.stringify(list) + " → " + JSON.stringify(res.body));
    if (status !== 200) assert.deepEqual(db.writes, [], "no write");
    else assert.ok(db.read(analyticsPath(TODAY, biz)), "built");
  }
});

test("DBR2-05 not registered → 404; uniquely registered but explicitly inactive → 404; no write", async () => {
  for (const [list, why] of [[[{ id: "bizOther" }], "absent target"], [[], "empty registry"], [[rec({ active: false })], "inactive"], [[rec({ status: " Archived " })], "archived status"], [[null, rec({ deleted: true })], "deleted beside null"]]) {
    const db = world(env(list));
    const res = await rebuild();
    assert.equal(res.statusCode, 404, why); assert.deepEqual(res.body, { ok: false, error: "business_not_found" });
    noWrites(db, why);
  }
});

test("DBR2-06 registry shapes: only the runtime {_v:'<JSON array>'} node establishes identity; every other shape is 503 unreadable", async () => {
  for (const [raw, why] of [[null, "absent node"], [{ _v: "[" }, "invalid JSON"], [{ _v: "{}" }, "non-array JSON"], [{ _v: 5 }, "non-string envelope"], [[rec()], "raw (non-envelope) array"], [{ [B]: rec() }, "object map"], [JSON.stringify([rec()]), "bare JSON string"]]) {
    const db = world(raw === null ? undefined : raw);
    if (raw === null) db.seed(`tenants/${T}/app/business`, null);
    const res = await rebuild();
    assert.equal(res.statusCode, 503, why + " → " + JSON.stringify(res.body)); assert.deepEqual(res.body, { ok: false, error: "business_registry_unreadable" });
    noWrites(db, why);
  }
});

test("DBR2-07 malformed request ids are refused (400) before any registry read or write", async () => {
  for (const body of [{ bizId: " " + B }, { bizId: B + " " }, { tenantId: " " + T }, { bizId: "a:b" }, { bizId: "a/b" }, { bizId: 5 }, { bizId: null }, { bizId: T }]) {
    const db = world(env([rec()]));
    const reads = []; const ref = db.ref; db.ref = (p, q) => { reads.push(p); return ref(p, q); };
    const res = await rebuild(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body) + " → " + JSON.stringify(res.body));
    assert.deepEqual([reads, db.writes], [[], []], "no read, no write");
  }
});

test("DBR2-08 a failed registry read is 503 authorization_unavailable — never a definitive 'not found' — and nothing is written", async () => {
  const db = world(env([rec()]));
  const ref = db.ref; db.ref = (p, q) => (String(p).endsWith("/app/business") ? { ...ref(p, q), once: async () => { throw new Error("transport"); } } : ref(p, q));
  const res = await rebuild();
  assert.equal(res.statusCode, 503); assert.deepEqual(res.body, { ok: false, error: "authorization_unavailable" });
  assert.deepEqual(db.writes, []);
  const res2 = await backfill();
  assert.equal(res2.statusCode, 503); assert.deepEqual(res2.body, { error: "authorization_unavailable" });
  assert.deepEqual(db.writes, []);
});

test("DBR2-09 the operator backfill follows the same identity rule: ambiguous (both orders) / unreadable / absent target refused with no write; registered → written", async () => {
  for (const [list, status, error] of [
    [env([rec({ active: true }), rec({ active: false })]), 503, "business_registry_ambiguous"],
    [env([rec({ active: false }), rec({ active: true })]), 503, "business_registry_ambiguous"],
    [[rec()], 503, "business_registry_unreadable"],
    [env([{ id: "bizOther" }]), 404, "business_not_found"],
  ]) {
    const db = world(list);
    const res = await backfill();
    assert.equal(res.statusCode, status, JSON.stringify(list)); assert.deepEqual(res.body, { error });
    assert.deepEqual(db.writes, [], "no write"); assert.equal(db.read(analyticsPath(YESTERDAY)), null);
  }
  for (const list of [[null, rec()], [rec({ active: false })]]) {
    const db = world(env(list));
    const res = await backfill();
    assert.equal(res.statusCode, 200, JSON.stringify(list) + " → " + JSON.stringify(res.body));
    assert.equal(db.read(analyticsPath(YESTERDAY)).revenue.total, 500, "the backfilled doc is written");
  }
  for (const body of [{ bizId: " " + B }, { bizId: "a:b" }]) {
    const db = world(env([rec()]));
    const res = await backfill(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body)); assert.deepEqual(db.writes, []);
  }
});

test("DBR2-10 the scheduled run (cron GET): an AMBIGUOUS business is not built and is reported as a failure (both orders); a valid business beside it and beside a null is built", async () => {
  const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try {
    for (const list of [[null, rec({ active: true }), rec({ active: false }), { id: "bizC", name: "C" }], [{ id: "bizC", name: "C" }, rec({ active: false }), null, rec({ active: true })]]) {
      const db = world(env(list));
      seedRaw(db, { biz: "bizC", entries: env([entry(uid(9), YESTERDAY, { sales: "300", supplier_payments: { s1: "30" }, payroll: "20" })]), businesses: list.filter((e) => e !== null) });
      db.seed(`tenants/${T}/app/business`, env(list));            // the stored list, as given (seedRaw re-seeded it)
      const res = mkRes();
      await API.default({ method: "GET", headers: { authorization: "Bearer " + SECRET }, query: {}, body: {} }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.summary.map((d) => d.bizId), ["bizC"], "only the uniquely registered business is built: " + JSON.stringify(list));
      assert.deepEqual(res.body.failures, [{ tenantId: T, bizId: B, error: "business_registry_ambiguous" }], "the ambiguous business is reported, never silently omitted");
      assert.equal(db.read(analyticsPath(YESTERDAY)), null, "no analytics doc for the ambiguous identity");
      assert.equal(db.read(insightsPath(YESTERDAY)), null, "no insights doc for the ambiguous identity");
      assert.ok(db.read(analyticsPath(YESTERDAY, "bizC")), "the valid business's doc is written");
      assert.ok(db.writes.every((w) => !w.path.startsWith(`tenants/${T}/biz:${B}:`)), "no write under the ambiguous business");
    }
  } finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
});
