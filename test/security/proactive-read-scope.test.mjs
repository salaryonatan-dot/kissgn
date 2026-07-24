// Behavioral tests for lib/proactiveCore.js. No Firebase/network.
// Proves authenticated proactive read routes use canonical business scope
// before any repository read.
// Run: node --test test/security/proactive-read-scope.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProactiveRead } from "../../lib/proactiveCore.js";

const SENSITIVE = "firebase key AIzaSySecret path /tenants/tenantA/biz_access stack";

function GET(query = {}, headers = {}, body = {}) {
  return { method: "GET", headers, query, body };
}

function mkRepos(overrides = {}) {
  const calls = [];
  return {
    calls,
    tenantExists: async (tenantId) => { calls.push(["tenantExists", tenantId]); return true; },
    getInsights: async (tenantId, bizId, limit) => {
      calls.push(["getInsights", tenantId, bizId, limit]);
      return [{ id: "i1", bizId }];
    },
    getDigest: async (tenantId, bizId, date) => {
      calls.push(["getDigest", tenantId, bizId, date]);
      return { date, bizId };
    },
    getWeeklySummary: async (tenantId, bizId) => {
      calls.push(["getWeeklySummary", tenantId, bizId]);
      return { tenantId, bizId };
    },
    ...overrides,
  };
}

function scopedGuard({ allowedTenant = "tenantA", allowedBiz = "bizA", deny } = {}) {
  const spy = { calls: [] };
  const fn = async (req, opts) => {
    spy.calls.push(opts);
    if (deny) throw deny;
    if (!req.headers?.authorization) throw { status: 401, msg: "unauthorized" };
    if (opts.tenantId !== allowedTenant) throw { status: 403, msg: "not a tenant member" };
    if (opts.bizId !== allowedBiz) throw { status: 403, msg: "business_access_denied" };
    return { uid: "viewerA", role: "viewer", ...opts };
  };
  return { fn, spy };
}

test("same-tenant allowed business succeeds and reads only after biz context", async () => {
  const repos = mkRepos();
  const { fn, spy } = scopedGuard();
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenantA", bizId: "bizA", limit: "2" }, { authorization: "Bearer user" }),
    { requireBizContext: fn, repos }
  );
  assert.equal(out.status, 200);
  assert.deepEqual(spy.calls, [{ tenantId: "tenantA", bizId: "bizA", mode: "read" }]);
  assert.deepEqual(repos.calls, [
    ["tenantExists", "tenantA"],
    ["getInsights", "tenantA", "bizA", 2],
  ]);
});

test("same-tenant disallowed business fails before repository read", async () => {
  const repos = mkRepos();
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenantA", bizId: "bizB" }, { authorization: "Bearer user" }),
    { requireBizContext: scopedGuard().fn, repos }
  );
  assert.equal(out.status, 403);
  assert.deepEqual(out.json, { error: "business_access_denied" });
  assert.deepEqual(repos.calls, []);
});

test("cross-tenant access fails before repository read", async () => {
  const repos = mkRepos();
  const out = await handleProactiveRead(
    GET({ action: "weekly", tenantId: "tenantB", bizId: "bizA" }, { authorization: "Bearer user" }),
    { requireBizContext: scopedGuard().fn, repos }
  );
  assert.equal(out.status, 403);
  assert.deepEqual(out.json, { error: "not a tenant member" });
  assert.deepEqual(repos.calls, []);
});

test("malformed tenantId fails before auth and repo", async () => {
  const repos = mkRepos();
  const { fn, spy } = scopedGuard();
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenant/A", bizId: "bizA" }, { authorization: "Bearer user" }),
    { requireBizContext: fn, repos }
  );
  assert.equal(out.status, 400);
  assert.equal(spy.calls.length, 0);
  assert.deepEqual(repos.calls, []);
});

test("malformed bizId fails before auth and repo", async () => {
  const repos = mkRepos();
  const { fn, spy } = scopedGuard();
  const out = await handleProactiveRead(
    GET({ action: "digest", tenantId: "tenantA", bizId: "biz/A" }, { authorization: "Bearer user" }),
    { requireBizContext: fn, repos }
  );
  assert.equal(out.status, 400);
  assert.equal(spy.calls.length, 0);
  assert.deepEqual(repos.calls, []);
});

test("missing auth fails before repository read", async () => {
  const repos = mkRepos();
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenantA", bizId: "bizA" }),
    { requireBizContext: scopedGuard().fn, repos }
  );
  assert.equal(out.status, 401);
  assert.deepEqual(out.json, { error: "unauthorized" });
  assert.deepEqual(repos.calls, []);
});

test("revoked or invalid auth is redacted through requireBizContext denial", async () => {
  const repos = mkRepos();
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenantA", bizId: "bizA" }, { authorization: "Bearer bad" }),
    { requireBizContext: scopedGuard({ deny: { status: 401, msg: SENSITIVE } }).fn, repos }
  );
  assert.equal(out.status, 401);
  assert.deepEqual(out.json, { error: "unauthorized" });
  assert.ok(!JSON.stringify(out.json).includes(SENSITIVE));
  assert.deepEqual(repos.calls, []);
});

test("digest read validates scope and returns default-date digest", async () => {
  const repos = mkRepos();
  const out = await handleProactiveRead(
    GET({ action: "digest", tenantId: "tenantA", bizId: "bizA" }, { authorization: "Bearer user" }),
    { requireBizContext: scopedGuard().fn, repos, now: new Date("2026-07-24T12:00:00.000Z") }
  );
  assert.equal(out.status, 200);
  assert.equal(out.json.digest.date, "2026-07-24");
  assert.ok(repos.calls.some((c) => c[0] === "getDigest"));
});

test("repository errors return generic internal_error and do not leak sensitive text", async () => {
  const repos = mkRepos({
    getInsights: async () => { throw new Error(SENSITIVE); },
  });
  const logged = [];
  const out = await handleProactiveRead(
    GET({ action: "insights", tenantId: "tenantA", bizId: "bizA" }, { authorization: "Bearer user" }),
    { requireBizContext: scopedGuard().fn, repos, logError: (where, err) => logged.push([where, err.message]) }
  );
  assert.equal(out.status, 500);
  assert.deepEqual(out.json, { ok: false, error: "internal_error" });
  assert.ok(!JSON.stringify(out.json).includes(SENSITIVE));
  assert.equal(logged[0][1], SENSITIVE);
});
