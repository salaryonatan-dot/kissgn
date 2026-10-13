// Agent/Daily integration I7 — parity with the I6 commit (git objects) OUTSIDE the corrected classes (T-I7-ADMINLOCAL /
// T-I7-AUTH-ALIGN; P0 / admin-API, M1 identity, user-access owners). The REAL api/admin.js of this checkout and of I6 (224a00a6) run over
// the same reference-recording database (test/support/i4-boundary-harness.mjs), clock / randomness frozen.
//   PA-01  every handler × the EX-06 tenant / business / scope / actor corpora: identical status, body, Auth calls, e-mails, limiter and
//          final state; references identical as a multiset except the ONE registry read I7 adds to an Admin-local business-data
//          authorization that reaches the business (registered)
//   PA-02  the corrected classes, stated explicitly: an Admin-local request for a business the registry does not register (stale grant,
//          implicit owner scope over an absent / ambiguous / unregistered business) — I6 served it, I7 refuses with the approved mapping
//          and nothing written
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { adminHarness, observe, seed, closeSdk, clone, env } from "../support/i4-boundary-harness.mjs";
import { I7_PARENT } from "../support/i7-integration.mjs";

let HEAD = null, I6 = null;
const head = async () => (HEAD ??= await adminHarness());
const i6 = async () => (I6 ??= await adminHarness({ source: I7_PARENT }));   // the I6 commit's bytes
after(async () => { await closeSdk(); });
const show = (s) => JSON.stringify(s);
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)])) : typeof v === "string" && ISO.test(v) ? "<iso>" : v);
async function frozen(fn) {
  const now = Date.now, rnd = Math.random, uuid = crypto.randomUUID;
  Date.now = () => 1760000000000; Math.random = () => 0.4242; crypto.randomUUID = () => "00000000-0000-4000-8000-000000000042"; syncBuiltinESMExports();
  try { return await fn(); } finally { Date.now = now; Math.random = rnd; crypto.randomUUID = uuid; syncBuiltinESMExports(); }
}
const ADMIN_LOCAL = new Set(["list-entry-exceptions", "set-entry-exception", "clear-entry-exception", "get-checklist-template-items", "set-checklist-template-items", "get-checklist-run", "set-checklist-run",
  "get-checklist-simple-run", "set-checklist-simple-run", "get-analytics-daily", "get-insights-daily"]);
let compared = 0, registryReads = 0;
async function parity(action, body, actor, method = "POST", st = seed()) {
  const one = async (h) => { h.reset(clone(st)); const res = await frozen(() => h.call(action, clone(body), actor, method)); return scrub(observe(h, res)); };
  const [a, b] = [await one(await head()), await one(await i6())];
  const t = body && typeof body === "object" ? body.tenantId : null, reg = `tenants/${t}/app/business`;
  const aRefs = [...a.refs];
  if (ADMIN_LOCAL.has(action) && aRefs.filter((p) => p === reg).length === b.refs.filter((p) => p === reg).length + 1) { aRefs.splice(aRefs.indexOf(reg), 1); registryReads++; }
  assert.deepEqual([...aRefs].sort(), [...b.refs].sort(), `${action} ${show(body)} as ${actor}: same references (as a multiset)`);
  delete a.refs; delete b.refs;
  assert.deepEqual(a, b, `${action} ${show(body)} as ${actor}: identical to I6`);
  compared++;
}
const FROM = "2026-10-01", TO = "2026-10-02";
const TOKEN = "0".repeat(64);
const OP = "11111111-1111-4111-8111-000000000001";
const BODIES = {
  "list-entry-exceptions": (t, b) => [{ tenantId: t, bizId: b, fromDate: FROM, toDate: TO }, "GET"],
  "set-entry-exception": (t, b) => [{ tenantId: t, bizId: b, businessDate: TO, reasonCode: "holiday", reasonText: "x", expectedRevision: 0, operationId: OP }, "POST"],
  "clear-entry-exception": (t, b) => [{ tenantId: t, bizId: b, businessDate: TO, expectedRevision: 1, operationId: OP }, "POST"],
  "get-checklist-template-items": (t, b) => [{ tenantId: t, bizId: b, templateId: "t1" }, "GET"],
  "set-checklist-template-items": (t, b) => [{ tenantId: t, bizId: b, templateId: "t1", doc: { a: 1 }, expectedVersionToken: TOKEN }, "POST"],
  "get-checklist-run": (t, b) => [{ tenantId: t, bizId: b, businessDate: FROM }, "GET"],
  "set-checklist-run": (t, b) => [{ tenantId: t, bizId: b, businessDate: FROM, doc: { a: 1 }, expectedVersionToken: TOKEN }, "POST"],
  "get-checklist-simple-run": (t, b) => [{ tenantId: t, bizId: b, businessDate: FROM, templateId: "t1" }, "GET"],
  "set-checklist-simple-run": (t, b) => [{ tenantId: t, bizId: b, businessDate: FROM, templateId: "t1", doc: { a: 1 }, expectedVersionToken: TOKEN }, "POST"],
  "get-analytics-daily": (t, b) => [{ tenantId: t, bizId: b, fromDate: FROM, toDate: TO }, "GET"],
  "get-insights-daily": (t, b) => [{ tenantId: t, bizId: b, fromDate: FROM, toDate: TO }, "GET"],
};
// tenants for which every business the corpus asks for is either registered (tenantA bizA / bizB, t:1 bizA) or refused before the
// registry question (non-member, foreign, invalid) — outside the corrected class
const TENANTS = ["tenantA", "t:1", "tenantB", "missing", "tenantA ", " tenantA", "סניף", "tenant\u0080A", "", null, undefined, "tenant.A", "x".repeat(129), 12, ["tenantA"], { a: 1 }];
const BIZ_FOR_GRANTED = ["bizA", "bizB", " bizA", "bizA ", "ביז", "biz\u0080", "biz.A", "x".repeat(129), "foreignBiz", "biz:A", "", null, 7];

test("PA-01 parity with I6 outside the corrected classes: every Admin-local action and every other handler, the EX-06 corpora and actors", async () => {
  for (const action of Object.keys(BODIES)) {
    for (const t of TENANTS) { const [b, m] = BODIES[action](t, "bizA"); await parity(action, b, "own", m); }                       // implicit scope: registered or refused earlier
    for (const biz of BIZ_FOR_GRANTED) for (const actor of ["mgr", "view"]) { const [b, m] = BODIES[action]("tenantA", biz); await parity(action, b, actor, m); }   // granted only bizA (registered)
    for (const actor of ["super", "own", "mgr", "view", "foreign", "sub1", null]) { const [b, m] = BODIES[action]("tenantA", "bizA"); await parity(action, b, actor, m); }
  }
  for (const t of TENANTS) {
    await parity("update-user", { tenantId: t, firebaseUid: "sub1", name: "Renamed" }, "own");
    await parity("update-user", { tenantId: t, firebaseUid: "sub1", email: "new@example.test", allowedBizIds: ["bizA"] }, "own");
    await parity("roles", { tenantId: t, targetUid: "sub1", role: "manager", allowedBizIds: ["bizA"] }, "own");
    await parity("create-user", { tenantId: t, email: "n@example.test", username: "nn", role: "viewer", allowedBizIds: ["bizA"] }, "own");
    await parity("delete-user", { tenantId: t, firebaseUid: "sub1", username: "sub1" }, "own");
    await parity("list-supplier-credits", { tenantId: t, bizId: "bizA" }, "own", "GET");
    await parity("bootstrap-self", { tenantId: t }, "newbie");
  }
  for (const actor of ["super", "own", "mgr", "view", "foreign", null]) {
    await parity("edit-client", { tenantId: "tenantA", bizName: "N" }, actor);
    await parity("delete-client", { tenantId: "tenantA" }, actor);
    await parity("resend-invite", { tenantId: "tenantA" }, actor);
    await parity("update-user", { tenantId: "tenantA", firebaseUid: "sub1", email: "new@example.test" }, actor);
  }
  assert.ok(compared > 600 && registryReads > 50, `non-vacuous: ${compared} comparisons, ${registryReads} with the one added registry read`);
});

test("PA-02 the corrected class: I6 served an Admin-local request for a business the registry does not register; I7 refuses it with the approved mapping and nothing written", async () => {
  const states = [
    ["absent", (s) => { delete s.tenants.tenantA.app.business; }, [503, "business_registry_unreadable"]],
    ["ambiguous twin", (s) => { s.tenants.tenantA.app.business = env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]); }, [503, "business_registry_ambiguous"]],
    ["stale grant (unregistered)", (s) => { s.tenants.tenantA.app.business = env([{ id: "bizB" }]); }, [403, "business_not_in_tenant"]],
  ];
  for (const [label, mutate, [status, error]] of states) for (const action of Object.keys(BODIES)) for (const actor of ["own", "mgr"]) {
    const st = seed(); mutate(st); st.tenants.tenantA["biz:bizA:checklist_template_items:t1"] = env({ secret: 1 });
    const [body, m] = BODIES[action]("tenantA", "bizA");
    const h7 = await head(), h6 = await i6();
    h6.reset(clone(st)); const b = observe(h6, await h6.call(action, clone(body), actor, m));
    h7.reset(clone(st)); const a = observe(h7, await h7.call(action, clone(body), actor, m));
    assert.ok(b.refs.some((r) => r.includes("biz:bizA:") || r.includes("entry_exceptions") || r === "tenants/tenantA"), `I6 reached the business data (${label}, ${action}, ${actor})`);
    assert.deepEqual([a.status, a.body], [status, { error }], `I7 refuses (${label}, ${action}, ${actor})`);
    assert.deepEqual(a.state, st, `I7: nothing written (${label}, ${action}, ${actor})`);
  }
});
