// CD-M2 — explicit "Business closed" entry workflow (closed-days amendment CD-01/CD-17,
// CDA-01/CDA-17; acceptance CD-AT12/13/14 plus partial-save repair, retry, reopening and
// future-date handling).
//
// Everything under test is PRODUCTION code vm-extracted from index.html:
//   • window.MarjinClosureLifecycle (planClosure / executeClosureAction / executeClosureReopen),
//   • the real destination lane + remote-atomic mutator (createEntriesWriteCoordinator /
//     createRemoteEntriesMutator) over the Gate-3 destination-partitioned remote,
//   • the real V2 row transformation (MarjinStorageV2.applyRowIntent),
//   • the real UI call sites `closureIo` / `closeBusinessDay` / `reopenBusinessDay`,
//     extracted by brace matching and run against the real seams.
// The structured-exception API is simulated with the REAL server transaction body
// (lib/entryExceptions.js applyOperation + requestHash + safeStateView, api/admin.js
// status mapping), so revision conflicts, operationId replay and ledger limits are the
// server's own semantics. The resulting rows + ledger are then read by the APPROVED CD-M1
// shared core (fresh browser bundle and committed fincore/v1) to prove the financial meaning.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { html, makeRemote, makeClient, drainLiveRigs, settleAll, tick, mkId, plain } from "../support/cross-writer-harness.mjs";
import { applyOperation, requestHash, safeStateView, validateSetInput } from "../../lib/entryExceptions.js";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";

afterEach(drainLiveRigs);

// ── production seams (one sandbox: lifecycle + closure + storage-v2 blocks) ──────────────
function loadSeams() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  const f = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  assert.ok(start !== -1 && f !== -1, "index.html anchors present");
  const src = html.slice(start, html.indexOf("});", f) + 3);
  assert.ok(src.includes("window.MarjinClosureLifecycle = Object.freeze({"), "the closure block sits inside the lifecycle region");
  assert.ok(!/new Date\(/.test(src), "no Date parsing in the lifecycle/closure blocks");
  const sandbox = { window: { crypto: globalThis.crypto }, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = loadSeams();
const MCraw = W.MarjinClosureLifecycle;
// sandbox (cross-realm) values are normalised to this realm before any deepEqual
const MC = { ...MCraw, planClosure: (...a) => plain(MCraw.planClosure(...a)), closureZeroIntents: (...a) => plain(MCraw.closureZeroIntents(...a)),
  executeClosureAction: async (io) => plain(await MCraw.executeClosureAction(io)), executeClosureReopen: async (io) => plain(await MCraw.executeClosureReopen(io)) };
const ML = W.MarjinSaveLifecycle;
const MS = W.MarjinStorageV2;
const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();

// ── the structured-exception API, backed by the REAL server transaction body ───────────
function makeExceptionServer({ role = "owner", uid = "u-owner" } = {}) {
  const ledger = {};            // tenant → biz → date → envelope
  const calls = [];
  const envOf = (t, b, d) => (((ledger[t] || {})[b] || {})[d]) || null;
  const put = (t, b, d, e) => { ledger[t] = ledger[t] || {}; ledger[t][b] = ledger[t][b] || {}; ledger[t][b][d] = e; };
  let failAfterApply = 0;       // simulate a lost response AFTER the server applied the op
  let gate = null;              // hold the next response open
  const handle = (action, body) => {
    let normalized = { reasonCode: null, reasonText: null };
    if (action === "set") { try { normalized = validateSetInput({ reasonCode: body.reasonCode, reasonText: body.reasonText }); } catch (e) { return { status: 400, json: { error: e.code } }; } }
    const cmd = { action, tenantId: body.tenantId, bizId: body.bizId, businessDate: body.businessDate, reasonCode: normalized.reasonCode, reasonText: normalized.reasonText,
      actorUid: uid, actorRole: role, expectedRevision: body.expectedRevision, operationId: body.operationId, now: 1790000000000 };
    cmd.requestHash = requestHash(cmd);
    const out = applyOperation(envOf(cmd.tenantId, cmd.bizId, cmd.businessDate), cmd);
    if (out.outcome === "conflict") {
      const map = { revision_conflict: 409, idempotency_conflict: 409, operation_owner_required: 409, operation_hard_limit_reached: 409 };
      return { status: map[out.code] || 409, json: { ok: false, error: out.code } };
    }
    if (out.outcome === "applied") put(cmd.tenantId, cmd.bizId, cmd.businessDate, out.envelope);
    const applied = out.outcome === "applied";
    return { status: 200, json: { ok: true, exception: safeStateView(out.state), revision: out.revision, applied, replayed: out.outcome === "replayed", rebuildRequired: applied } };
  };
  const apiFetch = async (url, opts) => {
    const action = /set-entry-exception/.test(url) ? "set" : /clear-entry-exception/.test(url) ? "clear" : null;
    const body = JSON.parse(opts.body);
    calls.push({ url, action, body });
    if (gate) { const g = gate; gate = null; await g.promise; }
    const r = handle(action, body);
    if (failAfterApply > 0) { failAfterApply--; throw new Error("network_lost_after_apply"); }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return {
    apiFetch, calls, ledger,
    ledgerOf: (t = "T1", b = "A") => plain((ledger[t] || {})[b] || {}),
    seedEnvelope: (t, b, d, e) => put(t, b, d, e),
    loseNextResponseAfterApply: () => { failAfterApply = 1; },
    holdNext: () => { let release; const promise = new Promise((r) => { release = r; }); gate = { promise }; return { release }; },
    effective: (t, b, d) => { const e = envOf(t, b, d); return e && e.state ? { source: "structured", status: e.state.status, revision: e.state.revision, reasonCode: e.state.status === "active" ? e.state.reasonCode : "", reasonText: "" } : undefined; },
  };
}

// ── one live client (real lane + mutator over the shared remote) + the closure io ───────
const TODAY = "2026-09-15";
function rig(seedRows, opts = {}) {
  const remote = makeRemote(seedRows);
  const client = makeClient(remote, "A").attach().pull();
  const server = opts.server || makeExceptionServer();
  const own = ML.createExceptionOwnership();
  if (opts.loaded) for (const [d, st] of Object.entries(opts.loaded)) own.setState(d, st);
  const spy = { errors: [], applied: [], active: [], reloads: 0, rebuilds: [], insightFailures: [], persists: [] };
  let idSeq = 0;
  const io = (date, extra = {}) => ({
    selection: client.ctrl, date, rows: client.lane._state().desired || [], today: TODAY, role: "owner", confirmedFingerprint: null,
    exceptionState: { get: (d) => own.getState(d), set: (d, st) => own.setState(d, st), applyActive: (d, a) => spy.active.push([d, a]) },
    opIds: { ensure: (d, mk) => own.ensureOpId(d, mk), consume: (d) => own.consumeOpId(d) },
    newOpId: () => "op-" + (++idSeq), newRowId: () => mkId("cd-m2-new-" + (++idSeq)),
    emptyEntry: { date: "", sales: "", deliveries: "", food_cost: "", payroll: "", hourly_payroll: "", other_expense: "", other_income: "", supplier_payments: {}, notes: "", is_exception: false, exception_reason: "", exception_note: "" },
    apiFetch: server.apiFetch,
    persistMutation: async (intent) => { spy.persists.push(plain(intent)); const r = await client.submit(intent); return { ok: r.status === "committed" || r.status === "committed_idempotent", canonical: r.rows, status: r.status, reason: r.reason, detail: r.detail }; },
    applyRows: (rows) => spy.applied.push(plain(rows)),
    reloadExceptions: async () => { spy.reloads++; },
    rebuildInsights: async (d, c) => { spy.rebuilds.push([d, c.tenantId, c.bizId]); },
    onInsightsFailure: (m) => spy.insightFailures.push(m),
    setError: (m) => spy.errors.push(m),
    ...extra,
  });
  return { remote, client, server, own, spy, io };
}
const remoteRows = (r) => plain(r.remote.rows());
const onDate = (rows, d) => rows.filter((x) => x.date === d);

// ── the CD-M1 meaning of the resulting rows + ledger (fresh browser bundle ≡ committed fincore) ──
function coreView(rows, ledgerNode, asOf, month = "2026-09") {
  const out = [];
  for (const P of [BROWSER.product, COMMITTED.product]) {
    const decoded = P.decodeExceptionLedger(ledgerNode && Object.keys(ledgerNode).length ? ledgerNode : null);
    const inp = { rows, config: { state: "present", value: {} }, fixed: { state: "absent" }, asOfBusinessDate: asOf, exceptionStates: decoded.state === "present" ? decoded.value : {}, exceptionLedgerState: decoded.state };
    const rep = P.productMonthReport(inp, { kind: "open_month", month });
    out.push(JSON.parse(BROWSER.metrics.report.serializeReport({ calendar: P.productClosureCalendar(inp), revenue: rep.actual.revenue, coverage: rep.coverage.revenue, flags: rep.flags.filter((f) => f.code === "closed_day_has_recorded_values") })));
  }
  assert.deepEqual(out[0], out[1], "fresh browser bundle ≡ committed fincore/v1");
  return out[0];
}

const D = "2026-09-10";                     // a completed date (TODAY = 2026-09-15)
const R1 = mkId("cd-m2-r1"), R2 = mkId("cd-m2-r2"), R0 = mkId("cd-m2-r0");
const TWO_ROWS = () => [
  { id: R1, date: D, sales: 300, deliveries: 0, other_income: 0, supplier_payments: { s1: "40" }, payroll: "100", notes: "keep", unknown_field: { x: 1 } },
  { id: R2, date: D, sales: "200", deliveries: "", other_income: "", twin: "yes" },
  { id: R0, date: "2026-09-09", sales: 999, deliveries: 0, other_income: 0 },
];

// ════════════════════════════════════════════════════════════════════════════
test("CDM2-01 planClosure is pure: exact per-row plan, display total, unreadable cells, timing, identity refusal, stable fingerprint", () => {
  const p = MC.planClosure(TWO_ROWS(), D, { today: TODAY });
  assert.equal(p.status, "ok"); assert.equal(p.timing, "completed");
  assert.deepEqual(p.rows.map((r) => [r.id, r.toZero]), [[R1, ["sales"]], [R2, ["sales"]]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  assert.equal(p.needsConfirmation, true); assert.equal(p.displayTotal, 500); assert.equal(p.unreadableCells, 0);
  assert.equal(p.createZeroRow, false); assert.deepEqual(p.explicitZeroOn, []);
  assert.equal(MC.planClosure(TWO_ROWS(), D, { today: TODAY }).fingerprint, p.fingerprint, "deterministic");
  const changed = TWO_ROWS(); changed[1].sales = "201";
  assert.notEqual(MC.planClosure(changed, D, { today: TODAY }).fingerprint, p.fingerprint, "a revenue change changes the confirmed plan");
  const bad = MC.planClosure([{ id: R1, date: D, sales: "12abc" }], D, { today: TODAY });
  assert.deepEqual([bad.needsConfirmation, bad.unreadableCells, bad.displayTotal, bad.rows[0].toZero], [true, 1, 0, ["sales"]], "an unreadable cell is zeroed only under confirmation and never summed");
  assert.deepEqual([MC.planClosure([], "2026-09-15", { today: TODAY }).timing, MC.planClosure([], "2026-09-20", { today: TODAY }).timing], ["current", "future"]);
  assert.equal(MC.planClosure([{ date: D, sales: 5 }], D, { today: TODAY }).status, "blocked_entry_identity_required", "an id-less row is never guessed");
  assert.equal(MC.planClosure(TWO_ROWS(), "", { today: TODAY }).status, "invalid_date");
  assert.equal(MC.planClosure(TWO_ROWS(), D, {}).status, "clock_required");
  const zeroOnly = MC.planClosure([{ id: R1, date: D, sales: "0", deliveries: 0 }], D, { today: TODAY });
  assert.deepEqual([zeroOnly.needsConfirmation, zeroOnly.explicitZeroOn, zeroOnly.rows[0].toZero], [false, [], []], "an operating zero needs no confirmation and no write");
  const purchasesOnly = MC.planClosure([{ id: R1, date: D, supplier_payments: { s1: "5" } }], D, { today: TODAY });
  assert.deepEqual([purchasesOnly.needsConfirmation, purchasesOnly.explicitZeroOn], [false, [R1]], "no revenue cell anywhere ⇒ the date must still RECORD a zero");
});

test("CDM2-02 CD-AT12 aggregate non-zero revenue across two rows: the executor asks for confirmation with the exact amount and rows; cancel (no confirmation) writes NOTHING", async () => {
  const h = rig(TWO_ROWS());
  const before = remoteRows(h);
  const res = await MC.executeClosureAction(h.io(D));
  assert.equal(res.status, "confirmation_required");
  assert.equal(res.plan.displayTotal, 500); assert.deepEqual(res.plan.rows.map((r) => r.id).sort(), [R1, R2].sort());
  await settleAll();
  assert.deepEqual(h.server.calls, [], "no exception API call");
  assert.deepEqual(h.spy.persists, [], "no entries intent");
  assert.deepEqual(h.remote.log(), [], "no remote transaction at all");
  assert.deepEqual(remoteRows(h), before, "stored rows byte-identical");
  assert.deepEqual(h.server.ledgerOf(), {}, "no ledger state");
  assert.deepEqual(h.spy.errors, []);
});

test("CDM2-03 CD-AT13 confirmed: closure set on the captured tenant/business/date, revenue explicit 0 on every row; ids, unknown fields and costs preserved; CD-M1 reads a valid closed day", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(res.status, "closed", JSON.stringify(res));
  assert.equal(h.server.calls.length, 1);
  assert.deepEqual({ ...h.server.calls[0].body, operationId: "x" }, { tenantId: "T1", bizId: "A", businessDate: D, reasonCode: "closure", expectedRevision: 0, operationId: "x" });
  assert.equal(h.server.ledgerOf()[D].state.status, "active"); assert.equal(h.server.ledgerOf()[D].state.reasonCode, "closure");
  const rows = remoteRows(h);
  const r1 = rows.find((r) => r.id === R1), r2 = rows.find((r) => r.id === R2);
  assert.deepEqual(r1, { ...TWO_ROWS()[0], sales: 0 }, "only the revenue cell changed; suppliers, payroll, notes, unknown fields intact");
  assert.deepEqual(r2, { ...TWO_ROWS()[1], sales: 0 }, "second row zeroed, its unknown field intact");
  assert.deepEqual(rows.find((r) => r.id === R0), TWO_ROWS()[2], "another date untouched");
  assert.deepEqual(h.spy.persists.map((i) => [i.type, i.target.id, i.patch.fields, i.base.fields]).sort(),
    [["upsert_entry", R1, { sales: 0 }, { sales: 300 }], ["upsert_entry", R2, { sales: 0 }, { sales: "200" }]].sort(), "narrow patches with the confirmed values as base");
  assert.deepEqual(h.spy.rebuilds, [[D, "T1", "A"]], "one insights rebuild for the captured selection");
  assert.equal(h.own._state().ops[D], undefined, "the operationId is consumed");
  const core = coreView(rows, h.server.ledgerOf(), TODAY);
  assert.deepEqual(core.calendar.closedDates, [D]);
  assert.deepEqual([core.coverage.closedDays, core.coverage.invalidDays, core.coverage.missingDays.includes(D), core.flags], [[D], [], false, []], "a valid closed day — no contradiction");
});

test("CDM2-04 CD-AT13 a concurrent UNRELATED change on the same row lands mid-transaction and survives; revenue still becomes 0", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  h.remote.interleave(() => { const rows = h.remote.rows(); rows.find((r) => r.id === R1).supplier_payments = { s1: "40", s2: "77" }; h.remote.setRowsDirect(rows); });
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(res.status, "closed");
  const r1 = remoteRows(h).find((r) => r.id === R1);
  assert.deepEqual([r1.sales, r1.supplier_payments], [0, { s1: "40", s2: "77" }], "the other writer's supplier change is not overwritten");
  assert.ok(h.remote.log().some((l) => l.runs > 1), "the transaction really re-ran against the fresher value");
});

test("CDM2-05 CD-AT13 a concurrent REVENUE change is a conflict: nothing overwritten, typed partial (visibly invalid in CD-M1); the repair re-confirms and converges without a second closure call", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  h.remote.interleave(() => { const rows = h.remote.rows(); const x = rows.find((r) => r.id === R1) || rows.find((r) => r.id === R2); x.sales = 777; h.remote.setRowsDirect(rows); });
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(res.status, "partial"); assert.equal(res.stage, "revenue"); assert.equal(res.outcome, "conflict");
  assert.match(h.spy.errors.at(-1), /סומן כסגור, אך איפוס ההכנסות לא הושלם/);
  const mid = remoteRows(h);
  assert.ok(onDate(mid, D).some((r) => r.sales === 777), "the concurrent revenue is never overwritten");
  assert.equal(h.server.ledgerOf()[D].state.status, "active", "the closure is recorded");
  const core = coreView(mid, h.server.ledgerOf(), TODAY);
  assert.deepEqual([core.revenue.complete, core.coverage.invalidDays, core.coverage.closedDays, core.flags.length > 0], [false, [D], [], true], "partial state = CDA-02 contradiction, never a complete fact");
  // repair: the plan changed ⇒ a NEW confirmation is required; the closure step is skipped
  await settleAll(); h.client.pull();
  const again = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(again.status, "confirmation_required", "an outdated confirmation never zeroes the new amount");
  const done = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: again.plan.fingerprint }));
  assert.equal(done.status, "closed"); assert.equal(done.closureApplied, false);
  assert.equal(h.server.calls.length, 1, "no second closure operation");
  const core2 = coreView(remoteRows(h), h.server.ledgerOf(), TODAY);
  assert.deepEqual([core2.coverage.invalidDays, core2.coverage.closedDays, core2.flags], [[], [D], []]);
});

test("CDM2-06 the confirmation is bound to the plan: a revenue change after the dialog was shown ⇒ nothing written, new confirmation", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  const rows = h.remote.rows(); rows.find((r) => r.id === R2).sales = "250"; h.remote.setRowsDirect(rows); h.client.pull();
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(res.status, "confirmation_required"); assert.equal(res.plan.displayTotal, 550);
  assert.deepEqual([h.server.calls.length, h.spy.persists.length], [0, 0]);
});

test("CDM2-07 liveness: a selection change while the closure call is in flight ⇒ stale, no entries write; while a zeroing write is in flight ⇒ stale, no success", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  const g = h.server.holdNext();
  const p = MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  await tick(); h.client.ctrl.invalidate("T2", "A"); g.release();
  assert.equal((await p).status, "stale");
  assert.deepEqual(h.spy.persists, [], "no entries write after the selection changed");
  const k = rig(TWO_ROWS());
  const ask2 = await MC.executeClosureAction(k.io(D));
  const gate = k.remote.holdNext("zeroing");
  const q = MC.executeClosureAction(k.io(D, { confirmedFingerprint: ask2.plan.fingerprint }));
  for (let i = 0; i < 6; i++) await tick();
  k.client.ctrl.invalidate("T1", "B"); gate.release();
  const r = await q;
  assert.equal(r.status, "stale"); assert.deepEqual(k.spy.rebuilds, []);
});

test("CDM2-08 exception API refusal (revision conflict) ⇒ no revenue write, error shown, exceptions reloaded", async () => {
  const h = rig(TWO_ROWS(), { loaded: {} });
  h.server.seedEnvelope("T1", "A", D, { state: { status: "active", reasonCode: "holiday", revision: 3 }, operations: {} });
  const ask = await MC.executeClosureAction(h.io(D));
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(res.status, "error"); assert.equal(res.httpStatus, 409);
  assert.deepEqual(h.spy.persists, []); assert.equal(h.spy.reloads, 1);
  assert.match(h.spy.errors.at(-1), /עודכן במקביל/);
  assert.ok(onDate(remoteRows(h), D).every((r) => Number(r.sales) > 0), "revenue untouched");
});

test("CDM2-09 a lost response after the server applied the closure: retry REPLAYS the same operationId (no duplicate op) and completes", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  h.server.loseNextResponseAfterApply();
  const first = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(first.status, "error"); assert.deepEqual(h.spy.persists, [], "no revenue write without a confirmed closure");
  const opId = h.own._state().ops[D]; assert.ok(opId, "operationId kept for the replay");
  const second = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(second.status, "closed");
  assert.deepEqual(h.server.calls.map((c) => c.body.operationId), [opId, opId], "same operationId ⇒ server replay");
  assert.equal(Object.keys(h.server.ledgerOf()[D].operations).length, 1, "exactly one ledger operation");
});

test("CDM2-10 a blocked lane (unhydrated / degraded) ⇒ typed partial with the precise reason; nothing reported as success", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint,
    persistMutation: async () => ({ ok: false, status: "blocked_listener_degraded" }) }));
  assert.deepEqual([res.status, res.stage, res.outcome], ["partial", "revenue", "blocked_listener_degraded"]);
  assert.deepEqual(h.spy.rebuilds, []);
  assert.match(h.spy.errors.at(-1), /עד להשלמה היום מוצג כלא תקין/);
});

test("CDM2-11 roles: only super_owner / owner / manager may close or reopen; others write nothing", async () => {
  for (const role of ["viewer", "shift_manager", undefined, "admin"]) {
    const h = rig(TWO_ROWS());
    assert.equal((await MC.executeClosureAction(h.io(D, { role, confirmedFingerprint: "x" }))).status, "forbidden");
    assert.equal((await MC.executeClosureReopen(h.io(D, { role }))).status, "forbidden");
    assert.deepEqual([h.server.calls.length, h.spy.persists.length], [0, 0]);
  }
});

test("CDM2-12 future date: the closure is recorded in the ledger only (no future row); CD-M1 forecasts 0 for it at once while Actual and the cost denominator are unchanged", async () => {
  const F = "2026-09-20";
  const h = rig([{ id: R0, date: "2026-09-09", sales: 999, deliveries: 0, other_income: 0 }]);
  const res = await MC.executeClosureAction(h.io(F));
  assert.deepEqual([res.status, res.timing, res.revenueIntents, res.rowCreated], ["closed", "future", 0, false]);
  assert.deepEqual(h.spy.persists, [], "no entries write for a scheduled closure");
  assert.equal(onDate(remoteRows(h), F).length, 0);
  const core = coreView(remoteRows(h), h.server.ledgerOf(), TODAY);
  assert.deepEqual(core.calendar.closedDates, [F]);
  // revenue recorded on a future date is zeroed under the same confirmation
  const k = rig([{ id: R1, date: F, sales: 50 }]);
  const ask = await MC.executeClosureAction(k.io(F));
  assert.equal(ask.status, "confirmation_required");
  const ok = await MC.executeClosureAction(k.io(F, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.equal(ok.status, "closed"); assert.equal(onDate(remoteRows(k), F)[0].sales, 0);
});

test("CDM2-13 completed date with no row: one pre-identified zero row is created (explicit zero, no exception fields); CD-M1 sees a recorded closed zero", async () => {
  const h = rig([{ id: R0, date: "2026-09-09", sales: 999, deliveries: 0, other_income: 0 }]);
  const res = await MC.executeClosureAction(h.io(D));
  assert.deepEqual([res.status, res.rowCreated, res.revenueIntents], ["closed", true, 1]);
  const [row] = onDate(remoteRows(h), D);
  assert.deepEqual([row.sales, row.deliveries, row.other_income], [0, 0, 0]);
  for (const k of ["is_exception", "exception_reason", "exception_note"]) assert.equal(k in row, false, k + " never written into the entries blob");
  assert.equal(h.spy.persists[0].createIfMissing, true); assert.equal(h.spy.persists[0].target.id, row.id);
  const core = coreView(remoteRows(h), h.server.ledgerOf(), TODAY);
  assert.deepEqual([core.coverage.closedDays, core.coverage.invalidDays, core.coverage.missingDays.includes(D)], [[D], [], false]);
});

test("CDM2-14 a purchases-only row on the date keeps its purchases and records sales 0 (explicit zero)", async () => {
  const h = rig([{ id: R1, date: D, supplier_payments: { s1: "80" }, payroll: "10" }]);
  const res = await MC.executeClosureAction(h.io(D));
  assert.equal(res.status, "closed");
  assert.deepEqual(onDate(remoteRows(h), D)[0], { id: R1, date: D, supplier_payments: { s1: "80" }, payroll: "10", sales: 0 });
});

test("CDM2-15 revenue added concurrently on ANOTHER row is detected after commit: typed partial, never 'closed'", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  h.remote.interleave(() => { const rows = h.remote.rows(); rows.push({ id: mkId("late"), date: D, sales: 500 }); h.remote.setRowsDirect(rows); });
  const res = await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  assert.deepEqual([res.status, res.stage], ["partial", "verify"]);
  assert.match(h.spy.errors.at(-1), /נמצאו הכנסות שנרשמו במקביל/);
  assert.deepEqual(h.spy.rebuilds, []);
});

test("CDM2-16 CD-AT14 reopen clears the closure only: revenue stays the explicit 0 (never restored); CD-M1 then reads an ordinary operating zero", async () => {
  const h = rig(TWO_ROWS());
  const ask = await MC.executeClosureAction(h.io(D));
  await MC.executeClosureAction(h.io(D, { confirmedFingerprint: ask.plan.fingerprint }));
  const persistsBefore = h.spy.persists.length;
  const res = await MC.executeClosureReopen(h.io(D));
  assert.equal(res.status, "reopened");
  assert.equal(h.server.calls.at(-1).action, "clear"); assert.equal(h.server.calls.at(-1).body.expectedRevision, 1);
  assert.equal(h.spy.persists.length, persistsBefore, "no entries write on reopen");
  assert.ok(onDate(remoteRows(h), D).every((r) => r.sales === 0), "revenue not resurrected");
  assert.equal(h.server.ledgerOf()[D].state.status, "cleared");
  const core = coreView(remoteRows(h), h.server.ledgerOf(), TODAY);
  assert.deepEqual([core.calendar.closedDates, core.coverage.closedDays, core.coverage.invalidDays, core.coverage.missingDays.includes(D)], [[], [], [], false], "an operating zero: present, not missing, not invalid");
  assert.equal((await MC.executeClosureReopen(h.io(D))).status, "not_closed", "reopening a non-closed date does nothing");
});

test("CDM2-17 a legacy (row-field) closure is converted to the structured closure by the action", async () => {
  const h = rig([{ id: R1, date: D, sales: 0, is_exception: true, exception_reason: "closure" }], { loaded: { [D]: { source: "legacy", status: "active", reasonCode: "closure", revision: 0 } } });
  const res = await MC.executeClosureAction(h.io(D));
  assert.equal(res.status, "closed"); assert.equal(h.server.calls.length, 1, "structured closure recorded");
});

test("CDM2-18 Storage V2: the same zeroing intents on the real row transformation merge an unrelated change and refuse a revenue change", () => {
  const plan = MC.planClosure([{ id: R1, date: D, sales: 300, supplier_payments: { s1: "40" } }], D, { today: TODAY });
  const { intents } = MC.closureZeroIntents(plan, {});
  const merged = MS.applyRowIntent({ id: R1, date: D, sales: 300, supplier_payments: { s1: "40", s2: "9" } }, intents[0]);
  assert.equal(merged.ok, true); assert.deepEqual([merged.row.sales, merged.row.supplier_payments], [0, { s1: "40", s2: "9" }]);
  const refused = MS.applyRowIntent({ id: R1, date: D, sales: 301, supplier_payments: { s1: "40" } }, intents[0]);
  assert.deepEqual([refused.ok, refused.status], [false, "conflict"]);
});

// ── the REAL UI call sites (brace-matched from index.html) against the real seams ─────
function sliceDecl(anchor) {
  const start = html.indexOf(anchor);
  assert.notEqual(start, -1, "anchor " + anchor); assert.equal(html.indexOf(anchor, start + 1), -1, "unique anchor " + anchor);
  let i = html.indexOf("{", start), depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (line) { if (c === "\n") line = false; continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === str) str = null; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break; }
  }
  return html.slice(start, html.indexOf(";", i) + 1);
}
function uiEnv(seed) {
  const h = rig(seed);
  const state = { form: { date: D, sales: "300" }, dialog: null, notice: "", error: "", entries: null, inFlight: false };
  const setters = { setForm: (v) => { state.form = typeof v === "function" ? v(state.form) : v; }, setClosureDialog: (v) => { state.dialog = v; }, setClosureNotice: (v) => { state.notice = v; },
    setEntrySaveError: (v) => { state.error = v; }, setEntries: (v) => { state.entries = v; }, setEntryExceptions: () => {}, setDashboardInsightsWarning: () => {} };
  const runner = ML.createSaveUiRunner({ ownership: ML.createSaveOwnership(), selection: h.client.ctrl, setInFlight: (v) => { state.inFlight = v; }, makeOpId: () => "ui-op" });
  const deps = {
    ...setters, console, Date,
    get form() { return state.form; }, get entries() { return h.client.lane._state().desired || []; },
    loggedInUser: { role: "owner" }, selectionCtrlRef: { current: h.client.ctrl }, exceptionOwnershipRef: { current: h.own },
    entriesWriteCoordRef: { current: h.client.lane }, saveUiRunnerRef: { current: runner }, captureSelectionCtx: () => h.client.ctrl.capture(),
    israelDateKey: () => TODAY, newRowId: () => mkId("ui-new"), EMPTY_ENTRY: { date: "", sales: "", deliveries: "", other_income: "", supplier_payments: {} },
    loadEntryExceptions: async () => {}, rebuildInsightsAfterEntrySave: async () => {},
    window: { MarjinClosureLifecycle: MCraw, apiFetch: h.server.apiFetch, crypto: { randomUUID: (() => { let n = 0; return () => "uuid-op-" + (++n); })() } },
  };
  const sandbox = { JSON, Math, Number, Object, Array, Promise, Error, String };
  for (const k of Object.keys(deps)) Object.defineProperty(sandbox, k, Object.getOwnPropertyDescriptor(deps, k));
  const src = [sliceDecl("const formWithException = (base, date) => {"), sliceDecl("const closureIo = (date, confirmedFingerprint) => ({"),
    sliceDecl("const closeBusinessDay = async (confirmedFingerprint) => {"), sliceDecl("const reopenBusinessDay = async () => {")].join("\n");
  vm.runInNewContext(src + "\n;__OUT = { closeBusinessDay, reopenBusinessDay };", sandbox);
  return { h, state, ui: sandbox.__OUT };
}

test("CDM2-19 UI call site: the first click opens the confirmation (no write); Cancel is a no-op; Confirm closes, zeros revenue and syncs the form; Reopen clears", async () => {
  const e = uiEnv(TWO_ROWS());
  await e.ui.closeBusinessDay(null);
  assert.equal(e.state.dialog.date, D); assert.equal(e.state.dialog.plan.displayTotal, 500);
  assert.deepEqual([e.h.server.calls.length, e.h.remote.log().length], [0, 0], "opening the dialog writes nothing");
  // Cancel is the JSX `onClick={()=>setClosureDialog(null)}` — it performs no call at all:
  assert.ok(html.includes('onClick={()=>setClosureDialog(null)}>ביטול</button>'), "the dialog Cancel button only closes the dialog");
  await e.ui.closeBusinessDay(e.state.dialog.plan.fingerprint);
  assert.equal(e.state.dialog, null);
  assert.match(e.state.notice, /היום סומן כסגור וההכנסות נרשמו כ-0/);
  assert.deepEqual([e.state.form.sales, e.state.form.is_exception, e.state.form.exception_reason], ["0", true, "closure"], "the form now carries the closure (a later ordinary save cannot clear it)");
  assert.ok(onDate(remoteRows(e.h), D).every((r) => r.sales === 0));
  assert.equal(e.state.inFlight, false, "the shared save runner released");
  await e.ui.reopenBusinessDay();
  assert.equal(e.h.server.ledgerOf()[D].state.status, "cleared");
  assert.deepEqual([e.state.form.is_exception, e.state.form.exception_reason], [false, ""]);
  assert.match(e.state.notice, /לא שוחזרו/);
});

test("CDM2-20 wiring guards: the generic exception control can no longer record a closure, is hidden while closed, and the date field never carries a closure to another date", () => {
  assert.ok(html.includes("window.MarjinForecast.EXCEPTION_REASONS.filter(r=>r!==window.MarjinClosureLifecycle.CLOSURE_REASON_CODE)"), "closure is not a generic reason option");
  assert.ok(html.includes("canEditException(loggedInUser?.role) && !window.MarjinClosureLifecycle.isActiveClosureState(exceptionOwnershipRef.current.getState(form.date))"), "generic control hidden on a closed date");
  assert.ok(/type="date" value=\{form\.date\} onChange=\{e=>\{[^}]*isActiveClosureState/.test(html), "date change re-reads the closure state");
  const close = sliceDecl("const closeBusinessDay = async (confirmedFingerprint) => {");
  for (const m of ["saveUiRunnerRef.current.run(ownCtx", "executeClosureAction(closureIo(date, confirmedFingerprint))", "isLive(ownCtx)"]) assert.ok(close.includes(m), m);
  const io = sliceDecl("const closureIo = (date, confirmedFingerprint) => ({");
  for (const m of ["entriesWriteCoordRef.current.submitIntent(intent2)", "exceptionOwnershipRef.current.ensureOpId", "today: israelDateKey(0)", "rows: entries"]) assert.ok(io.includes(m), m);
  assert.equal((html.match(/reasonCode: CLOSURE_REASON_CODE/g) || []).length, 1, "exactly one place sends the closure reason");
});

test("CDM2-21 ORDER JUSTIFICATION (validated against CD-M1): a failure after closure-first leaves a VISIBLY invalid day; the reverse order would leave a silently valid operating zero", () => {
  const rows = (sales) => [{ id: R1, date: D, sales, deliveries: 0, other_income: 0 }];
  const closureLedger = { [D]: { state: { status: "active", reasonCode: "closure", revision: 1 } } };
  // closure-first, zeroing failed: closure + recorded revenue
  const closureFirst = coreView(rows(300), closureLedger, TODAY);
  assert.deepEqual([closureFirst.coverage.invalidDays, closureFirst.flags.map((f) => f.date)], [[D], [D]], "contradiction: never a complete fact");
  // zero-first, closure failed: an ordinary operating zero — valid, present, and a forecast sample
  const zeroFirst = coreView(rows(0), {}, TODAY);
  assert.deepEqual([zeroFirst.coverage.invalidDays, zeroFirst.coverage.closedDays, zeroFirst.flags], [[], [], []], "looks like a normal zero day");
  const inp = { rows: rows(0), config: { state: "present", value: {} }, fixed: { state: "absent" }, asOfBusinessDate: TODAY, exceptionStates: {}, exceptionLedgerState: "absent" };
  const [day] = BROWSER.product.productDays(inp, { from: D, to: D }).days;
  assert.deepEqual(plain(BROWSER.metrics.revenueForecast.sampleEligibility(day, new Set())), { eligible: true }, "…and would silently enter the six-occurrence weekday baseline");
});
