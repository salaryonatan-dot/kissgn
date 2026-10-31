// DAILY-1 — the daily entry form must edit a day's existing record, never add a second record
// for the same date (production incident 2026-10-30, Kiss Gan Shmuel: a supplier-grid record,
// then two form saves each created a new record → revenue counted twice).
// Runs the PRODUCTION lifecycle text of index.html (executeEntrySave, the entries write lane,
// the remote-atomic mutator, applyEntryIntent) over the shared fake remote of the cross-writer
// harness. Synthetic rows only.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ML, makeRemoteService, makeClient, settleAll, mkId, entriesKey, plain, drainLiveRigs } from "../support/cross-writer-harness.mjs";

afterEach(drainLiveRigs);

const D = "2026-10-30";
const SUPPLIER_ROW = { id: mkId("sup-row"), date: D, sales: "", deliveries: "", other_income: "", payroll: "", supplier_payments: { s1: "460", s2: "4310.17" } };
const OTHER_DAY = { id: mkId("other"), date: "2026-10-29", sales: "9000", deliveries: "", other_income: "", payroll: "1500", supplier_payments: {} };

function rig(seedRows) {
  const remote = makeRemoteService();
  remote.atKey("T1", entriesKey("A")).seed(seedRows);
  const c = makeClient(remote, "form").attach().pull();
  return { remote, c, rows: () => remote.atKey("T1", entriesKey("A")).rows() };
}
let gen = 0;
function save(c, { form, rows, editingDate, newId }) {
  const ui = { saved: false, error: "", reset: 0 };
  const io = {
    selection: c.ctrl, form: { ...form }, rows, role: "owner", editingDate: editingDate === undefined ? null : editingDate,
    vatNormalize: (f) => f, materialChanged: () => false, todayKey: () => "2026-10-31",
    newOpId: () => "op-" + (++gen),
    exceptionState: { get: () => null, set: () => {}, applyActive: () => {} },
    opIds: { ensure: (d, make) => make(), consume: () => {} },
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    newRowId: () => newId || mkId("new-" + (++gen)),
    // production mapping (index.html saveEntry → persistMutation), verbatim in substance
    persistMutation: (intent2) => c.lane.submitIntent(intent2).then((r) => ({
      ok: r.status === "committed" || r.status === "committed_idempotent", canonical: r.rows, status: r.status,
      conflict: r.status === "conflict", blocked: typeof r.status === "string" && r.status.indexOf("blocked_") === 0,
      stale: r.status === "stale" || r.status === "cancelled_selection_changed",
      reason: r.reason, detail: r.detail || r.reason || r.error || (r.conflictPaths && r.conflictPaths.join(",")),
    })),
    applyRows: () => {}, reloadExceptions: async () => {}, rebuildInsights: async () => {}, loadInsights: async () => ({ skipped: true }),
    onInsightsFailure: () => {}, suppressNextInsightsLoad: () => {},
    resetFormAndEditing: () => { ui.reset++; }, setSaved: (v) => { ui.saved = v; }, setError: (m) => { ui.error = m; }, scheduleNav: () => {},
  };
  return ML.executeEntrySave(io).then((res) => ({ res, ui }));
}
const onDate = (rows, d = D) => (rows || []).filter((r) => r && r.date === d);

test("DAILY-1 a fresh form (not opened on the day's record) cannot add a second record for an existing date: refused locally, zero remote change, actionable message", async () => {
  const { c, rows } = rig([OTHER_DAY, SUPPLIER_ROW]);
  const before = JSON.stringify(rows());
  const { res, ui } = await save(c, { form: { date: D, sales: "13412", deliveries: "", other_income: "", payroll: "" }, rows: plain(c.view() || [OTHER_DAY, SUPPLIER_ROW]) });
  await settleAll();
  assert.equal(res.status, "error"); assert.equal(res.outcome, "date_exists");
  assert.equal(ui.saved, false); assert.match(ui.error, /כבר קיימת רשומה/);
  assert.equal(JSON.stringify(rows()), before, "nothing written");
});

test("DAILY-1 the form opened on the day's record edits THAT record: same id, supplier payments kept, revenue set, one record for the date", async () => {
  const { c, rows } = rig([OTHER_DAY, SUPPLIER_ROW]);
  const { res, ui } = await save(c, { form: { ...SUPPLIER_ROW, sales: "13412" }, rows: [OTHER_DAY, SUPPLIER_ROW], editingDate: D });
  await settleAll();
  assert.equal(res.status, "saved"); assert.equal(ui.error, "");
  const day = onDate(rows());
  assert.equal(day.length, 1); assert.equal(day[0].id, SUPPLIER_ROW.id);
  assert.equal(day[0].sales, "13412"); assert.deepEqual(day[0].supplier_payments, SUPPLIER_ROW.supplier_payments);
  assert.deepEqual(onDate(rows(), "2026-10-29")[0], OTHER_DAY, "another day untouched");
});

test("DAILY-1 adding labor later through the form opened on the same day keeps the id and the revenue; still one record", async () => {
  const withRevenue = { ...SUPPLIER_ROW, sales: "13412" };
  const { c, rows } = rig([OTHER_DAY, withRevenue]);
  const { res } = await save(c, { form: { ...withRevenue, payroll: "2920" }, rows: [OTHER_DAY, withRevenue], editingDate: D });
  await settleAll();
  assert.equal(res.status, "saved");
  const day = onDate(rows());
  assert.equal(day.length, 1); assert.equal(day[0].id, SUPPLIER_ROW.id);
  assert.equal(day[0].sales, "13412"); assert.equal(day[0].payroll, "2920");
});

test("DAILY-1 a new day still creates exactly one record; a replayed identical create (same id) is idempotent", async () => {
  const { c, rows } = rig([OTHER_DAY]);
  const NEW = mkId("fixed-new");
  const a = await save(c, { form: { date: D, sales: "13412", deliveries: "", other_income: "", payroll: "2920" }, rows: [OTHER_DAY], newId: NEW });
  await settleAll();
  assert.equal(a.res.status, "saved");
  assert.equal(onDate(rows()).length, 1); assert.equal(onDate(rows())[0].id, NEW);
  // a delayed / repeated submission of the SAME create from a stale view (the client still thinks the day is empty)
  const b = await save(c, { form: { date: D, sales: "13412", deliveries: "", other_income: "", payroll: "2920" }, rows: [OTHER_DAY], newId: NEW });
  await settleAll();
  assert.equal(b.res.status, "saved", "identical replay is accepted (already_created)");
  assert.equal(onDate(rows()).length, 1, "no second record");
});

test("DAILY-1 race: the view is stale (day looks empty) while another writer has created the day's record → the transaction refuses the create, zero second record", async () => {
  const { remote, c, rows } = rig([OTHER_DAY]);
  // another device / the supplier grid creates the day's record after this form hydrated
  remote.atKey("T1", entriesKey("A")).setRowsDirect([OTHER_DAY, SUPPLIER_ROW]);
  const { res, ui } = await save(c, { form: { date: D, sales: "13412", deliveries: "", other_income: "", payroll: "" }, rows: [OTHER_DAY], newId: mkId("racer") });
  await settleAll();
  assert.equal(res.status, "error"); assert.equal(ui.saved, false);
  assert.match(ui.error, /כבר קיימת רשומה/);
  assert.equal(onDate(rows()).length, 1); assert.equal(onDate(rows())[0].id, SUPPLIER_ROW.id);
});

test("DAILY-1 scope: only the daily-form create carries requireDateAbsent; a create without it keeps the R10 rule (duplicate dates legal), with it the same create is refused", () => {
  const nr = { id: mkId("pure-new"), date: D, sales: "1" };
  const base = { type: "upsert_entry", target: { id: nr.id }, createIfMissing: true, newRow: nr, patch: {}, base: {} };
  const plainCreate = ML.applyEntryIntent([SUPPLIER_ROW], base);
  assert.equal(plainCreate.ok, true); assert.equal(plainCreate.rows.length, 2);
  const guarded = ML.applyEntryIntent([SUPPLIER_ROW], { ...base, requireDateAbsent: true });
  assert.equal(guarded.ok, false); assert.equal(guarded.status, "conflict"); assert.equal(guarded.reason, "date_exists");
  const emptyDay = ML.applyEntryIntent([OTHER_DAY], { ...base, requireDateAbsent: true });
  assert.equal(emptyDay.ok, true); assert.equal(emptyDay.rows.length, 2);
});
