// SYS-P0-001 — Cron authorization hardening (executable route-auth proof).
//
// Compiles the REAL production route handlers (api/analytics/daily-builder.ts,
// api/daily-snapshot/run.ts, api/proactive/run.ts) with the project's own
// typescript, importing the REAL lib/securityContext.js + lib/bizAccess.js so
// requireCron / requireBizContext authorization logic is exercised for real.
// Only TERMINAL side-effect deps (firebase reads, analytics build, snapshot
// email, proactive job) are mocked and delegate to globalThis.__H, so an
// unauthorized request can be proven to reach ZERO writes / emails / jobs.
//
// NO network, Firebase, email or provider call is made. Run:
//   node --test test/security/cron-auth-hardening.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
assert.ok(existsSync(TSC), "typescript compiler required (npm install or TSC_BIN)");

const SECRET = "test-cron-secret-2f9a";

// ── shared stubs (delegate to globalThis.__H) ───────────────────────────────
const STUB_VERIFYTOKEN = `export async function requireAuth(req){ return globalThis.__H.requireAuth(req); }`;
const STUB_HELPERS = `export async function requireTenantAccess(u,t,r){ return globalThis.__H.requireTenantAccess(u,t,r); }
export async function isRateLimited(k,l,w){ return false; }`;
const STUB_ADMINSDK = `export function getAdminDb(){ return globalThis.__H.db(); }`;
const STUB_FBADMIN = `export function getDb(){ return globalThis.__H.db(); }`;

function build(routeRel, outRel, extraStubs) {
  const dir = mkdtempSync(join(tmpdir(), "cronauth-"));
  const mk = (rel, content) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  // real security primitives
  mkdirSync(join(dir, "lib"), { recursive: true });
  copyFileSync(join(REPO, "lib", "securityContext.js"), join(dir, "lib", "securityContext.js"));
  copyFileSync(join(REPO, "lib", "bizAccess.js"), join(dir, "lib", "bizAccess.js"));
  // M1 R2: the analytics endpoint resolves its target through the REAL shared registry rule
  copyFileSync(join(REPO, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));
  // lazy deps of requireBizContext
  mk("lib/verifyToken.js", STUB_VERIFYTOKEN);
  mk("lib/helpers.js", STUB_HELPERS);
  mk("lib/adminSdk.js", STUB_ADMINSDK);
  for (const [rel, content] of Object.entries(extraStubs)) mk(rel, content);
  // route under test
  const routeAbs = join(dir, routeRel);
  mkdirSync(dirname(routeAbs), { recursive: true });
  copyFileSync(join(REPO, routeRel), routeAbs);
  const r = spawnSync("node", [TSC, "--module", "esnext", "--target", "es2020",
    "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", routeAbs],
    { encoding: "utf8" });
  const outJs = join(dir, outRel);
  assert.ok(existsSync(outJs), "compile failed for " + routeRel + "\n" + r.stdout + r.stderr);
  return outJs;
}

function mkRes() {
  const x = { statusCode: 0, body: null, headers: {} };
  x.setHeader = (k, v) => { x.headers[k] = v; };
  x.status = (c) => { x.statusCode = c; return x; };
  x.json = (b) => { x.body = b; return x; };
  x.end = () => x;
  return x;
}

function mkDb(state) {
  return {
    ref: (path) => ({
      get: async () => ({ val: () => state.bizAccessVal }),
      once: async () => ({ val: () => {
        const p = String(path);
        if (p.endsWith("/app/business")) return state.business;
        if (p.endsWith("/app/users")) return state.users;
        if (p.includes("insights:daily")) return state.insights;
        return null;
      } }),
      child: () => ({ once: async () => ({ exists: () => true, val: () => null }) }),
    }),
  };
}

function setH(o = {}) {
  const calls = [];
  const state = {
    bizAccessVal: o.bizAccessVal !== undefined ? o.bizAccessVal : true,
    business: o.business || { _v: JSON.stringify([{ id: "b1", name: "Biz" }]) },   // the runtime registry node (M1 R2: the only shape that establishes identity)
    users: o.users || [{ firebaseUid: "u1", role: "owner", email: "owner@x.com", allowedBizIds: ["b1"] }],
    insights: o.insights !== undefined ? o.insights : null,
  };
  const H = {
    calls, state,
    requireAuth: o.requireAuth || (async () => ({ uid: "u1", email: "u1@x.com" })),
    requireTenantAccess: o.requireTenantAccess || (async () => o.role || "owner"),
    db: () => mkDb(state),
  };
  globalThis.__H = H;
  return H;
}

function setSecret(v) {
  if (v === null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = v;
}

// ── compile the three routes once ───────────────────────────────────────────
const DB_STUBS = {
  "src/analytics/dailyBuilder.js": `export async function buildAnalyticsForBiz(t,b,d){ globalThis.__H.calls.push("buildAnalyticsForBiz"); return {meta:{builtAt:1}}; }
export async function buildAnalyticsForAll(d){ globalThis.__H.calls.push("buildAnalyticsForAll"); return {docs:[],failures:[]}; }
export async function saveAnalyticsDoc(x){ globalThis.__H.calls.push("saveAnalyticsDoc"); }
export async function buildAndSaveInsights(t,b,d,x){ globalThis.__H.calls.push("buildAndSaveInsights"); }
export function yesterdayInIsrael(){ return "2026-07-18"; }`,
  "lib/analytics/sources.js": `export async function fetchBeecommDaily(d){ globalThis.__H.calls.push("fetchBeecommDaily"); return { revenue_total:1, tickets:1, revenue_dine_in:0, revenue_delivery:0, revenue_takeaway:0, hourly:{} }; }`,
};
const SNAP_STUBS = {
  "src/firebase/admin.js": STUB_FBADMIN,
  "src/snapshot/snapshotBuilder.js": `export async function buildSnapshotForAll(){ globalThis.__H.calls.push("buildSnapshotForAll"); return globalThis.__H.snapshotsAll||[]; }
export async function buildSnapshotForBiz(t,b){ globalThis.__H.calls.push("buildSnapshotForBiz"); return {tenantId:t,bizId:b,bizName:"Biz",date:"2026-07-18",netProfit:1,totalSales:2}; }`,
  "src/snapshot/snapshotEmail.js": `export async function sendSnapshotEmail(to,s){ globalThis.__H.calls.push("sendSnapshotEmail"); }`,
};
const PRO_STUBS = {
  "src/firebase/admin.js": STUB_FBADMIN,
  "src/firebase/refs.js": `export function tenantRef(){ return { child(){ return { once: async()=>({exists:()=>true}) }; } }; }`,
  "src/agent/proactive/runProactiveJob.js": `export async function runProactiveJob(){ globalThis.__H.calls.push("runProactiveJob"); return {scanned:0}; }
export async function runForBiz(t,b,br){ globalThis.__H.calls.push("runForBiz"); return {t,b}; }`,
  "src/agent/proactive/getTopActiveInsights.js": `export async function getTopActiveInsights(){ return []; }`,
  "src/agent/proactive/digestBuilder.js": `export async function buildWeeklySummary(){ return {}; }`,
  "lib/proactiveCore.js": `export async function handleProactiveRead(){ globalThis.__H.calls.push("handleProactiveRead"); return {status:200,json:{ok:true}}; }`,
};

const dbHandler = (await import(pathToFileURL(
  build("api/analytics/daily-builder.ts", "api/analytics/daily-builder.js", DB_STUBS)).href)).default;
const snapHandler = (await import(pathToFileURL(
  build("api/daily-snapshot/run.ts", "api/daily-snapshot/run.js", SNAP_STUBS)).href)).default;
const proHandler = (await import(pathToFileURL(
  build("api/proactive/run.ts", "api/proactive/run.js", PRO_STUBS)).href)).default;

const GET = (headers = {}) => ({ method: "GET", headers, query: {}, body: {} });
const POST = (body = {}, headers = {}) => ({ method: "POST", headers, query: {}, body });
const bearer = (s) => ({ authorization: "Bearer " + s });

// ══ DAILY-BUILDER (scheduled cron GET / backfill POST / manual rebuild) ══════
test("daily-builder GET: spoofed x-vercel-cron only -> 401, no scan", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await dbHandler(GET({ "x-vercel-cron": "1" }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForAll"), "no side effect");
});
test("daily-builder GET: random x-vercel-cron value -> 401", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await dbHandler(GET({ "x-vercel-cron": "totally-made-up" }), res);
  assert.equal(res.statusCode, 401);
});
test("daily-builder GET: missing Authorization -> 401", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await dbHandler(GET({}), res);
  assert.equal(res.statusCode, 401);
});
test("daily-builder GET: wrong bearer -> 401, no scan", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await dbHandler(GET(bearer("wrong")), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForAll"));
});
test("daily-builder GET: CRON_SECRET missing -> fail-closed 401 even with bearer", async () => {
  setH(); setSecret(null);
  const res = mkRes(); await dbHandler(GET(bearer("anything")), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForAll"));
});
test("daily-builder GET: correct Bearer CRON_SECRET -> 200, scheduled job runs", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await dbHandler(GET(bearer(SECRET)), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("buildAnalyticsForAll"), "scheduled reaches handler");
});
test("daily-builder POST backfill: spoofed x-vercel-cron -> 401 no build; correct Bearer -> 200 build", async () => {
  setH(); setSecret(SECRET);
  let res = mkRes(); await dbHandler(POST({ tenantId: "t1", bizId: "b1" }, { "x-vercel-cron": "1" }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForBiz"));
  setH(); setSecret(SECRET);
  res = mkRes(); await dbHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer(SECRET)), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("buildAnalyticsForBiz"));
});
test("daily-builder rebuild_after_entry_save: no verified user -> 401, no build", async () => {
  setH({ requireAuth: async () => { throw new Error("no token"); } }); setSecret(SECRET);
  const res = mkRes();
  await dbHandler(POST({ action: "rebuild_after_entry_save", tenantId: "t1", bizId: "b1", date: "2026-07-18" }, {}), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForBiz"));
});
test("daily-builder rebuild_after_entry_save: wrong tenant -> 403, no build", async () => {
  setH({ requireTenantAccess: async () => { throw { status: 403, msg: "access_denied" }; } }); setSecret(SECRET);
  const res = mkRes();
  await dbHandler(POST({ action: "rebuild_after_entry_save", tenantId: "t1", bizId: "b1", date: "2026-07-18" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForBiz"));
});
test("daily-builder rebuild_after_entry_save: client role/allowedBizIds cannot expand server authorization -> 403", async () => {
  // Server says manager WITHOUT access to b1; client body lies (role owner, allowedBizIds [b1]).
  setH({ role: "manager", users: [{ firebaseUid: "u1", role: "manager", allowedBizIds: [] }] });
  setSecret(SECRET);
  const res = mkRes();
  await dbHandler(POST({ action: "rebuild_after_entry_save", tenantId: "t1", bizId: "b1", date: "2026-07-18",
    role: "owner", allowedBizIds: ["b1"] }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body && res.body.error, "business_access_denied");
  assert.ok(!globalThis.__H.calls.includes("buildAnalyticsForBiz"));
});
test("daily-builder beecomm_diagnose: spoofed x-vercel-cron -> 401; correct Bearer -> not 401", async () => {
  setH(); setSecret(SECRET);
  let res = mkRes(); await dbHandler(POST({ action: "beecomm_diagnose", date: "2026-07-18" }, { "x-vercel-cron": "1" }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("fetchBeecommDaily"), "diagnostic not reached unauthorized");
  setH(); setSecret(SECRET);
  res = mkRes(); await dbHandler(POST({ action: "beecomm_diagnose", date: "2026-07-18" }, bearer(SECRET)), res);
  assert.notEqual(res.statusCode, 401, "authorized diagnostic passes cron gate");
});

// ══ DAILY-SNAPSHOT (scheduled cron GET / manual owner POST) ══════════════════
test("daily-snapshot GET: spoofed x-vercel-cron only -> 401, no build/email", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await snapHandler(GET({ "x-vercel-cron": "1" }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("buildSnapshotForAll"));
  assert.ok(!globalThis.__H.calls.includes("sendSnapshotEmail"));
});
test("daily-snapshot GET: correct Bearer -> 200, scheduled job runs", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await snapHandler(GET(bearer(SECRET)), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("buildSnapshotForAll"));
});
test("daily-snapshot POST: verified owner -> 200, email sent", async () => {
  setH({ role: "owner" }); setSecret(SECRET);
  const res = mkRes(); await snapHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("sendSnapshotEmail"));
});
test("daily-snapshot POST: viewer role -> 403, no email", async () => {
  setH({ role: "viewer" }); setSecret(SECRET);
  const res = mkRes(); await snapHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!globalThis.__H.calls.includes("sendSnapshotEmail"));
});
test("daily-snapshot POST: unauthenticated -> 401, no email", async () => {
  setH({ requireAuth: async () => { throw new Error("no token"); } }); setSecret(SECRET);
  const res = mkRes(); await snapHandler(POST({ tenantId: "t1", bizId: "b1" }, {}), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("sendSnapshotEmail"));
});
test("daily-snapshot POST: manager WITHOUT biz grant -> 403, no email", async () => {
  setH({ role: "manager", bizAccessVal: null }); setSecret(SECRET);
  const res = mkRes(); await snapHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!globalThis.__H.calls.includes("sendSnapshotEmail"));
});
test("daily-snapshot POST: client cannot self-promote to owner -> 403, no email", async () => {
  // Server role manager (has biz grant); client body claims role owner. Owner gate must reject.
  setH({ role: "manager", bizAccessVal: true }); setSecret(SECRET);
  const res = mkRes(); await snapHandler(POST({ tenantId: "t1", bizId: "b1", role: "owner" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body && res.body.error, "owner_role_required");
  assert.ok(!globalThis.__H.calls.includes("sendSnapshotEmail"));
});

// ══ PROACTIVE (scheduled cron GET / manual owner POST) ═══════════════════════
test("proactive GET: spoofed x-vercel-cron only -> 401, no job", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await proHandler(GET({ "x-vercel-cron": "1" }), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("runProactiveJob"));
});
test("proactive GET: correct Bearer -> 200, scheduled job runs", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await proHandler(GET(bearer(SECRET)), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("runProactiveJob"));
});
test("proactive POST: verified owner -> 200, single-biz job runs", async () => {
  setH({ role: "owner" }); setSecret(SECRET);
  const res = mkRes(); await proHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 200);
  assert.ok(globalThis.__H.calls.includes("runForBiz"));
});
test("proactive POST: viewer role -> 403, no job", async () => {
  setH({ role: "viewer" }); setSecret(SECRET);
  const res = mkRes(); await proHandler(POST({ tenantId: "t1", bizId: "b1" }, bearer("user-token")), res);
  assert.equal(res.statusCode, 403);
  assert.ok(!globalThis.__H.calls.includes("runForBiz"));
});
test("proactive POST: unauthenticated -> 401, no job", async () => {
  setH({ requireAuth: async () => { throw new Error("no token"); } }); setSecret(SECRET);
  const res = mkRes(); await proHandler(POST({ tenantId: "t1", bizId: "b1" }, {}), res);
  assert.equal(res.statusCode, 401);
  assert.ok(!globalThis.__H.calls.includes("runForBiz"));
});
test("proactive PUT: unsupported method -> 405 before side effects", async () => {
  setH(); setSecret(SECRET);
  const res = mkRes(); await proHandler({ method: "PUT", headers: bearer(SECRET), query: {}, body: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.ok(!globalThis.__H.calls.includes("runProactiveJob"));
  assert.ok(!globalThis.__H.calls.includes("runForBiz"));
});
