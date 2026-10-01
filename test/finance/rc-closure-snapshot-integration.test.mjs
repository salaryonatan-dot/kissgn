// Marjin 1.0 RC — cross-lineage integration: the CD-M2 R1 closure-entry workflow (production
// seam vm-extracted from index.html, real lane + remote-atomic mutator, real server ledger
// transaction body) WRITES the storage; the B2 morning snapshot + e-mail (compiled server
// builder/e-mail over the approved CD-M1 core) READS the same storage. A clean textual merge is not
// proof of compatibility: these cases prove the two approved lineages agree on every closed-day
// state the operator can reach — closed, partial (contradiction), reopened, future, concurrent
// unrelated edit, and a missing (never inferred closed) day.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { html, makeRemote, makeClient, drainLiveRigs, mkId, plain } from "../support/cross-writer-harness.mjs";
import { applyOperation, buildEffectiveRecord, requestHash, safeStateView, validateSetInput } from "../../lib/entryExceptions.js";
import { mail, snapOf } from "../support/b2-email-harness.mjs";
import { completeSeptember } from "../support/financial-invariants.mjs";

afterEach(drainLiveRigs);

function loadSeams() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  const f = html.indexOf("window.MarjinStoragePolicy = Object.freeze({", start);
  assert.ok(start !== -1 && f !== -1);
  const sandbox = { window: { crypto: globalThis.crypto }, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
const W = loadSeams();
const MC = W.MarjinClosureLifecycle, ML = W.MarjinSaveLifecycle, MS = W.MarjinStorageV2;
const run = async (p) => plain(await p);

// the structured-exception API over the REAL server transaction body (+ the list read)
function exceptionServer() {
  const ledger = {};
  const api = async (url, opts) => {
    if (/list-entry-exceptions/.test(url)) {
      const q = new URL("http://x" + url).searchParams, out = {};
      for (const [d, e] of Object.entries(ledger)) if (d >= q.get("fromDate") && d <= q.get("toDate")) { const r = buildEffectiveRecord(d, e, null); if (r.source !== "none") out[d] = r; }
      return { ok: true, status: 200, json: async () => ({ ok: true, exceptions: plain(out) }) };
    }
    const action = /set-entry-exception/.test(url) ? "set" : "clear";
    const body = JSON.parse(opts.body);
    const n = action === "set" ? validateSetInput({ reasonCode: body.reasonCode }) : { reasonCode: null, reasonText: null };
    const cmd = { action, tenantId: body.tenantId, bizId: body.bizId, businessDate: body.businessDate, reasonCode: n.reasonCode, reasonText: n.reasonText,
      actorUid: "u-owner", actorRole: "owner", expectedRevision: body.expectedRevision, operationId: body.operationId, now: 1790000000000 };
    cmd.requestHash = requestHash(cmd);
    const out = applyOperation(ledger[cmd.businessDate] || null, cmd);
    if (out.outcome === "conflict") return { ok: false, status: 409, json: async () => ({ ok: false, error: out.code }) };
    if (out.outcome === "applied") ledger[cmd.businessDate] = out.envelope;
    return { ok: true, status: 200, json: async () => ({ ok: true, exception: safeStateView(out.state), revision: out.revision, applied: out.outcome === "applied", rebuildRequired: out.outcome === "applied" }) };
  };
  return { api, ledger };
}

const TODAY = "2026-09-29";            // the B2 harness as-of (INV_NOW_MS): Actual 09-01…09-28
const D = "2026-09-10";
function rig(rows) {
  const remote = makeRemote(rows);
  const client = makeClient(remote, "A").attach().pull();
  const srv = exceptionServer();
  const own = ML.createExceptionOwnership();
  let n = 0;
  const io = (date, extra = {}) => ({
    selection: client.ctrl, date, rows: client.lane._state().desired || [], today: TODAY, role: "owner", confirmedFingerprint: null,
    exceptionState: { get: (d) => own.getState(d), set: (d, s) => own.setState(d, s), applyActive: () => {} },
    opIds: { ensure: (d, mk) => own.ensureOpId(d, mk), consume: (d) => own.consumeOpId(d) },
    newOpId: () => "op-" + (++n), newRowId: () => mkId("rc-new-" + (++n)), emptyEntry: {},
    apiFetch: srv.api,
    persistMutation: async (i) => { const r = await client.submit(i); return { ok: r.status === "committed" || r.status === "committed_idempotent", canonical: r.rows, status: r.status }; },
    verifyTransact: (t, k, fn) => remote.transact(t, k, fn), readNode: (raw) => MS.readEntriesNode(raw),
    applyRows: () => {}, reloadExceptions: async () => {}, rebuildInsights: async () => {}, setError: () => {},
    ...extra,
  });
  // hand the SAME stored state to the B2 reader (its harness tenant/business)
  const storage = () => ({ rows: plain(remote.rows()), exceptions: Object.keys(srv.ledger).length ? plain(srv.ledger) : undefined });
  return { remote, client, srv, io, storage };
}
const closeConfirmed = async (h, date) => {
  const ask = await run(MC.executeClosureAction(h.io(date)));
  return ask.status === "confirmation_required" ? run(MC.executeClosureAction(h.io(date, { confirmedFingerprint: ask.plan.fingerprint }))) : ask;
};

test("RC-01 CD-M2 closes a completed day with recorded revenue ⇒ B2 reads a valid closed day: known 0 (not missing), closure line, monthly costs on eligible days, no contradiction", async () => {
  const h = rig(completeSeptember());
  const res = await closeConfirmed(h, D);
  assert.equal(res.status, "closed", JSON.stringify(res));
  const { snapshot, text } = await mail(h.storage());
  const f = snapshot.financials;
  assert.deepEqual([f.coverage.closedDays, f.coverage.closedWithRevenue, f.coverage.revenue.missing], [[D], [], []]);
  assert.deepEqual([f.amounts.revenue.exact, f.amounts.revenue.state], ["27000", "complete"], "the closed day contributes a known 0");
  assert.deepEqual(f.costAllocation.completedClosureDates, [D]); assert.equal(f.costAllocation.allocationEligibleDays, 27);
  assert.match(text, /יום סגור \(הכנסה 0, לא חסר\): 10\.09/);
  assert.doesNotMatch(text, /סומנו כסגורים אך נרשמו בהם הכנסות/);
  const row = h.remote.rows().find((r) => r.date === D);
  assert.deepEqual([row.sales, row.payroll, row.supplier_payments], [0, "100", { s1: "300" }], "costs on the closed day are preserved");
});

test("RC-02 the reviewed race (revenue written after the closure persisted): CD-M2 reports partial AND B2 shows the dated contradiction — neither lineage claims success", async () => {
  const h = rig(completeSeptember().map((r) => (r.date === D ? { ...r, sales: "0" } : r)));
  const res = await run(MC.executeClosureAction(h.io(D, { apiFetch: async (u, o) => { const r = await h.srv.api(u, o); if (/set-entry/.test(u)) { const rows = h.remote.rows(); rows.find((x) => x.date === D).sales = "50"; h.remote.setRowsDirect(rows); } return r; } })));
  assert.deepEqual([res.status, res.reason], ["partial", "revenue_changed_concurrently"]);
  const { snapshot, text } = await mail(h.storage());
  assert.deepEqual(snapshot.financials.coverage.closedWithRevenue, [D]);
  assert.notEqual(snapshot.financials.amounts.revenue.state, "complete");
  assert.equal(snapshot.netProfit, null);
  assert.match(text, /⚠ סומנו כסגורים אך נרשמו בהם הכנסות: 10\.09/);
});

test("RC-03 reopen (CD-AT14) ⇒ B2 reads an ordinary operating zero: present, not closed, not missing, costs back on the day", async () => {
  const h = rig(completeSeptember());
  assert.equal((await closeConfirmed(h, D)).status, "closed");
  assert.equal((await run(MC.executeClosureReopen(h.io(D)))).status, "reopened");
  const s = await snapOf(h.storage());
  const f = s.financials;
  assert.deepEqual([f.coverage.closedDays, f.coverage.revenue.missing, f.costAllocation.completedClosureDates], [[], [], []]);
  assert.deepEqual([f.amounts.revenue.exact, f.amounts.revenue.state], ["27000", "complete"], "revenue stays the explicit 0 — never restored");
  assert.equal(f.costAllocation.allocationEligibleDays, 28);
});

test("RC-04 a FUTURE closure recorded by CD-M2 (no row) ⇒ B2: forecast loses that day at once; Actual, the cost denominator and calendar progress unchanged", async () => {
  const before = await snapOf({ rows: completeSeptember() });
  const h = rig(completeSeptember());
  const res = await closeConfirmed(h, "2026-09-30");
  assert.deepEqual([res.status, res.timing, res.rowCreated], ["closed", "future", false]);
  assert.equal(h.remote.rows().filter((r) => r.date === "2026-09-30").length, 0);
  const after = await snapOf(h.storage());
  assert.deepEqual(after.financials.projection.futureClosureDates, ["2026-09-30"]);
  assert.equal(JSON.stringify(after.financials.amounts), JSON.stringify(before.financials.amounts), "Actual identical");
  assert.equal(JSON.stringify(after.financials.costAllocation), JSON.stringify(before.financials.costAllocation), "denominator identical until completion");
  assert.equal(JSON.stringify(after.financials.window), JSON.stringify(before.financials.window));
  assert.ok(after.paceRevenue < before.paceRevenue, "projected revenue fell immediately");
});

test("RC-05 an unrelated concurrent supplier edit during the closure survives in storage AND in B2's purchases", async () => {
  const h = rig(completeSeptember());
  const ask = await run(MC.executeClosureAction(h.io(D)));
  h.remote.interleave(() => { const rows = h.remote.rows(); rows.find((x) => x.date === D).supplier_payments = { s1: "300", s9: "45" }; h.remote.setRowsDirect(rows); });
  const res = await run(MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint })));
  assert.equal(res.status, "closed");
  const s = await snapOf(h.storage());
  assert.equal(s.financials.amounts.purchases.exact, String(28 * 300 + 45));
});

test("RC-06 a missing revenue day is never inferred closed by either lineage: CD-M2 plans a closure only on request; B2 shows the dated missing warning", async () => {
  const rows = completeSeptember().map((r) => (r.date === D ? { ...r, sales: undefined, deliveries: undefined, other_income: undefined } : r));
  const { snapshot, text } = await mail({ rows });
  assert.deepEqual([snapshot.financials.coverage.closedDays, snapshot.financials.coverage.revenue.missing], [[], [D]]);
  assert.match(text, /חסרות הכנסות בימים: 10\.09/);
  const p = plain(MC.planClosure(rows.map((r) => ({ ...r })), D, { today: TODAY }));
  assert.equal(p.status, "ok"); assert.equal(p.needsConfirmation, false, "an absent revenue cell needs no confirmation; a closure is only ever the operator's explicit action");
});
