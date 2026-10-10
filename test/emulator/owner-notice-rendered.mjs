// Owner-notice UI R1 (LOCAL; pending independent Codex review) — the patched page rendered over the real local RTDB emulator
// with the delivery R7 route answering `action: "notice"`. The working-tree index.html boots in jsdom
// (test/historical/historical-page-harness.mjs: the pinned real React / Babel, the page's own Firebase module over the
// Admin SDK with the acting member's auth override, the page's own Financial Core); every `/api/daily-snapshot/run` request
// the page makes goes to the ACTUAL compiled R7 route handler (its harness sandbox: Admin / auth / provider seams only) over
// the SAME emulator; the page's Bearer token is mapped to the acting member's claims. DIAGNOSTIC, MIXED-TREE EVIDENCE: the
// route comes from the delivery R7 checkout named by R7_TREE (the M1 R5 base of this page carries no DE1 layer); it shows
// the page against the contract it depends on, it closes no integration gate.
//   UN-00  control (named business): no alert; exactly ONE read — POST /api/daily-snapshot/run with the exact body
//          { tenantId, bizId, action: "notice" } and the page's Authorization header; the dashboard renders; no fatal error
//   UN-01  the business has no name and the server holds a notice (recorded by the scheduled run's own writer): the alert
//          renders the exact decided sentence, the stored business date, and a "fix business details" control that opens
//          the EXISTING settings wizard (no repair action of its own)
//   UN-02  no name, nothing stored: the alert (the server-confirmed business state), without a date line
//   UN-03  correction through the real repair flow: the owner saves a name in the settings wizard → the page re-reads → the
//          server confirms (clears the stored notice — acknowledged) → the alert is gone
//   UN-04  the notice store cannot be read (fault injected on the real store, the route answers 503 unavailable): nothing is
//          shown, the page is fully usable; then, with the alert visible, a failed re-read (switch away and back) keeps it
//          visible — a failed read is never "resolved"
//   UN-05  a viewer and a manager: the page never asks (zero requests) and shows nothing; the server would refuse anyway
//          (DR7-06 / R7E1); the owner of another tenant never sees this tenant's business
//   UN-06  the request is unreachable (fetch throws) / answers a reply of another shape: nothing shown, page usable
//   UN-07  a business named "Unknown" is a named business: no alert (D-G4)
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner:
//   R7_TREE=<delivery R7 checkout> bash test/support/p1-r7-emu-run.sh <this checkout> <abs log dir> un=test/emulator/owner-notice-rendered.mjs
import admin from "firebase-admin";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { TextEncoder } from "node:util";
import { bootHistoricalPage, depsStatus, click, textOf, findByText } from "../historical/historical-page-harness.mjs";
import { loadFinance } from "../support/c1-seam.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  if (process.env.FIREBASE_DATABASE_URL) fail("FIREBASE_DATABASE_URL must be absent");
}
// INTEGRATION I1: on the integrated tree the page and the route it depends on are in the SAME checkout — the route is this
// tree's own (single-tree evidence, no mixed tree); R7_TREE remains for the historical diagnostic run on the M1 R5 base.
const { isI1Tree } = await import(pathToFileURL(join(ROOT, "test", "support", "i1-integration.mjs")).href).catch(() => ({ isI1Tree: () => false }));
const INTEGRATED = !process.env.R7_TREE && isI1Tree(ROOT);
const R7_TREE = process.env.R7_TREE || (INTEGRATED ? ROOT : null);
if (!R7_TREE) fail("R7_TREE (the delivery R7 checkout that serves action: \"notice\") is required");
const RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed: " + res.status);
}
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const OUT = process.env.UN_OUT || null;   // optional: a directory for DOM snapshots of the rendered states

// ── the REAL delivery R7 route (its harness sandbox over THIS emulator) ─────────────────────────────────────────────────
const H = await import(pathToFileURL(join(R7_TREE, "test", "support", "daily-email-harness.mjs")).href);
const D = await import(pathToFileURL(join(R7_TREE, "lib", "emailDelivery.js")).href);
const { route } = await H.buildSandbox({ fresh: true });
H.installSmtp([H.SMTP.accept()]);
const fault = { path: null, read: false, remove: false, refs: 0 };
const faulty = (r) => new Proxy(r, { get(t, k) {
  if (k === "once" && fault.read) return async () => { throw new Error("injected-store-fault"); };
  if (k === "remove" && fault.remove) return async () => { throw new Error("injected-store-fault"); };
  const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
} });
let CLAIMS = null;                                          // the acting member, mapped from the page's Bearer token
const requests = [];                                        // every /api/daily-snapshot/run request the page made
let fetchMode = "real";                                     // "real" | "throw" | "r5-shape"
const resp = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
const fetchImpl = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("/api/config")) return resp(200, { apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT });
  if (u === "/api/daily-snapshot/run") {
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    const auth = opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization);
    requests.push({ method: opts && opts.method, body, auth: typeof auth === "string" && auth.startsWith("Bearer ") });
    if (fetchMode === "throw") throw new TypeError("Failed to fetch");
    if (fetchMode === "r5-shape") return resp(200, { status: "ok", tenantId: body.tenantId, bizId: body.bizId, deliverable: false, code: "business_name_unavailable", notice: { code: "business_name_unavailable", message: "synthetic", tenantId: body.tenantId, bizId: body.bizId, businessDate: null, firstSeenAt: 0, lastSeenAt: 0, runs: 0 } });
    globalThis.__DE = { requireAuth: async () => { if (!auth || !CLAIMS) throw Object.assign(new Error("unauthorized"), { status: 401, msg: "unauthorized" }); return CLAIMS; } };
    const r = H.mkRes();
    await route({ method: (opts && opts.method) || "GET", headers: { authorization: auth ? "Bearer page" : "" }, query: {}, body }, r);
    requests[requests.length - 1].reply = { status: r.statusCode, body: r.body };
    return resp(r.statusCode, r.body);
  }
  return resp(404, { error: "not_available_in_harness" });
};

// ── the world ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const AS_OF = `${MONTH}-12`, TARGET_MS = Date.parse(`${AS_OF}T07:00:00Z`), CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const T = "tenantA", B = "bizA", B2 = "bizB", T2 = "tenantB", B3 = "bizC";
const OWNER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const VIEWER = { uid: "u_viewer", email: "v@demo.example", displayName: "viewer1" };
const MANAGER = { uid: "u_manager", email: "m@demo.example", displayName: "manager1" };
const OWNER_B = { uid: "u_owner_b", email: "ob@demo.example", displayName: "ownerb" };
const env = (v) => ({ _v: JSON.stringify(v) });
const ROWS = []; for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`, date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0 });
const CONFIG = (name) => ({ businessName: name, rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [] });
const FIXED = [{ id: "f1", name: "Utilities", amount: "3100" }];
const USERS = [
  { id: 1, username: "owner1", name: "בעלים", email: OWNER.email, role: "owner", firebaseUid: OWNER.uid },
  { id: 2, username: "viewer1", name: "צופה", email: VIEWER.email, role: "viewer", firebaseUid: VIEWER.uid, allowedBizIds: [B, B2] },
  { id: 3, username: "manager1", name: "מנהל", email: MANAGER.email, role: "manager", firebaseUid: MANAGER.uid, allowedBizIds: [B, B2] },
];
const bizNodes = (b, name) => ({ [`biz:${b}:entries`]: env(ROWS), [`biz:${b}:config`]: env(CONFIG(name)), [`biz:${b}:fixed`]: env(FIXED), [`biz:${b}:suppliers`]: env([]) });
// nameA: a string = the registry name; null = the record has NO name key at all
const fixtures = ({ nameA = "סניף א", nameB = "סניף ב", activeUid = OWNER.uid, activeBiz = B } = {}) => ({
  tenants: {
    [T]: {
      members: { [OWNER.uid]: true, [VIEWER.uid]: true, [MANAGER.uid]: true }, roles: { [OWNER.uid]: "owner", [VIEWER.uid]: "viewer", [MANAGER.uid]: "manager" },
      biz_access: { [B]: { [VIEWER.uid]: true, [MANAGER.uid]: true }, [B2]: { [VIEWER.uid]: true, [MANAGER.uid]: true } },
      app: { users: env(USERS), business: env([{ id: B, ...(nameA === null ? {} : { name: nameA }) }, { id: B2, name: nameB }]) },
      ...bizNodes(B, "סניף א (config)"), ...bizNodes(B2, nameB),
    },
    [T2]: {
      members: { [OWNER_B.uid]: true }, roles: { [OWNER_B.uid]: "owner" },
      app: { users: env([{ id: 1, username: "ownerb", name: "בעלים ב", email: OWNER_B.email, role: "owner", firebaseUid: OWNER_B.uid }]), business: env([{ id: B3, name: "סניף ג" }]) },
      ...bizNodes(B3, "סניף ג"),
    },
  },
  user_tenants: { [OWNER.uid]: T, [VIEWER.uid]: T, [MANAGER.uid]: T, [OWNER_B.uid]: T2 },
  user_active_biz: { [activeUid]: activeBiz },
  username_index: { owner1: { tenantId: T, email: OWNER.email }, viewer1: { tenantId: T, email: VIEWER.email }, manager1: { tenantId: T, email: MANAGER.email }, ownerb: { tenantId: T2, email: OWNER_B.email } },
});
const NOTICE = D.deliveryNoticePath(T, B);

const apps = {};
const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function run(id, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); console.log("PASS " + id); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: ((e && e.stack) || String(e)) + "\nrequests: " + JSON.stringify(requests) + "\nregistry: " + JSON.stringify(await cold(`tenants/${T}/app/business`)) }); console.log("FAIL " + id + " — " + (e && e.message)); }
}
const alertEl = (page) => page.document.querySelector('[data-daily-notice="active"]');
const alertText = (page) => textOf(page.document.querySelector('[data-daily-notice="message"]'));
const dateLine = (page) => page.document.querySelector('[data-daily-notice="date"]');
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));
const dashboardUp = (page) => page.document.querySelector(".kpi-card-link") !== null || page.document.querySelector('[data-c1="fin-unavailable"]') !== null;
const snapshot = (name, page) => { if (!OUT) return; mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, name + ".html"), `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${Array.from(page.document.querySelectorAll("style")).map((s) => s.textContent).join("\n")}</style></head><body>${page.document.getElementById("root").outerHTML}</body></html>`); };
const HE = D.MISSING_NAME_NOTICE_HE;
const stored = async () => (await apps.seed.database().ref(NOTICE).get()).val();
const cold = async (p) => (await apps.cold.database().ref(p).get()).val();

async function boot(user, { session, adminApp } = {}) {
  CLAIMS = { uid: user.uid, email: user.email };
  requests.length = 0;
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp: adminApp || apps[user.uid], user, session: session || { ["marjin_tid_" + user.uid]: T, ["marjin_biz_" + user.uid]: B }, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl });
  page.window.TextEncoder = TextEncoder;
  await page.until(() => dashboardUp(page) || page.document.querySelector(".mhd-nav") !== null, 25000);
  return page;
}
const settle = (page, ms = 1500) => page.sleep(ms);
/** Switch the selected business through the page's own switcher (the mobile header's "החלף סניף" → the modal's N-th business). */
const switchBiz = async (page, index) => {
  const open = page.document.querySelector("button.mhd-switch"); expect(open, "the business switcher control (mhd-switch)"); click(open); await page.sleep(300);
  const h2 = findByText(page.document, "h2", "בחירת סניף"); expect(h2, "the switcher modal");
  const modal = h2.parentElement.parentElement;
  const rows = Array.from(modal.querySelectorAll("button")).filter((b) => /flex/.test(b.getAttribute("style") || "") && !textOf(b).startsWith("+") && !b.querySelector("svg"));
  expect(rows[index], "business #" + index + " in the switcher (" + rows.length + " rows)"); click(rows[index]); await page.sleep(300);
};

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.cold = admin.initializeApp({ databaseURL: DB_URL }, "cold");
  for (const u of [OWNER, VIEWER, MANAGER, OWNER_B]) apps[u.uid] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: u.uid, token: { email: u.email } } }, u.uid);
  globalThis.__DB = new Proxy(apps.seed.database(), { get(t, k) {
    if (k === "ref") return (p, ...a) => { const r = t.ref(p, ...a); if (p === fault.path) { fault.refs++; return faulty(r); } return r; };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  await loadRules(RULES);
  const seed = async (f) => { await apps.seed.database().ref("/").set(fixtures(f)); fault.path = null; fault.read = false; fault.remove = false; fault.refs = 0; fetchMode = "real"; };
  const recordNotice = async (runs = 1) => { for (let i = 0; i < runs; i++) eq(await D.recordMissingNameNotice(apps.seed.database(), { tenantId: T, bizId: B, businessDate: d(11), nowMs: TARGET_MS + i * 1000 }), "recorded", "notice recorded by the server's writer"); };

  await run("UN-00", "control: a named business — no alert, exactly one authorized read with the exact body, the dashboard renders", async () => {
    await seed({});
    const page = await boot(OWNER);
    try {
      await settle(page);
      expect(dashboardUp(page), "dashboard up");
      eq(alertEl(page), null, "no alert");
      eq(requests.length, 1, "exactly one read: " + JSON.stringify(requests));
      const { reply, ...req0 } = requests[0];
      eq(JSON.stringify(req0), JSON.stringify({ method: "POST", body: { tenantId: T, bizId: B, action: "notice" }, auth: true }), "the exact request");
      eq(JSON.stringify([reply.status, reply.body.deliverable, reply.body.noticeState, reply.body.clearState]), JSON.stringify([200, true, "none", "not_needed"]), "the route's reply (R7 contract)");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
      eq(await stored(), null, "nothing written");
      snapshot("UN-00-named-no-alert", page);
    } finally { page.detach(); }
  });

  await run("UN-01", "no name + a stored notice: the alert with the exact sentence, the stored date, and the existing settings wizard as the repair link", async () => {
    await seed({ nameA: null });
    await recordNotice(2);
    const page = await boot(OWNER);
    try {
      await page.until(() => alertEl(page) !== null, 10000);
      eq(alertText(page), HE, "the decided sentence");
      expect(dateLine(page) && textOf(dateLine(page)).includes(d(11)), "the stored business date: " + textOf(dateLine(page)));
      eq(page.document.querySelector('[data-daily-notice="message"]').textContent.includes("synthetic"), false, "never a stored / synthetic message");
      expect(dashboardUp(page), "the page is usable with the alert");
      eq(requests.length, 1, "one read");
      eq((await stored()).runs, 2, "the read never changes the stored notice");
      snapshot("UN-01-nameless-alert", page);
      const fix = page.document.querySelector('[data-daily-notice="settings"]'); expect(fix, "the repair link");
      click(fix); await page.sleep(400);
      expect(page.document.querySelector(".wizard-title"), "the EXISTING settings wizard opened (no repair action of its own)");
      snapshot("UN-01-settings-wizard", page);
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("UN-02", "no name, nothing stored: the alert from the server-confirmed business state, no date line, nothing written", async () => {
    await seed({ nameA: "   " });
    const page = await boot(OWNER);
    try {
      await page.until(() => alertEl(page) !== null, 10000);
      eq(alertText(page), HE, "the decided sentence"); eq(dateLine(page), null, "no date line");
      eq(await stored(), null, "the read never writes");
      snapshot("UN-02-nameless-no-record", page);
    } finally { page.detach(); }
  });

  await run("UN-03", "correction through the real repair flow: the owner saves a name in the settings wizard → re-read → the server confirms and clears → the alert is gone", async () => {
    await seed({ nameA: "" });
    await recordNotice(1);
    const page = await boot(OWNER);
    try {
      await page.until(() => alertEl(page) !== null, 10000);
      click(page.document.querySelector('[data-daily-notice="settings"]')); await page.sleep(400);
      const w = page.window;
      const name = page.document.querySelector('input[placeholder="למשל: קפה ירושלמי"]'); expect(name, "wizard step 1 (business name)");
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set.call(name, "סניף א מתוקן"); name.dispatchEvent(new w.Event("input", { bubbles: true })); await page.sleep(100);
      const nextBtn = () => Array.from(page.document.querySelectorAll("button.btn-primary")).find((b) => textOf(b) === "המשך");
      for (let s = 1; s <= 4; s++) { const b = nextBtn(); expect(b, "next button at step " + s); click(b); await page.sleep(200); }
      const fin = nextBtn(); expect(fin, "finish button"); click(fin);
      for (let i = 0; i < 60 && page.document.querySelector(".wizard-title"); i++) await page.sleep(200);
      expect(!page.document.querySelector(".wizard-title"), "the wizard closed after the save");
      const reg = JSON.parse((await cold(`tenants/${T}/app/business`))._v);
      eq(reg.find((b) => b.id === B).name, "סניף א מתוקן", "the registry record carries the saved name (the authorized edit flow)");
      await page.until(() => alertEl(page) === null && requests.length >= 2, 10000);
      eq(alertEl(page), null, "the alert is gone after the server confirmed");
      const last = requests[requests.length - 1]; eq(JSON.stringify(last.body), JSON.stringify({ tenantId: T, bizId: B, action: "notice" }), "the re-read");
      eq(await cold(NOTICE), null, "the stored notice was cleared by the server (acknowledged)");
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
      snapshot("UN-03-corrected", page);
    } finally { page.detach(); }
  });

  await run("UN-04", "the store cannot be read: nothing shown, page usable; a failed re-read never hides a visible alert", async () => {
    await seed({ nameA: null }); await recordNotice(1);
    fault.path = NOTICE; fault.read = true;
    let page = await boot(OWNER);
    try {
      await settle(page, 2000);
      eq(alertEl(page), null, "nothing shown on an unreadable store (unknown, never 'resolved' and never invented)");
      expect(dashboardUp(page), "the page is usable");
      eq(requests.length, 1, "one read"); eq(fault.refs >= 1, true, "the route did consult the store");
      eq((await stored()).runs, 1, "the stored notice is untouched");
      snapshot("UN-04a-store-unreadable-nothing-shown", page);
    } finally { page.detach(); }
    // the alert is visible, then the store breaks and the owner switches away and back: the re-read fails, the alert stays
    await seed({ nameA: null }); await recordNotice(1);
    page = await boot(OWNER);
    try {
      await page.until(() => alertEl(page) !== null, 10000);
      fault.path = NOTICE; fault.read = true;
      await switchBiz(page, 1); await settle(page);
      eq(alertEl(page), null, "the named business B2 shows no alert");
      await switchBiz(page, 0); await settle(page);
      await page.until(() => requests.length >= 3, 10000);
      expect(alertEl(page), "the alert for A is still shown after a failed re-read");
      eq(alertEl(page).getAttribute("data-daily-notice-stale"), "1", "marked as not refreshed");
      eq(alertText(page), HE);
      snapshot("UN-04b-failed-reread-keeps-alert", page);
      eq(fatalErrors(page).length, 0, "fatal page errors: " + fatalErrors(page).join(" | "));
    } finally { page.detach(); }
  });

  await run("UN-05", "a viewer and a manager never ask and never see the alert; another tenant's owner cannot select this business", async () => {
    await seed({ nameA: null }); await recordNotice(1);
    for (const u of [VIEWER, MANAGER]) {
      const page = await boot(u, { session: { ["marjin_tid_" + u.uid]: T, ["marjin_biz_" + u.uid]: B } });
      try {
        await settle(page, 2000);
        eq(requests.length, 0, u.displayName + ": the page never asks");
        eq(alertEl(page), null, u.displayName + ": no alert");
        eq(textOf(page.document.getElementById("root")).includes(HE), false, u.displayName + ": the sentence appears nowhere in the rendered page");
        snapshot("UN-05-" + u.displayName + "-no-alert", page);
      } finally { page.detach(); }
    }
    // the owner of tenant B: their page is bound to tenant B; a read for tenant A's business is refused by the server
    const page = await boot(OWNER_B, { session: { ["marjin_tid_" + OWNER_B.uid]: T2, ["marjin_biz_" + OWNER_B.uid]: B3 } });
    try {
      await settle(page, 2000);
      eq(alertEl(page), null, "no alert for tenant B's owner");
      for (const r of requests) eq(r.body.tenantId, T2, "every read names the owner's own tenant");
      CLAIMS = { uid: OWNER_B.uid, email: OWNER_B.email };
      const r = await fetchImpl("/api/daily-snapshot/run", { method: "POST", headers: { Authorization: "Bearer page" }, body: JSON.stringify({ tenantId: T, bizId: B, action: "notice" }) });
      expect([401, 403].includes(r.status), "a cross-tenant read is refused by the route: " + r.status);
      const body = await r.json(); eq(body.noticeState, undefined, "no notice fields for another tenant's owner");
    } finally { page.detach(); }
  });

  await run("UN-06", "the request is unreachable / answers another shape: nothing shown, the page usable", async () => {
    await seed({ nameA: null }); await recordNotice(1);
    fetchMode = "throw";
    let page = await boot(OWNER);
    try { await settle(page, 2000); eq(alertEl(page), null, "fetch threw: nothing shown"); expect(dashboardUp(page), "usable"); eq(fatalErrors(page).length, 0, "no fatal error"); } finally { page.detach(); }
    fetchMode = "r5-shape";
    page = await boot(OWNER);
    try { await settle(page, 2000); eq(alertEl(page), null, "a reply without the R7 fields (a synthesized R5 record) is not authoritative: nothing shown"); eq(page.document.body.textContent.includes("synthetic"), false); } finally { page.detach(); }
  });

  await run("UN-07", "a business named \"Unknown\" is a named business: no alert (D-G4)", async () => {
    await seed({ nameA: "Unknown" });
    const page = await boot(OWNER);
    try { await settle(page, 2000); eq(alertEl(page), null, "no alert"); eq(requests.length, 1, "one read"); const r = requests[0]; eq(r.body.bizId, B); } finally { page.detach(); }
  });

  if (INTEGRATED) await run("UN-08", "INTEGRATED full chain: the REAL scheduled run (registry → canonical source → Builder accounting → delivery → receipt) records the notice for a nameless business and delivers the named one; the page shows the alert for that recorded run; repair → re-read clears → the next run delivers it", async () => {
    await seed({ nameA: null });
    H.installSmtp([H.SMTP.accept()]);
    const cron = async (ms) => { const u = H.freezeClock(ms); try { return await H.runCron(route); } finally { u(); } };
    const r1 = await cron(TARGET_MS);
    const row = (r, b) => (r.body.results || []).find((x) => x.tenantId === T && x.bizId === b);
    eq(r1.statusCode, 500, "a nameless business makes the run completed_with_failures: " + JSON.stringify(r1.body).slice(0, 400));
    eq(JSON.stringify([row(r1, B).outcome, row(r1, B).code, row(r1, B).settlement, row(r1, B).receipt, row(r1, B).notice]), JSON.stringify(["failed", "business_name_unavailable", "failed", "not_written", "recorded"]), "the failed row (scheduled G4)");
    eq(row(r1, B2).settlement, "delivered", "the named business of the same tenant is delivered");
    eq(globalThis.__SMTP.calls.length, 2, "two provider calls: the named business of tenant A and tenant B's business");
    eq(await cold(`email_delivery/daily_snapshot/${T}/${B}`), null, "no receipt for the nameless business (real store)");
    eq((await cold(`email_delivery/daily_snapshot/${T}/${B2}/${r1.body.businessDate}`)).state, "accepted", "the named business's receipt on the real store");
    const n = await stored();
    eq(JSON.stringify([n.code, n.message, n.businessDate, n.runs]), JSON.stringify(["business_name_unavailable", HE, r1.body.businessDate, 1]), "the notice the scheduled run recorded");
    const page = await boot(OWNER);
    try {
      await page.until(() => alertEl(page) !== null, 10000);
      eq(alertText(page), HE, "the decided sentence");
      expect(dateLine(page) && textOf(dateLine(page)).includes(r1.body.businessDate), "the recorded run's business date: " + textOf(dateLine(page)));
      eq(requests.length, 1, "one read, through the authorized route");
      eq(requests[0].reply.body.noticeState, "active", "the server confirms the stored notice");
      eq(globalThis.__SMTP.calls.length, 2, "the notice read made zero provider calls");
      snapshot("UN-08-integrated-scheduled-alert", page);
    } finally { page.detach(); }
    // repair through the authorized registry path (the same record identity), then the owner's read clears the notice
    await apps.seed.database().ref(`tenants/${T}/app/business`).set(env([{ id: B, name: "סניף א" }, { id: B2, name: "סניף ב" }]));
    const page2 = await boot(OWNER);
    try { await settle(page2, 2000); eq(alertEl(page2), null, "no alert after the repair"); eq(requests[0].reply.body.clearState, "cleared", "the server cleared the stored notice (acknowledged)"); } finally { page2.detach(); }
    eq(await cold(NOTICE), null, "the notice is gone from the real store");
    const r2 = await cron(TARGET_MS + 60 * 60 * 1000);
    eq(JSON.stringify([r2.statusCode, row(r2, B).settlement, row(r2, B2).code, globalThis.__SMTP.calls.length]), JSON.stringify([200, "delivered", "already_accepted", 3]), "the repaired business is delivered once; nothing is re-sent");
  });

  for (const a of Object.values(apps)) await a.delete().catch(() => {});
  console.log(JSON.stringify({ results, failures }, null, 1));
  process.exitCode = failures ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
