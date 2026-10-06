// M1 integration candidate (LOCAL; pending independent Codex review) — the INTEGRATED page rendered over the real local RTDB
// emulator with BOTH approved lines live at once: a persisted Core/F1 R4 cost history (MARJIN_COSTH/6, built by the REAL
// trusted writer: owner activation + a VD-47 attested past edit) and a P1 R7 supplier-credit node (MARJIN_CREDITS/4, built by
// the REAL writer domain). The working-tree index.html boots in jsdom (test/historical/historical-page-harness.mjs); the
// cost-history route (api/cost-history.js) and the credit list (api/admin.js) are the ACTUAL handlers (only Admin / auth /
// email seams replaced); list-entry-exceptions is the REAL repository. Expected texts are computed in node through the
// SAME generated core and the page's OWN seams (C1 views over the merged inputsFor with costHistory + credits) — never
// restated formulas.
//   RM1-00  control: dashboard purchases / Food Cost, suppliers view, P&L VD-50 gross and net equal the node core; the cost
//           editor shows the active history; no fatal page error
//   RM1-01  P1 (c) chain defect: Food Cost "—", purchases partial, VD-50 without an amount — labor and fixed stay exact
//   RM1-02  pending credit review: the same partial propagation (review disclosure)
//   RM1-03  corrupt cost history: the financial views are unavailable (never computed without the authoritative basis);
//           the credits tab still renders its own month
//   RM1-04  no cost history (compat configuration basis) + credits: VD-50 and Food Cost on net purchases
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner, one script at a time.
import admin from "firebase-admin";
import { readFileSync, mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { TextEncoder } from "node:util";
import { bootHistoricalPage, depsStatus, click, textOf, findByText } from "../historical/historical-page-harness.mjs";
import { loadFinance, loadSeam } from "../support/c1-seam.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";

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

// the REAL admin handler and the REAL cost-history route, each in its own disposable module graph (distinct seams)
async function realHandler(entry, key) {
  const dir = mkdtempSync(join(tmpdir(), "m1-rendered-" + key + "-"));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "api"), { recursive: true }); cpSync(join(ROOT, "api", entry), join(dir, "api", entry));
  mkdirSync(join(dir, "fincore"), { recursive: true }); cpSync(join(ROOT, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__M1_DB(); }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__M1_CLAIMS) throw new Error("no auth"); return globalThis.__M1_CLAIMS; }\nexport async function verifyToken() { return globalThis.__M1_CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__M1_CLAIMS; }\n`);
  writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
  return (await import(pathToFileURL(join(dir, "api", entry)).href)).default;
}
const adminHandler = await realHandler("admin.js", "admin"), costRoute = await realHandler("cost-history.js", "cost");
const FIX = await import(pathToFileURL(join(ROOT, "test", "support", "p1-credit-fixtures.mjs")).href);

// ── clock: Israel business date = day 12 of the current month ──
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const AS_OF = `${MONTH}-12`;
const TARGET_MS = Date.parse(`${AS_OF}T07:00:00Z`);
const CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const T = "tenantA", B = "bizA";
const CREDITS = `tenants/${T}/biz:${B}:supplier_credits`, HISTORY = `tenants/${T}/biz:${B}:cost_history`;
const USER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const ROWS = [];
for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`, date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0, notes: "" });
const CONFIG = { businessName: "סניף M1", rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [{ id: "g1", name: "Global", type: "global", monthlySalary: "9300" }] };
const FIXED = [{ id: "f1", name: "Utilities", amount: "3100" }];
const SUPS = [{ id: "s1", name: "קוקה קולה", category: "משקאות", days: [0, 1, 2, 3, 4, 5] }];

// ── the persisted cost history, built OFFLINE by the REAL trusted writer with the page's business clock ──
async function buildHistory() {
  const W = await loadWriter(ROOT);
  const sdb = makeDb();
  sdb.seed(`tenants/${T}/members/${USER.uid}`, true); sdb.seed(`tenants/${T}/roles/${USER.uid}`, "owner");
  sdb.seed(`tenants/${T}/app/business`, env([{ id: B, name: "סניף M1" }]));
  globalThis.__DB = sdb; globalThis.__CLAIMS = { uid: USER.uid, email: USER.email };
  let tick = TARGET_MS;
  const w = W.createCostHistoryWriter({ db: sdb, clock: () => (tick += 1000) });
  const base = { rent: { mode: "none" }, royalty: { mode: "none" } };
  const a = await w.activateCostHistory({ headers: {} }, { tenantId: T, bizId: B, body: { versionId: "00000000-0000-4000-8000-0000000000a0", expectedHead: null, effectiveFrom: AS_OF, basis: "recorded", globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "9300" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], ...base } });
  if (a.status !== "committed_current") throw new Error("activation " + JSON.stringify(a));
  const body = { versionId: "00000000-0000-4000-8000-0000000000a1", expectedHead: sdb.read(HISTORY).head, effectiveFrom: d(1), basis: "attested_retroactive", attestationReason: "supplier invoices", globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "9000" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3000" }], ...base };
  body.attestation = { confirmed: true, typedEffectiveFrom: body.effectiveFrom, confirmedSnapshotDigest: W.attestationDigest(body) };
  const e = await w.attestHistoricalCostEdit({ headers: {} }, { tenantId: T, bizId: B, body });
  if (e.status !== "committed_current" || e.review !== "cleared") throw new Error("attested edit " + JSON.stringify(e));
  return sdb.read(HISTORY);
}
const HISTORY_NODE = await buildHistory();
const CLEAN = FIX.creditNode([FIX.spec(1, "s1", d(5), "100", { documentNumber: "CR-100", actor: USER.uid, role: "owner" }), FIX.spec(3, "s1", d(9), "60", { documentNumber: "CR-300", actor: USER.uid, role: "owner" })], { tenantId: T, bizId: B });
const CHAIN = FIX.replaceIn(CLEAN, 1, 2, { issueDate: d(6) }, { actor: USER.uid, role: "owner" });
const DEFECT_C = (() => { const n = JSON.parse(JSON.stringify(CHAIN)); delete n.records[FIX.cid(2)]; delete n.review[FIX.oid(2)]; return n; })();
const PENDING = FIX.creditNode([FIX.spec(1, "s1", d(5), "100", { documentNumber: "CR-100", actor: USER.uid, role: "owner", review: "pending" })], { tenantId: T, bizId: B });
const CORRUPT_HISTORY = (() => { const n = JSON.parse(JSON.stringify(HISTORY_NODE)); n.versions["00000000-0000-4000-8000-0000000000a1"].fixedItems[0].monthlyAmount = "1"; return n; })();

const fixtures = ({ history = HISTORY_NODE, credits = CHAIN } = {}) => ({
  tenants: { [T]: {
    members: { [USER.uid]: true }, roles: { [USER.uid]: "owner" }, biz_access: { [B]: { [USER.uid]: true } },
    app: { users: env([{ id: 1, username: "owner1", name: "בעלים", email: USER.email, role: "owner", firebaseUid: USER.uid }]), business: env([{ id: B, name: "סניף M1" }]) },
    [`biz:${B}:entries`]: env(ROWS), [`biz:${B}:config`]: env(CONFIG), [`biz:${B}:fixed`]: env(FIXED), [`biz:${B}:suppliers`]: env(SUPS),
    ...(credits ? { [`biz:${B}:supplier_credits`]: credits } : {}), ...(history ? { [`biz:${B}:cost_history`]: history } : {}),
  } },
  user_tenants: { [USER.uid]: T }, user_active_biz: { [USER.uid]: B },
  username_index: { owner1: { tenantId: T, email: USER.email } },
});

const apps = {};
const results = []; let failures = 0;
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function run(id, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
}
const q = (page, k) => page.document.querySelector(`[data-c1="${k}"]`), qt = (page, k) => textOf(q(page, k));
const qp = (page, k) => page.document.querySelector(`[data-p1="${k}"]`);
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));

const resp = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
async function callReal(handler, u, opts) {
  const url = new URL(u, "http://x"), query = Object.fromEntries(url.searchParams.entries());
  const r = { code: 200, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  globalThis.__M1_CLAIMS = { uid: USER.uid, email: USER.email }; globalThis.__M1_DB = () => apps.seed.database();
  await handler({ method: (opts && opts.method) || "GET", query, headers: { authorization: "Bearer t" }, body: opts && opts.body ? JSON.parse(opts.body) : undefined }, r);
  return resp(r.code, r.body);
}
const fetchImpl = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("/api/config")) return resp(200, { apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT });
  if (u.startsWith("/api/admin?action=list-entry-exceptions")) {
    const p = new URL(u, "http://x").searchParams;
    const { listEntryExceptions } = await import("../../lib/repositories/entryExceptionsRepo.js");
    const exceptions = await listEntryExceptions({ tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate") });
    return resp(200, { ok: true, tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate"), exceptions });
  }
  if (/^\/api\/admin\?action=[a-z-]*supplier-credit/.test(u)) return callReal(adminHandler, u, opts);
  if (u.startsWith("/api/cost-history")) return callReal(costRoute, u, opts);
  return resp(404, { error: "not_available_in_harness" });
};
const session = { ["marjin_tid_" + USER.uid]: T, ["marjin_biz_" + USER.uid]: B };
async function boot() {
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp: apps.owner, user: USER, session, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl });
  page.window.TextEncoder = TextEncoder;
  await page.until(() => page.document.querySelector(".kpi-card-link") !== null || q(page, "fin-unavailable") !== null, 20000);
  return page;
}
const settled = (page) => page.until(() => (q(page, "mtd-revenue") !== null && !/טוען/.test(qt(page, "mtd-purchases"))) || (q(page, "fin-unavailable") !== null && !/טוען/.test(qt(page, "fin-unavailable"))), 20000);
const nav = async (page, label) => { const b = Array.from(page.document.querySelectorAll("button.mhd-tab")).find((x) => textOf(x) === label); expect(b, "nav tab " + label); click(b); await page.sleep(300); };
const subTab = async (page, label) => { const b = findByText(page.document, "button", label); expect(b, "sub-tab " + label); click(b); await page.sleep(200); };

/** node expectations through the page's own seams + the generated core (merged inputsFor: costHistory + credits) */
async function expected({ history, credits }) {
  const F = await loadFinance(), C1 = loadSeam(HTML);
  const win = {}; const block = HTML.slice(HTML.indexOf("// ── P1 supplier credits browser seam"));
  vm.runInNewContext(block.slice(0, block.indexOf("</script>")), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController });
  const bind = { tenantId: T, bizId: B };
  const decodedCredits = F.finance.supplierCredits.decodeSupplierCredits(credits ? { ...credits, operations: undefined } : null, bind);
  const costHistory = F.costHistory.codec.decodeHistory({ exists: !!history, value: history || null }, bind);
  const src = { rows: ROWS, config: { state: "present", value: CONFIG }, fixed: { state: "present", value: FIXED }, asOf: AS_OF, ledger: { state: "absent", states: {}, from: "2000-01-01", to: "2100-12-31" }, rowsReady: true, credits: decodedCredits, costHistory };
  return { costHistory, src, dash: C1.dashboard(F, src, { nowMs: TARGET_MS, lastYearSales: null }), sup: C1.suppliers(F, src, MONTH, SUPS), pnl: C1.pnl(F, src, MONTH, null), tab: win.MarjinP1.monthView(F, decodedCredits, MONTH, SUPS) };
}
async function scenario(id, label, data, check) {
  await run(id, label, async () => {
    await apps.seed.database().ref("/").set(fixtures(data));
    const X = await expected(data);
    const page = await boot();
    try {
      await settled(page);
      const obs = { dash: { purchases: qt(page, "mtd-purchases"), pct: qt(page, "purchases-pct"), labor: qt(page, "mtd-labor"), fixed: qt(page, "mtd-fixed"), unavailable: qt(page, "fin-unavailable") } };
      if (q(page, "mtd-revenue")) {
        await nav(page, "P&L");
        await page.until(() => q(page, "pnl-vd50") !== null || q(page, "fin-unavailable") !== null, 8000).catch(() => {});
        obs.pnl = { vd50: qt(page, "pnl-vd50"), net: qt(page, "pnl-net") };
      }
      await nav(page, "קניות");
      await subTab(page, "זיכויי ספקים");
      await page.until(() => qp(page, "credits-tab") !== null && qp(page, "credits-loading") === null, 15000).catch(() => {});
      obs.tab = { present: !!qp(page, "credits-tab"), invalid: !!qp(page, "credits-invalid"), total: textOf(qp(page, "credits-total")) };
      await subTab(page, "הזנת ספקים");
      await page.until(() => q(page, "sup-gross-credits") !== null || q(page, "sup-credits-incomplete") !== null || q(page, "sup-summary") !== null || q(page, "fin-unavailable") !== null, 10000).catch(() => {});
      obs.sup = { strip: qt(page, "sup-gross-credits"), incomplete: !!q(page, "sup-credits-incomplete"), pct: qt(page, "sup-pct"), total: qt(page, "sup-total") };
      obs.fatal = fatalErrors(page).length;
      check(obs, X);
      return JSON.stringify(obs);
    } finally { page.detach(); }
  });
}

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: USER.uid, token: { email: USER.email } } }, "owner");
  await loadRules(RULES);

  await scenario("RM1-00", "control: persisted (attested) cost history + a valid replaced credit chain — dashboard, P&L VD-50 / net and the suppliers view equal the node core over the merged inputs", { history: HISTORY_NODE, credits: CHAIN }, (o, X) => {
    eq(X.costHistory.state, "present", "node: the history decodes");
    expect(X.dash.status === "ready" && X.pnl.status === "ready" && X.sup.status === "ready", "node views ready");
    eq(o.dash.purchases, X.dash.purchases.text, "dashboard MTD purchases (net)"); eq(o.dash.pct, X.dash.purchasesPct.text, "dashboard Food Cost");
    eq(o.dash.labor, X.dash.labor.text, "dashboard labor (full employer cost from the attested history)"); eq(o.dash.fixed, X.dash.fixedRent.text, "dashboard fixed (closed-day placement)");
    expect(/₪/.test(X.pnl.gross.text) && o.pnl.vd50.includes(X.pnl.gross.text), "P&L VD-50 gross = node core " + o.pnl.vd50 + " / " + X.pnl.gross.text);
    expect(o.pnl.net.includes(X.pnl.rows.net.text), "P&L net = node core");
    eq(o.sup.pct, X.sup.purchasesPct.text, "suppliers Food Cost"); expect(!o.sup.incomplete, "suppliers complete");
    expect(o.tab.present && !o.tab.invalid, "credits tab valid"); eq(o.fatal, 0, "fatal page errors");
    expect(o.dash.pct === o.sup.pct, "Food Cost identical on the dashboard and the suppliers view");
  });
  await scenario("RM1-01", "P1 (c) chain defect (successor record + review deleted): Food Cost —, purchases partial, VD-50 without an amount; labor and fixed stay exact", { history: HISTORY_NODE, credits: DEFECT_C }, (o, X) => {
    expect(o.tab.invalid, "credits tab invalid"); expect(o.sup.incomplete, "suppliers incomplete disclosure");
    eq(o.sup.pct, "—", "suppliers Food Cost"); eq(o.dash.pct, X.dash.purchasesPct.text, "dashboard Food Cost = node"); expect(!/\d/.test(o.dash.pct), "no dashboard Food Cost percentage: " + o.dash.pct);
    expect(o.sup.total.includes("חלקי"), "partial purchases total"); expect(!/₪/.test(o.pnl.vd50), "VD-50 without an amount: " + o.pnl.vd50);
    eq(o.dash.labor, X.dash.labor.text, "labor exact"); eq(o.dash.fixed, X.dash.fixedRent.text, "fixed exact"); expect(/₪/.test(o.dash.labor), "labor is an amount");
    eq(o.fatal, 0, "fatal page errors");
  });
  await scenario("RM1-02", "pending credit review: purchases partial, Food Cost —, VD-50 without an amount", { history: HISTORY_NODE, credits: PENDING }, (o, X) => {
    expect(o.sup.incomplete, "review disclosure"); eq(o.sup.pct, "—", "suppliers Food Cost"); eq(o.dash.pct, X.dash.purchasesPct.text, "dashboard Food Cost = node");
    expect(!/₪/.test(o.pnl.vd50), "VD-50 without an amount: " + o.pnl.vd50); eq(o.fatal, 0, "fatal page errors");
  });
  await scenario("RM1-03", "corrupt cost history (attested version payload changed after review): financial views unavailable; the credits tab still renders its month", { history: CORRUPT_HISTORY, credits: CHAIN }, (o, X) => {
    eq(X.costHistory.state, "unreadable", "node: the corrupt history is unreadable");
    expect(o.dash.unavailable !== "" && o.dash.purchases === "", "dashboard financial view unavailable: " + JSON.stringify(o.dash));
    expect(o.pnl === undefined, "no P&L figures over an unreadable basis");
    expect(o.tab.present && !o.tab.invalid && o.tab.total !== "", "credits tab renders"); eq(o.fatal, 0, "fatal page errors");
  });
  await scenario("RM1-04", "no persisted cost history (compat configuration basis) + credits: VD-50 and Food Cost on net purchases equal the node core", { history: null, credits: CHAIN }, (o, X) => {
    eq(X.costHistory.state, "absent", "node: no history");
    eq(o.dash.purchases, X.dash.purchases.text, "dashboard purchases"); eq(o.dash.pct, X.dash.purchasesPct.text, "dashboard Food Cost");
    expect(o.pnl && o.pnl.vd50.includes(X.pnl.gross.text), "VD-50 = node " + (o.pnl && o.pnl.vd50) + " / " + X.pnl.gross.text);
    eq(o.sup.pct, X.sup.purchasesPct.text, "suppliers Food Cost"); eq(o.fatal, 0, "fatal page errors");
  });

  console.log(`\n${"case".padEnd(7)} ${"status".padEnd(6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${r.id.padEnd(7)} ${r.status.padEnd(6)} ${r.description}\n        ${r.notes}`);
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (failures) process.exitCode = 1;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(process.exitCode || 0); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(4); });
}
