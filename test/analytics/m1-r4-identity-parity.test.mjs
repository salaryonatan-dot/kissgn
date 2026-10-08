// M1 integration R4 (LOCAL; pending independent Codex review) — review finding A1: registered EXACT business ids were served by
// page / Core / P1 (and, for "biz A" / "biz@A", the nightly run) but refused by rebuild / backfill (400), and a padded id was
// refused by the nightly run. ONE identity contract now holds for every analytics entrypoint — the tenant id is the shared
// securityContext.isValidId, the business id is the shared isRegistryBizId, both compared EXACTLY (never trimmed, coerced or
// aliased) — and the registry then decides (lib/businessRegistry.js). Through the REAL endpoint and builder (seams: POS
// source, token verifier, role lookup). The cross-consumer view (page / Core / P1 too) is RMX-01.
//   IP-01  the review's exact registered ids (" bizA", "bizA ", "biz A", "biz@A") through rebuild, backfill and nightly: each
//          writes analytics AND insights at EXACTLY its own id's paths — never at a trimmed / normalized path
//   IP-02  tenant keys are never trimmed: a stored " tenantA" is its own tenant (built from its own registry and data),
//          never read or written as "tenantA" (the R3 nightly trimmed the key into ANOTHER tenant)
//   IP-03  the request contract, literal: the shared predicates decide 400 for both POST entrypoints
//   IP-04  a request that differs from the stored id only by padding is a collision (503 ambiguous), never served as it
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
const dir = mkdtempSync(join(tmpdir(), "m1-r4-id-"));
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
const SECRET = "m1-r4-id-cron-secret";   // test-only value
const T = "tenantA";
const mkRes = () => { const x = { statusCode: 0, body: null }; x.setHeader = () => {}; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };
const call = async (db, method, body, auth) => {
  installDb(db); const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try { const res = mkRes(); await API.default({ method, headers: { authorization: auth || "Bearer " + SECRET }, query: {}, body }, res); return res; }
  finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
};
const docs = (db, tenant, date) => db.writes.filter((w) => w.path.startsWith(`tenants/${tenant}/`) && w.path.endsWith(`:daily:${date}`)).map((w) => w.path).sort();
const both = (tenant, biz, date) => [`tenants/${tenant}/biz:${biz}:analytics:daily:${date}`, `tenants/${tenant}/biz:${biz}:insights:daily:${date}`].sort();
function world(tenant, ids) {
  const db = makeDb();
  for (const id of ids) seedRaw(db, { tenant, biz: id, entries: env([entry(uid(1), TODAY, { sales: "700", supplier_payments: { s1: "100" }, payroll: "50" }), entry(uid(2), DAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) });
  db.seed(`tenants/${tenant}/app/business`, env(ids.map((id) => ({ id, name: "n" }))));
  db.seed(`tenants/${tenant}/app/users`, env([{ firebaseUid: "u1", role: "owner", allowedBizIds: ids }]));
  return db;
}

test("IP-01 the review's exact registered ids are served by rebuild, backfill and nightly at exactly their own paths", async () => {
  for (const id of [" bizA", "bizA ", "biz A", "biz@A"]) {
    {
      const db = world(T, [id]);
      const res = await call(db, "POST", { action: "rebuild_after_entry_save", tenantId: T, bizId: id, date: TODAY }, "Bearer user-token");
      assert.equal(res.statusCode, 200, JSON.stringify(id) + " rebuild: " + JSON.stringify(res.body));
      assert.deepEqual(docs(db, T, TODAY), both(T, id, TODAY), JSON.stringify(id) + " rebuild paths");
    }
    {
      const db = world(T, [id]);
      const res = await call(db, "POST", { tenantId: T, bizId: id, date: DAY });
      assert.deepEqual([res.statusCode, res.body.status], [200, "success"], JSON.stringify(id) + " backfill");
      assert.deepEqual(docs(db, T, DAY), both(T, id, DAY), JSON.stringify(id) + " backfill paths");
    }
    {
      const db = world(T, [id]);
      const res = await call(db, "GET", {});
      assert.deepEqual([res.statusCode, res.body.status], [200, "completed"], JSON.stringify(id) + " nightly: " + JSON.stringify(res.body.failures));
      assert.deepEqual(docs(db, T, DAY), both(T, id, DAY), JSON.stringify(id) + " nightly paths");
    }
  }
});

test("IP-02 tenant keys are never trimmed into another tenant", async () => {
  const db = world(T, ["bizA"]);
  seedRaw(db, { tenant: " " + T, biz: "bizP", entries: env([entry(uid(3), DAY, { sales: "900", supplier_payments: { s1: "1" }, payroll: "1" })]) });
  db.seed(`tenants/ ${T}/app/business`, env([{ id: "bizP", name: "padded tenant's business" }]));
  const res = await call(db, "GET", {});
  assert.deepEqual([res.statusCode, res.body.status], [200, "completed"], JSON.stringify(res.body.failures));
  assert.deepEqual(res.body.summary.map((d) => [d.tenantId, d.bizId]).sort(), [[" " + T, "bizP"], [T, "bizA"]]);
  assert.deepEqual(docs(db, T, DAY), both(T, "bizA", DAY), "the trimmed tenant holds only its own business's docs");
  assert.deepEqual(docs(db, " " + T, DAY), both(" " + T, "bizP", DAY), "the padded tenant's business is built under its own key");
  assert.equal(db.read(`tenants/${T}/biz:bizP:analytics:daily:${DAY}`), null, "never written into another tenant");
});

test("IP-03 the request contract: the shared predicates decide 400 for both POST entrypoints", async () => {
  const BIZ = [["", false], ["a:b", false], ["a/b", false], ["a.b", false], ["a#b", false], ["x".repeat(129), false], [5, false], [" bizA", true], ["biz A", true], ["biz@A", true], ["bizA", true], ["x".repeat(128), true]];
  const TEN = [["", false], ["a/b", false], ["a$b", false], ["x".repeat(129), false], [7, false], ["tenant A", true], ["tenant:A", true], [T, true]];
  for (const [id, valid] of BIZ) assert.equal(isRegistryBizId(id), valid, "shared business predicate " + JSON.stringify(id));
  for (const [id, valid] of TEN) assert.equal(isValidId(id), valid, "shared tenant predicate " + JSON.stringify(id));
  for (const [tenantId, bizId, valid] of [...BIZ.map(([b, v]) => [T, b, v]), ...TEN.map(([t, v]) => [t, "bizA", v])]) {
    const db = world(T, ["bizA"]);
    const rb = await call(db, "POST", { action: "rebuild_after_entry_save", tenantId, bizId, date: TODAY }, "Bearer user-token");
    const bf = await call(db, "POST", { tenantId, bizId, date: DAY });
    const label = JSON.stringify([tenantId, bizId]);
    if (!valid) {
      assert.equal(rb.statusCode, 400, label + " rebuild"); assert.equal(bf.statusCode, 400, label + " backfill");
    } else {
      assert.notEqual(rb.statusCode, 400, label + " rebuild is not a request-format refusal");
      assert.notEqual(bf.statusCode, 400, label + " backfill is not a request-format refusal");
    }
  }
});

test("IP-04 a request that differs from the stored id only by padding is a collision, never served as it", async () => {
  for (const [stored, requested] of [["bizA", " bizA"], ["bizA", "bizA "], [" bizA", "bizA"], ["biz A", "biz A "]]) {
    const db = world(T, [stored]);
    const rb = await call(db, "POST", { action: "rebuild_after_entry_save", tenantId: T, bizId: requested, date: TODAY }, "Bearer user-token");
    const bf = await call(db, "POST", { tenantId: T, bizId: requested, date: DAY });
    assert.deepEqual([rb.statusCode, rb.body.error], [503, "business_registry_ambiguous"], JSON.stringify([stored, requested]) + " rebuild");
    assert.deepEqual([bf.statusCode, bf.body.error], [503, "business_registry_ambiguous"], JSON.stringify([stored, requested]) + " backfill");
    assert.deepEqual(docs(db, T, TODAY).concat(docs(db, T, DAY)), [], "nothing written");
  }
});
