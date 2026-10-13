// Agent/Daily integration I7 — Admin-local business-data paths bound to the authoritative registry (independent I6 review I6-R-02 /
// R6-5; T-I7-ADMINLOCAL, PROPOSED for the P0 / admin-API and M1 identity owners). The REAL api/admin.js handlers of this checkout run
// over the reference-recording database of test/support/i4-boundary-harness.mjs (every reference passes through the real Admin SDK
// path constructor). Nothing hosted is contacted.
//   AL-01  registered business: every action (entry exceptions list / set / clear; checklist template / run / simple-run get / set;
//          analytics / insights daily) is served exactly as before, after ONE registry read that follows the biz_access decision
//   AL-02  absent / bare-array / bare-string / malformed-JSON / non-array registry → 503 business_registry_unreadable; plain/padded
//          twin (both orders), duplicate and coerced twin → 503 business_registry_ambiguous; business not in the registry → 403
//          business_not_in_tenant; registry read failure → 503 business_registry_unavailable — for owner (implicit scope), manager
//          and viewer (granted), reads AND writes: refused before ANY business-data reference, nothing written
//   AL-03  a stale grant (biz_access to a business the registry does not hold) is refused; the plain id never reaches a padded record
//   AL-04  precedence is unchanged: unauthenticated 401, invalid business id 400, other tenant / no grant 403 — all BEFORE the registry
//          is read; the version fence (423) still applies to a registered business
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { adminHarness, observe, seed, closeSdk, clone, env } from "../support/i4-boundary-harness.mjs";
import { checklistVersionToken } from "../../lib/checklistVersion.js";

let H = null;
const head = async () => (H ??= await withQueries(await adminHarness()));
after(async () => { await closeSdk(); });
const show = (v) => JSON.stringify(v);
const REG = "tenants/tenantA/app/business";
const FROM = "2026-10-01", TO = "2026-10-02";

/** The recording database has no ordered queries; add the one shape the two range readers use (orderByKey().startAt().endAt().once()). */
async function withQueries(h) {
  const base = h.db.ref;
  h.db.ref = (p) => {
    const r = base(p);
    r.orderByKey = () => ({ startAt: (a) => ({ endAt: (b) => ({ once: async () => {
      const v = h.db.read(p) || {};
      const out = Object.fromEntries(Object.entries(v).filter(([k]) => k >= a && k <= b));
      return { val: () => clone(out), exists: () => Object.keys(out).length > 0 };
    } }) }) });
    return r;
  };
  return h;
}

const DOC = { fixtureSecret: "business-data" };
function withData(s, biz = "bizA") {
  const t = s.tenants.tenantA;
  t[`biz:${biz}:checklist_template_items:t1`] = env(DOC);
  t[`biz:${biz}:checklist_runs:${FROM}`] = env(DOC);
  t[`biz:${biz}:checklist_simple_runs:${FROM}:t1`] = env(DOC);
  t[`biz:${biz}:analytics:daily:${FROM}`] = env({ revenue: { total: 1 } });
  t[`biz:${biz}:insights:daily:${FROM}`] = env({ items: [] });
  // a ledger node exactly as set-entry-exception writes it (state at revision 1; the operations ledger is not needed to clear it)
  t.entry_exceptions = { [biz]: { [FROM]: { state: { schemaVersion: 1, tenantId: "tenantA", bizId: biz, businessDate: FROM, reasonCode: "holiday", category: "special_event",
    effects: { excludeFromForecastBaseline: true, excludeFromInsightComparison: true }, status: "active", source: "manual", createdBy: "own", createdAt: 1, updatedBy: "own", updatedAt: 1, revision: 1, reasonText: "x" } } } };
  return s;
}
const TOKEN = checklistVersionToken(DOC);
const OP = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
// [action, method, body(biz), minimum actor that may perform it, data-path fragment the action must reach]
const ACTIONS = [
  ["list-entry-exceptions", "GET", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "read", "entry_exceptions"],
  ["set-entry-exception", "POST", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: TO, reasonCode: "holiday", reasonText: "x", expectedRevision: 0, operationId: OP(1) }), "manager", "entry_exceptions"],
  ["clear-entry-exception", "POST", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: FROM, expectedRevision: 1, operationId: OP(2) }), "manager", "entry_exceptions"],
  ["get-checklist-template-items", "GET", (b) => ({ tenantId: "tenantA", bizId: b, templateId: "t1" }), "read", "checklist_template_items"],
  ["set-checklist-template-items", "POST", (b) => ({ tenantId: "tenantA", bizId: b, templateId: "t1", doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "manager", "checklist_template_items"],
  ["get-checklist-run", "GET", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: FROM }), "read", "checklist_runs"],
  ["set-checklist-run", "POST", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: FROM, doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "manager", "checklist_runs"],
  ["get-checklist-simple-run", "GET", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: FROM, templateId: "t1" }), "read", "checklist_simple_runs"],
  ["set-checklist-simple-run", "POST", (b) => ({ tenantId: "tenantA", bizId: b, businessDate: FROM, templateId: "t1", doc: { fixtureSecret: "overwritten" }, expectedVersionToken: TOKEN }), "manager", "checklist_simple_runs"],
  ["get-analytics-daily", "GET", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "read", "tenants/tenantA"],
  ["get-insights-daily", "GET", (b) => ({ tenantId: "tenantA", bizId: b, fromDate: FROM, toDate: TO }), "read", "tenants/tenantA"],
];
const actorsFor = (min) => (min === "read" ? ["own", "mgr", "view"] : ["own", "mgr"]);
const isData = (ref, b) => ref.includes(`biz:${b}:`) || ref.includes("entry_exceptions") || ref === "tenants/tenantA" || ref.startsWith("storage_v2_control");
const regRefs = (refs) => refs.filter((r) => r === REG).length;

test("AL-01 registered business: every admin-local action is served, after exactly ONE registry read that follows the biz_access decision", async () => {
  const h = await head();
  for (const [action, method, body, min] of ACTIONS) for (const actor of actorsFor(min)) {
    h.reset(withData(seed()));
    const o = observe(h, await h.call(action, body("bizA"), actor, method));
    assert.equal(o.status, 200, `${action} as ${actor}: ${show(o.body)}`);
    assert.equal(regRefs(o.refs), 1, `${action} as ${actor}: one registry read`);
    const ri = o.refs.indexOf(REG);
    if (actor !== "own") assert.ok(o.refs.indexOf(`tenants/tenantA/biz_access/bizA/${actor}`) < ri, `${action} as ${actor}: the grant is decided before the registry`);
    assert.ok(o.refs.slice(0, ri).every((r) => !isData(r, "bizA")), `${action} as ${actor}: no business data before the registry`);
    assert.ok(o.refs.slice(ri + 1).some((r) => isData(r, "bizA")), `${action} as ${actor}: the business data is reached`);
    if (/^get-checklist/.test(action)) assert.deepEqual(o.body.document, DOC, action);
    if (/^set-checklist/.test(action)) assert.equal(o.body.ok, true, action);
    if (action === "list-entry-exceptions") assert.deepEqual(Object.keys(o.body.exceptions), [FROM], action);
    if (/-(analytics|insights)-daily$/.test(action)) assert.deepEqual(Object.keys(o.body.docs), [FROM], action);
  }
});

const REGISTRIES = [
  ["absent", null, [503, "business_registry_unreadable"]],
  ["bare array", [{ id: "bizA" }, { id: "bizB" }], [503, "business_registry_unreadable"]],
  ["bare JSON string", JSON.stringify([{ id: "bizA" }, { id: "bizB" }]), [503, "business_registry_unreadable"]],
  ["malformed JSON", { _v: "[{\"id\":" }, [503, "business_registry_unreadable"]],
  ["non-array _v", { _v: JSON.stringify({ id: "bizA" }) }, [503, "business_registry_unreadable"]],
  ["twin plain first", env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]), [503, "business_registry_ambiguous"]],
  ["twin padded first", env([{ id: " bizA " }, { id: "bizA" }, { id: "bizB" }]), [503, "business_registry_ambiguous"]],
  ["duplicate", env([{ id: "bizA" }, { id: "bizA" }, { id: "bizB" }]), [503, "business_registry_ambiguous"]],
  ["coerced twin", env([{ id: "bizA" }, "bizA", { id: "bizB" }]), [503, "business_registry_ambiguous"]],
  ["not in the registry (stale grant)", env([{ id: "bizB" }]), [403, "business_not_in_tenant"]],
];
const withReg = (raw) => { const s = withData(seed()); if (raw === null) delete s.tenants.tenantA.app.business; else s.tenants.tenantA.app.business = raw; return s; };

test("AL-02 absent / unreadable / ambiguous / unregistered / unavailable registry: refused before ANY business-data reference, nothing written (owner, manager, viewer; reads and writes)", async () => {
  const h = await head();
  for (const [label, raw, [status, error]] of REGISTRIES) for (const [action, method, body, min] of ACTIONS) for (const actor of actorsFor(min)) {
    const before = withReg(raw); h.reset(before);
    const o = observe(h, await h.call(action, body("bizA"), actor, method));
    assert.deepEqual([o.status, o.body], [status, { error }], `${label}: ${action} as ${actor}`);
    assert.equal(regRefs(o.refs), 1, `${label}: ${action}: one registry read`);
    assert.deepEqual(o.refs.filter((r) => isData(r, "bizA")), [], `${label}: ${action} as ${actor}: no business-data reference`);
    assert.deepEqual(o.state, before, `${label}: ${action} as ${actor}: nothing written`);
  }
  // the registry read itself fails → 503 business_registry_unavailable, nothing reached
  const base = h.db.ref;
  try {
    h.db.ref = (p) => { const r = base(p); if (p === REG) { r.get = async () => { throw new Error("injected registry read failure"); }; r.once = r.get; } return r; };
    for (const [action, method, body] of ACTIONS) {
      const before = withData(seed()); h.reset(before);
      const o = observe(h, await h.call(action, body("bizA"), "mgr", method));
      assert.deepEqual([o.status, o.body], [503, { error: "business_registry_unavailable" }], `read failure: ${action}`);
      assert.deepEqual(o.refs.filter((r) => isData(r, "bizA")), [], `read failure: ${action}: no business-data reference`);
      assert.deepEqual(o.state, before);
    }
  } finally { h.db.ref = base; }
});

test("AL-03 a stale grant to an unregistered business is refused; exact identity — the plain id never reaches a padded record, and vice versa", async () => {
  const h = await head();
  for (const [action, method, body] of ACTIONS) {
    // viewer/manager hold a grant to bizX, which no registry record names
    const s = withData(seed(), "bizX"); s.tenants.tenantA.biz_access.bizX = { mgr: true, view: true }; h.reset(s);
    const o = observe(h, await h.call(action, body("bizX"), "mgr", method));
    assert.deepEqual([o.status, o.body], [403, { error: "business_not_in_tenant" }], `stale grant: ${action}`);
    assert.deepEqual(o.state, s, `stale grant: ${action}: nothing written`);
    // the registry holds only " bizP " (padded): the plain id is not registered; the padded id is (exact identity, never trimmed)
    const p = withData(seed(), " bizP "); p.tenants.tenantA.app.business = env([{ id: " bizP " }]); p.tenants.tenantA.biz_access["bizP"] = { mgr: true }; p.tenants.tenantA.biz_access[" bizP "] = { mgr: true };
    h.reset(p); const plain = observe(h, await h.call(action, body("bizP"), "mgr", method));
    // the runtime rule: a string id equal to the requested one only after trimming is an AMBIGUOUS identity — never served, never aliased
    assert.deepEqual([plain.status, plain.body], [503, { error: "business_registry_ambiguous" }], `plain vs padded: ${action}`);
    assert.deepEqual(plain.state, p, `plain vs padded: ${action}: nothing written`);
    h.reset(p); const padded = observe(h, await h.call(action, body(" bizP "), "mgr", method));
    assert.equal(padded.status, 200, `padded exact: ${action}: ${show(padded.body)}`);
  }
});

test("AL-04 precedence unchanged: 401 / 400 / tenant 403 / grant 403 come BEFORE the registry is read; the version fence still guards a registered business", async () => {
  const h = await head();
  for (const [action, method, body, min] of ACTIONS) {
    const cases = [
      [null, body("bizA"), 401, "unauthorized"],
      ["mgr", body("biz:A"), 400, "invalid tenantId or bizId"],
      ["foreign", body("bizA"), 403, null],
      [min === "read" ? "sub2" : "view", body("bizA"), 403, null],     // not a member / below the minimum role
      ["mgr", body("bizB"), 403, "business_access_denied"],              // a member without the grant to bizB
    ];
    for (const [actor, b, status, error] of cases) {
      const before = withData(seed()); h.reset(before);
      const o = observe(h, await h.call(action, b, actor, method));
      assert.equal(o.status, status, `${action} as ${actor} ${show(b.bizId)}: ${show(o.body)}`);
      if (error) assert.equal(o.body.error, error, `${action} as ${actor}`);
      assert.equal(regRefs(o.refs), 0, `${action} as ${actor} ${show(b.bizId)}: refused before the registry is read`);
      assert.deepEqual(o.state, before);
    }
  }
  // the version fence (P0-DATA-01) still refuses a quiesced, registered business with 423 and no ledger side effect
  for (const action of ["set-entry-exception", "clear-entry-exception"]) {
    const s = withData(seed()); s.storage_v2_control = { tenantA: { bizA: { contractVersion: 1, phase: "recovery_hold", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1 } } };
    h.reset(s);
    const body = ACTIONS.find((a) => a[0] === action)[2]("bizA");
    const o = observe(h, await h.call(action, body, "mgr", "POST"));
    assert.deepEqual([o.status, o.body.error, o.body.phase], [423, "maintenance", "recovery_hold"], action + ": " + show(o.body));
    assert.ok(o.refs.indexOf(REG) < o.refs.indexOf("storage_v2_control/tenantA/bizA"), action + ": registry before the policy read");
    assert.deepEqual(o.state, s, action + ": nothing written");
  }
});
