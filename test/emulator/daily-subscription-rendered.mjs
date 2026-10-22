// Daily e-mail subscription (owner requirement 2026-10-22; author candidate, pending independent review) — the page RENDERED
// over the real local RTDB emulator, every `/api/daily-snapshot/run` request answered by THIS tree's compiled route (harness
// sandbox: Admin / auth / provider seams only) over the SAME emulator; the page's Bearer token maps to the acting member's
// claims. The working-tree index.html boots in jsdom (test/historical/historical-page-harness.mjs), exactly as UN does.
//   DSR-00  owner, nothing stored: nothing about the subscription is requested on page load; the labelled control opens the
//           panel; ONE read with the exact body; the switch is OFF (default) and usable; no address anywhere in the panel
//   DSR-01  owner turns it ON through the switch: ONE change request { action: "subscription_set", enabled: true }; the
//           server-stored record is enabled (version 1, role owner); the switch shows ON. A fresh page reads it back ON.
//           Turning it OFF stores disabled (version 2); the switch shows OFF
//   DSR-02  the preference cannot be read (fault injected on the real store; the route answers 503): the switch stays OFF and
//           disabled, the error line is shown, nothing is written, the page stays usable
//   DSR-03  a viewer and a manager: no control, zero subscription requests; the stored preference is unchanged
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner:
//   bash test/support/p1-r7-emu-run.sh <this checkout> <abs log dir> dsr=test/emulator/daily-subscription-rendered.mjs
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { TextEncoder } from "node:util";
import { bootHistoricalPage, depsStatus, click, textOf } from "../historical/historical-page-harness.mjs";
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

// ── THIS tree's route and preference module (harness sandbox over THIS emulator) ─────────────────────────────────────────
const H = await import(pathToFileURL(join(ROOT, "test", "support", "daily-email-harness.mjs")).href);
const S = await H.buildSandbox({ fresh: true });
const { subscriptionPath } = await S.import("src/server/dailyEmailSubscription.js");
H.installSmtp([]);                                          // no provider call is expected at all
const T = "tenantA", B = "bizA", B2 = "bizB";
const SUB = subscriptionPath(T, B);
process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([[T, B, "owner-a@example.test"], [T, B2, "owner-a@example.test"]]);
const fault = { read: false };
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
    requests.push(entry);                                   // the page may have the notice read in flight at the same time
    globalThis.__DE = { requireAuth: async () => { if (!auth || !CLAIMS) throw Object.assign(new Error("unauthorized"), { status: 401, msg: "unauthorized" }); return CLAIMS; } };
    const r = H.mkRes();
    await S.route({ method: (opts && opts.method) || "GET", headers: { authorization: auth ? "Bearer page" : "" }, query: {}, body }, r);
    entry.reply = { status: r.statusCode, body: r.body };
    return resp(r.statusCode, r.body);
  }
  return resp(404, { error: "not_available_in_harness" });
};

// ── the world (the UN fixture shape, no stored preference unless a case writes one) ──────────────────────────────────────
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const TARGET_MS = Date.parse(`${MONTH}-12T07:00:00Z`), CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const OWNER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const VIEWER = { uid: "u_viewer", email: "v@demo.example", displayName: "viewer1" };
const MANAGER = { uid: "u_manager", email: "m@demo.example", displayName: "manager1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const ROWS = []; for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`, date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0 });
const CONFIG = (name) => ({ businessName: name, rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [] });
const USERS = [
  { id: 1, username: "owner1", name: "בעלים", email: OWNER.email, role: "owner", firebaseUid: OWNER.uid },
  { id: 2, username: "viewer1", name: "צופה", email: VIEWER.email, role: "viewer", firebaseUid: VIEWER.uid, allowedBizIds: [B, B2] },
  { id: 3, username: "manager1", name: "מנהל", email: MANAGER.email, role: "manager", firebaseUid: MANAGER.uid, allowedBizIds: [B, B2] },
];
const bizNodes = (b, name) => ({ [`biz:${b}:entries`]: env(ROWS), [`biz:${b}:config`]: env(CONFIG(name)), [`biz:${b}:fixed`]: env([{ id: "f1", name: "Utilities", amount: "3100" }]), [`biz:${b}:suppliers`]: env([]) });
const fixtures = ({ activeUid = OWNER.uid } = {}) => ({
  delivery_control: { daily_snapshot: { schema: 1, state: "released", version: 2, log: {
    v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "fixture", reason: "fixture bootstrap", at: 0 },
    v000000002: { action: "release", state: "released", version: 2, prevVersion: 1, actor: "fixture", reason: "fixture release", at: 0 } } } },
  tenants: { [T]: {
    members: { [OWNER.uid]: true, [VIEWER.uid]: true, [MANAGER.uid]: true }, roles: { [OWNER.uid]: "owner", [VIEWER.uid]: "viewer", [MANAGER.uid]: "manager" },
    biz_access: { [B]: { [VIEWER.uid]: true, [MANAGER.uid]: true }, [B2]: { [VIEWER.uid]: true, [MANAGER.uid]: true } },
    app: { users: env(USERS), business: env([{ id: B, name: "סניף א" }, { id: B2, name: "סניף ב" }]) },
    ...bizNodes(B, "סניף א (config)"), ...bizNodes(B2, "סניף ב"),
  } },
  user_tenants: { [OWNER.uid]: T, [VIEWER.uid]: T, [MANAGER.uid]: T },
  user_active_biz: { [activeUid]: B },
  username_index: { owner1: { tenantId: T, email: OWNER.email }, viewer1: { tenantId: T, email: VIEWER.email }, manager1: { tenantId: T, email: MANAGER.email } },
});

const apps = {};
const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
const canon = (x) => Array.isArray(x) ? x.map(canon) : x !== null && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
const eq = (a, b, m) => { if (JSON.stringify(canon(a)) !== JSON.stringify(canon(b))) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function run(id, description, fn) {
  try { await fn(); results.push({ id, description, status: "PASS" }); console.log("PASS " + id); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", notes: ((e && e.stack) || String(e)) + "\nrequests: " + JSON.stringify(requests) }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const q = (page, v) => page.document.querySelector(`[data-daily-subscription="${v}"]`);
const subRequests = () => requests.filter((r) => r.body && (r.body.action === "subscription" || r.body.action === "subscription_set"));
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));
const dashboardUp = (page) => page.document.querySelector(".kpi-card-link") !== null || page.document.querySelector('[data-c1="fin-unavailable"]') !== null;
const cold = async (p) => (await apps.cold.database().ref(p).get()).val();
async function boot(user) {
  CLAIMS = { uid: user.uid, email: user.email };
  requests.length = 0;
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp: apps[user.uid], user, session: { ["marjin_tid_" + user.uid]: T, ["marjin_biz_" + user.uid]: B }, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl });
  page.window.TextEncoder = TextEncoder;
  await page.until(() => dashboardUp(page) || page.document.querySelector(".mhd-nav") !== null, 25000);
  return page;
}
const openPanel = async (page) => { const b = q(page, "open"); expect(b, "the labelled control"); eq(textOf(b), "קבלת דוח יומי במייל", "the control label"); click(b); await page.until(() => q(page, "switch") !== null, 5000); };
const switchState = (page) => { const s = q(page, "switch"); return { checked: s.checked, disabled: s.disabled }; };

async function main() {
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.cold = admin.initializeApp({ databaseURL: DB_URL }, "cold");
  for (const u of [OWNER, VIEWER, MANAGER]) apps[u.uid] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: u.uid, token: { email: u.email } } }, u.uid);
  globalThis.__DB = new Proxy(apps.seed.database(), { get(t, k) {
    if (k === "ref") return (p, ...a) => { const r = t.ref(p, ...a); return p === SUB ? new Proxy(r, { get(rt, rk) { if (rk === "once" && fault.read) return async () => { throw new Error("injected-store-fault"); }; const v = rt[rk]; return typeof v === "function" ? v.bind(rt) : v; } }) : r; };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(RULES) });
  if (!res.ok) throw new Error("rules load failed: " + res.status);
  const seed = async (f) => { await apps.seed.database().ref("/").set(fixtures(f)); fault.read = false; };

  await run("DSR-00", "owner, nothing stored: no request on load; the control opens the panel; one read; default OFF and usable; no address", async () => {
    await seed({});
    const page = await boot(OWNER);
    try {
      await page.sleep(1500);
      expect(dashboardUp(page), "dashboard up");
      eq(subRequests().length, 0, "nothing about the subscription is requested on page load");
      eq(q(page, "switch"), null, "the panel is closed until opened");
      await openPanel(page);
      await page.until(() => !switchState(page).disabled, 5000);
      eq(subRequests().map(({ reply, ...r }) => r), [{ method: "POST", body: { tenantId: T, bizId: B, action: "subscription" }, auth: true }], "exactly one read with the exact body");
      eq([subRequests()[0].reply.status, subRequests()[0].reply.body.enabled, subRequests()[0].reply.body.explicit], [200, false, false], "the server's default OFF");
      eq(switchState(page), { checked: false, disabled: false }, "default OFF, usable");
      eq(textOf(q(page, "label")), "קבלת דוח יומי במייל", "the label");
      const panel = page.document.querySelector('[role="dialog"]');
      expect(panel && !/@/.test(panel.textContent) && panel.querySelectorAll("input").length === 1, "one switch and no address in the panel");
      eq(q(page, "error"), null, "no error line");
      eq(await cold(SUB), null, "a read writes nothing");
      eq(globalThis.__SMTP.calls.length, 0, "no provider call");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("DSR-01", "owner turns it ON then OFF through the switch: one change request each; the stored record and the switch follow the server", async () => {
    await seed({});
    let page = await boot(OWNER);
    try {
      await openPanel(page); await page.until(() => !switchState(page).disabled, 5000);
      click(q(page, "switch"));
      await page.until(() => switchState(page).checked === true && !switchState(page).disabled, 5000);
      const sets = subRequests().filter((r) => r.body.action === "subscription_set");
      eq(sets.map(({ reply, ...r }) => r), [{ method: "POST", body: { tenantId: T, bizId: B, action: "subscription_set", enabled: true }, auth: true }], "one change request");
      const stored = await cold(SUB);
      eq([Object.keys(stored).sort(), stored.schema, stored.enabled, stored.version, stored.updatedByRole, Number.isSafeInteger(stored.updatedAt)],
        [["enabled", "schema", "updatedAt", "updatedByRole", "version"], 1, true, 1, "owner", true], "the stored record (no address, no uid)");
      eq([sets[0].reply.status, sets[0].reply.body.version, sets[0].reply.body.changed], [200, 1, true], "the server's confirmation");
    } finally { page.detach(); }
    page = await boot(OWNER);
    try {
      await openPanel(page); await page.until(() => switchState(page).checked === true, 5000);
      eq(switchState(page), { checked: true, disabled: false }, "a fresh page reads the stored ON back");
      click(q(page, "switch"));
      await page.until(() => switchState(page).checked === false && !switchState(page).disabled, 5000);
      const stored = await cold(SUB);
      eq([stored.enabled, stored.version, stored.updatedByRole], [false, 2, "owner"], "the stored OFF");
      eq(globalThis.__SMTP.calls.length, 0, "no provider call");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("DSR-02", "the preference cannot be read: the switch stays OFF and disabled, the error line shows, nothing is written, the page is usable", async () => {
    await seed({});
    fault.read = true;
    const page = await boot(OWNER);
    try {
      await openPanel(page);
      await page.until(() => q(page, "error") !== null, 8000);
      eq(subRequests().map((r) => [r.body.action, r.reply.status]), [["subscription", 503]], "one read, refused as unavailable");
      eq(switchState(page), { checked: false, disabled: true }, "unconfirmed: OFF and not changeable");
      eq(textOf(q(page, "error")), "לא ניתן לעדכן כעת. נסו שוב מאוחר יותר.", "the error line");
      click(q(page, "close")); await page.sleep(200);
      eq(q(page, "switch"), null, "the panel closes");
      expect(dashboardUp(page), "the page is usable");
      eq(await cold(SUB), null, "nothing written");
    } finally { page.detach(); fault.read = false; }
  });

  await run("DSR-03", "viewer and manager: no control, zero subscription requests, the stored preference unchanged", async () => {
    await seed({});
    const rec = { schema: 1, enabled: true, version: 1, updatedAt: 0, updatedByRole: "owner" };
    await apps.seed.database().ref(SUB).set(rec);
    for (const user of [VIEWER, MANAGER]) {
      await apps.seed.database().ref(`user_active_biz/${user.uid}`).set(B);
      const page = await boot(user);
      try {
        await page.sleep(1500);
        eq(q(page, "open"), null, user.displayName + ": no control");
        eq(subRequests().length, 0, user.displayName + ": zero subscription requests");
        eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
      } finally { page.detach(); }
    }
    eq(await cold(SUB), rec, "unchanged");
  });

  for (const a of Object.values(apps)) await a.delete().catch(() => {});
  console.log(JSON.stringify({ results, failures }, null, 1));
  console.log(`DSR_RENDERED total=${results.length} pass=${results.length - failures} fail=${failures}`);
  process.exitCode = failures || results.length !== 4 ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
