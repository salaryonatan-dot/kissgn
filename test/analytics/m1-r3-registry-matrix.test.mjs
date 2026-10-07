// M1 integration R3 (LOCAL; pending independent Codex review) — ONE registry-shape × target-identity matrix across every
// consumer that decides "is business B a target of tenant T", each through its REAL code:
//   page      index.html's seam (window.MarjinC1): the stored node → businessRegistryNodeView → historyBinding (the gate of
//             every financial figure), and the first-business setup eligibility
//   Core      lib/finance/costHistoryWriter.js requireBusinessInTenant (the cost-history writer / route registry gate)
//   P1        api/admin.js list-supplier-credits (the REAL handler; only token / Admin / e-mail seams)
//   rebuild   api/analytics/daily-builder.ts POST rebuild_after_entry_save (user-authorized)
//   backfill  api/analytics/daily-builder.ts POST (cron-authorized operator backfill)
//   nightly   api/analytics/daily-builder.ts GET (cron) → src/analytics/dailyBuilder.ts discovery / build / analytics +
//             insights persistence
// For every row the outcome of each consumer is computed, written (M1_R3_MATRIX_OUT, when set) and checked against ONE rule:
//   * a target the shared rule classifies "registered" is served by every consumer (bound / 200 / built: analytics AND
//     insights written) — except the documented analytics exact-id rule for a PADDED stored id (rebuild / backfill 400,
//     nightly `business_id_not_exact`), which serves no other business either;
//   * any other target is refused by every consumer — no binding, no 2xx, no analytics or insights write — and the nightly
//     run reports it (never a clean empty run), except genuine absence and the supported empty registry (nothing to build,
//     first-business setup eligible on the page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { compileServer, makeDb, installDb, offlineFetch, ROOT } from "../support/server-reader-harness.mjs";
import { entry, seedRaw, uid } from "../support/b1-fixtures.mjs";
import { loadSeam } from "../support/c1-seam.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { apiHarness, memoryDb, seed as p1Seed } from "../support/p1-r3-api-harness.mjs";
import { classifyRegistryTarget } from "../../lib/businessRegistry.js";

offlineFetch();
const T = "tenantA", B = "bizA", K = "tenantK", BK = "bizK";
const env = (v) => ({ _v: JSON.stringify(v) });
const A = { id: B, name: "Biz A" };
const READ_FAILS = Symbol("read fails");

// ── the analytics endpoint + builder (as in the R2 / R3 analytics suites) ──
const srv = compileServer();
const dir = mkdtempSync(join(tmpdir(), "m1-r3-matrix-"));
cpSync(srv.dir, dir, { recursive: true });
cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"), { recursive: true });
cpSync(join(ROOT, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href);
const BD = await srv.import("src/finance/businessDate.js");
const DBLD = await srv.import("src/analytics/dailyBuilder.js");
const TODAY = BD.israelBusinessDate(Date.now()), DAY = DBLD.yesterdayInIsrael();
const SECRET = "m1-r3-matrix-cron-secret";   // test-only value
const W = await loadWriter(ROOT);
const C1 = loadSeam();
const mkRes = () => { const x = { statusCode: 0, body: null }; x.setHeader = () => {}; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };
const withCron = async (fn) => { const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET; try { return await fn(); } finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; } };

function analyticsWorld(node, bizIds) {
  const db = makeDb();
  for (const biz of bizIds) seedRaw(db, { biz, entries: { _v: JSON.stringify([entry(uid(1), TODAY, { sales: "700", supplier_payments: { s1: "100" }, payroll: "50" }), entry(uid(2), DAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) } });
  db.seed(`tenants/${T}/app/users`, env([{ firebaseUid: "u1", role: "owner", allowedBizIds: bizIds }]));
  db.seed(`tenants/${T}/app/business`, null);
  if (node !== undefined && node !== READ_FAILS) db.seed(`tenants/${T}/app/business`, node);
  seedRaw(db, { tenant: K, biz: BK, entries: { _v: JSON.stringify([entry(uid(3), DAY, { sales: "300", supplier_payments: { s1: "30" }, payroll: "20" })]) } });
  if (node !== READ_FAILS) return db;
  const ref = db.ref;
  return { ...db, ref: (p, q) => (p === `tenants/${T}/app/business` || p === "tenants" ? { ...ref(p, q), once: async () => { throw new Error("transport"); }, get: async () => { throw new Error("transport"); } } : ref(p, q)) };
}
const tWrites = (db) => db.writes.filter((w) => w.path.startsWith(`tenants/${T}/`));

async function outcomes(node, id) {
  const o = {};
  // page
  if (node === READ_FAILS) o.page = "unavailable (read_failed)";
  else {
    const v = C1.businessRegistryNodeView(node);
    const eligible = C1.firstSetupEligible(v.state === "unreadable" ? "unavailable" : v.state, v.list || []);
    const binds = v.state === "ready" && v.selectable.some((b) => b.id === id) && C1.historyBinding({ tenantId: T, bizId: id, gen: 1 }, { tenantId: T, bizId: id, gen: 1 }, id, v.list).ok === true;
    o.page = binds ? "serve" : v.state === "unreadable" ? `unavailable (${v.reason})` : eligible ? "first-business setup" : "refuse (not bound)";
  }
  // Core
  const s = p1Seed(); s.tenants.tenantA.app.business = node === READ_FAILS ? env([A]) : node;
  if (node === undefined) delete s.tenants.tenantA.app.business;
  const pdb = memoryDb(s);
  if (node === READ_FAILS) pdb.beforeGet = async (p) => { if (p.endsWith("/app/business")) throw new Error("transport"); };
  try { await W.requireBusinessInTenant(pdb, T, id); o.core = "serve"; } catch (e) { o.core = `refuse ${e.status} ${e.msg}`; }
  // P1 (the real handler)
  const h = await apiHarness(pdb);
  const p1 = await h.call("list-supplier-credits", { tenantId: T, bizId: id }, "own", "GET");
  o.p1 = p1.code === 200 ? "serve" : `refuse ${p1.code} ${p1.body && (p1.body.error || p1.body.reason || "")}`;
  // rebuild
  const bizIds = [...new Set([id.trim(), id])];
  { const db = analyticsWorld(node, bizIds); installDb(db); const res = mkRes();
    await API.default({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { action: "rebuild_after_entry_save", tenantId: T, bizId: id, date: TODAY } }, res);
    o.rebuild = res.statusCode === 200 ? "serve" : `refuse ${res.statusCode} ${res.body && res.body.error}`; o.rebuildWrites = tWrites(db).length; }
  // backfill
  { const db = analyticsWorld(node, bizIds); installDb(db); const res = mkRes();
    await withCron(() => API.default({ method: "POST", headers: { authorization: "Bearer " + SECRET }, query: {}, body: { tenantId: T, bizId: id, date: DAY } }, res));
    o.backfill = res.statusCode === 200 ? "serve" : `refuse ${res.statusCode} ${res.body && res.body.error}`; o.backfillWrites = tWrites(db).length; }
  // nightly
  { const db = analyticsWorld(node, bizIds); installDb(db); const res = mkRes();
    await withCron(() => API.default({ method: "GET", headers: { authorization: "Bearer " + SECRET }, query: {}, body: {} }, res));
    const built = (res.body.summary || []).some((d) => d.tenantId === T && d.bizId === id);
    const mine = (res.body.failures || []).filter((f) => f.tenantId === T || f.tenantId === null);
    const analytics = !!db.read(`tenants/${T}/biz:${id}:analytics:daily:${DAY}`), insights = !!db.read(`tenants/${T}/biz:${id}:insights:daily:${DAY}`);
    o.nightly = built ? "serve" : mine.length ? "refuse " + mine.map((f) => `${f.bizId === null ? "(tenant)" : f.bizId}:${f.error}`).join(", ") : "none";
    o.nightlyWrites = { analytics, insights, underTenant: tWrites(db).length, controlBuilt: (res.body.summary || []).some((d) => d.tenantId === K) || node === READ_FAILS };
  }
  o.shared = node === READ_FAILS ? "unavailable" : classifyRegistryTarget(node, id).state;
  return o;
}

const ROWS = [
  ["genuine absence (no node)", undefined, B],
  ["supported empty registry {_v:\"[]\"}", env([]), B],
  ["only null entries [null]", env([null]), B],
  ["only null entries [null, null]", env([null, null]), B],
  ["missing identifiers [{name}]", env([{ name: "unknown" }]), B],
  ["missing identifiers [{id:\"\"}, {id:null}]", env([{ id: "" }, { id: null }]), "null"],
  ["valid target alone", env([A]), B],
  ["valid target beside null", env([null, A]), B],
  ["valid target beside null / malformed / unsafe / duplicated unrelated", env([null, "bizX", 7, { name: "no id" }, { id: "" }, { id: "bad:id" }, A, { id: "bizZ" }, { id: "bizZ" }, null]), B],
  ["duplicate requested identity (active first)", env([{ ...A, active: true }, { ...A, active: false }]), B],
  ["duplicate requested identity (inactive first)", env([{ ...A, active: false }, { ...A, active: true }]), B],
  ["raw array [valid]", [A], B],
  ["raw array [null, valid]", [null, A], B],
  ["raw array [valid, other valid]", [A, { id: "bizC", name: "C" }], B],
  ["bare JSON string", JSON.stringify([A]), B],
  ["object map", { [B]: A }, B],
  ["unparsable envelope", { _v: "[{\"id\":" }, B],
  ["non-array envelope", { _v: JSON.stringify({ [B]: A }) }, B],
  ["non-string _v", { _v: 5 }, B],
  ["failed read", READ_FAILS, B],
  ["padded twin of the requested id", env([A, { id: B + " ", name: "twin" }]), B],
  ["padded stored id, exact id requested", env([{ id: " " + B, name: "padded" }]), B],
  ["coercion-only numeric id", env([{ id: 5, name: "n" }]), "5"],
  ["numeric id beside its string spelling", env([{ id: 5 }, { id: "5", name: "s" }]), "5"],
  ["padded stored id, padded id requested (documented analytics exact-id rule)", env([{ id: " " + B, name: "padded" }]), " " + B],
];

test("RMX-01 the registry shape × target identity matrix: one rule across page, Core, P1, rebuild, backfill and nightly", async () => {
  const matrix = [];
  for (const [label, node, id] of ROWS) {
    const o = await outcomes(node, id);
    matrix.push({ case: label, node: node === READ_FAILS ? "<read fails>" : node === undefined ? "<absent>" : node, requested: id, ...o });
    const at = label + " → " + JSON.stringify(o);
    const padded = id !== id.trim();
    if (o.shared === "registered") {
      for (const c of ["page", "core", "p1"]) assert.equal(o[c], "serve", c + " serves the registered target: " + at);
      if (padded) {
        assert.equal(o.rebuild, "refuse 400 invalid_tenant_or_biz_id", at); assert.match(o.backfill, /^refuse 400 /, at);
        assert.match(o.nightly, /business_id_not_exact/, at);
      } else {
        for (const c of ["rebuild", "backfill", "nightly"]) assert.equal(o[c], "serve", c + " serves the registered target: " + at);
        assert.ok(o.nightlyWrites.analytics && o.nightlyWrites.insights, "nightly writes analytics AND insights: " + at);
      }
    } else {
      for (const c of ["core", "p1", "rebuild", "backfill"]) assert.match(o[c], /^refuse /, c + " refuses: " + at);
      assert.notEqual(o.page, "serve", "the page binds no figure: " + at);
      assert.equal(o.rebuildWrites + o.backfillWrites, 0, "no rebuild / backfill write: " + at);
      assert.ok(!o.nightlyWrites.analytics && !o.nightlyWrites.insights && o.nightlyWrites.underTenant === 0, "no nightly analytics / insights write: " + at);
      const genuinelyEmpty = node === undefined || JSON.stringify(node) === JSON.stringify(env([]));
      if (genuinelyEmpty) { assert.equal(o.nightly, "none", at); assert.equal(o.page, "first-business setup", at); }
      else { assert.match(o.nightly, /^refuse /, "the nightly run reports it: " + at); assert.notEqual(o.page, "first-business setup", "never the first-business setup over an existing registry: " + at); }
    }
    assert.ok(o.nightlyWrites.controlBuilt, "the control tenant is built in the same run: " + at);
  }
  if (process.env.M1_R3_MATRIX_OUT) writeFileSync(process.env.M1_R3_MATRIX_OUT, JSON.stringify(matrix, null, 1) + "\n");
});
