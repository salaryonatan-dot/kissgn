// Behavioral tests for lib/agentAskCore.js (PR #2A). Injects fake
// requireBizContext + routeQuestion; proves the data path (routeQuestion) is
// never reached on denial and the scope policies hold. No firebase/network.
// Run: node --test test/security/agent-ask.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAgentAsk } from "../../lib/agentAskCore.js";

const okResponse = { text: "hi", confidence: { level: "high" }, intent: "revenue", usedSources: ["daily"] };

function mkDeps(overrides = {}) {
  const spy = { routeCalls: 0, lastContext: null, rateKeys: [] };
  const deps = {
    requireBizContext: overrides.requireBizContext
      || (async (_req, opts) => ({ uid: "u1", role: "viewer", ...opts })),
    routeQuestion: overrides.routeQuestion
      || (async (context) => { spy.routeCalls++; spy.lastContext = context; return okResponse; }),
    rateLimit: overrides.rateLimit || ((key) => { spy.rateKeys.push(key); return true; }),
    now: () => "2026-07-21T00:00:00.000Z",
  };
  return { deps, spy };
}
function req(method, body = {}, query = {}) {
  return { method, headers: {}, body, query };
}
const VALID_BODY = { question: "מה המחזור?", tenantId: "t1", bizId: "b1" };

test("no token → 401; routeQuestion untouched", async () => {
  const { deps, spy } = mkDeps({ requireBizContext: async () => { throw { status: 401, msg: "unauthorized" }; } });
  const out = await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(out.status, 401);
  assert.equal(spy.routeCalls, 0);
});

test("wrong tenant → 403; routeQuestion untouched", async () => {
  const { deps, spy } = mkDeps({ requireBizContext: async () => { throw { status: 403, msg: "not a tenant member" }; } });
  const out = await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(out.status, 403);
  assert.equal(spy.routeCalls, 0);
});

test("wrong business → 403; routeQuestion untouched", async () => {
  const { deps, spy } = mkDeps({ requireBizContext: async () => { throw { status: 403, msg: "business_access_denied" }; } });
  const out = await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(out.status, 403);
  assert.equal(spy.routeCalls, 0);
});

test("viewer authorized → 200 with preserved success shape", async () => {
  const { deps, spy } = mkDeps();
  const out = await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, { answer: "hi", confidence: "high", intent: "revenue", sources: ["daily"] });
  assert.equal(spy.routeCalls, 1);
});

test("unsupported timezone → 400; auth + routeQuestion untouched", async () => {
  let authCalled = 0;
  const { deps, spy } = mkDeps({ requireBizContext: async () => { authCalled++; return { uid: "u1" }; } });
  const out = await handleAgentAsk(req("POST", { ...VALID_BODY, timezone: "America/New_York" }), deps);
  assert.equal(out.status, 400);
  assert.equal(authCalled, 0, "security gate not reached");
  assert.equal(spy.routeCalls, 0);
});

test("timezone exactly Asia/Jerusalem is accepted", async () => {
  const { deps } = mkDeps();
  const out = await handleAgentAsk(req("POST", { ...VALID_BODY, timezone: "Asia/Jerusalem" }), deps);
  assert.equal(out.status, 200);
});

test("unsafe branchId (≠ bizId) → 400; routeQuestion untouched", async () => {
  const { deps, spy } = mkDeps();
  const out = await handleAgentAsk(req("POST", { ...VALID_BODY, branchId: "other-biz" }), deps);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, "invalid_branch_scope");
  assert.equal(spy.routeCalls, 0);
});

test("branchId === bizId is accepted and traced into context.branchId", async () => {
  const { deps, spy } = mkDeps();
  const out = await handleAgentAsk(req("POST", { ...VALID_BODY, branchId: "b1" }), deps);
  assert.equal(out.status, 200);
  assert.equal(spy.lastContext.branchId, "b1");
});

test("absent branchId → context.branchId is undefined (branchScope all)", async () => {
  const { deps, spy } = mkDeps();
  await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(spy.lastContext.branchId, undefined);
});

test("identifier ambiguity (ids in query as well as body) → 400; untouched", async () => {
  const { deps, spy } = mkDeps();
  const out = await handleAgentAsk(req("POST", VALID_BODY, { tenantId: "t1" }), deps);
  assert.equal(out.status, 400);
  assert.equal(spy.routeCalls, 0);
});

test("ids taken from body only — query-only ids do not satisfy the endpoint", async () => {
  const { deps } = mkDeps();
  const out = await handleAgentAsk(req("POST", { question: "מה?" }, { tenantId: "t1", bizId: "b1" }), deps);
  assert.equal(out.status, 400); // no body ids → required-pair failure
});

test("rate-limit key is uid:tenantId:bizId; exceeded → 429", async () => {
  const { deps, spy } = mkDeps({ rateLimit: (key) => { spy.rateKeys.push(key); return false; } });
  const out = await handleAgentAsk(req("POST", VALID_BODY), deps);
  assert.equal(out.status, 429);
  assert.deepEqual(spy.rateKeys, ["u1:t1:b1"]);
  assert.equal(spy.routeCalls, 0);
});

test("missing question → 400 before scope/auth", async () => {
  const { deps, spy } = mkDeps();
  const out = await handleAgentAsk(req("POST", { tenantId: "t1", bizId: "b1" }), deps);
  assert.equal(out.status, 400);
  assert.equal(spy.routeCalls, 0);
});

test("method policy: OPTIONS → 200 end; non-POST → 405", async () => {
  const { deps } = mkDeps();
  const o = await handleAgentAsk(req("OPTIONS"), deps);
  assert.equal(o.status, 200); assert.equal(o.end, true);
  const g = await handleAgentAsk(req("GET", VALID_BODY), deps);
  assert.equal(g.status, 405);
});
