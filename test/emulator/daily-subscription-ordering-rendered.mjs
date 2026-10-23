// Daily e-mail subscription correction C1 (author candidate, pending independent review): request ORDERING in the RENDERED
// page over the real local RTDB emulator. Every `/api/daily-snapshot/run` request is executed by THIS tree's compiled route
// at the moment the page sends it (the server applies requests in the order they are sent); the REPLY of a subscription
// request can be HELD and released later — in any order, or as a lost reply (the fetch fails after the server applied it).
// The working-tree index.html boots in jsdom exactly as in DSR / UN.
//   DSO-01  a delayed ON read (version 1) released after the confirmed OFF change (version 2): the switch stays OFF
//   DSO-02  out-of-order replies: an older read released after a newer read: the newer confirmed state stays; a change
//           whose reply is LOST (the server applied it) shows the error and the last confirmed state — never the change as
//           confirmed — and the automatic re-read then shows the server's state
//   DSO-03  switching businesses while requests are pending: a read never unlocks a pending change; a pending change
//           settles into ITS business only; a pending read of the business switched away from is dropped; the other
//           business shows only its own confirmed state; switching back shows the settled state
//   DSO-04  failed requests: a refused change (store unavailable) keeps the last confirmed state with the error line and no
//           write; a stale request failing after a later confirmed one shows no error
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner:
//   bash test/support/p1-r7-emu-run.sh <this checkout> <abs log dir> dso=test/emulator/daily-subscription-ordering-rendered.mjs
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { TextEncoder } from "node:util";
import { bootHistoricalPage, depsStatus, click, textOf, findByText } from "../historical/historical-page-harness.mjs";
import { loadFinance } from "../support/c1-seam.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_CONFIG) fail("credentials / database URL must be absent");
const RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

const H = await import(pathToFileURL(join(ROOT, "test", "support", "daily-email-harness.mjs")).href);
const S = await H.buildSandbox({ fresh: true });
const { subscriptionPath } = await S.import("src/server/dailyEmailSubscription.js");
H.installSmtp([]);                                          // no provider call is expected at all
const T = "tenantA", A = "bizA", B = "bizB";
const SUB = (b) => subscriptionPath(T, b);
process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([[T, A, "owner-a@example.test"], [T, B, "owner-a@example.test"]]);

// ── transport: the route runs when the page sends; a subscription reply may be held and released later ──────────────────
const fault = { write: false };
const gate = { hold: false, held: [] };
let CLAIMS = null;
const requests = [];
const resp = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
const fetchImpl = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("/api/config")) return resp(200, { apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT });
  if (u === "/api/daily-snapshot/run") {
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    const auth = opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization);
    const entry = { method: opts && opts.method, body, auth: typeof auth === "string" && auth.startsWith("Bearer ") };
    requests.push(entry);
    globalThis.__DE = { requireAuth: async () => { if (!auth || !CLAIMS) throw Object.assign(new Error("unauthorized"), { status: 401, msg: "unauthorized" }); return CLAIMS; } };
    const r = H.mkRes();
    await S.route({ method: (opts && opts.method) || "GET", headers: { authorization: auth ? "Bearer page" : "" }, query: {}, body }, r);
    entry.reply = { status: r.statusCode, body: r.body };
    const isSub = body && (body.action === "subscription" || body.action === "subscription_set");
    if (!isSub || !gate.hold) return resp(r.statusCode, r.body);
    return new Promise((resolve, reject) => {
      entry.release = (how = "deliver") => { entry.released = how; if (how === "lose") reject(new TypeError("Failed to fetch")); else resolve(resp(r.statusCode, r.body)); };
      gate.held.push(entry);
    });
  }
  return resp(404, { error: "not_available_in_harness" });
};
const subRequests = () => requests.filter((r) => r.body && (r.body.action === "subscription" || r.body.action === "subscription_set"));
/** The N-th subscription request (0-based) once the page has sent it and the server has answered it. */
const nth = async (page, n) => { await page.until(() => subRequests().length > n && subRequests()[n].reply !== undefined, 5000); return subRequests()[n]; };

// ── the world ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const TARGET_MS = Date.parse(`${MONTH}-12T07:00:00Z`), CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const OWNER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const ROWS = []; for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`, date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0 });
const CONFIG = (name) => ({ businessName: name, rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [] });
const bizNodes = (b, name) => ({ [`biz:${b}:entries`]: env(ROWS), [`biz:${b}:config`]: env(CONFIG(name)), [`biz:${b}:fixed`]: env([{ id: "f1", name: "Utilities", amount: "3100" }]), [`biz:${b}:suppliers`]: env([]) });
const RECORD = (enabled, version) => ({ schema: 1, enabled, version, updatedAt: 0, updatedByRole: "owner" });
const fixtures = (subs) => ({
  delivery_control: { daily_snapshot: { schema: 1, state: "released", version: 2, log: {
    v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "fixture", reason: "fixture bootstrap", at: 0 },
    v000000002: { action: "release", state: "released", version: 2, prevVersion: 1, actor: "fixture", reason: "fixture release", at: 0 } } } },
  ...(Object.keys(subs).length ? { email_delivery_subscriptions: { daily_snapshot: { [T]: subs } } } : {}),
  tenants: { [T]: {
    members: { [OWNER.uid]: true }, roles: { [OWNER.uid]: "owner" },
    app: { users: env([{ id: 1, username: "owner1", name: "בעלים", email: OWNER.email, role: "owner", firebaseUid: OWNER.uid }]), business: env([{ id: A, name: "סניף א" }, { id: B, name: "סניף ב" }]) },
    ...bizNodes(A, "סניף א (config)"), ...bizNodes(B, "סניף ב"),
  } },
  user_tenants: { [OWNER.uid]: T },
  user_active_biz: { [OWNER.uid]: A },
  username_index: { owner1: { tenantId: T, email: OWNER.email } },
});

const apps = {};
const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
const canon = (x) => Array.isArray(x) ? x.map(canon) : x !== null && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
const eq = (a, b, m) => { if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function run(id, description, fn) {
  try { await fn(); results.push({ id, description, status: "PASS" }); console.log("PASS " + id); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", notes: ((e && e.stack) || String(e)) + "\nrequests: " + JSON.stringify(requests.map(({ release, ...r }) => r)) }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const q = (page, v) => page.document.querySelector(`[data-daily-subscription="${v}"]`);
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));
const dashboardUp = (page) => page.document.querySelector(".kpi-card-link") !== null || page.document.querySelector('[data-c1="fin-unavailable"]') !== null;
const cold = async (p) => (await apps.cold.database().ref(p).get()).val();
/** What the owner sees: { open, on, locked, error }. */
const shown = (page) => { const s = q(page, "switch"); return s ? { open: true, on: s.checked, locked: s.disabled, error: q(page, "error") !== null } : { open: false }; };
const shownIs = async (page, want, m) => { try { await page.until(() => JSON.stringify(canon(shown(page))) === JSON.stringify(canon(want)), 5000); } catch (_) { eq(shown(page), want, m); } };
async function boot() {
  CLAIMS = { uid: OWNER.uid, email: OWNER.email };
  requests.length = 0; gate.held.length = 0;
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp: apps.owner, user: OWNER, session: { ["marjin_tid_" + OWNER.uid]: T, ["marjin_biz_" + OWNER.uid]: A }, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl });
  page.window.TextEncoder = TextEncoder;
  await page.until(() => dashboardUp(page) || page.document.querySelector(".mhd-nav") !== null, 25000);
  return page;
}
const open = async (page) => { const b = q(page, "open"); expect(b, "the labelled control"); click(b); await page.until(() => q(page, "switch") !== null, 5000); };
const close = async (page) => { click(q(page, "close")); await page.until(() => q(page, "switch") === null, 5000); };
const toggle = (page) => click(q(page, "switch"));
const switchBiz = async (page, index) => {
  const btn = page.document.querySelector("button.mhd-switch"); expect(btn, "the business switcher control (mhd-switch)"); click(btn); await page.sleep(300);
  const h2 = findByText(page.document, "h2", "בחירת סניף"); expect(h2, "the switcher modal");
  const rows = Array.from(h2.parentElement.parentElement.querySelectorAll("button")).filter((b) => /flex/.test(b.getAttribute("style") || "") && !textOf(b).startsWith("+") && !b.querySelector("svg"));
  expect(rows[index], "business #" + index + " in the switcher (" + rows.length + " rows)"); click(rows[index]); await page.sleep(500);
};
const release = async (page, entry, how) => { expect(entry && entry.release && !entry.released, "a held reply to release"); entry.release(how); await page.sleep(300); };

async function main() {
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.cold = admin.initializeApp({ databaseURL: DB_URL }, "cold");
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: OWNER.uid, token: { email: OWNER.email } } }, "owner");
  globalThis.__DB = new Proxy(apps.seed.database(), { get(t, k) {
    if (k === "ref") return (p, ...a) => { const r = t.ref(p, ...a); return String(p).startsWith("email_delivery_subscriptions/") ? new Proxy(r, { get(rt, rk) { if (rk === "transaction" && fault.write) return async () => { throw new Error("injected-store-fault"); }; const v = rt[rk]; return typeof v === "function" ? v.bind(rt) : v; } }) : r; };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(RULES) });
  if (!res.ok) throw new Error("rules load failed: " + res.status);
  const seed = async (subs = {}) => { await apps.seed.database().ref("/").set(fixtures(subs)); fault.write = false; gate.hold = false; };
  const version = async (b) => { const v = await cold(SUB(b)); return v === null ? null : [v.enabled, v.version]; };

  await run("DSO-01", "a delayed ON read (v1) released after the confirmed OFF change (v2) never turns the switch back ON", async () => {
    await seed({ [A]: RECORD(true, 1) });
    const page = await boot();
    try {
      await open(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "confirmed ON v1");
      await close(page); gate.hold = true;
      await open(page); const r2 = await nth(page, 1);
      eq([r2.body.action, r2.reply.body.enabled, r2.reply.body.version], ["subscription", true, 1], "the read the server answered ON v1 (held)");
      await shownIs(page, { open: true, on: true, locked: false, error: false }, "the last confirmed state while the read is pending");
      toggle(page); const w1 = await nth(page, 2);
      eq([w1.body.action, w1.body.enabled, w1.reply.status, w1.reply.body.version], ["subscription_set", false, 200, 2], "the change the server applied (OFF v2, held)");
      await shownIs(page, { open: true, on: true, locked: true, error: false }, "locked while the change is pending, still the confirmed ON");
      await release(page, w1); await shownIs(page, { open: true, on: false, locked: false, error: false }, "confirmed OFF v2");
      await release(page, r2); await page.sleep(500);
      eq(shown(page), { open: true, on: false, locked: false, error: false }, "the delayed ON read (v1) is ignored");
      eq(await version(A), [false, 2], "the server record");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("DSO-02", "out-of-order replies; a lost change reply is never shown as confirmed; the re-read shows the server state", async () => {
    await seed({ [A]: RECORD(true, 1) });
    const page = await boot();
    try {
      await open(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "confirmed ON v1");
      await close(page); gate.hold = true;
      await open(page); const r2 = await nth(page, 1);                      // read #1 of this panel: ON v1 (held)
      toggle(page); const w1 = await nth(page, 2);                         // change OFF: the server applies it (v2)
      eq([w1.reply.status, w1.reply.body.enabled, w1.reply.body.version], [200, false, 2], "the server applied the change");
      await release(page, w1, "lose");                                     // ... but the reply is lost
      await shownIs(page, { open: true, on: true, locked: false, error: true }, "a lost reply: the error and the last CONFIRMED state, never OFF as confirmed");
      const r3 = await nth(page, 3);                                       // the automatic re-read: OFF v2 (held)
      eq([r3.body.action, r3.reply.body.enabled, r3.reply.body.version], ["subscription", false, 2], "the re-read the server answered");
      await release(page, r3); await shownIs(page, { open: true, on: false, locked: false, error: false }, "the newer read (OFF v2) arrives first: confirmed OFF, error cleared");
      await release(page, r2); await page.sleep(500);
      eq(shown(page), { open: true, on: false, locked: false, error: false }, "the older read (ON v1) arriving last changes nothing");
      eq(await version(A), [false, 2], "the server record");
      eq(subRequests().filter((r) => r.body.action === "subscription_set").length, 1, "nothing was re-sent");
    } finally { page.detach(); }
  });

  await run("DSO-03", "switching businesses while requests are pending: each reply settles only its own business", async () => {
    await seed({ [A]: RECORD(true, 1) });
    const page = await boot();
    try {
      await open(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "A: confirmed ON v1");
      gate.hold = true;
      toggle(page); const wA = await nth(page, 1);                         // A: change OFF (v2), reply held
      eq([wA.body.bizId, wA.reply.body.enabled, wA.reply.body.version], [A, false, 2], "A's change");
      await close(page); await open(page); const rA = await nth(page, 2);  // A: a read (OFF v2: sent after the change), held
      await release(page, rA);
      eq([rA.reply.body.enabled, rA.reply.body.version], [false, 2], "the server answered the read after applying the change");
      await shownIs(page, { open: true, on: false, locked: true, error: false }, "A: the read confirms OFF v2 but never unlocks the pending change");
      await close(page); await open(page); const rA2 = await nth(page, 3); // A: another read, held across the switch
      await close(page); await switchBiz(page, 1);
      await open(page); const rB = await nth(page, 4);                     // B: a read, held
      eq([rB.body.bizId, rB.reply.body.enabled, rB.reply.body.version], [B, false, null], "B's read (no record)");
      await shownIs(page, { open: true, on: false, locked: true, error: false }, "B: nothing confirmed yet — not A's state");
      await release(page, wA); await release(page, rA2); await page.sleep(300);
      eq(shown(page), { open: true, on: false, locked: true, error: false }, "A's replies never reach B's switch");
      await release(page, rB); await shownIs(page, { open: true, on: false, locked: false, error: false }, "B: confirmed default OFF");
      gate.hold = false;
      toggle(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "B: confirmed ON v1");
      eq([await version(A), await version(B)], [[false, 2], [true, 1]], "each business's own record");
      await close(page); await switchBiz(page, 0); await open(page);
      await shownIs(page, { open: true, on: false, locked: false, error: false }, "back on A: the settled OFF v2");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("DSO-04", "failed requests: a refused change keeps the confirmed state; a stale failure after a later confirmation shows nothing", async () => {
    await seed({ [A]: RECORD(true, 1) });
    let page = await boot();
    try {
      await open(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "confirmed ON v1");
      fault.write = true; gate.hold = true;
      toggle(page); const w1 = await nth(page, 1);
      eq([w1.reply.status, w1.reply.body.status], [503, "unavailable"], "the server refused the change (store unavailable)");
      await release(page, w1);
      await shownIs(page, { open: true, on: true, locked: false, error: true }, "the error and the last confirmed ON");
      const r = await nth(page, 2); fault.write = false;
      await release(page, r); await shownIs(page, { open: true, on: true, locked: false, error: false }, "the re-read confirms ON");
      eq(await version(A), [true, 1], "nothing written");
    } finally { page.detach(); }
    await seed({ [A]: RECORD(true, 1) });
    page = await boot();
    try {
      await open(page); await shownIs(page, { open: true, on: true, locked: false, error: false }, "confirmed ON v1");
      await close(page); gate.hold = true;
      await open(page); const r2 = await nth(page, 1);
      toggle(page); const w1 = await nth(page, 2);
      await release(page, w1); await shownIs(page, { open: true, on: false, locked: false, error: false }, "confirmed OFF v2");
      await release(page, r2, "lose"); await page.sleep(500);
      eq(shown(page), { open: true, on: false, locked: false, error: false }, "the earlier read failing after the confirmed change shows no error");
      eq(await version(A), [false, 2], "the server record");
      eq(globalThis.__SMTP.calls.length, 0, "no provider call in any case");
    } finally { page.detach(); }
  });

  for (const a of Object.values(apps)) await a.delete().catch(() => {});
  console.log(JSON.stringify({ results, failures }, null, 1));
  console.log(`DSO_RENDERED total=${results.length} pass=${results.length - failures} fail=${failures}`);
  process.exitCode = failures || results.length !== 4 ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
