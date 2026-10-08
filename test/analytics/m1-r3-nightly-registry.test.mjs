// M1 integration R3 (LOCAL; pending independent Codex review) — the NIGHTLY analytics run (cron GET) applies the approved
// registry interpretation of rebuild / backfill / Core / P1 at every boundary: discovery, selection, the build, the analytics
// write and the insights write. Through the REAL endpoint api/analytics/daily-builder.ts, the REAL
// src/analytics/dailyBuilder.ts (discovery, build, save, insights) and the REAL lib/businessRegistry.js, over an in-memory
// RTDB that records every write. Only the POS source, the token verifier and the role lookup are seams.
//
// Review finding R2-02: the scheduled run accepted a raw-array registry (a lenient parse, then a re-wrapped `{_v}`) and
// persisted BOTH analytics and insights for it, while rebuild / backfill / Core / P1 refuse that shape.
// Every run below also holds a CONTROL tenant (tenantK / bizK, a valid runtime registry): its analytics AND insights docs are
// written in the same run, so a refusal is never a blanket "build nothing". Expected outcomes are literal.
//   NR3-01  non-runtime registry nodes — a raw array (one / two valid-looking records), a bare JSON string, an object map:
//           nothing is built or written for the tenant (no analytics, no insights); each record id it appears to name is
//           reported `business_registry_unreadable` (the rejected target stays visible)
//   NR3-02  an unreadable envelope (invalid JSON, a non-string _v, a non-array JSON, an empty string): no write; ONE tenant
//           failure (bizId null) when no id can be named
//   NR3-03  a NON-EMPTY runtime registry in which no element names a business (only nulls / id-less records / primitives /
//           coercion-only ids): no write; reported `business_registry_no_valid_record` — never a clean empty run
//   NR3-04  a valid target beside unrelated nulls / malformed records: built, analytics + insights written, no failure
//   NR3-05  the requested id duplicated, both orders: `business_registry_ambiguous`, no write (preserved from R2)
//   NR3-06  padded / coercion-only identifiers: a padded stored id is never trimmed into another business's id — M1 R4 (review
//           A1): it is built under ITS OWN exact id, as page / Core / P1 serve it, never under the trimmed id; a padded twin
//           makes both spellings ambiguous (nothing written for either)
//   NR3-07  genuine absence (no node) and the supported empty registry (`{_v:"[]"}`): no failure, no write (unchanged)
//   NR3-08  the tenants read fails: `business_discovery_failed`, nothing built — never a clean empty run
//   NR3-09  an indexed business of a tenant whose registry is unreadable is a reported failure, never a silent skip
//   NR3-10  the identity is re-checked at BUILD time: a registry that stops establishing the target after discovery fails
//           that business before any write (`business_registry_changed_<state>`, distinct from the discovery codes)
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
const dir = mkdtempSync(join(tmpdir(), "m1-r3-nightly-"));
cpSync(srv.dir, dir, { recursive: true });
cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"), { recursive: true });
cpSync(join(ROOT, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));   // the REAL shared rule (as committed)
writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const compiled = spawnSync("node", [tsc, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href).catch((e) => { throw new Error("wrapper compile/import failed: " + e.message + "\n" + compiled.stdout); });
const DBLD = await srv.import("src/analytics/dailyBuilder.js");

const SECRET = "m1-r3-test-cron-secret";   // test-only value
const DAY = DBLD.yesterdayInIsrael();
const K = "tenantK", BK = "bizK";
const rec = (extra = {}) => ({ id: B, name: "Biz " + B, ...extra });
const docPaths = (tenant, biz) => [`tenants/${tenant}/biz:${biz}:analytics:daily:${DAY}`, `tenants/${tenant}/biz:${biz}:insights:daily:${DAY}`];
const mkRes = () => { const x = { statusCode: 0, body: null, headers: {} }; x.setHeader = (k, v) => { x.headers[k] = v; }; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; }; x.end = () => x; return x; };

/** tenant T with a day of data for `bizIds`, its registry node RAW as given (undefined = absent); control tenant K valid. */
function world(registry, { bizIds = [B], index } = {}) {
  const db = makeDb();
  for (const biz of bizIds) seedRaw(db, { biz, entries: env([entry(uid(1), DAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) });
  db.seed(`tenants/${T}/app/business`, null);
  if (registry !== undefined) db.seed(`tenants/${T}/app/business`, registry);
  seedRaw(db, { tenant: K, biz: BK, entries: env([entry(uid(2), DAY, { sales: "300", supplier_payments: { s1: "30" }, payroll: "20" })]) });
  if (index) db.seed("proactive_biz_index", index);
  return db;
}
async function nightly(db) {
  installDb(db);
  const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
  try { const res = mkRes(); await API.default({ method: "GET", headers: { authorization: "Bearer " + SECRET }, query: {}, body: {} }, res); return res; }
  finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
}
/** The run outcome for tenant T: nothing persisted under it; the control tenant built (analytics AND insights). */
// M1 R4 (review A2): a run with any failure is HTTP 500 and `partial` (the control tenant is built) — never 200 `completed`.
function assertRefusedTenant(db, res, failures, label) {
  assert.equal(res.statusCode, failures.length ? 500 : 200, label + ": " + JSON.stringify(res.body));
  assert.equal(res.body.status, failures.length ? "partial" : "completed", label + ": run status");
  assert.deepEqual(res.body.failures ?? [], failures, label + ": failures");
  assert.equal(res.body.failureCount, failures.length, label + ": failureCount");
  assert.deepEqual(res.body.summary.map((d) => [d.tenantId, d.bizId]), [[K, BK]], label + ": only the control business is built");
  assert.deepEqual(db.writes.filter((w) => w.path.startsWith(`tenants/${T}/`)), [], label + ": no analytics / insights write under the refused tenant");
  for (const p of docPaths(K, BK)) assert.ok(db.read(p), label + ": the control doc is written: " + p);
}

test("NR3-01 non-runtime registry nodes (raw array, bare JSON string, object map): no analytics or insights; each named id reported unreadable", async () => {
  const cases = [
    ["raw array, one valid-looking record", [rec()], [B]],
    ["raw array, two valid-looking records", [rec(), { id: "bizC", name: "C" }], [B, "bizC"]],
    ["bare JSON string", JSON.stringify([rec()]), [B]],
    ["object map", { [B]: rec() }, [B]],
    ["raw array beside a null", [null, rec()], [B]],
  ];
  for (const [label, node, ids] of cases) {
    const db = world(node, { bizIds: ["bizC", B] });
    const res = await nightly(db);
    assertRefusedTenant(db, res, ids.map((bizId) => ({ tenantId: T, bizId, error: "business_registry_unreadable" })), label);
  }
});

test("NR3-02 an unreadable envelope: no write; one tenant-level failure when no id can be named", async () => {
  for (const [label, node] of [["invalid JSON", { _v: "[{\"id\":" }], ["non-string _v", { _v: 5 }], ["non-array JSON", { _v: "{}" }], ["empty string", ""]]) {
    const db = world(node);
    const res = await nightly(db);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: null, error: "business_registry_unreadable" }], label);
  }
});

test("NR3-03 a non-empty runtime registry in which no element names a business is reported, never a clean empty run", async () => {
  for (const list of [[null], [null, null], [{ name: "unknown" }], [{ id: "" }], [7, "bizA", true], [{ id: 5, name: "coerced" }], [null, { id: null }]]) {
    const db = world(env(list));
    const res = await nightly(db);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: null, error: "business_registry_no_valid_record" }], JSON.stringify(list));
  }
});

test("NR3-04 a valid target beside unrelated nulls / malformed records is built: analytics + insights written, no failure", async () => {
  for (const list of [[null, rec()], [rec(), null], [null, "bizX", 7, { name: "no id" }, { id: "" }, rec(), { id: 9 }, null]]) {
    const db = world(env(list));
    const res = await nightly(db);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.failures, undefined, JSON.stringify(list) + ": no failure");
    assert.deepEqual(res.body.summary.map((d) => [d.tenantId, d.bizId, d.bizName]).sort(), [[T, B, "Biz " + B], [K, BK, "Biz " + BK]], JSON.stringify(list));
    for (const p of [...docPaths(T, B), ...docPaths(K, BK)]) assert.ok(db.read(p), JSON.stringify(list) + ": written " + p);
  }
});

test("NR3-05 the requested id duplicated (both orders): ambiguous, nothing written for it", async () => {
  for (const list of [[rec({ active: true }), rec({ active: false })], [rec({ active: false }), rec({ active: true })]]) {
    const db = world(env(list));
    const res = await nightly(db);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: B, error: "business_registry_ambiguous" }], JSON.stringify(list));
  }
});

test("NR3-06 padded / coercion-only identifiers: never trimmed or coerced into a business id", async () => {
  // M1 R4 (review A1): the R3 expectation (a padded stored id refused as `business_id_not_exact`) disagreed with page / Core /
  // P1, which serve the EXACT registered id " bizA". Under the one shared contract the padded id is built under ITSELF — never
  // trimmed into "bizA" (no doc under "bizA") — and a padded twin makes both spellings ambiguous.
  {
    const db = world(env([{ id: " " + B, name: "padded" }]), { bizIds: [" " + B, B] });
    const res = await nightly(db);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.summary.map((d) => [d.tenantId, d.bizId]).sort(), [[T, " " + B], [K, BK]], "padded only: built under its exact id");
    for (const p of docPaths(T, " " + B)) assert.ok(db.read(p), "padded only: written " + p);
    for (const p of docPaths(T, B)) assert.equal(db.read(p), null, "padded only: never trimmed into " + p);
  }
  {
    const db = world(env([rec(), { id: B + " ", name: "padded twin" }]), { bizIds: [B, B + " "] });
    const res = await nightly(db);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: B, error: "business_registry_ambiguous" }, { tenantId: T, bizId: B + " ", error: "business_registry_ambiguous" }], "exact + padded twin");
  }
  {
    const db = world(env([{ id: 5, name: "n" }, { id: "5", name: "s" }]), { bizIds: ["5"] });
    const res = await nightly(db);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: "5", error: "business_registry_ambiguous" }], "numeric id beside its string spelling");
  }
});

test("NR3-07 genuine absence and the supported empty registry: no failure, nothing built for the tenant (unchanged)", async () => {
  for (const [label, node] of [["absent node", undefined], ["empty runtime list", env([])]]) {
    const db = world(node);
    const res = await nightly(db);
    assertRefusedTenant(db, res, [], label);
    assert.equal(res.body.failures, undefined, label + ": a clean run");
  }
});

test("NR3-08 the tenants read fails: a reported discovery failure, nothing built — never a clean empty run", async () => {
  const db = world(env([rec()]), { index: { [`${T}:${B}`]: true } });
  const failing = { ...db, ref: (p) => (p === "tenants" ? { once: async () => { throw new Error("PERMISSION_DENIED private@example.test"); } } : db.ref(p)) };
  const res = await nightly(failing);
  assert.equal(res.statusCode, 500, "M1 R4 (review A2): a failed discovery is HTTP 500");
  assert.equal(res.body.status, "failed", "nothing built and a failure: `failed`, never `completed`");
  assert.deepEqual(res.body.failures, [{ tenantId: null, bizId: null, error: "business_discovery_failed" }]);
  assert.equal(res.body.successCount, 0);
  assert.deepEqual(db.writes.filter((w) => !w.path.startsWith("analytics_runs/")), [], "nothing but the run record is written");
});

test("NR3-09 an indexed business of an unreadable-registry tenant is reported, never silently skipped", async () => {
  const db = world([rec()], { index: { [`${T}:${B}`]: true, [`${T}:bizQ`]: { tenantId: T, bizId: "bizQ" } } });
  const res = await nightly(db);
  assertRefusedTenant(db, res, [{ tenantId: T, bizId: B, error: "business_registry_unreadable" }, { tenantId: T, bizId: "bizQ", error: "business_registry_unreadable" }], "indexed + raw array");
});

test("NR3-10 the identity is re-checked at build time: a registry that changes after discovery fails the business before any write", async () => {
  for (const [label, later, error] of [["raw array", [rec()], "business_registry_changed_unreadable"], ["duplicated", env([rec(), rec()]), "business_registry_changed_ambiguous"], ["removed", env([{ id: "other" }]), "business_registry_changed_not_registered"]]) {
    const db = world(env([rec()]));
    const regPath = `tenants/${T}/app/business`;
    const racing = { ...db, ref: (p) => (p === regPath ? { ...db.ref(p), once: async () => ({ val: () => JSON.parse(JSON.stringify(later)), exists: () => true }) } : db.ref(p)) };
    const res = await nightly(racing);
    assertRefusedTenant(db, res, [{ tenantId: T, bizId: B, error }], label);
  }
});
