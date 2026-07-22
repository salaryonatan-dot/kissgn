// Behavioral tests for lib/alertsCore.js (PR #2A). Injects the REAL requireCron
// (firebase-free) plus a controllable requireBizContext and fake repos; proves
// every branch, the role policy, the cron matrix, and that repo/runner/email are
// untouched on denial. No firebase/network.
// Run: node --test test/security/alerts-dispatch.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAlerts } from "../../lib/alertsCore.js";
import { requireCron } from "../../lib/securityContext.js";

function mkRepos() {
  const calls = [];
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return Promise.resolve(ret); };
  return {
    calls,
    runAlertsForBiz: rec("runAlertsForBiz", { fired: 1 }),
    runAlertsForAll: rec("runAlertsForAll", [{ alertsFired: 2, emailSent: true }, { alertsFired: 0, emailSent: false }]),
    getActiveAlerts: rec("getActiveAlerts", [{ severity: "info" }, { severity: "critical" }]),
    dismissAlert: rec("dismissAlert", undefined),
    getThresholds: rec("getThresholds", { foodCostPct: 33 }),
    saveThresholds: rec("saveThresholds", undefined),
  };
}
// Controllable biz-context: allow (record) or deny with a status.
function bizCtx({ deny } = {}) {
  const spy = { calls: 0 };
  const fn = async (_req, opts) => { spy.calls++; spy.opts = opts; if (deny) throw deny; return { uid: "u1", role: "manager", ...opts }; };
  return { fn, spy };
}
function GET(query = {}, headers = {}) { return { method: "GET", headers, query, body: {} }; }
function POST(body = {}, query = {}, headers = {}) { return { method: "POST", headers, query, body }; }
const CRON = { headers: { authorization: "Bearer s3cret" } };
const SECRET = "s3cret";

// Wire real requireCron with a fixed secret via a wrapper (keeps env untouched).
const reqCron = (req) => requireCron(req, { cronSecret: SECRET });

// ── cron matrix ──────────────────────────────────────────────────────────────

test("GET empty query + correct Bearer secret → cron runs runAlertsForAll", async () => {
  const repos = mkRepos();
  const out = await handleAlerts({ method: "GET", headers: CRON.headers, query: {}, body: {} },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 200);
  assert.equal(out.json.businessesChecked, 2);
  assert.ok(repos.calls.some((c) => c[0] === "runAlertsForAll"));
});

test("GET cron with x-vercel-cron only → 401; runner untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts({ method: "GET", headers: { "x-vercel-cron": "1" }, query: {}, body: {} },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 401);
  assert.deepEqual(repos.calls, []);
});

test("GET cron with wrong secret → 401; runner untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts({ method: "GET", headers: { authorization: "Bearer nope" }, query: {}, body: {} },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 401);
  assert.deepEqual(repos.calls, []);
});

// ── GET dispatch (no misrouting to cron) ─────────────────────────────────────

test("GET arbitrary param, no ids → 400 (not cron); requireCron/repos untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(GET({ foo: "bar" }), { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 400);
  assert.deepEqual(repos.calls, []);
});

test("GET config=1 without ids → 400", async () => {
  const out = await handleAlerts(GET({ config: "1" }), { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 400);
});

test("GET only one identifier → 400", async () => {
  const out = await handleAlerts(GET({ tenantId: "t1" }), { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 400);
});

test("GET both ids → viewer read allowed; alerts sorted by severity", async () => {
  const repos = mkRepos();
  const { fn } = bizCtx();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1" }), { requireCron: reqCron, requireBizContext: fn, repos });
  assert.equal(out.status, 200);
  assert.equal(out.json.alerts[0].severity, "critical"); // sorted ahead of info
  assert.ok(repos.calls.some((c) => c[0] === "getActiveAlerts"));
});

test("GET both ids + config=1 → thresholds read", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", config: "1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.thresholds, { foodCostPct: 33 });
  assert.ok(!repos.calls.some((c) => c[0] === "getActiveAlerts"));
});

test("GET config=2 → 400 invalid config", async () => {
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", config: "2" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 400);
});

test("GET read denied → 403; getActiveAlerts untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx({ deny: { status: 403, msg: "business_access_denied" } }).fn, repos });
  assert.equal(out.status, 403);
  assert.deepEqual(repos.calls, []);
});

test("GET read with body carrying tenantId → 400 ambiguity", async () => {
  const out = await handleAlerts({ method: "GET", headers: {}, query: { tenantId: "t1", bizId: "b1" }, body: { tenantId: "t1" } },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 400);
});

// ── POST dispatch ─────────────────────────────────────────────────────────────

test("POST run → manager write allowed; runAlertsForBiz called", async () => {
  const repos = mkRepos();
  const { fn, spy } = bizCtx();
  const out = await handleAlerts(POST({ action: "run", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: fn, repos });
  assert.equal(out.status, 200);
  assert.equal(spy.opts.mode, "write");
  assert.ok(repos.calls.some((c) => c[0] === "runAlertsForBiz"));
});

test("POST run denied (viewer/shift_manager) → 403; runner + email untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(POST({ action: "run", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx({ deny: { status: 403, msg: "role_not_allowed" } }).fn, repos });
  assert.equal(out.status, 403);
  assert.deepEqual(repos.calls, []);
});

test("POST config → saveThresholds after auth; missing thresholds → 400 (no write)", async () => {
  const repos = mkRepos();
  const ok = await handleAlerts(POST({ action: "config", tenantId: "t1", bizId: "b1", thresholds: { foodCostPct: 30 } }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(ok.status, 200);
  assert.ok(repos.calls.some((c) => c[0] === "saveThresholds"));

  const repos2 = mkRepos();
  const bad = await handleAlerts(POST({ action: "config", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: repos2 });
  assert.equal(bad.status, 400);
  assert.ok(!repos2.calls.some((c) => c[0] === "saveThresholds"), "no write on missing thresholds");
});

test("POST dismiss → dismissAlert after auth; missing alertId → 400 (no write)", async () => {
  const repos = mkRepos();
  const ok = await handleAlerts(POST({ action: "dismiss", tenantId: "t1", bizId: "b1", alertId: "a1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(ok.status, 200);
  assert.ok(repos.calls.some((c) => c[0] === "dismissAlert"));

  const repos2 = mkRepos();
  const bad = await handleAlerts(POST({ action: "dismiss", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: repos2 });
  assert.equal(bad.status, 400);
  assert.ok(!repos2.calls.some((c) => c[0] === "dismissAlert"));
});

test("POST unknown action → 400; auth + repos untouched", async () => {
  const repos = mkRepos();
  const { fn, spy } = bizCtx();
  const out = await handleAlerts(POST({ action: "nuke", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: fn, repos });
  assert.equal(out.status, 400);
  assert.equal(spy.calls, 0);
  assert.deepEqual(repos.calls, []);
});

test("POST can never reach cron: no action → 400, runner untouched", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(POST({ tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos });
  assert.equal(out.status, 400);
  assert.ok(!repos.calls.some((c) => c[0] === "runAlertsForAll"));
});

test("POST with ids in query → 400 (ids must come from body only)", async () => {
  const out = await handleAlerts(POST({ action: "run" }, { tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 400);
});

test("wrong tenant/business denied for write → 403; no write", async () => {
  const repos = mkRepos();
  const out = await handleAlerts(POST({ action: "run", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx({ deny: { status: 403, msg: "not a tenant member" } }).fn, repos });
  assert.equal(out.status, 403);
  assert.deepEqual(repos.calls, []);
});

test("OPTIONS → 204 end", async () => {
  const out = await handleAlerts({ method: "OPTIONS", headers: {}, query: {}, body: {} },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos: mkRepos() });
  assert.equal(out.status, 204); assert.equal(out.end, true);
});

// ── strict GET query allowlist (revision 3) ──────────────────────────────────

test("GET tenantId+bizId+action → 400; no cron/auth/repo runs", async () => {
  const repos = mkRepos();
  const { fn, spy } = bizCtx();
  let cronCalls = 0;
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", action: "run" }),
    { requireCron: (r) => { cronCalls++; return reqCron(r); }, requireBizContext: fn, repos });
  assert.equal(out.status, 400);
  assert.equal(cronCalls, 0);
  assert.equal(spy.calls, 0);
  assert.deepEqual(repos.calls, []);
});

test("GET tenantId+bizId+foo=bar → 400 (unknown key)", async () => {
  const repos = mkRepos();
  const { fn, spy } = bizCtx();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", foo: "bar" }),
    { requireCron: reqCron, requireBizContext: fn, repos });
  assert.equal(out.status, 400);
  assert.equal(spy.calls, 0);
  assert.deepEqual(repos.calls, []);
});

test("GET tenantId+bizId+config='' → 400", async () => {
  const repos = mkRepos();
  const { fn, spy } = bizCtx();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", config: "" }),
    { requireCron: reqCron, requireBizContext: fn, repos });
  assert.equal(out.status, 400);
  assert.equal(spy.calls, 0);
  assert.deepEqual(repos.calls, []);
});

// ── internal error redaction (revision 3) ────────────────────────────────────

const SENSITIVE = "firebase key AIzaSyServerSecret path /tenants/t1/biz_access stack@node";
function throwingRepos() {
  const calls = [];
  const boom = (name) => (...a) => { calls.push(name); return Promise.reject(new Error(SENSITIVE)); };
  return {
    calls,
    runAlertsForBiz: boom("runAlertsForBiz"),
    runAlertsForAll: boom("runAlertsForAll"),
    getActiveAlerts: boom("getActiveAlerts"),
    dismissAlert: boom("dismissAlert"),
    getThresholds: boom("getThresholds"),
    saveThresholds: boom("saveThresholds"),
  };
}
function assertRedacted(out) {
  assert.equal(out.status, 500);
  assert.deepEqual(out.json, { ok: false, error: "internal_error" });
  const body = JSON.stringify(out.json);
  assert.ok(!body.includes("firebase") && !body.includes("AIzaSy") && !body.includes(SENSITIVE), "sensitive text absent");
}

test("cron runner failure → 500 internal_error; real error logged server-side only", async () => {
  const repos = throwingRepos();
  const logged = [];
  const out = await handleAlerts({ method: "GET", headers: CRON.headers, query: {}, body: {} },
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: (w, e) => logged.push([w, e.message]) });
  assertRedacted(out);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][1], SENSITIVE, "real message preserved only in logger");
});

test("read: getActiveAlerts failure → 500 internal_error; getThresholds NOT called after", async () => {
  const repos = throwingRepos();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: () => {} });
  assertRedacted(out);
  assert.deepEqual(repos.calls, ["getActiveAlerts"], "no secondary getThresholds after failure");
});

test("config read: getThresholds failure → 500 internal_error (wrapped)", async () => {
  const repos = throwingRepos();
  const out = await handleAlerts(GET({ tenantId: "t1", bizId: "b1", config: "1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: () => {} });
  assertRedacted(out);
});

test("write run: runAlertsForBiz failure → 500 internal_error", async () => {
  const repos = throwingRepos();
  const out = await handleAlerts(POST({ action: "run", tenantId: "t1", bizId: "b1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: () => {} });
  assertRedacted(out);
});

test("write config: saveThresholds failure → 500; re-read getThresholds NOT called", async () => {
  const repos = throwingRepos();
  const out = await handleAlerts(POST({ action: "config", tenantId: "t1", bizId: "b1", thresholds: { foodCostPct: 30 } }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: () => {} });
  assertRedacted(out);
  assert.deepEqual(repos.calls, ["saveThresholds"], "no re-read after write failure");
});

test("write dismiss: dismissAlert failure → 500 internal_error", async () => {
  const repos = throwingRepos();
  const out = await handleAlerts(POST({ action: "dismiss", tenantId: "t1", bizId: "b1", alertId: "a1" }),
    { requireCron: reqCron, requireBizContext: bizCtx().fn, repos, logError: () => {} });
  assertRedacted(out);
});
