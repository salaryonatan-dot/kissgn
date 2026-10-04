// Marjin 1.0 P1 (P1 R1, MARJIN_CREDITS/2) — RENDERED Supplier Credits tab and net-purchase surfaces on the REAL RTDB emulator.
//
// The WORKING-TREE index.html is booted in jsdom through test/historical/historical-page-harness.mjs
// (real React tree, its own firebase module over an ordinary-member Admin app). The four credit
// actions are served by the ACTUAL api/admin.js handler (only its auth / email / Admin-app seams
// replaced; the DB is the real Admin transport to the same emulator); list-entry-exceptions by the
// REAL repository. Expected texts are computed in node from the same stored data through the same
// generated core and the page's own seams — never restated formulas.
// P1 R1 adds: the mandatory document number, review states (pending / flagged badges, owner accept),
// the unknown-outcome same-operation retry, and the retired legacy pending-credit card (its stored node
// is byte-identical after every case).
//
// Deliberately NOT named *.test.mjs (needs the emulator). Run through the emulator runner.
import admin from "firebase-admin";
import { readFileSync, mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { bootHistoricalPage, depsStatus, click, textOf, findByText } from "../historical/historical-page-harness.mjs";
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

// the real admin handler, only the Admin-SDK / auth / email seams replaced
const hdir = mkdtempSync(join(tmpdir(), "p1-rendered-admin-"));
cpSync(join(ROOT, "lib"), join(hdir, "lib"), { recursive: true });
mkdirSync(join(hdir, "api"), { recursive: true });
cpSync(join(ROOT, "api", "admin.js"), join(hdir, "api", "admin.js"));
mkdirSync(join(hdir, "fincore"), { recursive: true });
cpSync(join(ROOT, "fincore", "v1"), join(hdir, "fincore", "v1"), { recursive: true });
try { symlinkSync(join(ROOT, "node_modules"), join(hdir, "node_modules"), "dir"); } catch (_) {}
writeFileSync(join(hdir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB(); }\nexport function getAdminAuth() { return { getUser: async () => ({}) }; }\n`);
writeFileSync(join(hdir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyToken() { return globalThis.__CLAIMS; }\n`);
writeFileSync(join(hdir, "lib", "sendEmail.js"), `export async function sendEmail() { return { messageId: "m" }; }\nexport async function sendAlertDigest() { return { messageId: "d" }; }\n`);
const handler = (await import(pathToFileURL(join(hdir, "api", "admin.js")).href)).default;
const FIX = await import(pathToFileURL(join(ROOT, "test", "support", "p1-credit-fixtures.mjs")).href);

// ── clock: Israel business date = day 12 of the current month ──
const realNow = Date.now();
const MONTH = new Date(realNow).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const AS_OF = `${MONTH}-12`;
const TARGET_MS = Date.parse(`${AS_OF}T07:00:00Z`);
const CLOCK_OFFSET_MS = TARGET_MS - realNow;
const d = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ROWS = [];
for (let n = 1; n <= 11; n++) ROWS.push({ id: `0000000${n % 10}-p1aa-4bbb-8ccc-${String(n).padStart(12, "0")}`.replace("p1aa", "aaaa"), date: d(n), sales: 1000, deliveries: 0, other_income: 0, supplier_payments: { s1: 300 }, payroll: 100, other_expense: 0, notes: "" });
const CONFIG = { businessName: "סניף P1", rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 30, laborCostPct: 27 }, employees: [] };
const SUPS = [{ id: "s1", name: "קוקה קולה", category: "משקאות", days: [0, 1, 2, 3, 4, 5] }];
const USER = { uid: "u_owner", email: "o@demo.example", displayName: "owner1" };
const env = (v) => ({ _v: JSON.stringify(v) });
const CREDIT1 = FIX.creditNode([FIX.spec(1, "s1", d(5), "100", { documentNumber: "CR-100", actor: "u_owner", role: "owner" })], { tenantId: "tenantA", bizId: "bizA" });
/** The retired legacy pending-credit node (owner decision 4): preserved byte-for-byte, never read or written by the page. */
const LEGACY = { _v: JSON.stringify([{ id: 991, supplierId: "s1", supplierName: "קוקה קולה", date: "2026-01-02", amount: 77, note: "legacy pending" }]) };
const fixtures = () => ({
  tenants: { [T]: {
    members: { u_owner: true }, roles: { u_owner: "owner" }, biz_access: { [B]: { u_owner: true } },
    app: { users: env([{ id: 1, username: "owner1", name: "בעלים", email: USER.email, role: "owner", firebaseUid: USER.uid }]), business: env([{ id: B, name: "סניף P1" }]) },
    [`biz:${B}:entries`]: env(ROWS), [`biz:${B}:config`]: env(CONFIG), [`biz:${B}:fixed`]: env([]), [`biz:${B}:suppliers`]: env(SUPS),
    [`biz:${B}:supplier_credits`]: CREDIT1, [`biz:${B}:credits`]: LEGACY,
  } },
  user_tenants: { u_owner: T }, user_active_biz: { u_owner: B },
  username_index: { owner1: { tenantId: T, email: USER.email } },
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
const qp = (page, k) => page.document.querySelector(`[data-p1="${k}"]`);
const qc = (page, k) => page.document.querySelector(`[data-c1="${k}"]`);
const fatalErrors = (page) => page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined|Minified React error/.test(e));

// ── API double: credit actions → REAL handler; entry-exceptions list → REAL repository ──
const ctl = { creditsList: "ok", calls: [], loseNextCreate: false, deferNextDecision: false };
const resp = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body, text: async () => JSON.stringify(body) });
async function callHandler(u, opts) {
  const url = new URL(u, "http://x"), query = Object.fromEntries(url.searchParams.entries());
  const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
  globalThis.__CLAIMS = { uid: USER.uid, email: USER.email }; globalThis.__DB = () => apps.seed.database();
  await handler({ method: (opts && opts.method) || "GET", query, headers: { authorization: "Bearer t" }, body: opts && opts.body ? JSON.parse(opts.body) : undefined }, r);
  return resp(r.code, r.body);
}
function makeFetch() {
  return async (url, opts) => {
    const u = String(url);
    if (u.startsWith("/api/config")) return resp(200, { apiKey: "demo", authDomain: "demo.local", databaseURL: DB_URL, projectId: PROJECT });
    if (u.startsWith("/api/admin?action=list-entry-exceptions")) {
      const p = new URL(u, "http://x").searchParams;
      const { listEntryExceptions } = await import("../../lib/repositories/entryExceptionsRepo.js");
      const exceptions = await listEntryExceptions({ tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate") });
      return resp(200, { ok: true, tenantId: p.get("tenantId"), bizId: p.get("bizId"), fromDate: p.get("fromDate"), toDate: p.get("toDate"), exceptions });
    }
    const m = /^\/api\/admin\?action=([a-z-]*supplier-credit[a-z-]*)/.exec(u);
    if (m) {
      ctl.calls.push({ action: m[1], method: (opts && opts.method) || "GET", body: opts && opts.body ? JSON.parse(opts.body) : null });
      if (m[1] === "list-supplier-credits" && ctl.creditsList === "fail") return resp(500, { error: "list_failed" });
      if (m[1] === "create-supplier-credit" && ctl.loseNextCreate) {
        // the server COMMITS, the response is lost on the way back (network error at the client)
        ctl.loseNextCreate = false; await callHandler(u, opts); throw new TypeError("Failed to fetch");
      }
      if (m[1] === "decide-supplier-credit-review" && ctl.deferNextDecision) {
        ctl.deferNextDecision = false;
        return resp(200, { ok: true, applied: false, decisionPending: true, review: "flagged", postCommitAccess: "verification_unavailable", retryWithSameOperation: true });
      }
      return callHandler(u, opts);
    }
    return resp(404, { error: "not_available_in_harness" });
  };
}
const session = { ["marjin_tid_" + USER.uid]: T, ["marjin_biz_" + USER.uid]: B };
async function boot() {
  const page = await bootHistoricalPage({ html: HTML, fincore: "ok", loadFincore: loadFinance, adminApp: apps.owner, user: USER, session, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS, fetchImpl: makeFetch() });
  await page.until(() => page.document.querySelector(".kpi-card-link") !== null || qc(page, "fin-unavailable") !== null, 20000);
  return page;
}
const navScreen = async (page, label) => { const b = Array.from(page.document.querySelectorAll("button.mhd-tab")).find((x) => textOf(x) === label); expect(b, "nav " + label); click(b); await page.sleep(300); };
const subTab = async (page, label) => { const b = findByText(page.document, "button", label); expect(b, "sub-tab " + label); click(b); await page.sleep(200); };
function setValue(page, el, value) {
  const w = page.window;
  const proto = el.tagName === "SELECT" ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new w.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const stored = async () => (await apps.seed.database().ref(NODE).once("value")).val();
const entriesNow = async () => JSON.stringify((await apps.seed.database().ref(`tenants/${T}/biz:${B}:entries`).once("value")).val());
async function creditsTab(page) {
  await navScreen(page, "קניות");
  await subTab(page, "זיכויי ספקים");
  await page.until(() => qp(page, "credits-tab") !== null && (qp(page, "credits-loading") === null), 15000);
}

// node expectations through the page's own seams + the generated core
async function expected(node) {
  const F = await loadFinance(), C1 = loadSeam(HTML);
  const win = {}; const block = HTML.slice(HTML.indexOf("// ── P1 supplier credits browser seam"));
  vm.runInNewContext(block.slice(0, block.indexOf("</script>")), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController });
  const P1 = win.MarjinP1;
  const credits = F.finance.supplierCredits.decodeSupplierCredits(node ? { ...node, operations: undefined } : null, { tenantId: T, bizId: B });
  const src = { rows: ROWS, config: { state: "present", value: CONFIG }, fixed: { state: "present", value: [] }, asOf: AS_OF, ledger: { state: "absent", states: {}, from: "2000-01-01", to: "2100-12-31" }, rowsReady: true, credits };
  return { F, C1, P1, sup: C1.suppliers(F, src, MONTH, SUPS), tab: P1.monthView(F, credits, MONTH, SUPS) };
}

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")}`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: USER.uid, token: { email: USER.email } } }, "owner");
  await loadRules(RULES);
  await apps.seed.database().ref("/").set(fixtures());
  const entriesBefore = await entriesNow();
  let page = null;

  await run("P1R-01", "the dedicated 'זיכויי ספקים' tab under Purchases lists the month's credit by ISSUE date with its document number and the active total (= node core)", async () => {
    const X = await expected(await stored());
    page = await boot();
    await creditsTab(page);
    expect(qp(page, `credit-row-${cid(1)}`), "seeded credit row rendered: " + textOf(qp(page, "credits-tab")).slice(0, 300));
    eq(textOf(qp(page, "credits-total")), X.tab.totalText, "tab total");
    expect(textOf(qp(page, `credit-row-${cid(1)}`)).includes("CR-100"), "document number shown");
    expect(textOf(qp(page, "credits-tab")).includes("תאריך ההנפקה של מסמך הזיכוי"), "issue-date attribution explained");
    expect(qp(page, "credit-form"), "owner sees the form");
    expect(fatalErrors(page).length === 0, "no fatal errors: " + fatalErrors(page).slice(0, 3).join(" | "));
    return `total ${X.tab.totalText}`;
  });

  await run("P1R-02", "the supplier entry tab shows gross − credits = net for the month and per supplier; values equal the node C1 view over the same stored node", async () => {
    const X = await expected(await stored());
    await subTab(page, "הזנת ספקים");
    await page.until(() => qc(page, "sup-gross-credits") !== null, 10000);
    const t = textOf(qc(page, "sup-gross-credits"));
    expect(t.includes(X.sup.gross.text) && t.includes(X.sup.credits.text) && t.includes(X.sup.total.text), `strip "${t}" vs gross ${X.sup.gross.text} credits ${X.sup.credits.text} net ${X.sup.total.text}`);
    expect(qc(page, "sup-row-credits-s1"), "per-supplier gross − credits line");
    expect(textOf(qc(page, "sup-row-credits-s1")).includes(X.sup.bySupplierId.s1.grossText), "row gross");
    return t;
  });

  await run("P1R-03", "creating a credit through the form: POST create-supplier-credit (UUIDs, canonical amount), the record is stored with audit metadata, the list and the net update; entries are untouched (no negative purchase)", async () => {
    await creditsTab(page);
    const before = ctl.calls.filter((c) => c.action === "create-supplier-credit").length;
    setValue(page, qp(page, "credit-supplier"), "s1");
    setValue(page, qp(page, "credit-date"), d(8));
    setValue(page, qp(page, "credit-amount"), "50.50");
    setValue(page, qp(page, "credit-doc"), "  cr   2 ");
    await page.sleep(50);
    click(qp(page, "credit-save"));
    await page.until(() => qp(page, "credit-msg-ok") !== null || qp(page, "credit-msg-warn") !== null || qp(page, "credit-msg-error") !== null, 15000);
    expect(!qp(page, "credit-msg-error"), "no error: " + textOf(qp(page, "credit-msg-error")));
    const posts = ctl.calls.filter((c) => c.action === "create-supplier-credit");
    eq(posts.length, before + 1, "one create POST"); eq(posts[posts.length - 1].method, "POST", "POST");
    const body = posts[posts.length - 1].body;
    expect(/^[0-9a-f-]{36}$/.test(body.creditId) && /^[0-9a-f-]{36}$/.test(body.operationId), "UUID identities");
    eq(body.amount, "50.5", "canonical amount sent"); eq(body.issueDate, d(8), "issue date as typed"); eq(body.documentNumber, "cr 2", "normalized display number sent");
    const nd = await stored();
    const rec = nd.records[body.creditId];
    expect(rec && rec.amount === "50.5" && rec.documentKey === "cr~20~2" && !("documentCaseSensitive" in rec) && rec.createdBy === USER.uid && rec.createdRole === "owner", "stored record " + JSON.stringify(rec));
    eq(nd.review[body.operationId].state, "cleared", "the post-commit check cleared the review");
    await page.until(() => qp(page, `credit-row-${body.creditId}`) !== null, 10000);
    const X = await expected(nd);
    eq(textOf(qp(page, "credits-total")), X.tab.totalText, "tab total after create");
    eq(await entriesNow(), entriesBefore, "entries node byte-identical (a credit is never a purchase row)");
    return `${X.tab.totalText} · ${body.creditId}`;
  });

  await run("P1R-04", "validation: a NEGATIVE / zero amount, a missing date or a MISSING / DUPLICATE document number shows a Hebrew error and the duplicate is refused by the server", async () => {
    const before = ctl.calls.length;
    setValue(page, qp(page, "credit-supplier"), "s1");
    setValue(page, qp(page, "credit-date"), "");
    setValue(page, qp(page, "credit-amount"), "-20");
    await page.sleep(50);
    click(qp(page, "credit-save"));
    await page.until(() => qp(page, "err-amount") !== null, 5000);
    expect(qp(page, "err-issueDate"), "date error");
    expect(/חיובי/.test(textOf(qp(page, "err-amount"))), "positive-amount message");
    eq(ctl.calls.length, before, "no request");
    setValue(page, qp(page, "credit-amount"), "0"); setValue(page, qp(page, "credit-date"), d(9)); await page.sleep(50);
    click(qp(page, "credit-save")); await page.sleep(200);
    expect(qp(page, "err-amount"), "zero refused"); expect(qp(page, "err-documentNumber"), "missing document number refused"); eq(ctl.calls.length, before, "still no request");
    // a hard duplicate (case differs) passes the client and is refused by the server, nothing stored
    const n0 = Object.keys((await stored()).records).length;
    setValue(page, qp(page, "credit-amount"), "5"); setValue(page, qp(page, "credit-doc"), "cr-100"); await page.sleep(50);
    click(qp(page, "credit-save"));
    await page.until(() => qp(page, "credit-msg-error") !== null, 10000);
    expect(/כבר רשום/.test(textOf(qp(page, "credit-msg-error"))), "duplicate message: " + textOf(qp(page, "credit-msg-error")));
    eq(Object.keys((await stored()).records).length, n0, "nothing stored");
    setValue(page, qp(page, "credit-amount"), ""); setValue(page, qp(page, "credit-date"), ""); setValue(page, qp(page, "credit-supplier"), ""); setValue(page, qp(page, "credit-doc"), "");
    return "refused client-side + duplicate refused by the server";
  });

  await run("P1R-05", "void: the record stays (status 'בוטל', an immutable void event) and stops counting; the request carries the head sequence", async () => {
    const row = qp(page, `credit-row-${cid(1)}`);
    click(row.querySelector('[data-p1="credit-void"]'));
    await page.until(() => { const r = qp(page, `credit-row-${cid(1)}`); return r && /בוטל/.test(textOf(r)); }, 15000);
    const call = ctl.calls.filter((c) => c.action === "void-supplier-credit").pop();
    eq(call.body.expectedSeq, 1, "CAS sequence");
    const nd = await stored();
    const ev = nd.voids[call.body.operationId];
    eq(ev.kind, "void", "void event"); eq(ev.creditId, cid(1), "target"); eq(ev.voidedBy, USER.uid, "voidedBy"); eq(nd.records[cid(1)].amount, "100", "document kept (immutable)");
    const X = await expected(nd);
    await page.sleep(100);
    eq(textOf(qp(page, "credits-total")), X.tab.totalText, "total excludes the voided credit");
    return X.tab.totalText;
  });

  await run("P1R-06", "edit = replace: the form is pre-filled, saving voids the old record (replacedBy) and creates the new one in ONE request", async () => {
    const nd0 = await stored();
    const X0 = await expected(nd0);
    const activeId = X0.tab.rows.find((r) => r.editable).creditId;
    click(qp(page, `credit-row-${activeId}`).querySelector('[data-p1="credit-edit"]'));
    await page.sleep(100);
    eq(qp(page, "credit-amount").value, nd0.records[activeId].amount, "pre-filled amount");
    eq(qp(page, "credit-doc").value, "cr 2", "pre-filled document number");
    setValue(page, qp(page, "credit-amount"), "40"); await page.sleep(50);
    click(qp(page, "credit-save"));
    await page.until(() => ctl.calls.some((c) => c.action === "replace-supplier-credit") && (qp(page, "credit-msg-ok") || qp(page, "credit-msg-warn") || qp(page, "credit-msg-error")), 15000);
    expect(!qp(page, "credit-msg-error"), "no error: " + textOf(qp(page, "credit-msg-error")));
    const call = ctl.calls.filter((c) => c.action === "replace-supplier-credit").pop();
    const nd = await stored();
    eq(nd.voids[call.body.operationId].replacedByCreditId, call.body.newCreditId, "replace event links the successor"); eq(nd.voids[call.body.operationId].creditId, activeId, "and voids the predecessor");
    eq(nd.records[call.body.newCreditId].amount, "40", "new amount"); eq(nd.records[call.body.newCreditId].replacesCreditId, activeId, "back link");
    eq(nd.records[call.body.newCreditId].documentKey, "cr~20~2", "same document identity"); eq(call.body.identityCorrection, undefined, "no identity correction");
    await page.until(() => qp(page, `credit-row-${call.body.newCreditId}`) !== null, 10000);
    const X = await expected(nd);
    eq(textOf(qp(page, "credits-total")), X.tab.totalText, "total after edit");
    return X.tab.totalText;
  });

  await run("P1R-09", "the retired legacy pending-credit card is NOT rendered on the dashboard and its stored node is byte-identical (never migrated, never reinterpreted)", async () => {
    await navScreen(page, "Dashboard");
    await page.sleep(300);
    const txt = textOf(page.document.body);
    expect(!/זיכוי ממתין/.test(txt) && !/ממתין לחשבונית זיכוי/.test(txt), "no legacy pending-credit card");
    eq(JSON.stringify((await apps.seed.database().ref(`tenants/${T}/biz:${B}:credits`).once("value")).val()), JSON.stringify(LEGACY), "legacy node byte-identical");
    page.detach(); page = null;
    return "hidden + preserved";
  });

  await run("P1R-10", "review states are rendered as such and never counted; the OWNER accepts a flagged credit ⇒ it counts once (POST decide-supplier-credit-review)", async () => {
    // a pending and a flagged credit, written by the real writer domain (the same bytes the server stores)
    const n0 = await stored();
    let n1 = n0;
    const SCm = await import(pathToFileURL(join(ROOT, "lib", "supplierCredits.js")).href);
    const create = (node, n, doc, amount, issue) => { const c = { action: "create", tenantId: T, bizId: B, creditId: cid(n), operationId: FIX.oid(n), input: SCm.validateCreditInput({ supplierId: "s1", issueDate: issue, amount, documentNumber: doc }), actorUid: "u_mgr_gone", actorRole: "manager", now: Date.now() + n }; c.requestHash = SCm.requestHash(c); return SCm.applyCreditOperation(node, c).node; };
    n1 = create(n1, 20, "PEND-1", "11", d(3));
    n1 = create(n1, 21, "FLAG-1", "22", d(4));
    n1 = FIX.resolve(n1, FIX.oid(21), "flagged", { now: Date.now() + 100 });
    await apps.seed.database().ref(NODE).set(n1);
    const p = await boot();
    try {
      await creditsTab(p);
      await p.until(() => qp(p, `credit-row-${cid(21)}`) !== null, 10000);
      expect(/ממתין לאימות הרשאה/.test(textOf(qp(p, `credit-row-${cid(20)}`))), "pending badge");
      expect(/סומן לבדיקת הבעלים/.test(textOf(qp(p, `credit-row-${cid(21)}`))), "flagged badge");
      eq(qp(p, `credit-row-${cid(21)}`).getAttribute("data-p1-counted"), "0", "flagged not counted");
      expect(qp(p, "credits-review"), "review banner");
      const X = await expected(n1);
      eq(textOf(qp(p, "credits-total")), X.tab.totalText, "the total excludes pending / flagged");
      p.window.confirm = () => true;
      ctl.deferNextDecision = true;
      click(qp(p, `credit-row-${cid(21)}`).querySelector('[data-p1="credit-accept"]'));
      await p.until(() => qp(p, "credit-retry-same") !== null, 15000);
      expect(/טרם אושרה/.test(textOf(qp(p, "credit-msg-warn"))), "pending decision is never displayed as accepted");
      eq((await stored()).review[FIX.oid(21)].state, "flagged", "still withheld");
      const decisionBody = ctl.calls.filter(c => c.action === "decide-supplier-credit-review").pop().body;
      await p.until(() => qp(p, "credit-retry-same") && !qp(p, "credit-retry-same").disabled, 15000);
      click(qp(p, "credit-retry-same"));
      await p.until(() => qp(p, `credit-row-${cid(21)}`)?.getAttribute("data-p1-counted") === "1", 15000);
      eq(JSON.stringify(ctl.calls.filter(c => c.action === "decide-supplier-credit-review").pop().body), JSON.stringify(decisionBody), "same decision operation retry");
      await p.until(() => ctl.calls.some((c) => c.action === "decide-supplier-credit-review") && (qp(p, "credit-msg-ok") || qp(p, "credit-msg-warn") || qp(p, "credit-msg-error")), 15000);
      expect(!qp(p, "credit-msg-error"), "no error: " + textOf(qp(p, "credit-msg-error")));
      const nd = await stored();
      eq(nd.review[FIX.oid(21)].state, "cleared", "accepted"); eq(nd.review[FIX.oid(21)].decidedBy, USER.uid, "by the owner");
      await p.until(() => qp(p, `credit-row-${cid(21)}`) && qp(p, `credit-row-${cid(21)}`).getAttribute("data-p1-counted") === "1", 10000);
      const X2 = await expected(nd);
      eq(textOf(qp(p, "credits-total")), X2.tab.totalText, "counted once after acceptance");
      return `${X.tab.totalText} → ${X2.tab.totalText}`;
    } finally { p.detach(); }
  });

  await run("P1R-11", "a LOST response (the server committed, the client saw a network error) shows 'status unknown' with a same-operation retry; the retry replays — exactly one record", async () => {
    const p = await boot();
    try {
      await creditsTab(p);
      const n0 = Object.keys((await stored()).records).length;
      ctl.loseNextCreate = true;
      setValue(p, qp(p, "credit-supplier"), "s1"); setValue(p, qp(p, "credit-date"), d(9)); setValue(p, qp(p, "credit-amount"), "7"); setValue(p, qp(p, "credit-doc"), "LOST-1");
      await p.sleep(50);
      click(qp(p, "credit-save"));
      await p.until(() => qp(p, "credit-retry-same") !== null, 15000);
      expect(/אינו ידוע/.test(textOf(qp(p, "credit-msg-error"))), "status unknown, never 'not saved': " + textOf(qp(p, "credit-msg-error")));
      expect(!/לא נשמר/.test(textOf(qp(p, "credit-msg-error"))), "never claims 'not saved'");
      const first = ctl.calls.filter((c) => c.action === "create-supplier-credit").pop().body;
      eq(Object.keys((await stored()).records).length, n0 + 1, "the lost request DID commit");
      click(qp(p, "credit-retry-same"));
      await p.until(() => qp(p, "credit-msg-ok") !== null || qp(p, "credit-msg-warn") !== null, 15000);
      const retry = ctl.calls.filter((c) => c.action === "create-supplier-credit").pop().body;
      eq(JSON.stringify(retry), JSON.stringify(first), "the retry is the SAME operation (same ids, same body)");
      eq(Object.keys((await stored()).records).length, n0 + 1, "exactly one record");
      return "unknown → same-operation retry → replayed";
    } finally { p.detach(); }
  });

  await run("P1R-07", "an unavailable credit list is explicit (never 'no credits'): the tab shows the unavailable state with retry, purchases are marked incomplete; retry recovers", async () => {
    ctl.creditsList = "fail";
    const p = await boot();
    try {
      await navScreen(p, "קניות");
      await subTab(p, "הזנת ספקים");
      await p.until(() => qc(p, "sup-credits-incomplete") !== null, 15000);
      expect(!qc(p, "sup-gross-credits"), "no complete-looking credit line");
      await subTab(p, "זיכויי ספקים");
      await p.until(() => qp(p, "credits-unavailable") !== null, 10000);
      expect(!qp(p, "credits-empty"), "not shown as an empty month");
      ctl.creditsList = "ok";
      click(qp(p, "credits-retry"));
      await p.until(() => qp(p, "credits-total") !== null, 15000);
      return "unavailable → retry → " + textOf(qp(p, "credits-total"));
    } finally { ctl.creditsList = "ok"; p.detach(); }
  });

  await run("P1R-08", "a client cannot bypass the API: the signed-in owner's own RTDB app is DENIED reading and writing the credit node", async () => {
    const db = apps.owner.database();
    let r = "allowed"; try { await db.ref(NODE).once("value"); } catch (e) { r = String(e.code || e.message); }
    expect(/permission/i.test(r), "read denied: " + r);
    let w = "allowed"; try { await db.ref(NODE + "/records/x").set({ amount: "-1" }); } catch (e) { w = String(e.code || e.message); }
    expect(/permission/i.test(w), "write denied: " + w);
    let rv = "allowed"; try { await db.ref(NODE + "/review").set({ x: { state: "cleared" } }); } catch (e) { rv = String(e.code || e.message); }
    expect(/permission/i.test(rv), "review forge denied: " + rv);
    return "read + write denied";
  });
  await run("P1R-12", "a similar separator variant shows a visible warning and needs an explicit audited different-document confirmation", async () => {
    const p = await boot();
    try {
      await creditsTab(p);
      const n0 = Object.keys((await stored()).records).length;
      setValue(p, qp(p, "credit-supplier"), "s1"); setValue(p, qp(p, "credit-date"), d(10));
      setValue(p, qp(p, "credit-amount"), "9"); setValue(p, qp(p, "credit-doc"), "CR/100");
      await p.sleep(50); click(qp(p, "credit-save"));
      await p.until(() => qp(p, "credit-confirm-similar") !== null, 10000);
      expect(/דומה/.test(textOf(qp(p, "credit-msg-error"))), "visible similarity warning");
      eq(Object.keys((await stored()).records).length, n0, "warning stores nothing");
      p.window.prompt = () => "Verified distinct original document";
      click(qp(p, "credit-confirm-similar"));
      await p.until(() => qp(p, "credit-msg-ok") !== null || qp(p, "credit-msg-warn") !== null, 15000);
      const call = ctl.calls.filter((c) => c.action === "create-supplier-credit").pop();
      const nd = await stored();
      eq(Object.keys(nd.records).length, n0 + 1, "one new credit");
      eq(nd.records[call.body.creditId].similarityConfirmation.reason, "Verified distinct original document", "audited reason");
      eq(JSON.stringify(nd.records[call.body.creditId].similarityConfirmation.confirmedAgainst), JSON.stringify([cid(1)]), "exact similarity identity");
      eq(nd.records[call.body.creditId].similarityConfirmation.by, USER.uid, "authenticated actor");
      return "warning → explicit audited confirmation";
    } finally { p.detach(); }
  });

  const wd = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${wd("case", 7)} ${wd("status", 6)} ${wd("ms", 6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${wd(r.id, 7)} ${wd(r.status, 6)} ${wd(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 12;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`INCOMPLETE: expected ${EXPECTED}`); process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — rendered P1 Supplier Credits");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(process.exitCode || 0); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); process.exit(4); });
}
