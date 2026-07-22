// PR #2A — disabled-endpoint behavior + supplemental wiring/parity checks.
// Behavioral for the 410 endpoints (they import nothing, safe to invoke).
// Supplemental source-static checks are regression guards only — the primary
// proof for Agent/Alerts/security-context lives in their dedicated behavioral
// suites. NOTE: there is deliberately NO test asserting x-vercel-cron is
// sufficient for cron (the cron branch now requires Bearer CRON_SECRET only).
// Run: node --test test/security/pr2a-endpoint-hardening.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

function mkReq(method, extra = {}) { return { method, headers: {}, query: {}, body: {}, ...extra }; }
function mkRes() {
  const res = { _status: null, _json: undefined, _ended: false, _headers: {} };
  res.setHeader = (k, v) => { res._headers[k] = v; return res; };
  res.status = (c) => { res._status = c; return res; };
  res.json = (o) => { res._json = o; res._ended = true; return res; };
  res.end = () => { res._ended = true; return res; };
  return res;
}
const load = async (rel) => (await import(pathToFileURL(join(REPO, rel)).href)).default;

// ── create-tenant 410 ────────────────────────────────────────────────────────
test("create-tenant: POST/GET/PUT/DELETE → 410 unsupported_action", async () => {
  const h = await load("api/create-tenant.js");
  for (const m of ["POST", "GET", "PUT", "DELETE"]) {
    const res = mkRes(); await h(mkReq(m), res);
    assert.equal(res._status, 410, m);
    assert.deepEqual(res._json, { error: "unsupported_action", action: "create-tenant" });
  }
});
test("create-tenant: OPTIONS → 204 no body; no auth/DB in source", async () => {
  const h = await load("api/create-tenant.js");
  const res = mkRes(); await h(mkReq("OPTIONS"), res);
  assert.equal(res._status, 204); assert.equal(res._json, undefined);
  const src = codeOnly(read("api/create-tenant.js"));
  assert.ok(!/firebase-admin|adminSdk|getAdminDb|requireAuth\(|\.set\(|\.ref\(/.test(src));
});

// ── whatsapp 410 ─────────────────────────────────────────────────────────────
test("whatsapp: GET/POST → 410; OPTIONS → 204; no provider call in source", async () => {
  const h = await load("api/whatsapp.js");
  for (const m of ["GET", "POST"]) {
    const res = mkRes(); await h(mkReq(m), res);
    assert.equal(res._status, 410, m);
    assert.equal(res._json.action, "whatsapp");
  }
  const o = mkRes(); await h(mkReq("OPTIONS"), o); assert.equal(o._status, 204);
  const src = codeOnly(read("api/whatsapp.js"));
  assert.ok(!/green-api|sendWhatsApp|GREENAPI|fetch\(|requireAuth\(/.test(src));
});

// ── supplemental wiring (regression guards) ──────────────────────────────────
test("ask.ts delegates to the core and injects requireBizContext + routeQuestion", () => {
  const src = read("api/agent/ask.ts");
  assert.ok(/handleAgentAsk\(\s*req\s*,\s*\{[^}]*requireBizContext[^}]*routeQuestion/.test(src.replace(/\s+/g, " ")));
});
test("alerts/run.ts delegates to the core, injects requireCron, and does NOT use x-vercel-cron", () => {
  const src = read("api/alerts/run.ts");
  assert.ok(/handleAlerts\(\s*req\s*,\s*\{[^}]*requireCron/.test(src.replace(/\s+/g, " ")), "injects requireCron");
  assert.ok(!/x-vercel-cron/.test(codeOnly(src)), "wrapper code does not reference x-vercel-cron");
});
test("cron branch in the core uses requireCron, not x-vercel-cron", () => {
  const core = read("lib/alertsCore.js");
  assert.ok(/requireCron\(req\)/.test(core));
  assert.ok(!/x-vercel-cron/.test(codeOnly(core)), "core code does not accept x-vercel-cron");
  assert.ok(!/x-vercel-cron/.test(codeOnly(read("lib/securityContext.js"))), "requireCron code ignores x-vercel-cron");
});

// ── js/.d.ts value-export parity for the new modules ─────────────────────────
for (const base of ["securityContext", "apiScope", "agentAskCore", "alertsCore"]) {
  test(`parity: lib/${base}.js exports === lib/${base}.d.ts value exports`, () => {
    const js = read(`lib/${base}.js`);
    const dts = read(`lib/${base}.d.ts`);
    const jsEx = new Set([
      ...[...js.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]),
      ...[...js.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]),
    ]);
    const dtsEx = new Set([
      ...[...dts.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]),
      ...[...dts.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]),
    ]);
    assert.deepEqual([...jsEx].sort(), [...dtsEx].sort(), `${base} parity`);
  });
}
