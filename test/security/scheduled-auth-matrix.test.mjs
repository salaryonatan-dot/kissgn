// P0 scheduled-job authorization — full adversarial matrix for EVERY Vercel cron route.
//
// Complements test/security/cron-auth-hardening.test.mjs (SYS-P0-001 route proofs) with
// the complete scheduled matrix Codex exercised in its independent probe (2026-07-29)
// and asked to be committed: no auth, wrong auth, correct machine auth, spoofed
// x-vercel-cron / x-vercel-cron-schedule only, user (Firebase) auth only, wrong and
// alternate HTTP methods, malformed Authorization headers, empty/missing CRON_SECRET,
// query-string secrets, and error paths — asserting that every rejection happens before
// ANY protected side effect (build, write, scan, email).
//
// The four routes declared in vercel.json are compiled from source with the project's
// own typescript and run against the REAL lib/securityContext.js (requireCron /
// requireBizContext), lib/bizAccess.js, and for alerts the REAL lib/alertsCore.js +
// lib/apiScope.js. Only terminal dependencies (Firebase, builders, email, jobs) are
// stubbed and record calls in globalThis.__H.calls.
//
// Deterministic fake secret only. NO network, Firebase, email or provider call.
//   node --test test/security/scheduled-auth-matrix.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
assert.ok(existsSync(TSC), "typescript compiler required (npm install or TSC_BIN)");

const SECRET = "fixture-cron-secret-7c1e0b"; // deterministic test value, not a real secret

// ── stubs (terminal deps only) ───────────────────────────────────────────────
const rec = (name, ret) => `globalThis.__H.calls.push(${JSON.stringify(name)}); if (globalThis.__H.throwIn === ${JSON.stringify(name)}) throw new Error("boom"); return ${ret};`;
const COMMON = {
  "lib/verifyToken.js": `export async function requireAuth(req){ return globalThis.__H.requireAuth(req); }`,
  "lib/helpers.js": `export async function requireTenantAccess(u,t,r){ return globalThis.__H.requireTenantAccess(u,t,r); }
export async function isRateLimited(){ return false; }`,
  "lib/adminSdk.js": `export function getAdminDb(){ return globalThis.__H.db(); }`,
  "src/firebase/admin.js": `export function getDb(){ return globalThis.__H.db(); }`,
};
const ROUTES = {
  "daily-builder": {
    src: "api/analytics/daily-builder.ts", out: "api/analytics/daily-builder.js", job: "buildAnalyticsForAll",
    stubs: {
      "src/analytics/dailyBuilder.js": `export async function buildAnalyticsForBiz(t,b,d){ ${rec("buildAnalyticsForBiz", "{meta:{builtAt:1}}")} }
export async function buildAnalyticsForAll(d){ ${rec("buildAnalyticsForAll", "{docs:[],failures:[]}")} }
export async function saveAnalyticsDoc(x){ ${rec("saveAnalyticsDoc", "undefined")} }
export async function buildAndSaveInsights(){ ${rec("buildAndSaveInsights", "undefined")} }
export function yesterdayInIsrael(){ return "2026-09-28"; }`,
      "lib/analytics/sources.js": `export async function fetchBeecommDaily(d){ ${rec("fetchBeecommDaily", "{revenue_total:1,tickets:1,revenue_dine_in:0,revenue_delivery:0,revenue_takeaway:0,hourly:{}}")} }`,
    },
  },
  "daily-snapshot": {
    src: "api/daily-snapshot/run.ts", out: "api/daily-snapshot/run.js", job: "buildSnapshotForAll",
    stubs: {
      "src/snapshot/snapshotBuilder.js": `export async function buildSnapshotForAll(){ ${rec("buildSnapshotForAll", "[]")} }
export async function buildSnapshotForBiz(t,b){ ${rec("buildSnapshotForBiz", "{tenantId:t,bizId:b,bizName:'Biz'}")} }`,
      "src/snapshot/snapshotEmail.js": `import { currentDeliveryAttempt } from "../../lib/emailDelivery.js";
export async function sendSnapshotEmail(to){ const a = currentDeliveryAttempt(); if (a) { await a.beforeTransport(); a.info = { messageId: "<stub>", accepted: [to], rejected: [] }; } ${rec("sendSnapshotEmail", "undefined")} }`,
    },
  },
  "proactive": {
    src: "api/proactive/run.ts", out: "api/proactive/run.js", job: "runProactiveJob",
    stubs: {
      "src/firebase/refs.js": `export function tenantRef(){ return { child(){ return { once: async()=>({exists:()=>true}) }; } }; }`,
      "src/agent/proactive/runProactiveJob.js": `export async function runProactiveJob(){ ${rec("runProactiveJob", "{scanned:0}")} }
export async function runForBiz(){ ${rec("runForBiz", "{}")} }`,
      "src/agent/proactive/getTopActiveInsights.js": `export async function getTopActiveInsights(){ return []; }`,
      "src/agent/proactive/digestBuilder.js": `export async function buildWeeklySummary(){ return {}; }`,
      "lib/proactiveCore.js": `export async function handleProactiveRead(){ globalThis.__H.calls.push("handleProactiveRead"); return {status:200,json:{ok:true}}; }`,
    },
  },
  "alerts": {
    src: "api/alerts/run.ts", out: "api/alerts/run.js", job: "runAlertsForAll", realLib: ["alertsCore.js", "apiScope.js"],
    stubs: {
      "src/alerts/runner.js": `export async function runAlertsForAll(){ ${rec("runAlertsForAll", "[]")} }
export async function runAlertsForBiz(){ ${rec("runAlertsForBiz", "{alertsFired:0}")} }`,
      "src/alerts/alertsRepo.js": `export async function getActiveAlerts(){ ${rec("getActiveAlerts", "[]")} }
export async function dismissAlert(){ ${rec("dismissAlert", "undefined")} }`,
      "src/alerts/configRepo.js": `export async function getThresholds(){ ${rec("getThresholds", "{}")} }
export async function saveThresholds(){ ${rec("saveThresholds", "undefined")} }`,
    },
  },
};

function build(route) {
  const dir = mkdtempSync(join(tmpdir(), "schedauth-"));
  const put = (rel, content) => { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); };
  mkdirSync(join(dir, "lib"), { recursive: true });
  for (const f of ["securityContext.js", "bizAccess.js", ...(route.realLib || [])]) copyFileSync(join(REPO, "lib", f), join(dir, "lib", f));
  // daily e-mail reliability: the snapshot route's delivery receipts / outcome classification (real, dependency-free)
  if (existsSync(join(REPO, "lib", "emailDelivery.js"))) copyFileSync(join(REPO, "lib", "emailDelivery.js"), join(dir, "lib", "emailDelivery.js"));
  // DE1 R5 (delivery owner decisions): the receipt module composes the REAL shared registry predicate (dependency-free)
  if (existsSync(join(REPO, "lib", "businessRegistry.js"))) copyFileSync(join(REPO, "lib", "businessRegistry.js"), join(dir, "lib", "businessRegistry.js"));
  for (const [rel, c] of Object.entries({ ...COMMON, ...route.stubs })) put(rel, c);
  const routeAbs = join(dir, route.src);
  mkdirSync(dirname(routeAbs), { recursive: true });
  copyFileSync(join(REPO, route.src), routeAbs);
  const r = spawnSync("node", [TSC, "--module", "esnext", "--target", "es2020", "--moduleResolution", "bundler",
    "--skipLibCheck", "--noEmitOnError", "false", routeAbs], { encoding: "utf8" });
  const out = join(dir, route.out);
  assert.ok(existsSync(out), "compile failed for " + route.src + "\n" + r.stdout + r.stderr);
  return out;
}

const HANDLERS = {};
for (const [name, route] of Object.entries(ROUTES)) HANDLERS[name] = (await import(pathToFileURL(build(route)).href)).default;

// Every side effect any route can reach (reads of user data included for the machine-only matrix).
const SIDE_EFFECTS = ["buildAnalyticsForAll", "buildAnalyticsForBiz", "saveAnalyticsDoc", "buildAndSaveInsights", "fetchBeecommDaily",
  "buildSnapshotForAll", "buildSnapshotForBiz", "sendSnapshotEmail", "runProactiveJob", "runForBiz", "handleProactiveRead",
  "runAlertsForAll", "runAlertsForBiz", "getActiveAlerts", "dismissAlert", "getThresholds", "saveThresholds"];

function mkRes() {
  const x = { statusCode: 0, body: null, headers: {}, ended: false };
  x.setHeader = (k, v) => { x.headers[k] = v; };
  x.status = (c) => { x.statusCode = c; return x; };
  x.json = (b) => { x.body = b; return x; };
  x.end = () => { x.ended = true; return x; };
  return x;
}

// User identity stub: a VALID owner Firebase token (to prove user auth never opens machine paths).
function setH(o = {}) {
  const H = {
    calls: [], throwIn: o.throwIn,
    requireAuth: async () => ({ uid: "u1", email: "owner@example.test" }),
    requireTenantAccess: async () => "owner",
    db: () => ({ ref: () => ({ get: async () => ({ val: () => true }), once: async () => ({ val: () => null, exists: () => false }) }) }),
  };
  globalThis.__H = H;
  return H;
}
function setSecret(v) { if (v === null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = v; }
const req = (method, headers = {}, query = {}, body = undefined) => ({ method, headers, query, body });
const noSideEffects = (label) => {
  const hit = globalThis.__H.calls.filter((c) => SIDE_EFFECTS.includes(c));
  assert.deepEqual(hit, [], label + ": side effects reached: " + hit.join(","));
};
async function call(name, r) { const res = mkRes(); await HANDLERS[name](r, res); return res; }

// The scheduled request of each route exactly as vercel.json declares it: GET, no query.
const SCHEDULED = Object.keys(ROUTES);

// ── configuration invariants ────────────────────────────────────────────────
test("vercel.json declares exactly the four scheduled routes covered by this matrix", () => {
  const crons = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8")).crons.map((c) => c.path).sort();
  assert.deepEqual(crons, ["/api/alerts/run", "/api/analytics/daily-builder", "/api/daily-snapshot/run", "/api/proactive/run"]);
});

for (const name of SCHEDULED) {
  const job = ROUTES[name].job;

  test(`[${name}] NO AUTH -> 401, no side effect`, async () => {
    setH(); setSecret(SECRET);
    const res = await call(name, req("GET"));
    assert.equal(res.statusCode, 401); noSideEffects(name);
  });

  test(`[${name}] WRONG AUTH -> 401, no side effect`, async () => {
    for (const wrong of ["wrong", SECRET + "x", SECRET.slice(0, -1), SECRET.toUpperCase(), " " + SECRET]) {
      setH(); setSecret(SECRET);
      const res = await call(name, req("GET", { authorization: "Bearer " + wrong }));
      assert.equal(res.statusCode, 401, "secret variant " + JSON.stringify(wrong)); noSideEffects(name);
    }
  });

  test(`[${name}] CORRECT MACHINE AUTH -> 200, scheduled job reached`, async () => {
    setH(); setSecret(SECRET);
    const res = await call(name, req("GET", { authorization: "Bearer " + SECRET }));
    assert.equal(res.statusCode, 200);
    assert.ok(globalThis.__H.calls.includes(job), "scheduled job " + job + " reached");
  });

  test(`[${name}] correct machine auth + spoofed x-vercel-cron -> 200 (header has no effect)`, async () => {
    setH(); setSecret(SECRET);
    const res = await call(name, req("GET", { authorization: "Bearer " + SECRET, "x-vercel-cron": "1", "x-vercel-cron-schedule": "0 0 * * *" }));
    assert.equal(res.statusCode, 200);
  });

  test(`[${name}] SPOOFED x-vercel-cron / x-vercel-cron-schedule ONLY -> 401, no side effect`, async () => {
    for (const h of [{ "x-vercel-cron": "1" }, { "x-vercel-cron": "true" }, { "x-vercel-cron-schedule": "0 23 * * *" },
      { "x-vercel-cron": "1", "x-vercel-cron-schedule": "0 23 * * *", "user-agent": "vercel-cron/1.0" }, { "x-vercel-id": "fra1::abc" }]) {
      setH(); setSecret(SECRET);
      const res = await call(name, req("GET", h));
      assert.equal(res.statusCode, 401, JSON.stringify(h)); noSideEffects(name);
    }
  });

  test(`[${name}] USER AUTH ONLY (valid owner Firebase token) -> 401 on the machine-only scheduled request`, async () => {
    setH(); setSecret(SECRET);
    const res = await call(name, req("GET", { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJ1MSJ9.sig" }));
    assert.equal(res.statusCode, 401); noSideEffects(name);
  });

  test(`[${name}] MALFORMED Authorization -> 401, no side effect`, async () => {
    for (const a of [SECRET, "Bearer", "Bearer ", "bearer " + SECRET, "BEARER " + SECRET, "Bearer  " + SECRET, "Bearer " + SECRET + " ",
      "Basic " + Buffer.from("x:" + SECRET).toString("base64"), "Token " + SECRET, "Bearer\t" + SECRET, "", "Bearer " + SECRET + "\u0000"]) {
      setH(); setSecret(SECRET);
      const res = await call(name, req("GET", { authorization: a }));
      assert.equal(res.statusCode, 401, "authorization " + JSON.stringify(a)); noSideEffects(name);
    }
    setH(); setSecret(SECRET);
    const arr = await call(name, req("GET", { authorization: ["Bearer " + SECRET, "Bearer " + SECRET] }));
    assert.equal(arr.statusCode, 401, "array-valued header"); noSideEffects(name);
  });

  test(`[${name}] EMPTY / MISSING CRON_SECRET config -> fail closed 401`, async () => {
    for (const cfg of [null, ""]) {
      for (const a of ["Bearer ", "Bearer undefined", "Bearer null", "Bearer " + SECRET]) {
        setH(); setSecret(cfg);
        const res = await call(name, req("GET", { authorization: a }));
        assert.equal(res.statusCode, 401, `secret=${JSON.stringify(cfg)} auth=${JSON.stringify(a)}`); noSideEffects(name);
      }
    }
  });

  test(`[${name}] QUERY-STRING secret is never accepted`, async () => {
    for (const q of [{ secret: SECRET }, { token: SECRET }, { cron_secret: SECRET }, { authorization: "Bearer " + SECRET }, { key: SECRET }]) {
      setH(); setSecret(SECRET);
      const res = await call(name, req("GET", {}, q));
      assert.ok(res.statusCode >= 400 && res.statusCode < 500, `query ${JSON.stringify(q)} -> ${res.statusCode}`);
      noSideEffects(name);
    }
  });

  test(`[${name}] WRONG / ALTERNATE HTTP METHODS -> 405 (or 400), never a side effect, even with the correct secret`, async () => {
    for (const m of ["PUT", "PATCH", "DELETE", "HEAD", "TRACE", "CONNECT", "get", "Get"]) {
      for (const h of [{}, { authorization: "Bearer " + SECRET }, { "x-vercel-cron": "1" }]) {
        setH(); setSecret(SECRET);
        const res = await call(name, req(m, h, {}, {}));
        assert.ok([400, 401, 405].includes(res.statusCode), `${m} ${JSON.stringify(h)} -> ${res.statusCode}`);
        noSideEffects(`${name} ${m}`);
      }
    }
  });

  test(`[${name}] OPTIONS preflight -> 2xx with no side effect, even without auth`, async () => {
    for (const h of [{}, { "x-vercel-cron": "1" }]) {
      setH(); setSecret(SECRET);
      const res = await call(name, req("OPTIONS", h));
      assert.ok(res.statusCode === 200 || res.statusCode === 204, "OPTIONS -> " + res.statusCode);
      noSideEffects(name + " OPTIONS");
    }
  });

  test(`[${name}] ERROR PATH: a failing job never turns a denied request into an allowed one`, async () => {
    setH({ throwIn: job }); setSecret(SECRET);
    let res = await call(name, req("GET", { "x-vercel-cron": "1" }));
    assert.equal(res.statusCode, 401); noSideEffects(name);
    setH({ throwIn: job }); setSecret(SECRET);
    res = await call(name, req("GET", { authorization: "Bearer " + SECRET }));
    assert.equal(res.statusCode, 500, "authorized run that fails reports 500 (visible failure)");
  });
}

// ── non-GET machine paths on daily-builder (operator backfill / POS diagnostic) ──
for (const [label, body, effect] of [
  ["backfill POST", { tenantId: "t1", bizId: "b1", date: "2026-09-28" }, "buildAnalyticsForBiz"],
  ["beecomm_diagnose POST", { action: "beecomm_diagnose", date: "2026-09-28" }, "fetchBeecommDaily"],
]) {
  test(`[daily-builder ${label}] machine-only: no auth / spoofed header / user token / empty secret -> 401; correct secret reaches ${effect}`, async () => {
    for (const [cfg, h] of [[SECRET, {}], [SECRET, { "x-vercel-cron": "1" }], [SECRET, { authorization: "Bearer user-firebase-token" }],
      [SECRET, { authorization: "bearer " + SECRET }], ["", { authorization: "Bearer " }], [null, { authorization: "Bearer " + SECRET }]]) {
      setH(); setSecret(cfg);
      const res = await call("daily-builder", req("POST", h, {}, body));
      assert.equal(res.statusCode, 401, `${label} ${JSON.stringify(h)} secret=${JSON.stringify(cfg)}`); noSideEffects(label);
    }
    process.env.BEECOMM_API_KEY = "fixture-not-a-key";
    setH(); setSecret(SECRET);
    const ok = await call("daily-builder", req("POST", { authorization: "Bearer " + SECRET }, {}, body));
    delete process.env.BEECOMM_API_KEY;
    assert.equal(ok.statusCode, 200);
    assert.ok(globalThis.__H.calls.includes(effect));
  });
}

// ── user-facing branches stay user-scoped and cannot reach the all-business job ──
test("[proactive] user read (?action=insights) never reaches the full scan; POST without owner identity is refused", async () => {
  setH(); setSecret(SECRET);
  let res = await call("proactive", req("GET", { authorization: "Bearer user-token" }, { action: "insights", tenantId: "t1", bizId: "b1" }));
  assert.ok(!globalThis.__H.calls.includes("runProactiveJob"));
  setH(); setSecret(SECRET);
  globalThis.__H.requireAuth = async () => { throw new Error("no token"); };
  res = await call("proactive", req("POST", { authorization: "Bearer " + SECRET }, {}, {}));
  assert.equal(res.statusCode, 401, "the cron secret is not a user identity");
  noSideEffects("proactive POST with cron secret");
});
test("[daily-snapshot] the cron secret cannot send a single-business manual email (POST is owner-only)", async () => {
  setH(); setSecret(SECRET);
  globalThis.__H.requireAuth = async () => { throw new Error("not a firebase token"); };
  const res = await call("daily-snapshot", req("POST", { authorization: "Bearer " + SECRET }, {}, { tenantId: "t1", bizId: "b1" }));
  assert.equal(res.statusCode, 401); noSideEffects("snapshot POST with cron secret");
});
test("[alerts] the cron secret cannot use the user write branch; user token cannot reach runAlertsForAll", async () => {
  setH(); setSecret(SECRET);
  globalThis.__H.requireAuth = async () => { throw new Error("not a firebase token"); };
  let res = await call("alerts", req("POST", { authorization: "Bearer " + SECRET }, {}, { action: "run", tenantId: "t1", bizId: "b1" }));
  assert.equal(res.statusCode, 401); noSideEffects("alerts POST with cron secret");
  setH(); setSecret(SECRET);
  res = await call("alerts", req("POST", { authorization: "Bearer user-token" }, {}, { action: "run", tenantId: "t1", bizId: "b1" }));
  assert.ok(!globalThis.__H.calls.includes("runAlertsForAll"), "user write never runs the all-business job");
});
