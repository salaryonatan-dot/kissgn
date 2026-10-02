// Marjin 1.0 WP-C1 — RENDERED browser financial surfaces on the REAL RTDB emulator.
//
// The WORKING-TREE index.html is booted in jsdom through test/historical/historical-page-harness.mjs
// (its real React tree, its own firebase module over an ordinary-member Admin app, its own
// storage transport, entries coordinator and listeners). The page's fincore bootstrap module is
// executed with ONLY its dynamic import rewritten: "ok" loads the generated fincore/v1 bundle,
// "missing" makes the import fail, "mismatch" returns a bundle with other identifiers. The
// list-entry-exceptions API is served by the REAL server repository (lib/repositories/
// entryExceptionsRepo.js) over the same emulator. Expected amounts are computed in node from the
// same seeded data through the SAME generated core — never restated formulas.
//
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner.
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { bootHistoricalPage, depsStatus, click, textOf } from "../historical/historical-page-harness.mjs";
import { loadFinance, loadSeam } from "../support/c1-seam.mjs";

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
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed: " + res.status);
}
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

// ── one shared test clock: Israel business date = day 12 of the current month, 10:00 local ──
const realNow = Date.now();
const nowIL = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const MONTH = nowIL.slice(0, 7);
const AS_OF = `${MONTH}-12`;
const TARGET_MS = Date.parse(`${AS_OF}T07:00:00Z`);   // 10:00 Israel (IDT) / 09:00 (IST): same business date
const CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;

// ── fixtures ──
const ROWS = [];
for (let n = 1; n <= 11; n++) {
  if (n === 4) continue;                                       // day 4: MISSING (no row, no closure)
  if (n === 7) continue;                                       // day 7: structured CLOSURE, no row
  ROWS.push({ id: `c1-${n}`, date: d(n), sales: 1000 + n * 10, deliveries: 50, other_income: 0, supplier_payments: { s1: 300 + n }, payroll: 200, other_expense: 0, notes: "" });
}
ROWS.push({ id: "c1-9", date: d(9), sales: 1500, deliveries: 0, other_income: 0, supplier_payments: { s1: 310 }, payroll: 210 }); // day 9 replaced below
ROWS.splice(ROWS.findIndex((r) => r.id === "c1-9" && r.sales !== 1500), 1);
ROWS.push({ id: "c1-9b", date: d(9), sales: 200, deliveries: 0, other_income: 0, payroll: 15 });   // day 9: a preserved DUPLICATE row (folded)
ROWS.push({ id: "c1-12", date: AS_OF, sales: 777, deliveries: 23, other_income: 0 });          // TODAY: context only, never Actual
const STRUCT = { [d(7)]: { state: { schemaVersion: 1, tenantId: "tenantA", bizId: "bizA", businessDate: d(7), status: "active", reasonCode: "closure", reasonText: "", revision: 1, updatedAt: 1, updatedBy: "u_owner" }, operations: {} } };
const CONFIG = { businessName: "סניף C1", rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 },
  employees: [{ id: "g1", name: "מנהלת", role: "מנהל משמרת", type: "global", monthlySalary: 9300 }] };
const FIXED = [{ id: "f1", name: "ארנונה", amount: 3100 }];
const USER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const fixtures = ({ config = env(CONFIG) } = {}) => ({
  tenants: { tenantA: {
    members: { u_owner: true }, roles: { u_owner: "owner" }, biz_access: { bizA: { u_owner: true } },
    app: { users: env([{ id: 1, username: "owner1", name: "בעלים", email: USER.email, role: "owner", firebaseUid: USER.uid }]), business: env([{ id: "bizA", name: "סניף C1" }]) },
    "biz:bizA:entries": env(ROWS), "biz:bizA:config": config, "biz:bizA:fixed": env(FIXED),
    "biz:bizA:suppliers": env([{ id: "s1", name: "ספק ירקות", category: "ירקות", days: [0, 1, 2, 3, 4, 5] }]),
    entry_exceptions: { bizA: STRUCT },
  } },
  user_tenants: { u_owner: "tenantA" }, user_active_biz: { u_owner: "bizA" },
  username_index: { owner1: { tenantId: "tenantA", email: USER.email } },
});

const apps = {};
const results = []; let failures = 0;
async function run(id, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const q = (page, k) => page.document.querySelector(`[data-c1="${k}"]`);
const qt = (page, k) => textOf(q(page, k));
const rootText = (page) => textOf(page.document.getElementById("root"));   // rendered tree only (script text excluded)

let listCalls = [];
// C1 R1: the list double answers in the REAL handler's shape (api/admin.js handleListEntryExceptions:
// { ok, tenantId, bizId, fromDate, toDate, exceptions }). `ledgerCtl` switches it at run time:
//   mode "ok" | "fail" | "gate" (each call is HELD until the test resolves it with a body variant).
const ledgerCtl = { mode: null, held: [] };
async function listBody(p, variant = "real") {
  const { listEntryExceptions } = await import("../../lib/repositories/entryExceptionsRepo.js");   // the REAL server repository
  const exceptions = await listEntryExceptions({ tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate") });
  if (variant === "reopened") delete exceptions[d(7)];                      // the same window after day 7 was reopened
  return { ok: true, tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate"), exceptions };
}
const jsonResp = (body) => ({ ok: true, status: 200, json: async () => body });
const failResp = () => ({ ok: false, status: 500, json: async () => ({ error: "list_failed" }) });
function makeFetch({ ledger = "ok" } = {}) {
  ledgerCtl.mode = ledger; ledgerCtl.held = [];
  return async (url, opts) => {
    const u = String(url);
    if (u.startsWith("/api/config")) return { ok: true, status: 200, json: async () => ({ apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT }) };
    if (u.startsWith("/api/admin?action=list-entry-exceptions")) {
      const p = new URL(u, "http://x").searchParams;
      listCalls.push({ from: p.get("fromDate"), to: p.get("toDate") });
      if (ledgerCtl.mode === "fail") return failResp();
      if (ledgerCtl.mode === "gate") {
        return await new Promise((release) => ledgerCtl.held.push({ from: p.get("fromDate"), to: p.get("toDate"),
          answer: async (variant) => release(variant === "fail" ? failResp() : jsonResp(await listBody(p, variant))) }));
      }
      return jsonResp(await listBody(p));
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_available_in_harness" }), text: async () => "" };
  };
}
const session = { ["marjin_tid_" + USER.uid]: "tenantA", ["marjin_biz_" + USER.uid]: "bizA" };
async function boot({ fincore = "ok", ledger = "ok" } = {}) {
  listCalls = [];
  const page = await bootHistoricalPage({ html: HTML, fincore, loadFincore: loadFinance, adminApp: apps.owner, user: USER, session, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl: makeFetch({ ledger }) });
  await page.until(() => page.document.querySelector(".kpi-card-link") !== null || q(page, "fin-unavailable") !== null, 20000);
  return page;
}
const settled = (page) => page.until(() => (q(page, "mtd-revenue") !== null) || (q(page, "fin-unavailable") !== null && !/טוען/.test(qt(page, "fin-unavailable"))), 20000);
const nav = async (page, label) => { const b = Array.from(page.document.querySelectorAll("button.mhd-tab")).find((x) => textOf(x) === label); expect(b, "nav tab " + label); click(b); await page.sleep(300); };
const visible = async (page) => { page.document.dispatchEvent(new page.window.Event("visibilitychange")); await page.sleep(50); };
/** Answer every held list call (present or arriving within `ms`) whose request is the one tagged by `pick`. */
async function answerHeld(page, n, variant, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (ledgerCtl.held.length > n) break; await page.sleep(20); }
  const h = ledgerCtl.held[n]; if (!h) throw new Error("no held list call #" + n + " (held " + ledgerCtl.held.length + ")");
  await h.answer(variant); await page.sleep(50);
}
const dm = (x) => x.slice(8) + "." + x.slice(5, 7);
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));

// ── expected values: the same seeded data through the same generated core (node) ──
async function expected() {
  const F = await loadFinance(), C = loadSeam(HTML);
  const states = { [d(7)]: { status: "active", reasonCode: "closure" } };
  const src = { rows: ROWS, config: { state: "present", value: CONFIG }, fixed: { state: "present", value: FIXED }, asOf: AS_OF,
    ledger: { state: "present", states, from: "2000-01-01", to: "2100-12-31" }, rowsReady: true };
  const dash = C.dashboard(F, src, { nowMs: TARGET_MS, lastYearSales: null });
  return { F, C, src, dash, pnl: C.pnl(F, src, MONTH, null), hist: C.history(F, src, MONTH), emp: C.employees(F, src, MONTH) };
}

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");     // getApps()[0]: the server repository's Admin app
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: USER.uid, token: { email: USER.email } } }, "owner");
  await loadRules(RULES);
  await apps.seed.database().ref("/").set(fixtures());
  const X = await expected();
  expect(X.dash.status === "ready", "node expectation ready: " + JSON.stringify(X.dash).slice(0, 200));
  let page = null;

  await run("C1R-01", "module OK: the page renders the dashboard from the shared core (MTD revenue, disclosure dates, purchases, labor, fixed, forecast v2) — values equal the node core over the same data", async () => {
    page = await boot();
    await settled(page);
    expect(q(page, "mtd-revenue"), "MTD revenue rendered (not unavailable): " + qt(page, "fin-unavailable"));
    eq(page.window.__marjinFinance.state, "ready", "module state");
    eq(qt(page, "mtd-revenue"), X.dash.revenue.text, "MTD revenue text");
    eq(qt(page, "revenue-warning"), X.dash.disclosure.warning, "missing-date disclosure under revenue");
    expect(qt(page, "revenue-warning").includes(d(4).slice(8) + "." + d(4).slice(5, 7)), "the missing day 4 is named");
    expect(!qt(page, "revenue-warning").includes(d(7).slice(8) + "." + d(7).slice(5, 7)), "the closed day 7 is NOT reported missing");
    eq(qt(page, "closures"), X.dash.disclosure.closures, "closures line");
    eq(qt(page, "mtd-purchases"), X.dash.purchases.text, "purchases");
    eq(qt(page, "mtd-labor"), X.dash.labor.text, "labor (typed)");
    eq(qt(page, "mtd-fixed"), X.dash.fixedRent.text, "fixed + rent");
    eq(qt(page, "hero-revenue"), X.dash.revenue.text, "hero = same report field");
    expect(qt(page, "forecast-revenue").includes(X.dash.forecast.text), "forecast v2 value");
    expect(!rootText(page).includes("תחזית קופה"), "linear run-rate tile retired");
    expect(fatalErrors(page).length === 0, "no fatal runtime errors: " + fatalErrors(page).slice(0, 3).join(" | "));
    // The C1 ledger load: consecutive bounded chunks (≤ 366 days) ending at the month end and
    // reaching back at least 13 months (prior-year P&L). The 95-day CD-M2 loader is separate.
    const monthEnd = X.F.finance.businessDate.monthBounds(MONTH).last;
    const c1Calls = listCalls.filter((c) => c.to === monthEnd || listCalls.some((n) => n.to === monthEnd && X.F.finance.businessDate.addDays(c.to, 1) === n.from));
    expect(c1Calls.length >= 2, "C1 ledger chunks present: " + JSON.stringify(listCalls));
    for (const c of c1Calls) expect(X.F.finance.businessDate.datesInRange(c.from, c.to).length <= 366, "chunk ≤ 366 days " + JSON.stringify(c));
    expect(c1Calls.some((c) => c.from <= X.F.finance.businessDate.addDays(d(1), -365)), "window reaches the prior-year month");
    return `revenue ${qt(page, "mtd-revenue")} · labor ${qt(page, "mtd-labor")} · forecast ${X.dash.forecast.text} · ledger chunks ${JSON.stringify(listCalls)}`;
  });

  await run("C1R-02", "today strip: today's recorded revenue is CONTEXT (labelled outside Actual) and is not part of MTD revenue", async () => {
    eq(X.dash.today.revenueText, "₪800", "node: today's folded revenue");
    expect(qt(page, "today-strip").includes("₪800"), "today strip shows today's recorded revenue: " + qt(page, "today-strip"));
    expect(qt(page, "today-strip").includes("מחוץ לבפועל"), "labelled outside Actual");
    return qt(page, "today-strip");
  });

  await run("C1R-03", "history: closed day 7 is 'יום סגור' (₪0, not missing), missing day 4 is 'לא הוזן', duplicate day 9 is folded, today is context", async () => {
    await nav(page, "פדיון יומי");
    await page.until(() => q(page, "hist-count") !== null, 8000);
    const body = rootText(page);
    expect(body.includes("יום סגור — הכנסה 0, לא חסר"), "closed day card");
    const h9 = X.hist.days.find((x) => x.date === d(9)), h7 = X.hist.days.find((x) => x.date === d(7)), h4 = X.hist.days.find((x) => x.date === d(4));
    eq(h7.status, "closed", "node: day 7 closed"); eq(h4.status, "missing", "node: day 4 missing");
    expect(body.includes(h9.revenueText), "day 9 shows the FOLDED revenue of both rows " + h9.revenueText);
    expect(body.includes("הסכומים בכרטיס כוללים את כולן"), "duplicate header text corrected (U-23)");
    expect(qt(page, "hist-count").startsWith(String(X.hist.presentDays)), "present-day count from the report: " + qt(page, "hist-count"));
    return `count "${qt(page, "hist-count")}", day9 ${h9.revenueText}`;
  });

  await run("C1R-04", "P&L: rows from the month report; VD-50 'רווח גולמי' row shows — (owner decision pending)", async () => {
    await nav(page, "P&L");
    await page.until(() => q(page, "pnl-vd50") !== null || q(page, "fin-unavailable") !== null, 8000);
    const row = q(page, "pnl-vd50");
    expect(row, "VD-50 row rendered: " + qt(page, "fin-unavailable"));
    expect(textOf(row).includes("רווח גולמי") && !/₪/.test(textOf(row)), "VD-50 row has no amount: " + textOf(row));
    expect(textOf(q(page, "pnl-revenue")).includes(X.pnl.rows.revenue.text), "P&L revenue");
    expect(textOf(q(page, "pnl-net")).includes(X.pnl.rows.net.text), "P&L net = report operatingProfit (typed)");
    return `VD-50 row: "${textOf(row)}"`;
  });

  await run("C1R-05", "employees: month employer cost from the report; placement per day; future days 'צפוי'", async () => {
    await nav(page, "עלות עובדים");
    await page.until(() => q(page, "emp-month-total") !== null, 8000);
    expect(qt(page, "emp-month-total").includes(X.emp.monthTotal.text), "month total " + qt(page, "emp-month-total"));
    expect(qt(page, "emp-global-day").includes(X.emp.globalPerDay.text), "global per day placement " + qt(page, "emp-global-day"));
    const days = Array.from(page.document.querySelectorAll('[data-c1="emp-day"]')).map(textOf);
    expect(days.some((t) => t.includes("צפוי")), "future days labelled צפוי");
    return `${qt(page, "emp-month-total")} · ${qt(page, "emp-global-day")}`;
  });
  if (page) { page.detach(); page = null; }

  await run("C1R-06", "module MISSING: explicit unavailable state, no amounts, no old-formula fallback", async () => {
    const p = await boot({ fincore: "missing" });
    try {
      await settled(p);
      eq(p.window.__marjinFinance.state, "failed", "module state failed");
      expect(q(p, "fin-unavailable") && !q(p, "mtd-revenue"), "dashboard shows the unavailable state");
      expect(!/₪/.test(qt(p, "fin-unavailable")), "no amounts");
      expect(typeof p.window.calcMetrics === "undefined" && typeof p.window.buildChart === "undefined", "legacy formulas absent");
      await nav(p, "P&L"); await p.sleep(300);
      expect(q(p, "fin-unavailable") && !q(p, "pnl-revenue"), "P&L unavailable");
      expect(fatalErrors(p).length === 0, "no fatal runtime errors: " + fatalErrors(p).slice(0, 3).join(" | "));
      return `"${qt(p, "fin-unavailable")}" (${p.window.__marjinFinance.error})`;
    } finally { p.detach(); }
  });

  await run("C1R-07", "module VERSION MISMATCH: refused, unavailable state", async () => {
    const p = await boot({ fincore: "mismatch" });
    try {
      await settled(p);
      eq(p.window.__marjinFinance.state, "failed", "module refused");
      eq(p.window.__marjinFinance.error, "fincore_version_mismatch", "reason");
      expect(q(p, "fin-unavailable") && !q(p, "mtd-revenue"), "unavailable");
      return p.window.__marjinFinance.error;
    } finally { p.detach(); }
  });

  await run("C1R-08", "closure history UNREADABLE (list API fails): no financial result is computed — unavailable, never 'no closures'", async () => {
    const p = await boot({ ledger: "fail" });
    try {
      await settled(p);
      eq(p.window.__marjinFinance.state, "ready", "module ok");
      expect(q(p, "fin-unavailable") && !q(p, "mtd-revenue"), "dashboard unavailable when the ledger cannot be read");
      return qt(p, "fin-unavailable");
    } finally { p.detach(); }
  });

  await run("C1R-09", "config node UNREADABLE (not an envelope): labor and fixed render '—', never defaults", async () => {
    await apps.seed.database().ref("tenants/tenantA/biz:bizA:config").set({ businessName: "x", employees: "broken" });
    const p = await boot();
    try {
      await settled(p);
      expect(q(p, "mtd-revenue"), "dashboard renders");
      eq(qt(p, "mtd-labor"), "—", "labor not computed from an unreadable config");
      return `labor ${qt(p, "mtd-labor")} · fixed ${qt(p, "mtd-fixed")}`;
    } finally { p.detach(); await apps.seed.database().ref("tenants/tenantA/biz:bizA:config").set(env(CONFIG)); }
  });

  await run("C1R-10", "COMPLETE data (history for the v2 forecast, closure with its explicit zero row): typed labor, fixed, profit, forecast and projected profit render and equal the node core", async () => {
    const bd = X.F.finance.businessDate;
    const full = [];
    for (const date of bd.datesInRange(bd.addDays(d(1), -70), bd.addDays(AS_OF, -1))) {
      if (date === d(7)) { full.push({ id: "z-" + date, date, sales: 0, deliveries: 0, other_income: 0, supplier_payments: {}, payroll: 0, other_expense: 0, is_exception: true, exception_reason: "closure" }); continue; }
      full.push({ id: "z-" + date, date, sales: 1200 + (bd.dowOf(date) * 37), deliveries: 40, other_income: 0, supplier_payments: { s1: 350 }, payroll: 230, other_expense: 0 });
    }
    await apps.seed.database().ref("tenants/tenantA/biz:bizA:entries").set(env(full));
    const src = { ...X.src, rows: full };
    const dash = X.C.dashboard(X.F, src, { nowMs: TARGET_MS, lastYearSales: null });
    const pnl = X.C.pnl(X.F, src, MONTH, null);
    expect(dash.status === "ready" && dash.labor.state === "complete", "node: complete labor " + (dash.labor && dash.labor.state));
    expect(dash.forecast.amount !== null && dash.projectedProfit.amount !== null, "node: forecast and projected profit exist");
    const p = await boot();
    try {
      await settled(p);
      eq(qt(p, "mtd-revenue"), dash.revenue.text, "revenue");
      eq(qt(p, "mtd-labor"), dash.labor.text, "labor (complete employer cost)");
      eq(qt(p, "labor-pct"), dash.laborPct.text, "labor %");
      eq(qt(p, "purchases-pct"), dash.purchasesPct.text, "purchases %");
      eq(qt(p, "mtd-fixed"), dash.fixedRent.text, "fixed accrual");
      expect(qt(p, "forecast-revenue").includes(dash.forecast.text), "forecast v2 " + qt(p, "forecast-revenue"));
      expect(qt(p, "forecast-profit").includes(dash.projectedProfit.text), "projected profit " + qt(p, "forecast-profit"));
      expect(!q(p, "revenue-warning"), "no missing-date warning on complete data");
      await nav(p, "P&L");
      await p.until(() => q(p, "pnl-net") !== null, 8000);
      expect(textOf(q(p, "pnl-net")).includes(pnl.rows.net.text), "P&L net " + textOf(q(p, "pnl-net")));
      expect(!/₪/.test(textOf(q(p, "pnl-vd50"))), "VD-50 still — with complete data");
      return `revenue ${dash.revenue.text} · labor ${dash.labor.text} (${dash.laborPct.text}) · fixed ${dash.fixedRent.text} · forecast ${dash.forecast.text} · proj. profit ${dash.projectedProfit.text} · P&L net ${pnl.rows.net.text}`;
    } finally { p.detach(); await apps.seed.database().ref("tenants/tenantA/biz:bizA:entries").set(env(ROWS)); }
  });

  // ── C1 R1 (independent review findings 3 and 6) ──────────────────────────────────────────
  await run("C1R-11", "ledger list FAILS → explicit unavailable state with a retry control; after the API recovers, retry renders the report (no stale or partial numbers before)", async () => {
    const p = await boot({ ledger: "fail" });
    try {
      await settled(p);
      expect(q(p, "fin-unavailable") && !q(p, "mtd-revenue"), "unavailable while the ledger cannot be read");
      const btn = q(p, "fin-retry"); expect(btn, "retry control rendered: " + qt(p, "fin-unavailable"));
      ledgerCtl.mode = "ok"; const before = listCalls.length;
      click(btn);
      await p.until(() => q(p, "mtd-revenue") !== null, 15000);
      expect(listCalls.length > before, "retry re-read the ledger");
      eq(qt(p, "mtd-revenue"), X.dash.revenue.text, "recovered MTD revenue");
      eq(qt(p, "closures"), X.dash.disclosure.closures, "recovered closures line");
      return `retry: ${listCalls.length - before} list calls → ${qt(p, "mtd-revenue")}`;
    } finally { p.detach(); }
  });

  await run("C1R-12", "a successful ledger followed by a FAILED refresh (page returns to the foreground): unavailable — the earlier result is not reused for the new request", async () => {
    const p = await boot();
    try {
      await settled(p);
      expect(q(p, "mtd-revenue"), "initially ready");
      ledgerCtl.mode = "fail";
      await visible(p);
      await p.until(() => q(p, "fin-unavailable") !== null && q(p, "mtd-revenue") === null && q(p, "fin-retry") !== null, 15000);
      ledgerCtl.mode = "ok";
      click(q(p, "fin-retry"));
      await p.until(() => q(p, "mtd-revenue") !== null, 15000);
      eq(qt(p, "mtd-revenue"), X.dash.revenue.text, "after retry");
      return "ready → failed refresh → unavailable → retry → ready";
    } finally { p.detach(); }
  });

  await run("C1R-13", "OVERLAPPING refreshes resolved OUT OF ORDER: the newer (day 7 reopened) wins; the older (day 7 closed) arrives last and is discarded", async () => {
    const p = await boot();
    try {
      await settled(p);
      expect(qt(p, "closures").includes(dm(d(7))), "initially day 7 is a closure");
      ledgerCtl.mode = "gate"; ledgerCtl.held = [];
      await visible(p);                                  // request A (older)
      await p.until(() => ledgerCtl.held.length >= 1, 8000);
      await visible(p);                                  // request B (newer)
      await p.until(() => ledgerCtl.held.length >= 2, 8000);
      expect(!q(p, "mtd-revenue"), "while the latest request is pending, no result is shown as authoritative");
      // B: answer its first chunk and every later chunk of B with the "reopened" state
      await answerHeld(p, 1, "reopened");
      for (let i = 2; ; i++) { const t0 = Date.now(); while (ledgerCtl.held.length <= i && Date.now() - t0 < 1500) await p.sleep(20); if (ledgerCtl.held.length <= i) break; await ledgerCtl.held[i].answer("reopened"); await p.sleep(50); }
      await p.until(() => q(p, "mtd-revenue") !== null, 15000);
      const afterB = qt(p, "revenue-warning");
      expect(afterB.includes(dm(d(7))), "the newer result: day 7 is now MISSING (reopened) — " + afterB);
      // A: the older request resolves LAST with day 7 closed
      const heldBefore = ledgerCtl.held.length;
      await ledgerCtl.held[0].answer("real"); await p.sleep(400);
      eq(ledgerCtl.held.length, heldBefore, "the stale request stopped (no further chunks)");
      expect(qt(p, "revenue-warning").includes(dm(d(7))), "still the newer state after the older result arrived");
      expect(!q(p, "closures") || !qt(p, "closures").includes(dm(d(7))), "the older 'closed' result never applied");
      return `B (reopened) applied; A (closed) discarded · warning "${qt(p, "revenue-warning")}"`;
    } finally { ledgerCtl.mode = "ok"; for (const h of ledgerCtl.held) h.answer("real").catch(() => {}); p.detach(); }
  });

  await run("C1R-14", "fixed-cost editor header (D-21): the CONFIGURED monthly amount (₪3,100, current config applied retrospectively) — not the MTD accrual", async () => {
    const p = await boot();
    try {
      await settled(p);
      const opener = Array.from(p.document.querySelectorAll("button.mhd-icon-btn")).find((b) => b.getAttribute("title") === "הוצאות קבועות");
      expect(opener, "fixed-cost editor button");
      click(opener);
      await p.until(() => q(p, "fixed-modal-total") !== null, 8000);
      const t = qt(p, "fixed-modal-total");
      const configured = X.F.presenters.money.formatShekel(String(FIXED[0].amount));   // the seeded configuration (one item, no fixed rent)
      eq(configured, "₪3,100", "seeded configured monthly");
      expect(t.includes("₪3,100"), "header shows the configured monthly amount: " + t);
      expect(!t.includes(X.dash.fixedRent.text) || X.dash.fixedRent.text === "₪3,100", "not the MTD accrual " + X.dash.fixedRent.text);
      expect(t.includes(X.F.presenters.labels.LABELS.configurationBasis.current_applied_retrospectively), "basis label");
      return t;
    } finally { p.detach(); }
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 7)} ${w("status", 6)} ${w("ms", 6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 7)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 14;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`INCOMPLETE: expected ${EXPECTED}`); process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — rendered C1 surfaces");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(process.exitCode || 0); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(4); });
}
