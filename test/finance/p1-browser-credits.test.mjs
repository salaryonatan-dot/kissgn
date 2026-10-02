// P1 Supplier Credits — the browser seam (window.MarjinP1 in index.html) and the C1 consumers
// that now read NET purchases, evaluated in a node vm over the COMMITTED fincore/v1 bundle (the
// same two artefacts the page loads). Browser ≡ server: the C1 suppliers / Food Cost view over the
// list-API node equals the server canonical month report over the same stored node.
//   P1B-01…06  seam: list session, source states, form validation (no negative invoice), ids, bodies
//   P1B-07…09  Supplier Credits tab month view: loading / unavailable / empty / rows / invalid
//   P1B-10…14  C1 consumers: suppliers gross/credits/net, incomplete + negative disclosures, history,
//              P&L and dashboard unchanged without credits, D-1 / closed days / forecast preserved
//   P1B-15     Food Cost browser ≡ server parity through the real loader
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance, loadSeam, present, absent, ledgerOf, row, srcOf } from "../support/c1-seam.mjs";
import { compileServer, makeDb } from "../support/server-reader-harness.mjs";
import { NOW_MS, T, B, env, seedRaw, stableJson, uid, asLegacy } from "../support/b1-fixtures.mjs";
import * as SC from "../../lib/supplierCredits.js";

const F = await loadFinance();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
export const P1_START = "// ── P1 supplier credits browser seam";
export function p1Source(html) {
  const i = html.indexOf(P1_START);
  if (i < 0) throw new Error("P1 seam not found");
  return html.slice(i, html.indexOf("</script>", i));
}
function loadP1(html = HTML, extra = {}) {
  const win = {};
  vm.runInNewContext(p1Source(html), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController, ...extra });
  return win.MarjinP1;
}
const P1 = loadP1();
/** vm-realm objects compared structurally (cross-realm prototypes differ) */
const deq = (a, b, m) => assert.deepEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b, m);
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rec = (n, supplierId, issueDate, amount, extra = {}) => ({ creditId: cid(n), supplierId, issueDate, amount, status: "active", revision: 1, createdAt: 1, createdBy: "u", ...extra });
const node = (...recs) => ({ schemaVersion: 1, revision: Math.max(1, recs.length), records: Object.fromEntries(recs.map((r) => [r.creditId, r])) });
const SUPS = [{ id: "s1", name: "קוקה קולה" }, { id: 2, name: "ירקות" }];
const AS_OF = "2026-10-05";
const pad = (n) => String(n).padStart(2, "0");
const monthRows = (m, days, sup = () => ({ s1: "300" })) => Array.from({ length: days }, (_, i) => row(`${m}-${pad(i + 1)}`, { sales: "1000", supplier_payments: sup(i + 1), payroll: "100" }, uid(Number(m.slice(5)) * 100 + i + 1)));
const ROWS = () => [...monthRows("2026-09", 30, (d) => ({ s1: d <= 30 ? "300" : "0" })), ...monthRows("2026-10", 4)];
const src = (credits, rows = ROWS(), asOf = AS_OF) => ({ ...srcOf({ rows, asOf }), ...(credits === undefined ? {} : { credits }) });
const decoded = (raw) => F.finance.supplierCredits.decodeSupplierCredits(raw);

// ── P1B-01…06 seam ─────────────────────────────────────────────────────────────
test("P1B-01 list session: ready / response shape / failed read / deadline → explicit unreadable; a newer key makes the older STALE (never overwrites)", async () => {
  const s = P1.createCreditsSession({ deadlineMs: 5 });
  deq(await s.request("k1", async () => ({ ok: true, node: null })), { state: "ready", node: null, key: "k1" });
  assert.equal((await s.request("k2", async () => ({ ok: true }))).reason, "response_shape", "a body without `node` is not 'no credits'");
  assert.equal((await s.request("k3", async () => { throw new Error("net"); })).reason, "read_failed");
  assert.equal((await s.request("k4", () => new Promise(() => {}))).reason, "deadline_exceeded");
  let release; const slow = s.request("old", () => new Promise((r) => { release = r; }));
  await new Promise((r) => setImmediate(r));
  const fresh = s.request("new", async () => ({ ok: true, node: node(rec(1, "s1", "2026-10-01", "5")) }));
  release({ ok: true, node: null });
  assert.equal((await slow).state, "stale"); assert.equal((await fresh).state, "ready"); assert.equal(s.latest(), "new");
  const live = { v: true }; const p = s.request("k5", async () => ({ ok: true, node: null }), () => live.v); live.v = false;
  assert.equal((await p).state, "stale", "a selection that changed mid-read never resolves");
});

test("P1B-02 sourceFor: loading until THIS key is held; a failed read is not_loaded (never 'no credits'); a held node is core-decoded", () => {
  deq(P1.sourceFor(F, null, "k"), { state: "loading" });
  deq(P1.sourceFor(F, { key: "old", state: "ready", node: null }, "k"), { state: "loading" });
  deq(P1.sourceFor(F, { key: "k", state: "unreadable", reason: "read_failed" }, "k"), { state: "not_loaded" });
  deq(P1.sourceFor(F, { key: "k", state: "ready", node: null }, "k"), { state: "absent" });
  assert.equal(P1.sourceFor(F, { key: "k", state: "ready", node: "garbage" }, "k").state, "unreadable");
  assert.equal(P1.sourceFor(F, { key: "k", state: "ready", node: node(rec(1, "s1", "2026-10-01", "5")) }, "k").records.length, 1);
});

test("P1B-03 form validation uses the core rules: supplier of the business, real issue date, positive net-of-VAT amount — a NEGATIVE amount is refused (never a negative invoice)", () => {
  const ok = P1.validateForm(F, { supplierId: "s1", issueDate: "2026-10-02", amount: " 300.50 ", documentNumber: " CR-1 ", note: "" }, SUPS);
  deq(ok, { ok: true, input: { supplierId: "s1", issueDate: "2026-10-02", amount: "300.5", documentNumber: "CR-1" } });
  assert.equal(P1.validateForm(F, { supplierId: "2", issueDate: "2026-10-02", amount: "1" }, SUPS).ok, true, "numeric supplier ids compare as strings");
  const errs = (f) => Object.keys(P1.validateForm(F, f, SUPS).errors || {}).sort();
  deq(errs({ supplierId: "", issueDate: "", amount: "" }), ["amount", "issueDate", "supplierId"]);
  deq(errs({ supplierId: "s9", issueDate: "2026-10-02", amount: "1" }), ["supplierId"], "not a supplier of the business");
  for (const a of ["-300", "0", "0.00", "1,000", "1e3", "abc", "300.555"]) deq(errs({ supplierId: "s1", issueDate: "2026-10-02", amount: a }), ["amount"], a);
  for (const d of ["2026-02-30", "2027-02-29", "02/10/2026", "2026-10-2"]) deq(errs({ supplierId: "s1", issueDate: d, amount: "1" }), ["issueDate"], d);
  deq(errs({ supplierId: "s1", issueDate: "2026-10-02", amount: "1", documentNumber: "x".repeat(65), note: "y".repeat(501) }), ["documentNumber", "note"]);
  assert.equal(P1.ERRORS.invalid_amount.includes("חיובי"), true);
});

test("P1B-04 identities come only from crypto.randomUUID (never Math.random); request bodies carry exactly the documented fields", () => {
  assert.equal(P1.newId({}), null); assert.equal(P1.newId({ randomUUID: () => cid(7) }), cid(7));
  assert.doesNotMatch(p1Source(HTML), /Math\.random\(/);
  const ctx = { tenantId: T, bizId: B };
  const input = { supplierId: "s1", issueDate: "2026-10-02", amount: "300" };
  deq(P1.createBody(ctx, input, cid(1), cid(2)), { tenantId: T, bizId: B, creditId: cid(1), operationId: cid(2), ...input });
  const r = { creditId: cid(1), revision: 3 };
  deq(P1.voidBody(ctx, r, cid(4)), { tenantId: T, bizId: B, creditId: cid(1), operationId: cid(4), expectedRecordRevision: 3 });
  deq(P1.replaceBody(ctx, r, input, cid(5), cid(6)), { tenantId: T, bizId: B, creditId: cid(1), newCreditId: cid(5), operationId: cid(6), expectedRecordRevision: 3, ...input });
});

test("P1B-05 every server error code has a Hebrew message; unknown codes fall back to 'not saved'", () => {
  const codes = ["invalid_supplier_id", "unknown_supplier", "suppliers_unavailable", "invalid_issue_date", "invalid_amount", "credit_id_exists", "credit_not_found", "credit_not_active", "revision_conflict", "idempotency_conflict", "record_limit_reached", "operation_limit_reached", "node_unreadable", "role_not_allowed", "business_access_denied", "maintenance", "network"];
  for (const c of codes) assert.match(P1.errorText(c), /[֐-׿]/, c);
  assert.equal(P1.errorText("weird"), P1.ERRORS.failed);
});

test("P1B-06 the seam never reads or writes RTDB and calls only the four credit actions (server-mediated documents)", () => {
  const block = p1Source(HTML);
  for (const re of [/firebase/i, /storage\.(set|get|mutate)/, /_rtdb/, /supplier_payments/, /setSupPayDate|saveEntry|persistEntries/]) assert.doesNotMatch(block, re);
  const page = HTML;
  const actions = [...page.matchAll(/action=([a-z-]*supplier-credit[a-z-]*)/g)].map((m) => m[1]);
  deq([...new Set(actions)].sort(), ["list-supplier-credits"]);
  for (const a of ["create-supplier-credit", "void-supplier-credit", "replace-supplier-credit"]) assert.ok(page.includes(`"${a}"`), a);
});

// ── P1B-07…09 tab view ─────────────────────────────────────────────────────────
test("P1B-07 month view states: loading, unavailable (not_loaded / unreadable — with retry), empty month, rows newest-first with voided / replaced labels and the ACTIVE total", () => {
  assert.equal(P1.monthView(F, { state: "loading" }, "2026-10", SUPS).status, "loading");
  for (const s of [{ state: "not_loaded" }, { state: "unreadable", reason: "schema_version" }]) assert.equal(P1.monthView(F, s, "2026-10", SUPS).status, "unavailable");
  const empty = P1.monthView(F, { state: "absent" }, "2026-10", SUPS);
  deq([empty.status, empty.empty, empty.activeCount, empty.total], ["ready", true, 0, null]);
  const st = decoded(node(
    rec(1, "s1", "2026-10-01", "100", { status: "voided", revision: 2, replacedByCreditId: cid(2) }),
    rec(2, "s1", "2026-10-03", "90", { replacesCreditId: cid(1), documentNumber: "CR-2" }),
    rec(3, "2", "2026-10-02", "10.5"),
    rec(4, "s1", "2026-10-02", "7", { status: "voided", revision: 2 }),
    rec(5, "s1", "2026-09-30", "1000"),
  ));
  const v = P1.monthView(F, st, "2026-10", SUPS);
  deq(v.rows.map((r) => [r.creditId, r.issueDate, r.status, r.statusText]), [
    [cid(2), "2026-10-03", "active", ""], [cid(3), "2026-10-02", "active", ""], [cid(4), "2026-10-02", "voided", "בוטל"], [cid(1), "2026-10-01", "voided", "הוחלף בעריכה"],
  ]);
  assert.equal(v.total, "100.5"); assert.equal(v.activeCount, 2); assert.equal(v.rows[1].supplierName, "ירקות"); assert.equal(v.rows[0].documentNumber, "CR-2");
  assert.equal(P1.monthView(F, st, "2026-09", SUPS).total, "1000", "issue-month listing: the September credit is listed only in September");
});

test("P1B-08 invalid records are surfaced in their issue month (undatable ones in every month) — never silently dropped", () => {
  const st = decoded({ schemaVersion: 1, revision: 1, records: { [cid(1)]: rec(1, "s1", "2026-10-02", "0"), [cid(2)]: rec(2, "s1", "2026-10-03", "5") } });
  const oct = P1.monthView(F, st, "2026-10", SUPS), sep = P1.monthView(F, st, "2026-09", SUPS);
  assert.equal(oct.invalidCount, 1); assert.ok(oct.invalidText); assert.equal(sep.invalidCount, 0);
  const und = decoded({ schemaVersion: 1, revision: 1, records: { [cid(1)]: rec(1, "s1", "2027-02-29", "5") } });
  assert.equal(P1.monthView(F, und, "2026-01", SUPS).invalidCount, 1);
});

test("P1B-09 a record's note survives into the edit form; the edit (replace) body keeps the record's revision for CAS", () => {
  const st = decoded(node(rec(1, "s1", "2026-10-02", "5", { note: "חשבונית 77" })));
  const r = P1.monthView(F, st, "2026-10", SUPS).rows[0];
  assert.equal(r.note, "חשבונית 77"); assert.equal(r.revision, 1);
  assert.match(HTML, /note: row\.note \|\| "" \}\);/, "startEditCredit restores the note");
});

// ── P1B-10…14 C1 consumers ─────────────────────────────────────────────────────
test("P1B-10 C1 suppliers / Food Cost view: rows reconcile gross − credits = net; overall net; Food Cost on net; the tab total equals the report credits", () => {
  const raw = node(rec(1, "s1", "2026-09-15", "300"), rec(2, "s9", "2026-09-20", "40"));
  const v = C1.suppliers(F, src(decoded(raw)), "2026-09", SUPS);
  assert.equal(v.status, "ready");
  assert.equal(v.gross.amount, "9000"); assert.equal(v.credits.amount, "340"); assert.equal(v.total.amount, "8660");
  const s1 = v.bySupplierId.s1, s9 = v.bySupplierId.s9;
  deq([s1.gross, s1.credits, s1.amount, s1.negative], ["9000", "300", "8700", false]);
  deq([s9.gross, s9.credits, s9.amount, s9.negative], [null, "40", "-40", true], "a credit-only supplier is shown negative, never dropped");
  assert.equal(v.purchasesPct.num, Number((8660 / 30000 * 100).toFixed(10)) || v.purchasesPct.num);
  assert.ok(Math.abs(v.purchasesPct.num - 8660 / 30000 * 100) < 1e-6, "Food Cost % on NET");
  assert.equal(P1.monthView(F, decoded(raw), "2026-09", SUPS).total, v.credits.amount, "the Supplier Credits tab reconciles with the report");
  assert.equal(v.disclosure.negative, null); assert.equal(v.disclosure.incomplete, null);
});

test("P1B-11 C1 incomplete / net-negative / loading: credits loading ⇒ the view is loading; not_loaded / unreadable / invalid ⇒ purchases partial + disclosure; net-negative ⇒ disclosure", () => {
  deq(C1.suppliers(F, src({ state: "loading" }), "2026-09", SUPS), { status: "loading", reason: "supplier_credits" });
  for (const st of [{ state: "not_loaded" }, decoded("garbage"), decoded({ schemaVersion: 1, revision: 1, records: { [cid(1)]: rec(1, "s1", "2026-09-10", "-5") } })]) {
    const v = C1.suppliers(F, src(st), "2026-09", SUPS);
    assert.equal(v.status, "ready"); assert.equal(v.total.complete, false, JSON.stringify(st).slice(0, 60));
    assert.equal(v.disclosure.incomplete, C1.TXT.creditsIncomplete); assert.equal(v.purchasesPct.num, null, "no complete-looking Food Cost");
  }
  const neg = C1.suppliers(F, src(decoded(node(rec(1, "s1", "2026-09-10", "9500")))), "2026-09", SUPS);
  assert.equal(neg.total.amount, "-500"); assert.equal(neg.disclosure.negative, C1.TXT.negativeNetPurchases);
});

test("P1B-12 without credits (absent node) every C1 view is byte-identical to the pre-P1 composition (no credit source)", () => {
  const opts = { nowMs: Date.UTC(2026, 9, 5, 9), lastYearSales: null, dow: 1, suppliers: SUPS };
  const views = (s) => stableJson({
    d: C1.dashboard(F, s, opts), h: C1.history(F, s, "2026-09"), p: C1.pnl(F, s, "2026-09", "2026-08"), sup: C1.suppliers(F, s, "2026-09", SUPS),
  });
  assert.equal(views(src({ state: "absent" })), views(src(undefined)));
});

test("P1B-13 D-1, closed days and the forecast are preserved: a credit issued today / in the future does not count; a closed-day credit counts; the dashboard revenue forecast is unchanged", () => {
  const rows = ROWS().filter((r) => r.date !== "2026-09-09");
  const ledger = ledgerOf({ "2026-09-09": { status: "active", reasonCode: "closure", revision: 1 } }, "2026-01-01", "2026-12-31");
  const s0 = { ...srcOf({ rows, asOf: AS_OF, ledger }) };
  const st = decoded(node(rec(1, "s1", "2026-09-09", "60"), rec(2, "s1", AS_OF, "70"), rec(3, "s1", "2026-10-20", "80"), rec(4, "s1", "2026-10-02", "5")));
  const sep = C1.suppliers(F, { ...s0, credits: st }, "2026-09", SUPS);
  assert.equal(sep.credits.amount, "60", "closed-day credit counts in its issue month"); assert.equal(sep.report.coverage.day.closedDays.includes("2026-09-09"), true);
  const oct = C1.suppliers(F, { ...s0, credits: st }, "2026-10", SUPS);
  assert.equal(oct.credits.amount, "5", "only completed dates (≤ D-1) count");
  const opts = { nowMs: Date.UTC(2026, 9, 5, 9), lastYearSales: null, dow: 1, suppliers: SUPS };
  const a = C1.dashboard(F, { ...s0, credits: st }, opts), b = C1.dashboard(F, s0, opts);
  assert.equal(a.status, "ready"); assert.equal(b.status, "ready");
  assert.equal(stableJson(a.revenue), stableJson(b.revenue), "revenue unchanged");
  assert.equal(stableJson(a.projection.forecast), stableJson(b.projection.forecast), "REV_FORECAST/v2 unchanged");
  assert.equal(stableJson(a.chart), stableJson(b.chart)); assert.equal(stableJson(a.today), stableJson(b.today), "the current day stays context (never Actual)");
  assert.equal(a.purchases.amount, String(Number(b.purchases.amount) - 5), "only the completed Oct credit reduces MTD purchases");
});

test("P1B-14 the history month figures and P&L contribution use NET purchases", () => {
  const st = decoded(node(rec(1, "s1", "2026-09-15", "300")));
  const h = C1.history(F, src(st), "2026-09"), h0 = C1.history(F, src({ state: "absent" }), "2026-09");
  assert.equal(h.report.actual.purchases.value, "8700"); assert.equal(h0.report.actual.purchases.value, "9000");
  const day15 = h.days.find((d) => d.date === "2026-09-15"), day15b = h0.days.find((d) => d.date === "2026-09-15");
  assert.notEqual(day15.expensesText, day15b.expensesText, "the issue date's expenses are net");
  const p = C1.pnl(F, src(st), "2026-09", null), p0 = C1.pnl(F, src({ state: "absent" }), "2026-09", null);
  assert.notEqual(stableJson(p), stableJson(p0));
  assert.equal(BigInt(p.report.actual.contributionBeforeFixed.value) - BigInt(p0.report.actual.contributionBeforeFixed.value), 300n);
});

// ── P1B-15 browser ≡ server ────────────────────────────────────────────────────
test("P1B-15 Food Cost parity: the browser C1 report over the list-API node ≡ the server canonical month report over the same stored node (byte-identical)", async () => {
  const srv = compileServer();
  const CI = await srv.import("src/finance-server/canonicalInputs.js");
  const CM = await srv.import("src/finance-server/canonicalMetrics.js");
  const serialize = F.metrics.report.serializeReport;
  const nodes = [null, node(rec(1, "s1", "2026-09-15", "300")), node(rec(1, "s1", "2026-09-20", "9500"), rec(2, "s9", "2026-09-21", "3")), { schemaVersion: 1, revision: 1, records: { [cid(1)]: rec(1, "s1", "2026-09-10", "0") } }, "garbage"];
  const rows = ROWS().map(({ id, ...r }) => ({ id, ...r }));
  for (const stored of nodes) {
    const db = seedRaw(makeDb(), { entries: asLegacy(rows), config: env({}), fixed: null, suppliers: env(SUPS) });
    if (stored !== null) db.seed(`tenants/${T}/biz:${B}:supplier_credits`, typeof stored === "object" ? { ...stored, operations: { x: { kind: "create" } } } : stored);
    const si = await CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: Date.UTC(2026, 9, 5, 9), need: { config: true, fixed: true, exceptions: true } });
    for (const m of ["2026-09", "2026-10"]) {
      const server = CM.canonicalMonthReport(si, { kind: m === "2026-10" ? "open_month" : "closed_month", month: m }).report;
      const listNode = SC.safeNodeView(db.read(`tenants/${T}/biz:${B}:supplier_credits`));
      const s = { ...srcOf({ rows, asOf: si.asOfBusinessDate, config: present({}), fixed: absent() }), credits: P1.sourceFor(F, { key: "k", state: "ready", node: listNode }, "k") };
      const browser = C1.suppliers(F, s, m, SUPS);
      assert.equal(browser.status, "ready", JSON.stringify(browser));
      assert.equal(serialize(browser.report), serialize(server), `${JSON.stringify(stored).slice(0, 40)} ${m}`);
    }
  }
});
void NOW_MS;
