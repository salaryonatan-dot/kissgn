// Agent/Daily integration I3 — M1 D-CTRL shared-predicate layer (LOCAL author candidate; pending independent Codex review
// and the M1 identity owner's acceptance). Owner decision D-CTRL (2026-10-09, APPROVED_DECISION_RECORD.md): reject the
// RTDB-forbidden control characters U+0000–U+001F and U+007F in tenant / business identifiers before any database reference
// is built; never trim, sanitize, replace or alias; apply consistently through the shared identity mechanism; ordinary names
// and valid identities keep their contracts. Builder coordination contract §2.3: the rule is adopted INSIDE
// lib/securityContext.js isValidId and lib/businessRegistry.js isRegistryBizId (expected effect: requireBizContext → 400).
// Every behavioural expectation below is computed independently or against the I2 commit's own predicate bytes (git objects),
// never against the code under test.
//   DC-01  the two predicates refuse every control character in every position; for every other value the verdict is EXACTLY
//          the I2 verdict (corpus: colon / padded / unicode / C1-range / boundary-length / non-string / RTDB-forbidden)
//   DC-02  requireBizContext answers 400 for a control-character tenant or business id BEFORE tenant access or any database
//          handle is requested; valid colon / padded / unicode ids proceed with their exact bytes
//   DC-03  the registry: classify / read refuse a control-character request before any db.ref; for every other request and
//          every registry (control-character records included) the state and the resolved record are exactly I2's
//   DC-04  Core cost history (requireBusinessInTenant): 400 before any read
//   DC-05  P1 supplier credits (the real api/admin.js handler): 400 for a control-character tenant / business, zero reads
//   DC-06  analytics entry points (the real api/analytics/daily-builder.ts, rebuild + backfill): 400, zero reads / writes; the
//          nightly discovery never reads or writes a control-character business and still builds its valid neighbour
//   DC-07  one rule everywhere: delivery isTenantKey / isBusinessKey and the Builder's composite equal the shared predicates on
//          the whole corpus (the I1-R-02 probe is now {false,false,false,false} for U+0001)
//   DC-08  page mirror ≡ server: C1 historyBinding agrees with classifyRegistryTarget on every corpus case, control chars included
//   DC-09  the real Admin SDK: every id the predicates accept is a key the SDK accepts in both slots; every control character the
//          SDK refuses in a key is refused by the predicates first
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { isValidId, requireBizContext } from "../../lib/securityContext.js";
import { isRegistryBizId, classifyRegistryTarget, resolveRegistryTarget, readRegistryTarget } from "../../lib/businessRegistry.js";
import { isTenantKey, isBusinessKey, receiptPath, deliveryNoticePath } from "../../lib/emailDelivery.js";
import { requireBusinessInTenant } from "../../lib/finance/costHistoryWriter.js";
import { loadSeam } from "../support/c1-seam.mjs";
import { apiHarness, memoryDb } from "../support/p1-r3-api-harness.mjs";

const I2 = "cfe900dd2073701b2392c186f95a9107cd5291ce";
const CONTROLS = [...Array(0x20).keys(), 0x7f].map((c) => String.fromCharCode(c));
const env = (list) => ({ _v: JSON.stringify(list) });

// ── the I2 predicates, from the I2 commit's own bytes (never the working tree) ──────────────────────────────────────────
const old = await (async () => {
  const dir = mkdtempSync(join(tmpdir(), "i3-dctrl-i2-"));
  mkdirSync(join(dir, "lib"));
  for (const f of ["lib/securityContext.js", "lib/businessRegistry.js", "lib/bizAccess.js"]) {
    const r = gitIn(REPO, ["cat-file", "blob", `${I2}:${f}`], { encoding: "buffer" });
    assert.equal(r.status, 0, `${I2}:${f}`);
    writeFileSync(join(dir, f), r.stdout);
  }
  const sc = await import(pathToFileURL(join(dir, "lib/securityContext.js")).href);
  const br = await import(pathToFileURL(join(dir, "lib/businessRegistry.js")).href);
  return { isValidId: sc.isValidId, isRegistryBizId: br.isRegistryBizId, classify: br.classifyRegistryTarget, resolve: br.resolveRegistryTarget };
})();

// ── corpus ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BASE = ["bizA", "tenantA", "a", "t:1", "a:b", " bizA", "bizA ", "biz A", "biz@A", "סניף א", "ביז-1", "😀", "x".repeat(127), "x".repeat(128), "x".repeat(129),
  "", "a.b", "a#b", "a$b", "a[b", "a]b", "a/b", "\u0080", "a\u0085b", "a\u009fb", "a b", "a b", "a b", "a﻿b", "a​b", "null", "undefined", "0", "Unknown"];
const NONSTRING = [undefined, null, 0, 7, true, false, {}, [], ["a"], { id: "a" }];
const withControls = [];
for (const c of CONTROLS) for (const s of ["", "a", "biz", "t:1"]) { withControls.push(c + s, s + c, s.slice(0, 1) + c + s.slice(1)); }
const CORPUS = [...BASE, ...NONSTRING, ...withControls.filter((v) => v.length > 0)];
const hasControl = (v) => typeof v === "string" && /[\u0000-\u001f\u007f]/.test(v);

test("DC-01 the shared predicates refuse every control character in every position; every other verdict is exactly I2's", () => {
  let refused = 0;
  for (const c of CONTROLS) for (const v of [c, "a" + c, c + "a", "biz" + c + "A", "x".repeat(127) + c]) {
    assert.equal(isValidId(v), false, "isValidId " + JSON.stringify(v)); assert.equal(isRegistryBizId(v), false, "isRegistryBizId " + JSON.stringify(v)); refused++;
  }
  assert.equal(refused, 33 * 5);
  for (const v of CORPUS) {
    if (hasControl(v)) { assert.equal(isValidId(v), false); assert.equal(isRegistryBizId(v), false); continue; }
    assert.equal(isValidId(v), old.isValidId(v), "isValidId keeps the I2 verdict for " + JSON.stringify(v));
    assert.equal(isRegistryBizId(v), old.isRegistryBizId(v), "isRegistryBizId keeps the I2 verdict for " + JSON.stringify(v));
  }
  // non-vacuity: I2 accepted the control-character ids (the I1-R-02 finding), so the change is the refusal and nothing else
  assert.equal(old.isValidId("t\u0001"), true); assert.equal(old.isRegistryBizId("b\u0001"), true);
  for (const v of ["t:1", " bizA", "סניף א", "a\u0085b", "x".repeat(128)]) assert.equal(isValidId(v), true, "still an identity: " + JSON.stringify(v));
  for (const v of [" bizA", "biz@A", "סניף א", "a b"]) assert.equal(isRegistryBizId(v), true, "still a business id: " + JSON.stringify(v));
  assert.equal(isRegistryBizId("t:1"), false, "':' stays refused for a business id only");
  // the predicates only answer: a refused value is not transformed into anything
  for (const v of ["a\u0001", " a\n"]) { assert.equal(typeof isValidId(v), "boolean"); assert.equal(typeof isRegistryBizId(v), "boolean"); }
});

test("DC-02 requireBizContext: 400 before tenant access or a database handle; valid ids proceed with their exact bytes", async () => {
  const run = async (tenantId, bizId) => {
    const calls = [];
    const deps = { requireAuth: async () => ({ uid: "u1", email: null }), requireTenantAccess: async (uid, t) => { calls.push(["tenant", t]); return "owner"; }, getDb: async () => { calls.push(["db"]); return { ref: (p) => { calls.push(["ref", p]); return { once: async () => ({ val: () => true }) }; } }; } };
    try { const ctx = await requireBizContext({ headers: {} }, { tenantId, bizId, mode: "read" }, deps); return { ok: true, ctx, calls }; }
    catch (e) { return { ok: false, e, calls }; }
  };
  for (const c of CONTROLS) {
    for (const [t, b, msg] of [["tenant" + c, "bizA", "invalid tenantId"], ["tenantA", "biz" + c, "invalid bizId"], [c, c, "invalid tenantId"]]) {
      const r = await run(t, b);
      assert.equal(r.ok, false, JSON.stringify([t, b]));
      assert.deepEqual([r.e.status, r.e.msg], [400, msg], JSON.stringify([t, b]));
      assert.deepEqual(r.calls, [], "nothing before the refusal: " + JSON.stringify([t, b]));
    }
  }
  for (const [t, b] of [["t:1", "bizA"], [" tenantA", " bizA"], ["tenantA", "סניף א"], ["tenantA", "biz@A"]]) {
    const r = await run(t, b);
    assert.equal(r.ok, true, JSON.stringify([t, b]) + " " + JSON.stringify(r.e));
    assert.deepEqual([r.ctx.tenantId, r.ctx.bizId], [t, b], "the exact bytes, never trimmed or aliased");
    assert.deepEqual(r.calls[0], ["tenant", t]);
  }
});

test("DC-03 registry: a control-character request is invalid before any db.ref; every other classification is exactly I2's", async () => {
  for (const c of CONTROLS) {
    const refs = []; const db = { ref: (p) => { refs.push(p); return { get: async () => ({ val: () => env([{ id: "b" + c }]) }) }; } };
    assert.deepEqual(await readRegistryTarget(db, "tenantA", "b" + c), { state: "invalid_request" });
    assert.deepEqual(refs, [], "no reference built");
    assert.deepEqual(classifyRegistryTarget(env([{ id: "b" + c }]), "b" + c), { state: "invalid_request" });
  }
  const REGISTRIES = [[], [{ id: "bizA", name: "A" }], [{ id: "bizA" }, { id: "bizA\u0001" }], [{ id: "bizA\u0001" }], [{ id: "bizA\n" }], [{ id: "\tbizA" }, { id: "bizA" }],
    [{ id: "bizA" }, { id: "bizA" }], [{ id: " bizA" }], [{ id: "bizA\u007f" }, { id: "bizB" }], [null, { id: "bizA" }], [{ id: 7 }, { id: "7" }], ["bizA"], [{ id: "a\u0085" }]];
  const REQUESTS = ["bizA", "bizB", " bizA", "bizA\n".trim(), "7", "a\u0085", "biz@A"];
  let compared = 0;
  for (const list of REGISTRIES) for (const id of REQUESTS) {
    const now = resolveRegistryTarget(env(list), id), before = old.resolve(env(list), id);
    assert.equal(now.state, before.state, JSON.stringify([list, id]));
    assert.equal(now.reason, before.reason, JSON.stringify([list, id]));
    assert.deepEqual(now.record, before.record, JSON.stringify([list, id]));
    compared++;
  }
  assert.equal(compared, REGISTRIES.length * REQUESTS.length);
});

test("DC-04 Core cost history: requireBusinessInTenant refuses a control-character identity with 400 before any read", async () => {
  for (const c of CONTROLS) for (const [t, b] of [["tenant" + c, "bizA"], ["tenantA", "biz" + c]]) {
    const reads = []; const db = { ref: (p) => { reads.push(p); return { get: async () => ({ val: () => null }), once: async () => ({ val: () => null }) }; } };
    await assert.rejects(requireBusinessInTenant(db, t, b), (e) => e && e.status === 400, JSON.stringify([t, b]));
    assert.deepEqual(reads, [], JSON.stringify([t, b]));
  }
});

test("DC-05 P1 supplier credits (real api/admin.js handler): 400 for a control-character tenant / business with zero reads", async () => {
  const h = await apiHarness(memoryDb());
  const control = await h.call("list-supplier-credits", { tenantId: "tenantA", bizId: "bizA" }, "own", "GET");
  assert.notEqual(control.code, 400, "positive control: the valid pair is not a request-format refusal: " + JSON.stringify(control.body));
  for (const c of ["\u0000", "\u0001", "\n", "\u001f", "\u007f"]) for (const [t, b] of [["tenantA" + c, "bizA"], ["tenantA", "bizA" + c]]) {
    h.db.reads.length = 0;
    const r = await h.call("list-supplier-credits", { tenantId: t, bizId: b }, "own", "GET");
    assert.equal(r.code, 400, JSON.stringify([t, b]) + " " + JSON.stringify(r.body));
    assert.deepEqual(h.db.reads, [], "no read: " + JSON.stringify([t, b]));
  }
});

test("DC-06 analytics: rebuild / backfill answer 400 with no read or write; the nightly never touches a control-character business", async () => {
  const { compileServer, makeDb, installDb, offlineFetch, ROOT } = await import("../support/server-reader-harness.mjs");
  const { entry, seedRaw, uid } = await import("../support/b1-fixtures.mjs");
  offlineFetch();
  const srv = compileServer();
  const dir = mkdtempSync(join(tmpdir(), "i3-dctrl-an-"));
  cpSync(srv.dir, dir, { recursive: true });
  cpSync(join(ROOT, "api", "analytics", "daily-builder.ts"), join(dir, "api", "analytics", "daily-builder.ts"));
  cpSync(join(ROOT, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));
  cpSync(join(ROOT, "lib", "securityContext.js"), join(dir, "lib", "securityContext.js"));
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(){ return { uid: "u1" }; }\n`);
  writeFileSync(join(dir, "lib", "helpers.js"), `export async function requireTenantAccess(){ return "owner"; }\nexport async function isRateLimited(){ return false; }\n`);
  writeFileSync(join(dir, "lib", "analytics", "sources.js"), `export async function fetchBeecommDaily(){ throw { reason: "offline" }; }\n`);
  spawnSync("node", [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(dir, "api", "analytics", "daily-builder.ts")], { encoding: "utf8" });
  const API = await import(pathToFileURL(join(dir, "api", "analytics", "daily-builder.js")).href);
  const BD = await srv.import("src/finance/businessDate.js"), DBLD = await srv.import("src/analytics/dailyBuilder.js");
  const TODAY = BD.israelBusinessDate(Date.now()), DAY = DBLD.yesterdayInIsrael();
  const SECRET = "i3-dctrl-cron-secret";   // test-only value
  const world = (ids) => {
    const db = makeDb();
    for (const id of ids.filter((x) => !hasControl(x))) seedRaw(db, { tenant: "tenantA", biz: id, entries: env([entry(uid(1), DAY, { sales: "500", supplier_payments: { s1: "80" }, payroll: "40" })]) });
    db.seed("tenants/tenantA/app/business", env(ids.map((id) => ({ id, name: "n" }))));
    db.seed("tenants/tenantA/app/users", env([{ firebaseUid: "u1", role: "owner", allowedBizIds: ids }]));
    const refs = []; const orig = db.ref.bind(db); db.ref = (p, ...a) => { refs.push(p); return orig(p, ...a); }; db.__refs = refs;
    return db;
  };
  const call = async (db, method, body, auth) => {
    installDb(db); const prev = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET;
    try { const x = { statusCode: 0, body: null, setHeader() {}, end() { return x; } }; x.status = (c) => { x.statusCode = c; return x; }; x.json = (b) => { x.body = b; return x; };
      await API.default({ method, headers: { authorization: auth || "Bearer " + SECRET }, query: {}, body }, x); return x; }
    finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
  };
  for (const c of ["\u0000", "\u0001", "\n", "\u007f"]) for (const [t, b] of [["tenantA" + c, "bizA"], ["tenantA", "bizA" + c]]) {
    for (const [label, args] of [["rebuild", ["POST", { action: "rebuild_after_entry_save", tenantId: t, bizId: b, date: TODAY }, "Bearer user-token"]], ["backfill", ["POST", { tenantId: t, bizId: b, date: DAY }]]]) {
      const db = world(["bizA"]);
      const r = await call(db, ...args);
      assert.equal(r.statusCode, 400, label + " " + JSON.stringify([t, b]) + " " + JSON.stringify(r.body));
      assert.deepEqual(db.__refs.filter((p) => p.includes(c)), [], label + ": no reference carries the control character");
      assert.deepEqual(db.writes, [], label + ": nothing written");
    }
  }
  const db = world(["bizA", "bizB\u0001"]);
  const n = await call(db, "GET", {});
  assert.deepEqual(db.__refs.filter((p) => hasControl(p)), [], "the nightly builds no reference for the control-character business");
  assert.ok(db.writes.some((w) => w.path === `tenants/tenantA/biz:bizA:analytics:daily:${DAY}`), "its valid neighbour is still built: " + JSON.stringify(n.body));
  assert.equal(db.writes.filter((w) => hasControl(w.path)).length, 0);
});

test("DC-07 one rule everywhere: delivery keys and the Builder composite equal the shared predicates on the whole corpus", () => {
  for (const v of CORPUS) {
    assert.equal(isTenantKey(v), isValidId(v), "tenant " + JSON.stringify(v));
    assert.equal(isBusinessKey(v), isRegistryBizId(v), "business " + JSON.stringify(v));
  }
  const probe = { sharedTenant: isValidId("t\u0001"), sharedBusiness: isRegistryBizId("b\u0001"), deliveryTenant: isTenantKey("t\u0001"), deliveryBusiness: isBusinessKey("b\u0001") };
  assert.deepEqual(probe, { sharedTenant: false, sharedBusiness: false, deliveryTenant: false, deliveryBusiness: false }, "the I1-R-02 probe");
  assert.equal(receiptPath("daily_snapshot", "t\u0001", "bizA", "2026-10-01"), null); assert.equal(deliveryNoticePath("tenantA", "b\u0001"), null);
  assert.equal(receiptPath("daily_snapshot", "t:1", " bizA", "2026-10-01"), "email_delivery/daily_snapshot/t:1/ bizA/2026-10-01", "delivery paths keep the exact bytes");
});

test("DC-08 page mirror ≡ server: C1 historyBinding agrees with classifyRegistryTarget, control characters included", () => {
  const C1 = loadSeam();
  const T = "tenantA";
  let n = 0;
  for (const id of CORPUS.filter((v) => typeof v === "string")) for (const list of [[{ id }], [{ id }, { id: "other" }], [{ id }, { id }], [{ id: "x" }]]) {
    const server = classifyRegistryTarget(env(list), id).state === "registered";
    const b = C1.historyBinding({ tenantId: T, bizId: id, gen: 1 }, { tenantId: T, bizId: id, gen: 1 }, id, list);
    const page = !!b.ok;
    if (id === "") { assert.equal(page, false); assert.equal(server, false); continue; }
    assert.equal(page, server, "page ≡ server for " + JSON.stringify([id, list]));
    n++;
  }
  assert.ok(n > 400, "corpus size " + n);
  for (const c of CONTROLS) assert.equal(C1.historyBinding({ tenantId: T, bizId: "b" + c, gen: 1 }, { tenantId: T, bizId: "b" + c, gen: 1 }, "b" + c, [{ id: "b" + c }]).reason, "business_unregistered");
});

test("DC-09 the real Admin SDK: accepted ids are SDK keys in both slots; the SDK's refused control characters are refused first", async () => {
  const admin = (await import("firebase-admin")).default;
  const app = admin.initializeApp({ databaseURL: "https://i3-dctrl-offline-probe.firebaseio.com" }, "i3-dctrl-" + process.pid);
  try {
    const db = app.database();
    const sdkAccepts = (p) => { try { db.ref(p); return true; } catch { return false; } };
    for (const c of CONTROLS) {
      assert.equal(sdkAccepts(`tenants/t${c}/members`), false, "the SDK refuses " + JSON.stringify(c));
      assert.equal(isValidId("t" + c) || isRegistryBizId("b" + c), false, "…and the predicates refuse it first");
    }
    for (const v of CORPUS) {
      if (isValidId(v)) assert.equal(sdkAccepts(`tenants/${v}/members`), true, "tenant slot " + JSON.stringify(v));
      if (isRegistryBizId(v)) assert.equal(sdkAccepts(`tenants/tenantA/biz:${v}:entries`), true, "business slot " + JSON.stringify(v));
    }
  } finally { await app.delete(); }
});
