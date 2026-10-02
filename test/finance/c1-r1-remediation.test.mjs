// WP-C1 R1 — regressions for the independent C1 review (2026-10-02, CHANGES_REQUIRED).
// Each test reproduces a reviewed defect; every one FAILS on the rejected candidate e1a24d95
// (see the handoff's TEST_RESULTS.md red run) and passes on the remediation.
//  F2 incomplete other expense → no complete-looking breakdown shares
//  F4 missing hourly payroll   → never an authoritative ₪0; the daily total reflects it
//  F5 invalid royalty / deliveries → visibly unavailable, never hidden
//  F3 fixed-cost editor header → configured monthly amount (never the MTD accrual); explicit unavailable
//  F6 closure-ledger refresh   → no older result is authoritative for a newer input state
// Valid explicit zeros stay distinct from missing / invalid / unreadable throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFinance, loadSeam, srcOf, row, present, absent } from "../support/c1-seam.mjs";
import { GLOBAL_3000 } from "../support/financial-invariants.mjs";

const F = await loadFinance();
const C = loadSeam();
const NOW = Date.parse("2026-09-29T07:00:00Z"), AS_OF = "2026-09-29", MONTH = "2026-09";
const day = (d, f = {}) => row(`2026-09-${String(d).padStart(2, "0")}`, { sales: "100", deliveries: "0", other_income: "0", supplier_payments: { s: "20" }, payroll: "10", ...f });
const month = (patch = () => ({})) => { const r = []; for (let d = 1; d <= 28; d++) r.push(day(d, patch(d))); return r; };
const dash = (src) => C.dashboard(F, src, { nowMs: NOW, lastYearSales: null });
const strip = (x) => JSON.parse(JSON.stringify(x));

// ── F2 ─────────────────────────────────────────────────────────────────────────────────────────
test("C1R1-F2a invalid other expense: no breakdown share is shown and the other row is visibly unavailable (not dropped)", () => {
  const v = dash(srcOf({ rows: month((d) => d === 1 ? { other_expense: "abc" } : {}), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF }));
  assert.equal(v.report.actual.otherExpense.complete, false);
  assert.notEqual(v.report.actual.operatingProfit.state, "complete");
  for (const b of v.breakdown) assert.equal(b.shareText, "—", "no share for " + b.key);
  const other = v.breakdown.find((b) => b.key === "other");
  assert.ok(other, "the incomplete component is listed");
  assert.equal(other.text, "—");
});

test("C1R1-F2b explicit zero other expense stays a complete value: shares are shown and sum over the complete components", () => {
  const v = dash(srcOf({ rows: month(() => ({ other_expense: "0" })), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF }));
  assert.equal(v.report.actual.operatingProfit.state, "complete");
  const shares = v.breakdown.filter((b) => b.shareText !== "—");
  assert.ok(shares.length >= 2, "complete data keeps its shares");
  assert.ok(!v.breakdown.some((b) => b.key === "other"), "a complete ₪0 other expense is not an unavailable row");
});

// ── F4 ─────────────────────────────────────────────────────────────────────────────────────────
test("C1R1-F4a missing payroll on a completed present day: hourly and the day total are '—', never ₪0 / an authoritative total", () => {
  const rows = month(); delete rows[0].payroll;
  const e = C.employees(F, srcOf({ rows, config: present(GLOBAL_3000), fixed: absent(), asOf: AS_OF }), MONTH);
  const first = e.days[0];
  assert.equal(first.date, "2026-09-01");
  assert.equal(first.hourlyText, "—");
  assert.equal(first.totalText, "—");
  assert.equal(first.pctText, null);
  assert.equal(e.monthTotal.text, "—");
  const second = e.days[1];
  assert.notEqual(second.totalText, "—", "a day with payroll keeps its total");
});

test("C1R1-F4b explicit payroll 0 is a valid zero (₪0 hourly), distinct from missing", () => {
  const rows = month((d) => d === 1 ? { payroll: "0" } : {});
  const e = C.employees(F, srcOf({ rows, config: present(GLOBAL_3000), fixed: absent(), asOf: AS_OF }), MONTH);
  assert.equal(e.days[0].hourlyText, "₪0");
  assert.notEqual(e.days[0].totalText, "—");
});

test("C1R1-F4c entry preview: payroll not entered is missing (day total '—'); an entered 0 is a total", () => {
  const src = srcOf({ rows: month(), config: present(GLOBAL_3000), fixed: absent(), asOf: AS_OF });
  assert.equal(C.entryLabor(F, src, "2026-09-08", "").totalText, "—");
  assert.notEqual(C.entryLabor(F, src, "2026-09-08", "0").totalText, "—");
});

// ── F5 ─────────────────────────────────────────────────────────────────────────────────────────
test("C1R1-F5a an invalid royalty rate stays visible as unavailable on the dashboard and in the P&L (never hidden)", () => {
  const src = srcOf({ rows: month(), config: present({ employees: [], hasRoyalty: true, royaltyPct: "abc" }), fixed: absent(), asOf: AS_OF });
  const v = dash(src);
  assert.equal(v.royalty.show, true);
  assert.equal(v.royalty.text, "—");
  const p = C.pnl(F, src, MONTH, null);
  assert.equal(p.showRoyalty, true);
  // no royalty configured at all: nothing to show
  assert.equal(dash(srcOf({ rows: month(), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF })).royalty.show, false);
});

test("C1R1-F5b invalid deliveries keep the P&L deliveries row visible and unavailable; exact summation of valid deliveries is unchanged", () => {
  const bad = C.pnl(F, srcOf({ rows: month((d) => d === 1 ? { deliveries: "abc" } : {}), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF }), MONTH, null);
  assert.deepEqual(strip(bad.deliveries), { text: "—", show: true });
  const good = C.pnl(F, srcOf({ rows: month((d) => ({ deliveries: d === 1 ? "12.5" : "0" })), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF }), MONTH, null);
  assert.equal(good.deliveries.show, true);
  assert.equal(good.deliveries.text, F.presenters.money.formatShekel("12.5"));
  const none = C.pnl(F, srcOf({ rows: month(), config: present({ employees: [] }), fixed: absent(), asOf: AS_OF }), MONTH, null);
  assert.equal(none.deliveries.show, false, "explicit zero deliveries: no row (approved presentation)");
});

// ── F3 ─────────────────────────────────────────────────────────────────────────────────────────
test("C1R1-F3a the fixed-cost editor header shows the CONFIGURED monthly amount (₪3,100), not the MTD accrual", () => {
  const src = srcOf({ rows: month(), config: present({ employees: [] }), fixed: present([{ id: "f1", name: "rent", amount: 3100 }]), asOf: AS_OF });
  const h = C.configuredMonthly(F, src, AS_OF);
  assert.equal(h.status, "ready");
  assert.equal(h.available, true);
  assert.equal(h.amount, "3100");
  assert.equal(h.text, "₪3,100");
  assert.notEqual(h.text, dash(src).fixedRent.text, "the dashboard KPI (MTD accrual) is a different figure");
  assert.equal(h.basisLabel, F.presenters.labels.LABELS.configurationBasis.current_applied_retrospectively);
});

test("C1R1-F3b configured monthly: fixed rent included; % rent and royalty as rates; invalid / missing amount is an explicit unavailable state", () => {
  const withRent = C.configuredMonthly(F, srcOf({ rows: [], config: present({ rentType: "fixed", rentFixed: "5000", hasRoyalty: true, royaltyPct: "6" }), fixed: present([{ id: "a", amount: "100" }]), asOf: AS_OF }), AS_OF);
  assert.equal(withRent.amount, "5100");
  assert.equal(withRent.rentFixedText, "₪5,000");
  assert.equal(withRent.royaltyText, F.presenters.percent.formatPercent("6"));
  const pct = C.configuredMonthly(F, srcOf({ rows: [], config: present({ rentType: "pct", rentPct: "8" }), fixed: present([{ id: "a", amount: "100" }]), asOf: AS_OF }), AS_OF);
  assert.equal(pct.amount, "100");
  assert.equal(pct.rentPctText, F.presenters.percent.formatPercent("8"));
  for (const fixed of [present([{ id: "a", amount: "abc" }]), present([{ id: "a" }])]) {
    const u = C.configuredMonthly(F, srcOf({ rows: [], config: present({}), fixed, asOf: AS_OF }), AS_OF);
    assert.equal(u.status, "ready"); assert.equal(u.available, false); assert.equal(u.amount, null);
    assert.match(u.text, /לא זמין/);
  }
  const zero = C.configuredMonthly(F, srcOf({ rows: [], config: present({}), fixed: absent(), asOf: AS_OF }), AS_OF);
  assert.equal(zero.available, true); assert.equal(zero.text, "₪0", "no fixed items configured is a valid ₪0");
  assert.equal(C.configuredMonthly(F, srcOf({ rows: [], config: { state: "loading" }, fixed: absent(), asOf: AS_OF }), AS_OF).status, "loading");
});

// ── F6 ─────────────────────────────────────────────────────────────────────────────────────────
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const ok = (f, t, ex = {}) => ({ ok: true, fromDate: f, toDate: t, exceptions: ex });
const tick = () => new Promise((r) => setImmediate(r));
const SEL = { tenantId: "t1", bizId: "b1", gen: 1 }, WIN = { from: "2026-09-01", to: "2026-09-30" };
const closureRec = { source: "structured", status: "active", reasonCode: "closure" };

test("C1R1-F6a ledger key binds tenant, business, generation, window, list revision and attempt; a stored result for another key is never used", () => {
  const listA = {}, listB = {};
  const kA = C.ledgerKey(SEL, WIN, C.revisionOf(listA), 0);
  assert.equal(C.ledgerKey(SEL, WIN, C.revisionOf(listA), 0), kA, "stable for the same list object");
  for (const k of [C.ledgerKey(SEL, WIN, C.revisionOf(listB), 0), C.ledgerKey(SEL, WIN, C.revisionOf(listA), 1), C.ledgerKey({ ...SEL, bizId: "b2" }, WIN, C.revisionOf(listA), 0), C.ledgerKey({ ...SEL, gen: 2 }, WIN, C.revisionOf(listA), 0), C.ledgerKey(SEL, { ...WIN, from: "2025-09-01" }, C.revisionOf(listA), 0)]) assert.notEqual(k, kA);
  assert.equal(C.ledgerKey(null, WIN, 1, 0), null);
  const stored = { state: "present", states: {}, key: kA };
  assert.equal(C.ledgerFor(stored, kA), stored);
  assert.equal(C.ledgerFor(stored, kA + "x").state, "loading");
  assert.equal(C.ledgerFor(stored, null).state, "loading");
});

test("C1R1-F6b a successful result followed by a FAILED refresh is unreadable for the new key (the old success is not reused)", async () => {
  const s = C.createLedgerSession(F);
  const r1 = await s.request("k1", WIN.from, WIN.to, async (f, t) => ok(f, t, { "2026-09-07": closureRec }));
  assert.equal(r1.state, "present"); assert.equal(r1.key, "k1");
  const r2 = await s.request("k2", WIN.from, WIN.to, async () => { throw new Error("500"); });
  assert.equal(r2.state, "unreadable"); assert.equal(r2.key, "k2");
  assert.equal(C.ledgerFor(r1, "k2").state, "loading", "the earlier success is not authoritative for k2");
  assert.equal(C.ledgerFor(r2, "k2").state, "unreadable");
});

test("C1R1-F6c overlapping refreshes resolving OUT OF ORDER: only the latest request resolves; the older resolves stale", async () => {
  const s = C.createLedgerSession(F);
  const a = deferred(), b = deferred();
  const pA = s.request("kA", WIN.from, WIN.to, () => a.p);
  const pB = s.request("kB", WIN.from, WIN.to, () => b.p);
  b.resolve(ok(WIN.from, WIN.to, {}));                                   // newer (reopened) resolves first
  const rB = await pB;
  a.resolve(ok(WIN.from, WIN.to, { "2026-09-07": closureRec }));         // older (closed) resolves later
  const rA = await pA;
  assert.equal(rB.state, "absent"); assert.equal(rB.key, "kB");
  assert.equal(rA.state, "stale");
  assert.equal(s.latest(), "kB");
});

test("C1R1-F6d a business / date-window change while a request is pending: the pending result is stale", async () => {
  const s = C.createLedgerSession(F);
  const a = deferred();
  const pA = s.request(C.ledgerKey(SEL, WIN, 1, 0), WIN.from, WIN.to, () => a.p);
  const newKey = C.ledgerKey({ ...SEL, bizId: "b2" }, WIN, 1, 0);
  const pB = s.request(newKey, WIN.from, WIN.to, async (f, t) => ok(f, t));
  a.resolve(ok(WIN.from, WIN.to, { "2026-09-07": closureRec }));
  assert.equal((await pA).state, "stale");
  const rB = await pB; assert.equal(rB.key, newKey); assert.equal(rB.state, "absent");
  // window change mid-flight (multi-chunk): the old window's chunks stop being applied
  const s2 = C.createLedgerSession(F);
  const g = deferred(); let calls = 0;
  const pOld = s2.request("w1", "2025-09-01", "2026-09-30", (f, t) => { calls++; return calls === 1 ? g.p : Promise.resolve(ok(f, t)); });
  s2.request("w2", "2026-01-01", "2026-09-30", async (f, t) => ok(f, t));
  g.resolve(ok("2025-09-01", C.ledgerChunks(F, "2025-09-01", "2026-09-30")[0].to));
  assert.equal((await pOld).state, "stale");
  await tick();
});

test("C1R1-F6e a failed middle chunk makes the whole window unreadable; a successful retry (new attempt key) recovers", async () => {
  const from = "2025-09-01", to = "2026-10-31";
  const chunks = C.ledgerChunks(F, from, to); assert.ok(chunks.length > 1);
  const s = C.createLedgerSession(F);
  let n = 0;
  const failed = await s.request("a0", from, to, async (f, t) => { if (n++ === 1) throw new Error("500"); return ok(f, t); });
  assert.equal(failed.state, "unreadable");
  const retried = await s.request("a1", from, to, async (f, t) => ok(f, t, f <= "2025-09-07" && "2025-09-07" <= t ? { "2025-09-07": closureRec } : {}));
  assert.equal(retried.state, "present"); assert.equal(retried.key, "a1");
  assert.deepEqual(Object.keys(retried.states), ["2025-09-07"]);
});

test("C1R1-F6f response metadata and record shape are cross-checked: wrong fromDate/toDate, out-of-chunk or malformed records ⇒ unreadable", async () => {
  const io = (body) => ({ fetchChunk: async () => body });
  const L = (body) => C.loadLedger(F, io(body), WIN.from, WIN.to);
  assert.equal((await L(ok(WIN.from, WIN.to, { "2026-09-07": closureRec }))).state, "present");
  assert.equal((await L({ ok: true, exceptions: {} })).reason, "ledger_range_mismatch", "no metadata");
  assert.equal((await L(ok("2026-08-01", WIN.to))).reason, "ledger_range_mismatch");
  assert.equal((await L(ok(WIN.from, WIN.to, { "2026-10-07": closureRec }))).reason, "ledger_record_shape", "record outside the chunk");
  assert.equal((await L(ok(WIN.from, WIN.to, { "2026-09-07": "closed" }))).reason, "ledger_record_shape");
  assert.equal((await L(ok(WIN.from, WIN.to, { "2026-09-07": { status: "active" } }))).reason, "ledger_record_shape");
  assert.equal((await L(ok(WIN.from, WIN.to, { "not-a-date": closureRec }))).reason, "ledger_record_shape");
  assert.equal((await L({ ok: true, fromDate: WIN.from, toDate: WIN.to, exceptions: [] })).state, "unreadable");
  // tenant / business echoed by the API must be the requested scope
  const scoped = (body) => C.loadLedger(F, { fetchChunk: async () => body, scope: { tenantId: "t1", bizId: "b1" } }, WIN.from, WIN.to);
  assert.equal((await scoped({ ...ok(WIN.from, WIN.to), tenantId: "t1", bizId: "b1" })).state, "absent");
  assert.equal((await scoped({ ...ok(WIN.from, WIN.to), tenantId: "t1", bizId: "b2" })).reason, "ledger_scope_mismatch");
  assert.equal((await scoped(ok(WIN.from, WIN.to))).reason, "ledger_scope_mismatch", "no echoed scope");
  const s = C.createLedgerSession(F);
  assert.equal((await s.request("k", WIN.from, WIN.to, async (f, t) => ({ ...ok(f, t), tenantId: "t9", bizId: "b1" }), null, { tenantId: "t1", bizId: "b1" })).reason, "ledger_scope_mismatch");
});
