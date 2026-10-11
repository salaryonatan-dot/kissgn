// Agent/Daily integration I2 (LOCAL; pending independent Codex review) — rendered regression for I1-R-03: the page's entries
// listener must tolerate a value that Firebase delivers SYNCHRONOUSLY inside onValue() (the value is already in the client
// cache). The working-tree index.html boots in jsdom (test/historical/historical-page-harness.mjs: the pinned real React /
// Babel, the page's own Firebase module over the Admin SDK with the acting member's auth override, the page's own Financial
// Core) over the real local RTDB emulator. Nothing in the page is stubbed or patched: the synchronous delivery is produced by
// the real SDK, by warming its cache before the page subscribes. The test only OBSERVES (a transparent wrapper around the
// member's Admin app records whether the entries callback ran before onValue() returned) so a pass is never vacuous.
//   EH-00  control: a cold client — the entries value arrives asynchronously; the dashboard renders the stored month; no error
//   EH-01  the entries node is already cached (another live listener on the same node in the same client): the page's entries
//          callback is delivered DURING registration; the page hydrates the same month, no ReferenceError, no uncaught throw
//   EH-02  every node the page subscribes for the business (entries, config, fixed, suppliers, users, registry) is cached:
//          each of those page listeners may fire synchronously; the same result
//   EH-03  the I1-R-03 sequence: a first page of the same member is left attached (as a boot that timed out leaves it), then
//          a second page boots for the same member and business: it hydrates without error
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner:
//   bash test/support/p1-r7-emu-run.sh <this checkout> <abs log dir> eh=test/emulator/entries-hydrate-immediate.mjs
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TextEncoder } from "node:util";
import { bootHistoricalPage, depsStatus, textOf } from "../historical/historical-page-harness.mjs";
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
const RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

// ── the world (the owner-notice harness's shapes; a named business with eleven stored days) ───────────────────────────
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const AS_OF = `${MONTH}-12`, TARGET_MS = Date.parse(`${AS_OF}T07:00:00Z`), CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const T = "tenantA", B = "bizA", B2 = "bizB";
const OWNER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const ROWS = []; for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`, date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0 });
const CONFIG = (name) => ({ businessName: name, rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [] });
const FIXED = [{ id: "f1", name: "Utilities", amount: "3100" }];
const USERS = [{ id: 1, username: "owner1", name: "בעלים", email: OWNER.email, role: "owner", firebaseUid: OWNER.uid }];
const bizNodes = (b, name) => ({ [`biz:${b}:entries`]: env(ROWS), [`biz:${b}:config`]: env(CONFIG(name)), [`biz:${b}:fixed`]: env(FIXED), [`biz:${b}:suppliers`]: env([]) });
const fixtures = () => ({
  tenants: { [T]: {
    members: { [OWNER.uid]: true }, roles: { [OWNER.uid]: "owner" },
    app: { users: env(USERS), business: env([{ id: B, name: "סניף א" }, { id: B2, name: "סניף ב" }]) },
    ...bizNodes(B, "סניף א"), ...bizNodes(B2, "סניף ב"),
  } },
  user_tenants: { [OWNER.uid]: T },
  user_active_biz: { [OWNER.uid]: B },
  username_index: { owner1: { tenantId: T, email: OWNER.email } },
});
const ENTRIES = `tenants/${T}/biz:${B}:entries`;   // the page's entries listener path (window.storage.subscribeNode)

// ── observation only: a transparent wrapper that records whether a value callback ran INSIDE on() ─────────────────────
function observed(app) {
  const db = app.database();
  const log = { sync: [], async: [] };
  const wrapRef = (r, path) => new Proxy(r, { get(t, k) {
    if (k === "on") return (evt, cb, ...rest) => {
      let inside = true;
      const w = function (snap) { (inside ? log.sync : log.async).push(path); return cb.apply(this, arguments); };
      const h = t.on(evt, w, ...rest); inside = false; return h;
    };
    const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
  } });
  const pdb = new Proxy(db, { get(t, k) { if (k === "ref") return (p, ...a) => wrapRef(t.ref(p, ...a), p); const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
  return { app: { database: () => pdb, name: app.name, options: app.options }, log };
}

// Firebase's exceptionGuard re-throws a callback's exception asynchronously (an uncaught exception): record it, never crash
const uncaught = [];
process.on("uncaughtException", (e) => { uncaught.push((e && e.stack) || String(e)); });

const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function run(id, description, fn) {
  const t0 = Date.now(); const u0 = uncaught.length;
  try {
    const n = await fn();
    await new Promise((r) => setTimeout(r, 300));
    eq(uncaught.length - u0, 0, "uncaught exceptions: " + uncaught.slice(u0).join(" | "));
    results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); console.log("PASS " + id + (n ? " — " + n : ""));
  } catch (e) {
    failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: ((e && e.stack) || String(e)) + (uncaught.length > u0 ? "\nuncaught: " + uncaught.slice(u0).join(" | ") : "") });
    console.log("FAIL " + id + " — " + (e && e.message));
  }
}
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|before initialization|Minified React error/.test(e));
const dashboardUp = (page) => page.document.querySelector(".kpi-card-link") !== null || page.document.querySelector('[data-c1="fin-unavailable"]') !== null;
const MONTH_SALES = /11[,.]?000/;          // eleven stored days × 1,000: the stored month reached the dashboard (hydrated)
const mtd = (page) => page.document.querySelector('[data-c1="mtd-revenue"]');
const hydrated = (page) => mtd(page) !== null && MONTH_SALES.test(textOf(mtd(page)));
// the two server lists the dashboard reads are answered by the REAL server repositories (as in c1-rendered-surfaces)
const jsonResp = (body) => ({ ok: true, status: 200, json: async () => body });
const fetchImpl = async (url) => {
  const u = String(url);
  if (u.startsWith("/api/config")) return jsonResp({ apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT });
  if (u.startsWith("/api/admin?action=list-entry-exceptions")) {
    const p = new URL(u, "http://x").searchParams;
    const { listEntryExceptions } = await import("../../lib/repositories/entryExceptionsRepo.js");
    const exceptions = await listEntryExceptions({ tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate") });
    return jsonResp({ ok: true, tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate"), exceptions });
  }
  if (u.startsWith("/api/admin?action=list-supplier-credits")) {
    const p = new URL(u, "http://x").searchParams;
    const { readSupplierCredits } = await import("../../lib/repositories/supplierCreditsRepo.js");
    return jsonResp({ ok: true, tenantId: p.get("tenantId"), bizId: p.get("bizId"), node: await readSupplierCredits({ tenantId: p.get("tenantId"), bizId: p.get("bizId") }) });
  }
  return { ok: false, status: 404, json: async () => ({ error: "not_available_in_harness" }), text: async () => "" };
};
async function boot(adminApp) {
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp, user: OWNER, session: { ["marjin_tid_" + OWNER.uid]: T, ["marjin_biz_" + OWNER.uid]: B }, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl });
  page.window.TextEncoder = TextEncoder;
  return page;
}
async function bootAndCheck(adminApp, label) {
  const page = await boot(adminApp);
  try {
    await page.until(() => dashboardUp(page) || fatalErrors(page).length > 0, 25000);
    eq(fatalErrors(page).length, 0, label + ": fatal page errors: " + fatalErrors(page).join(" | "));
    await page.until(() => hydrated(page) || fatalErrors(page).length > 0, 15000).catch(() => {});
    eq(fatalErrors(page).length, 0, label + ": fatal page errors: " + fatalErrors(page).join(" | "));
    expect(hydrated(page), label + ": the stored month (11,000) is the dashboard's MTD revenue: " + JSON.stringify(textOf(mtd(page))) + " / " + textOf(page.document.querySelector('[data-c1="fin-unavailable"]')));
    return page;
  } catch (e) { page.detach(); throw e; }
}

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  const seedApp = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(RULES) });
  if (!res.ok) throw new Error("rules load failed: " + res.status);
  let n = 0;
  const memberApp = () => admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: OWNER.uid, token: { email: OWNER.email } } }, "owner-" + (++n));
  const seed = async () => { await seedApp.database().ref("/").set(fixtures()); };

  await run("EH-00", "control: a cold client — asynchronous entries value, the stored month renders, no error", async () => {
    await seed();
    const app = memberApp(); const o = observed(app);
    const page = await bootAndCheck(o.app, "EH-00");
    try {
      eq(o.log.sync.filter((p) => p === ENTRIES).length, 0, "cold client: no synchronous entries delivery");
      expect(o.log.async.includes(ENTRIES), "the entries value arrived (asynchronously)");
      return `async=${o.log.async.filter((p) => p === ENTRIES).length}`;
    } finally { page.detach(); await app.delete(); }
  });

  await run("EH-01", "the entries node is already cached: the page's entries callback runs DURING registration; same hydration, no error", async () => {
    await seed();
    const app = memberApp(); const o = observed(app);
    const warm = app.database().ref(ENTRIES); const h = warm.on("value", () => {});
    await warm.once("value");
    const page = await bootAndCheck(o.app, "EH-01");
    try {
      expect(o.log.sync.includes(ENTRIES), "non-vacuity: the entries value was delivered synchronously inside onValue() (sync=" + JSON.stringify(o.log.sync) + ")");
      return `sync=${o.log.sync.filter((p) => p === ENTRIES).length}`;
    } finally { page.detach(); warm.off("value", h); await app.delete(); }
  });

  await run("EH-02", "every node the page subscribes for the business is already cached: each listener may fire synchronously; same result", async () => {
    await seed();
    const app = memberApp(); const o = observed(app);
    const keys = ["entries", "config", "fixed", "suppliers"].map((k) => `tenants/${T}/biz:${B}:${k}`).concat([`tenants/${T}/app/users`, `tenants/${T}/app/business`]);
    const warm = keys.map((k) => { const r = app.database().ref(k); return { r, h: r.on("value", () => {}) }; });
    for (const w of warm) await w.r.once("value");
    const page = await bootAndCheck(o.app, "EH-02");
    try {
      expect(o.log.sync.includes(ENTRIES), "non-vacuity: synchronous entries delivery (sync=" + JSON.stringify(o.log.sync) + ")");
      return `sync paths=${JSON.stringify([...new Set(o.log.sync)])}`;
    } finally { page.detach(); for (const w of warm) w.r.off("value", w.h); await app.delete(); }
  });

  await run("EH-03", "the I1-R-03 sequence: a first page left attached, then a second page of the same member hydrates without error", async () => {
    await seed();
    const app = memberApp(); const o = observed(app);
    const first = await bootAndCheck(o.app, "EH-03 first page");   // deliberately NOT detached before the second boot
    try {
      const before = o.log.sync.length;
      const second = await bootAndCheck(o.app, "EH-03 second page");
      try {
        expect(o.log.sync.slice(before).includes(ENTRIES), "non-vacuity: the second page's entries value was delivered synchronously (sync=" + JSON.stringify(o.log.sync.slice(before)) + ")");
        return `sync=${o.log.sync.slice(before).filter((p) => p === ENTRIES).length}`;
      } finally { second.detach(); }
    } finally { first.detach(); await app.delete(); }
  });

  await seedApp.delete().catch(() => {});
  console.log(JSON.stringify({ results, failures }, null, 1));
  process.exitCode = failures ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
main().catch((e) => { console.error(e); process.exit(1); });
