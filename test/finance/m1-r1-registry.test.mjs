// M1 R1 — the business-registry contract across EVERY consumer of the requested business (independent review finding P1:
// a valid registered business was available to the Core writer but 503 for P1 when an UNRELATED registry record was
// malformed or duplicated; finding P2: a numeric / null / missing id was admitted by String() coercion).
//
// Contract (lib/businessRegistry.js; the page mirrors it in the C1 seam): the requested business is decided ONLY by its own
// registration — registered iff exactly one record's id is the string bizId and no other element's identity collides with
// it. A defect confined to an unrelated record is ignored. Ambiguity of the requested business (duplicate, coerced or trimmed
// collision), an uninterpretable registry, or a failed read fail CLOSED and NON-definitively (503; a pending review stays
// pending). An unlisted business is a definitive 403. biz_access never substitutes for registration.
//   RR-01  pure classification over the supported runtime representation ({_v:"<JSON array>"}) and every defect class
//   RR-02  the review's exact reproducers + the full case table: the REAL Core writer (read + owner activation) and the REAL P1
//          API (list + create) on ONE database agree on availability for every case, and a denial writes nothing
//   RR-03  stale biz_access for an unregistered target (also beside unrelated defects, and when another tenant lists it):
//          both deny 403; nothing written
//   RR-04  tenant / business isolation and supported access: the tenant-wide owner WITHOUT a biz_access row and a manager
//          WITH one are served despite unrelated defects; a manager without access to the target, a foreign-tenant owner and
//          an unauthenticated caller are refused by both
//   RR-05  unreadable / unavailable registry and target ambiguity are non-definitive at the post-commit check on BOTH
//          writers (review stays pending, never flagged); a defect appearing in an unrelated record after the commit still
//          clears; the target's removal is definitive (flagged)
//   RR-06  financial + page path: with unrelated defects the real P1 list → page credit session → bound source → C1 views carry
//          the valid supplier credits (purchases net, complete, VD-50 valued) and equal both the clean-registry views and the
//          server canonical report; with an ambiguous target every consumer is unavailable together (no figures)
//   RR-07  browser ≡ server: the page's registry rule (C1 historyBinding) and the server predicate agree on a 300+ case corpus
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { compileServer, offlineFetch } from "../support/server-reader-harness.mjs";
import { asLegacy, entry, uid, stableJson } from "../support/b1-fixtures.mjs";
import { apiHarness, memoryDb, seed as p1Seed, env, createBody, cid, oid } from "../support/p1-r3-api-harness.mjs";
import { loadFinance, loadSeam, srcOf, present, ledgerOf } from "../support/c1-seam.mjs";
import { classifyRegistryTarget, readRegistryTarget, isRegistryBizId, decodeRegistryNode } from "../../lib/businessRegistry.js";

offlineFetch();
const W = await loadWriter(REPO);
const SRV = compileServer();
const CI = await SRV.import("src/finance-server/canonicalInputs.js"), CM = await SRV.import("src/finance-server/canonicalMetrics.js");
const F = await loadFinance();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const P1 = (() => { const i = HTML.indexOf("// ── P1 supplier credits browser seam"); const win = {}; vm.runInNewContext(HTML.slice(i, HTML.indexOf("</script>", i)), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController }); return win.MarjinP1; })();

const T = "tenantA", B = "bizA";
const REG = `tenants/${T}/app/business`;
const HISTORY = (b = B) => `tenants/${T}/biz:${b}:cost_history`, CREDITS = (b = B) => `tenants/${T}/biz:${b}:supplier_credits`;
const NOW = Date.parse("2026-10-02T09:00:00Z");
const req = { headers: {} };
const V = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = NOW;
const as = (u) => { globalThis.__CLAIMS = u ? { uid: u, email: u + "@example.test" } : null; };
const writer = (db) => W.createCostHistoryWriter({ db, clock: () => (tick += 1000) });
const ACT = { globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "9300" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } };
const activation = (bizId, n = "a0") => ({ tenantId: T, bizId, body: { versionId: V(n), expectedHead: null, effectiveFrom: "2026-10-02", basis: "recorded", ...ACT } });

/** The supported runtime defect corpus for an UNRELATED record (the target bizA itself is valid and unique). */
const UNRELATED = {
  writer_shape: [{ id: B, name: "A" }, { id: "bizB", name: "B" }],
  malformed_sibling: [{ id: B }, { name: "broken" }],                          // review reproducer
  duplicate_sibling: [{ id: B }, { id: "bizB" }, { id: "bizB" }],              // review reproducer
  unsafe_sibling: [{ id: B }, { id: "biz:C" }],                                // review reproducer
  numeric_sibling: [{ id: B }, { id: 7 }],
  null_id_sibling: [{ id: null }, { id: B }],
  forbidden_char_sibling: [{ id: B }, { id: "a/b" }, { id: "x.y" }],
  empty_and_long_sibling: [{ id: "" }, { id: "z".repeat(300) }, { id: B }],
  non_record_elements: [null, 5, "bizB", [], true, { id: B }],
  mixed_everything: [{ name: "x" }, { id: "bizB" }, { id: "bizB" }, { id: "biz:C" }, { id: 7 }, null, { id: B, name: "A" }],
};
/** Ambiguity or corruption of the REQUESTED business (target id → registry). */
const AMBIGUOUS = {
  duplicate_target: [B, [{ id: B }, { id: B }]],
  duplicate_target_with_names: [B, [{ id: B, name: "A" }, { id: B, name: "A2" }]],
  whitespace_variant: [B, [{ id: B }, { id: " " + B }]],
  bare_string_target: [B, [B]],
  bare_string_beside_record: [B, [{ id: B }, B]],
  numeric_target: ["7", [{ id: 7 }]],                                          // review P2 reproducer
  numeric_beside_canonical: ["7", [{ id: "7" }, { id: 7 }]],
  null_target: ["null", [{ id: null }]],                                       // review P2 reproducer
  missing_id_target: ["undefined", [{ name: "broken" }]],                      // review P2 reproducer
  boolean_target: ["true", [{ id: true }]],
};
const UNREADABLE = {
  invalid_json: { _v: "not json" }, not_array: { _v: "{\"id\":\"bizA\"}" }, absent: null, non_runtime_plain_array: [{ id: B }],
  non_runtime_plain_string: JSON.stringify([{ id: B }]), envelope_without_v: { v: "[]" }, numeric_envelope: { _v: 5 },
};

test("RR-01 pure classification: unrelated defects are ignored; target ambiguity, uninterpretable registry and bad requests are distinguished", () => {
  for (const [label, list] of Object.entries(UNRELATED)) {
    const c = classifyRegistryTarget(env(list), B);
    assert.equal(c.state, "registered", label);
    assert.equal(c.unrelatedDefects > 0, label !== "writer_shape", label + ": unrelated defects counted (diagnostic only)");
  }
  for (const [label, [id, list]] of Object.entries(AMBIGUOUS)) assert.equal(classifyRegistryTarget(env(list), id).state, "ambiguous", label);
  assert.equal(classifyRegistryTarget(env([{ id: B }, { id: B }]), B).reason, "duplicate_target");
  assert.equal(classifyRegistryTarget(env([{ id: 7 }]), "7").reason, "noncanonical_target_identity");
  for (const [label, raw] of Object.entries(UNREADABLE)) assert.equal(classifyRegistryTarget(raw, B).state, "unreadable", label);
  for (const list of [[], [{ id: "bizB" }], [{ id: null }, { id: "bizB" }], [{ id: "biza" }], [{ id: "bizA2" }]]) assert.equal(classifyRegistryTarget(env(list), B).state, "not_registered", JSON.stringify(list));
  for (const bad of ["", "a:b", "a/b", "x".repeat(129), 7, null, undefined]) {
    assert.equal(isRegistryBizId(bad), false, String(bad));
    assert.equal(classifyRegistryTarget(env([{ id: bad }]), bad).state, "invalid_request");
  }
  assert.deepEqual(decodeRegistryNode(env([{ id: B }])), { ok: true, list: [{ id: B }] });
});

/** Both consumers for one registry value, on ONE fresh database; returns the observed availability of each. */
async function consumers(registry, bizId, { actor = "own", prep } = {}) {
  const s = p1Seed();
  if (registry === undefined) delete s.tenants.tenantA.app.business; else s.tenants.tenantA.app.business = registry;
  s.tenants.tenantA[`biz:${bizId}:suppliers`] = env([{ id: "s1" }]);
  s.tenants.tenantA.biz_access[bizId] = { ...(s.tenants.tenantA.biz_access[bizId] || {}), mgr: true };
  const db = memoryDb(s); globalThis.__DB = db;
  if (prep) prep(db);
  const h = await apiHarness(db);
  const before = db.value();
  as(actor); const coreRead = (await writer(db).readCostHistory(req, { tenantId: T, bizId })).status;
  as("own"); const coreAct = await writer(db).activateCostHistory(req, activation(bizId));
  const list = await h.call("list-supplier-credits", { tenantId: T, bizId }, actor, "GET");
  const create = await h.call("create-supplier-credit", createBody(1, { bizId }), actor);
  return { db, before, coreRead, coreAct: coreAct.status, coreReview: coreAct.review, list: [list.code, list.body && list.body.error], create: [create.code, create.body && (create.body.error || create.body.review)] };
}
const CLASS = {
  registered: (o) => ["absent", "present"].includes(o.coreRead) && o.coreAct === "committed_current" && o.list[0] === 200 && o.create[0] === 200,
  not_registered: (o) => o.coreRead === "business_not_in_tenant" && o.coreAct === "business_not_in_tenant" && o.list[0] === 403 && o.create[0] === 403 && o.list[1] === "business_not_in_tenant",
  ambiguous: (o) => o.coreRead === "authorization_unavailable" && o.coreAct === "authorization_unavailable" && o.list[0] === 503 && o.create[0] === 503 && o.list[1] === "business_registry_ambiguous",
  unreadable: (o) => o.coreRead === "authorization_unavailable" && o.coreAct === "authorization_unavailable" && o.list[0] === 503 && o.create[0] === 503 && o.list[1] === "business_registry_unreadable",
  unavailable: (o) => o.coreRead === "authorization_unavailable" && o.coreAct === "authorization_unavailable" && o.list[0] === 503 && o.list[1] === "business_registry_unavailable",
};

test("RR-02 the review's reproducers and the full case table: the real Core writer and the real P1 API agree on every case; denials write nothing", async () => {
  const rows = [];
  for (const [label, list] of Object.entries(UNRELATED)) rows.push([label, env(list), B, "registered"]);
  for (const [label, [id, list]] of Object.entries(AMBIGUOUS)) rows.push([label, env(list), id, "ambiguous"]);
  for (const [label, raw] of Object.entries(UNREADABLE)) rows.push([label, raw, B, "unreadable"]);
  rows.push(["absent_target", env([{ id: "bizB" }]), B, "not_registered"], ["malformed_unrelated_absent_target", env([{ id: null }, { id: "bizB" }]), B, "not_registered"], ["empty_registry", env([]), B, "not_registered"]);
  for (const [label, raw, id, want] of rows) for (const actor of ["own", "mgr"]) {
    const o = await consumers(raw, id, { actor });
    assert.ok(CLASS[want](o), `${label} (${actor}) expected ${want}: ${JSON.stringify({ ...o, db: undefined, before: undefined })}`);
    if (want !== "registered") assert.deepEqual(o.db.value(), o.before, `${label}: a denial writes nothing`);
    else { assert.ok(o.db.read(HISTORY(id)) && o.db.read(CREDITS(id)), label + ": both writers committed for the valid target"); assert.equal(o.create[1], "cleared", label + ": the P1 post-commit check clears"); assert.equal(o.coreReview, "cleared"); }
  }
  // read failure of the registry (transport): both 503, non-definitive
  const o = await consumers(env([{ id: B }]), B, { prep: (db) => { db.beforeGet = (p) => { if (p.endsWith("/app/business")) throw new Error("down"); }; } });
  assert.ok(CLASS.unavailable(o), JSON.stringify({ ...o, db: undefined, before: undefined }));
});

test("RR-03 stale biz_access never substitutes for registration: an unregistered target is refused by both, also beside unrelated defects and when ANOTHER tenant lists it", async () => {
  for (const reg of [env([{ id: B }]), env([{ id: B }, { name: "broken" }, { id: "bizB" }, { id: "bizB" }])]) {
    for (const actor of ["mgr", "own"]) {
      const o = await consumers(reg, "ghost", { actor, prep: (db) => { db.put(`tenants/tenantB/app/business`, env([{ id: "ghost" }])); db.put(`tenants/${T}/biz:ghost:cost_history`, null); } });
      assert.ok(CLASS.not_registered(o), actor + " " + JSON.stringify({ ...o, db: undefined, before: undefined }));
      assert.equal(o.db.read(`tenants/${T}/biz_access/ghost/mgr`), true, "the stale biz_access row is present (and authorizes nothing)");
      assert.deepEqual(o.db.value(), o.before);
    }
  }
});

test("RR-04 isolation and supported access with unrelated defects: owner (no biz_access) and manager (with) are served; no-access manager, foreign owner and anonymous are refused by both", async () => {
  const reg = env(UNRELATED.mixed_everything);
  for (const actor of ["own", "mgr"]) {
    const o = await consumers(reg, B, { actor, prep: (db) => db.put(`tenants/${T}/biz_access/${B}/own`, null) });
    assert.ok(CLASS.registered(o), actor + " " + JSON.stringify({ ...o, db: undefined, before: undefined }));
    assert.equal(o.db.read(`tenants/${T}/biz_access/${B}/own`), null, "the owner holds no biz_access row");
  }
  // a manager without access to the (registered) target business: both refuse with 403
  { const s = p1Seed(); s.tenants.tenantA.app.business = reg; const db = memoryDb(s); globalThis.__DB = db; const h = await apiHarness(db); db.put(`tenants/${T}/biz_access/${B}/mgr`, null);
    const before = db.value();
    as("mgr"); assert.equal((await writer(db).readCostHistory(req, { tenantId: T, bizId: B })).status, "unauthorized");
    assert.equal((await h.call("list-supplier-credits", { tenantId: T, bizId: B }, "mgr", "GET")).code, 403);
    assert.equal((await h.call("create-supplier-credit", createBody(1), "mgr")).code, 403);
    for (const actor of ["foreign", null]) {
      as(actor); assert.ok(["unauthorized", "unauthenticated"].includes((await writer(db).readCostHistory(req, { tenantId: T, bizId: B })).status), String(actor));
      assert.ok([401, 403].includes((await h.call("list-supplier-credits", { tenantId: T, bizId: B }, actor, "GET")).code));
      assert.ok([401, 403].includes((await h.call("create-supplier-credit", createBody(2), actor)).code));
    }
    assert.deepEqual(db.value(), before); }
  // per-business isolation under unrelated defects: bizB's nodes are never touched by bizA's writes
  const o = await consumers(reg, B);
  assert.equal(o.db.read(CREDITS("bizB")), null); assert.equal(o.db.read(HISTORY("bizB")), null);
});

test("RR-05 the post-commit check: target ambiguity, an uninterpretable registry or a failed read leave BOTH reviews pending; an unrelated defect still clears; the target's removal flags", async () => {
  const cases = [
    ["target becomes duplicated", (db) => db.put(REG, env([{ id: B }, { id: B }])), "pending"],
    ["registry becomes invalid JSON", (db) => db.put(REG, { _v: "not json" }), "pending"],
    ["registry read fails", (db) => { db.beforeGet = (p) => { if (p.endsWith("/app/business")) throw new Error("down"); }; }, "pending"],
    ["an unrelated record becomes malformed / duplicated", (db) => db.put(REG, env([{ id: B }, { name: "x" }, { id: "bizB" }, { id: "bizB" }])), "cleared"],
    // definitive loss: P1 persists the flag; Core detects it definitively but (approved Core/F1 R4 RL4 behavior) cannot persist
    // the flag audit once the business is gone, so its review stays pending with flag_unconfirmed — unchanged by R1
    ["the target is removed", (db) => db.put(REG, env([{ id: "bizB" }])), "flagged"],
  ];
  for (const [label, change, want] of cases) {
    // Core: the activation's post-commit authorization runs after the history transaction
    { const s = p1Seed(); const db = memoryDb(s); globalThis.__DB = db; let fired = false;
      db.afterTransaction = (p) => { if (!fired && p === HISTORY()) { fired = true; change(db); } };
      as("own"); const r = await writer(db).activateCostHistory(req, activation(B));
      db.beforeGet = null;
      assert.equal(r.status, "committed_current", label + " core " + JSON.stringify(r));
      if (want === "flagged") { assert.equal(r.reviewResolution, "business_not_in_tenant", "Core: a definitive post-commit loss"); assert.equal(r.audit, "flag_unconfirmed"); assert.equal(db.read(HISTORY()).review[V("a0")].state, "pending"); }
      else { assert.equal(db.read(HISTORY()).review[V("a0")].state, want, `${label}: Core review ${want} ${JSON.stringify(r)}`); if (want === "pending") assert.notEqual(r.reviewResolution, "business_not_in_tenant", "non-definitive"); } }
    // P1: the create's post-commit re-check runs after the credit transaction
    { const s = p1Seed(); const db = memoryDb(s); const h = await apiHarness(db); let fired = false;
      db.afterTransaction = (p) => { if (!fired && p === CREDITS()) { fired = true; change(db); } };
      const r = await h.call("create-supplier-credit", createBody(1), "mgr");
      db.beforeGet = null;
      assert.equal(r.code, 200, label + " p1 " + JSON.stringify(r.body));
      assert.equal(db.read(CREDITS()).review[oid(1)].state, want, `${label}: P1 review ${want}`); }
  }
});

// ── RR-06: the financial + page path ────────────────────────────────────────────────────────────────────────────────────
const CLOSED = "2026-09-08";
const days = (from, to) => { const out = []; for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const ROWS = days("2026-09-01", "2026-10-02").filter((d) => d !== CLOSED).map((d, i) => entry(uid(i + 1), d, { sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" }));
const CREDIT_SET = [["2026-09-08", "40"], ["2026-09-15", "120"], ["2026-09-30", "10"], ["2026-10-01", "50"]];
async function financialWorld(registryList) {
  const s = p1Seed();
  s.tenants.tenantA.app.business = env([{ id: B }, { id: "bizB" }]);           // the writers run on a clean registry …
  s.tenants.tenantA[`biz:${B}:entries`] = asLegacy(ROWS); s.tenants.tenantA[`biz:${B}:config`] = env({ employees: [] }); s.tenants.tenantA[`biz:${B}:fixed`] = env([]);
  s.tenants.tenantA.entry_exceptions = { [B]: { [CLOSED]: { state: { status: "active", reasonCode: "closure" } } } };
  const db = memoryDb(s); globalThis.__DB = db; const h = await apiHarness(db);
  tick = NOW; as("own");
  assert.equal((await writer(db).activateCostHistory(req, activation(B))).status, "committed_current");
  const body = { versionId: V("a1"), expectedHead: db.read(HISTORY()).head, effectiveFrom: "2026-09-01", basis: "attested_retroactive", attestationReason: "supplier invoices", ...ACT };
  body.attestation = { confirmed: true, typedEffectiveFrom: body.effectiveFrom, confirmedSnapshotDigest: W.attestationDigest(body) };
  assert.equal((await writer(db).attestHistoricalCostEdit(req, { tenantId: T, bizId: B, body })).status, "committed_current");
  for (const [k, [issueDate, amount]] of CREDIT_SET.entries())
    assert.equal((await h.call("create-supplier-credit", { tenantId: T, bizId: B, creditId: cid(k + 1), operationId: oid(k + 1), supplierId: "s1", issueDate, amount, documentNumber: "CR-" + (k + 1) }, "mgr")).code, 200);
  db.put(REG, env(registryList));                                               // … then the registry takes the case's shape
  return { db, h };
}
/** The page path over the real API: list → credit session → bound source; history bound through the page's own registry rule. */
async function pageViews({ db, h }, registryList, month = "2026-09") {
  const api = await h.call("list-supplier-credits", { tenantId: T, bizId: B }, "own", "GET");
  const key = `${T}|${B}|1|0`, session = P1.createCreditsSession({ deadlineMs: 1000 });
  const held = await session.request(key, async () => { if (api.code !== 200) throw new Error("http_error"); return api.body; }, () => true);
  const credits = P1.sourceFor(F, held, key, { tenantId: T, bizId: B });
  const sel = { tenantId: T, bizId: B, gen: 1 };
  const bind = C1.historyBinding({ tenantId: T, bizId: B, gen: 1 }, sel, B, registryList);
  const costHistory = bind.ok ? F.costHistory.codec.decodeHistory({ exists: true, value: db.read(HISTORY()) }, bind.bind) : { state: "unreadable", reason: bind.reason };
  as("own"); const coreRead = (await writer(db).readCostHistory(req, { tenantId: T, bizId: B })).status;
  const states = Object.fromEntries(Object.entries(db.read(`tenants/${T}/entry_exceptions/${B}`)).map(([d, v]) => [d, { ...v.state, revision: 1 }]));
  const src = { ...srcOf({ rows: ROWS, asOf: "2026-10-05", config: present({ employees: [] }), fixed: present([]), ledger: ledgerOf(states, "2026-01-01", "2026-12-31") }), costHistory, credits };
  return { api: api.code, held: held.state, credits: credits.state, binding: bind.ok ? "bound" : bind.reason, coreRead, report: clone(C1.monthReport(F, src, month)), sup: clone(C1.suppliers(F, src, month, [{ id: "s1", name: "S" }])), tab: P1.monthView(F, credits, month, [{ id: "s1", name: "S" }]) };
}
test("RR-06 financial + page: unrelated defects leave the valid target's supplier credits in every figure (≡ clean registry ≡ server); an ambiguous target is unavailable everywhere together", async () => {
  const clean = await pageViews(await financialWorld(UNRELATED.writer_shape), UNRELATED.writer_shape);
  assert.equal(clean.report.status, "ready", JSON.stringify(clean.report).slice(0, 300));
  const a = clean.report.report.actual;
  assert.equal(a.purchases.credits.value, "170"); assert.equal(a.purchases.complete, true); assert.equal(a.grossProfitBeforeFixed.state, "complete"); assert.match(a.grossProfitBeforeFixed.value, /^-?\d/);
  for (const label of ["malformed_sibling", "duplicate_sibling", "unsafe_sibling", "numeric_sibling", "mixed_everything"]) {
    const w = await financialWorld(UNRELATED[label]);
    const v = await pageViews(w, UNRELATED[label]);
    assert.equal(v.api, 200, label + ": the P1 list serves the valid target"); assert.equal(v.held, "ready"); assert.equal(v.credits, "present");
    assert.equal(v.binding, "bound", label + ": the page's registry rule binds the cost history"); assert.equal(v.coreRead, "present", label + ": the Core route serves it");
    assert.equal(v.report.status, "ready", label);
    assert.equal(F.metrics.report.serializeReport(v.report.report), F.metrics.report.serializeReport(clean.report.report), label + ": figures identical to the clean registry (credits included, complete, VD-50 valued)");
    assert.equal(v.tab.status, "ready"); assert.equal(v.tab.total, "170");
    assert.equal(v.sup.status, "ready");
    // ≡ the server canonical report over the same stored nodes
    const si = await CI.loadCanonicalInputs(w.db, T, B, { site: "m1r1", nowMs: Date.parse("2026-10-05T09:00:00Z"), need: { config: true, fixed: true, exceptions: true, costHistory: true } });
    const server = CM.canonicalMonthReport(si, { kind: "closed_month", month: "2026-09" }).report;
    assert.equal(F.metrics.report.serializeReport(v.sup.report), F.metrics.report.serializeReport(server), label + ": browser ≡ server");
  }
  for (const label of ["duplicate_target", "whitespace_variant", "bare_string_beside_record"]) {
    const list = AMBIGUOUS[label][1];
    const v = await pageViews(await financialWorld(list), list);
    assert.equal(v.api, 503); assert.equal(v.credits, "not_loaded"); assert.equal(v.binding, "business_unregistered"); assert.equal(v.coreRead, "authorization_unavailable");
    assert.notEqual(v.report.status, "ready", label + ": no figures over an ambiguous business"); assert.equal(v.tab.status, "unavailable");
  }
});

test("RR-07 browser ≡ server: the page's registry rule (C1 historyBinding) and lib/businessRegistry.js agree on every corpus case", () => {
  const ids = [B, "bizB", "7", "null", "undefined", "true", " bizA", "a:b", "", "x".repeat(129), "קפה"];
  const elements = [{ id: B }, { id: "bizB" }, { id: 7 }, { id: "7" }, { id: null }, { name: "n" }, { id: true }, { id: " bizA" }, { id: "biz:C" }, { id: "קפה" }, B, 7, null, [], "bizB", { id: "a:b" }];
  let n = 0;
  for (const id of ids) for (let i = 0; i < elements.length; i++) for (let j = i; j < elements.length; j++) for (const list of [[elements[i]], [elements[i], elements[j]], [elements[j], elements[i], { id: B }]]) {
    const server = classifyRegistryTarget(env(list), id).state === "registered";
    const b = C1.historyBinding({ tenantId: T, bizId: id, gen: 1 }, { tenantId: T, bizId: id, gen: 1 }, id, list);
    const page = b.ok || (b.reason !== "business_unregistered" && b.reason !== "context_unbound");
    if (id === "") assert.equal(b.reason, "context_unbound"); else assert.equal(page, server, `${JSON.stringify(id)} in ${JSON.stringify(list)}: page ${JSON.stringify(b)} vs server ${server}`);
    n++;
  }
  assert.ok(n > 300, String(n));
});
