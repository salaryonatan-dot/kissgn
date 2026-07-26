// P0-DATA-01 + R2 regression guard: duplicate revenue, entry identity, replay
// safety, and selection lifecycle.
// Identity for a daily entry is (tenant, business, business-date): the storage
// path carries tenant+business; inside one entries blob the canonical key is the
// trimmed date string. Edit identity is the ORIGINAL canonical business date
// captured at editor-open — never an array index. These tests exercise the ACTUAL
// inline helpers from index.html (vm-extracted, not re-implemented); source-guard
// assertions are supplementary. Matrix row numbers (A1-G56) refer to the R2 task.
// Run: node --test test/dashboard/entries-lifecycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

function loadMarjinEntries() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "index.html must contain the P0-DATA-01 helper block");
  const endNeedle = "window.MarjinEntries = Object.freeze({ entryDateKey, mergeLegacyDuplicateEntries, canonicalizeEntries, upsertEntryByDate });";
  const end = html.indexOf(endNeedle, start);
  assert.notEqual(end, -1, "index.html must expose window.MarjinEntries for focused tests");
  const src = html.slice(start, end + endNeedle.length);
  assert.ok(!/new Date\(/.test(src), "entry identity must be string-based — no Date() parsing in the helper block");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.MarjinEntries;
}

const ME = loadMarjinEntries();
const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra });
const totalRevenue = (list) =>
  list.reduce((a, e) => a + (Number(e.sales) || 0) + (Number(e.deliveries) || 0) + (Number(e.other_income) || 0), 0);
const supplierTotal = (list) =>
  list.reduce((a, e) => a + Object.values(e.supplier_payments || {}).reduce((s, v) => s + (Number(v) || 0), 0), 0);

// Incident fixture — July 2026, 24 entered days: 22×24,031 + 24,048 + 27,753 = 580,483.
function incidentEntries() {
  const list = [];
  for (let d = 1; d <= 22; d++) list.push(day(`2026-07-${String(d).padStart(2, "0")}`, 24031));
  list.push(day("2026-07-23", 24048));
  list.push(day("2026-07-24", 27753));
  return list;
}

test("incident fixture arithmetic is exact", () => {
  const list = incidentEntries();
  assert.equal(list.length, 24);
  assert.equal(totalRevenue(list), 580483);
  assert.equal(580483 + 27753, 608236);
});

// ── A. DATE IDENTITY ─────────────────────────────────────────────────────────

test("A1: new entry saved onto an existing date replaces the row — never appends", () => {
  const after = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  assert.equal(after.length, 24);
  assert.equal(after.filter((e) => e.date === "2026-07-24").length, 1);
  assert.equal(totalRevenue(after), 580483);
});

test("A2: edit without changing the date replaces exactly that logical day", () => {
  const after = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 30000), "2026-07-24");
  assert.equal(after.length, 24);
  assert.equal(after.find((e) => e.date === "2026-07-24").sales, 30000);
  assert.equal(totalRevenue(after), 580483 - 27753 + 30000);
});

test("A3: edit moving a date to an unused date removes the original day", () => {
  const after = ME.upsertEntryByDate([day("2026-07-01", 100), day("2026-07-24", 27753)], day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(after).map((e) => e.date), ["2026-07-01", "2026-07-25"]);
});

test("A4: edit moving day A onto existing day B — save wins, A removed by date, one row for B", () => {
  const entries = [day("2026-07-20", 1000, { food_cost: 111 }), day("2026-07-24", 27753)];
  const edited = day("2026-07-24", 5000, { food_cost: 999 });
  const after = ME.upsertEntryByDate(entries, edited, "2026-07-20");
  assert.equal(after.length, 1);
  assert.deepEqual(plain(after[0]), plain(edited), "explicit save wins wholesale; nothing summed");
});

test("A5/A6: insertion before the edited row / reordering cannot redirect the edit (R2 stale-index reproduction)", () => {
  // Editor opened on 2026-07-24 (identity = its DATE). Hydration inserts 06-30
  // before it — under the old index model editingId=1 would now point at 07-01.
  const hydrated = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753), day("2026-06-30", 50)]);
  const after = ME.upsertEntryByDate(hydrated, day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(after).map((e) => e.date), ["2026-06-30", "2026-07-01", "2026-07-25"]);
  assert.ok(after.some((e) => e.date === "2026-07-01"), "A10: unrelated day must never be removed");
  assert.ok(!after.some((e) => e.date === "2026-07-24"), "the edited logical day is replaced");
});

test("A7: listener hydration while the editor is open leaves the edit-by-date deterministic", () => {
  const state1 = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753)]);
  const hydrated = ME.canonicalizeEntries([...plain(state1), day("2026-07-02", 70)]); // echo while modal open
  const after = ME.upsertEntryByDate(hydrated, day("2026-07-24", 28000), "2026-07-24");
  assert.equal(after.length, 3);
  assert.equal(after.find((e) => e.date === "2026-07-24").sales, 28000);
  assert.equal(after.find((e) => e.date === "2026-07-01").sales, 100);
});

test("A8: original edited date deleted elsewhere before save — no unrelated day harmed", () => {
  const state = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-30", 9)]); // 07-24 already gone
  const after = ME.upsertEntryByDate(state, day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(after).map((e) => e.date), ["2026-07-01", "2026-07-25", "2026-07-30"], "07-30 must survive (old index model deleted it)");
});

test("A9: final target date appears before save — still exactly one row for it", () => {
  const state = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753), day("2026-07-25", 500)]);
  const after = ME.upsertEntryByDate(state, day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(after).map((e) => `${e.date}:${e.sales}`), ["2026-07-01:100", "2026-07-25:27753"]);
});

test("A-legacy-index: a numeric third argument is ignored — positional deletion is impossible", () => {
  const state = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753)]);
  const after = ME.upsertEntryByDate(state, day("2026-07-25", 1), 0);
  assert.ok(after.some((e) => e.date === "2026-07-01"), "index 0 must NOT delete 07-01");
  assert.equal(after.length, 3);
});

test("A11/A12: different dates with equal revenue stay separate; 07-24/07-25 never merge (no UTC shift)", () => {
  const canon = ME.canonicalizeEntries([day("2026-07-24", 27753), day("2026-07-25", 27753)]);
  assert.equal(canon.length, 2);
  assert.equal(totalRevenue(canon), 55506);
});

// ── B. DUPLICATE REPLAY ──────────────────────────────────────────────────────

const fullRecord = () => ({
  date: "2026-07-24", sales: 27753, deliveries: 100, other_income: 50,
  supplier_payments: { supplierA: 100 }, food_cost: 0,
  payroll: 500, hourly_payroll: { empA: 200 }, other_expense: 30, note: "x",
});

test("B13-16/B22: the same complete daily record delivered twice doubles NOTHING", () => {
  const rec = fullRecord();
  const canon = ME.canonicalizeEntries([rec, plain(rec)]);
  assert.equal(canon.length, 1);
  const r = canon[0];
  assert.equal(r.sales, 27753, "revenue never summed");
  assert.equal(r.deliveries, 100);
  assert.equal(r.other_income, 50);
  assert.equal(r.supplier_payments.supplierA, 100, "supplier payment NOT doubled (was 200 pre-R2)");
  assert.equal(r.payroll, 500, "payroll never summed");
  assert.equal(r.hourly_payroll.empA, 200, "hourly payroll never summed");
  assert.equal(r.other_expense, 30);
});

test("B17: canonicalization is idempotent and replay-safe — canonicalize(x+x) === canonicalize(x)", () => {
  const rec = fullRecord();
  const once = ME.canonicalizeEntries([rec]);
  const doubled = ME.canonicalizeEntries([rec, plain(rec)]);
  const twice = ME.canonicalizeEntries(plain(once));
  assert.deepEqual(plain(doubled), plain(once));
  assert.deepEqual(plain(twice), plain(once));
});

test("B18: duplicate rows with different supplier keys keep both (deterministic union)", () => {
  const canon = ME.canonicalizeEntries([
    day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 } }),
    day("2026-07-24", 0, { supplier_payments: { supplierB: 40 } }),
  ]);
  assert.deepEqual(plain(canon[0].supplier_payments), { supplierA: 100, supplierB: 40 });
});

test("B19: duplicate rows with the SAME supplier key never add — earliest value wins", () => {
  const canon = ME.canonicalizeEntries([
    day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 } }),
    day("2026-07-24", 0, { supplier_payments: { supplierA: 70 } }),
  ]);
  assert.equal(canon[0].supplier_payments.supplierA, 100, "no arithmetic addition (was 170 pre-R2)");
});

test("B20/B21: property order and irrelevant metadata differences cannot cause financial addition", () => {
  const rec = fullRecord();
  const reordered = { note: "x", hourly_payroll: { empA: 200 }, payroll: 500, other_expense: 30, food_cost: 0, supplier_payments: { supplierA: 100 }, other_income: 50, deliveries: 100, sales: 27753, date: "2026-07-24" };
  const withMeta = { ...plain(rec), _idx: 7, __key: "z" };
  for (const pair of [[rec, reordered], [rec, withMeta]]) {
    const canon = ME.canonicalizeEntries(plain(pair));
    assert.equal(canon[0].sales, 27753);
    assert.equal(canon[0].supplier_payments.supplierA, 100);
    assert.equal(canon[0].payroll, 500);
  }
});

test("B-scalar precedence: earliest non-zero scalar wins; zeros are filled by later values", () => {
  const m1 = ME.canonicalizeEntries([day("2026-07-10", 100), day("2026-07-10", 200)]);
  assert.equal(m1[0].sales, 100);
  const m2 = ME.canonicalizeEntries([day("2026-07-10", 0), day("2026-07-10", 200)]);
  assert.equal(m2[0].sales, 200);
  const m4 = ME.canonicalizeEntries([day("2026-07-10", 1, { note: "" }), day("2026-07-10", 0, { note: "b" })]);
  assert.equal(m4[0].note, "b");
});

test("B-hourly union: complementary hourly_payroll keys from duplicate rows are preserved", () => {
  const canon = ME.canonicalizeEntries([
    day("2026-07-24", 1, { hourly_payroll: { empA: 200 } }),
    day("2026-07-24", 0, { hourly_payroll: { empB: 300 } }),
  ]);
  assert.deepEqual(plain(canon[0].hourly_payroll), { empA: 200, empB: 300 });
});

test("B23/A4: explicit save precedence beats merge precedence — save wins wholesale incl. zeroing", () => {
  const after = ME.upsertEntryByDate([day("2026-07-24", 5000, { food_cost: 700, supplier_payments: { s1: 9 } })], day("2026-07-24", 0), null);
  assert.equal(after.length, 1);
  assert.equal(after[0].sales, 0);
  assert.equal(after[0].food_cost, undefined);
  assert.equal(after[0].supplier_payments, undefined, "no merging on explicit save");
});

// ── C. INCIDENT FIXTURE ──────────────────────────────────────────────────────

test("C24-26: ₪580,483 is stable; ₪608,236 unreachable via replay, doubled payload, or full doubling", () => {
  const correct = incidentEntries();
  for (const attempt of [
    ME.upsertEntryByDate(correct, day("2026-07-24", 27753), null),
    ME.canonicalizeEntries([...correct, day("2026-07-24", 27753)]),
    ME.canonicalizeEntries([...correct, ...plain(correct)]),
  ]) {
    assert.equal(totalRevenue(attempt), 580483);
    assert.notEqual(totalRevenue(attempt), 608236);
  }
});

test("C27/C28: exactly one 2026-07-24 point; MTD, chart and history see the same effective count", () => {
  const state = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const monthEntries = state.filter((e) => e.date && e.date.startsWith("2026-07-"));
  assert.equal(monthEntries.filter((e) => e.date === "2026-07-24").length, 1);
  assert.equal(monthEntries.length, 24, "one effective row per business date for every consumer");
});

// ── D. DOWNSTREAM FINANCIAL EFFECTS (canonical rows feed unchanged formulas) ──

test("D29-33: identical replay leaves supplier total, Food Cost %, payroll and profit inputs unchanged", () => {
  const base = [
    day("2026-07-01", 10000, { supplier_payments: { a: 1000, b: 500 }, payroll: 800, hourly_payroll: { e1: 200 } }),
    day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 }, payroll: 500 }),
  ];
  const once = ME.canonicalizeEntries(plain(base));
  const replayed = ME.canonicalizeEntries([...plain(base), ...plain(base)]);
  const metrics = (rows) => {
    const revenue = totalRevenue(rows);
    const food = supplierTotal(rows);
    const labor = rows.reduce((a, e) => a + (Number(e.payroll) || 0) + Object.values(e.hourly_payroll || {}).reduce((s, v) => s + (Number(v) || 0), 0), 0);
    return { revenue, food, foodPct: (food / revenue) * 100, labor, contribution: revenue - food - labor };
  };
  assert.deepEqual(metrics(replayed), metrics(once), "no financial figure may move under replay");
  assert.equal(metrics(replayed).food, 1600);
  assert.equal(metrics(replayed).labor, 1500);
});

// ── E. PERSISTENCE PATHS (source guards — supplementary to behavioral tests) ──

function saveEntrySlice() {
  const start = html.indexOf("const saveEntry = async");
  const end = html.indexOf("const deleteEntry", start);
  assert.ok(start !== -1 && end !== -1);
  return html.slice(start, end);
}

test("E35/E41: saveEntry upserts by ORIGINAL DATE; no index-based append/replace or wizard writer remains", () => {
  const src = saveEntrySlice();
  assert.ok(src.includes("window.MarjinEntries.upsertEntryByDate("));
  assert.ok(src.includes("__editingDate"), "stable date identity must feed the upsert");
  assert.ok(!src.includes("[...entries,__applyExc"));
  assert.ok(!src.includes("entries.map((e,i)=>i===editingId"));
  assert.ok(!src.includes("entries[editingId]"), "no positional previous-entry lookup");
  assert.ok(src.includes("entrySaveInFlightRef.current"), "double-submit guard must remain");
  assert.ok(!html.includes("const saveRevenueStep"), "dead index-keyed wizard writer must not exist");
});

test("E36-38/E42: persist canonicalizes every full-blob write (supplier/employee/fixed/delete/clear paths included)", () => {
  const start = html.indexOf("const persist = async (e, f)");
  const slice = html.slice(start, start + 1400);
  const canonIdx = slice.indexOf("e = window.MarjinEntries.canonicalizeEntries(e);");
  const writeIdx = slice.indexOf("JSON.stringify(e), true");
  assert.ok(canonIdx !== -1 && writeIdx !== -1 && canonIdx < writeIdx, "canonicalization must precede the storage write");
});

test("E39: delete is keyed by date — a stale render index cannot remove the wrong day", () => {
  const start = html.indexOf("const deleteEntryByDate = date =>");
  assert.notEqual(start, -1, "date-keyed delete wrapper must exist");
  const slice = html.slice(start, start + 450);
  assert.ok(slice.includes("entryDateKey"), "delete resolves the row by canonical date key");
  assert.ok(slice.includes("findIndex"), "current index resolved fresh inside the handler");
  assert.ok(html.includes("onClick={()=>deleteEntryByDate(e.date)}"), "history row passes the date, not a render index");
  assert.ok(!html.includes("onClick={()=>deleteEntry(i)}"), "no index-passing delete caller remains");
});

test("E40: clear-all persists an empty canonical list through persist()", () => {
  assert.ok(html.includes('const u=[];setEntries(u);persist(u,null);'), "clear-all path unchanged and persist-guarded");
});

// ── F. ASYNC LIFECYCLE (source guards + behavioral identity) ─────────────────

test("F43/F44: save completing after a business OR tenant switch cannot write the new selection", () => {
  const src = saveEntrySlice();
  assert.ok(src.includes("activeBizIdRef.current !== __saveForBizId || window._currentTenantId !== __saveForTenantId"), "pre-persist abort guard");
  assert.ok(src.includes("activeBizIdRef.current === __saveForBizId && window._currentTenantId === __saveForTenantId"), "post-persist setEntries guard");
});

test("F45/F46: queued listener callbacks and self-heal writes are generation- and tenant-bound", () => {
  assert.ok(html.includes("let live = true;"));
  assert.ok(html.includes("if(!live) return; // R2: queued callback from an unsubscribed/old selection — ignore"));
  assert.ok(html.includes("deduped.length < val.length && live && window._currentTenantId === tenantAtSetup"), "self-heal bound to its source selection");
  assert.ok(html.includes("return () => { live = false; unsubs.forEach(u => typeof u===\"function\" && u());"), "cleanup flips the generation flag and unsubscribes");
});

test("F47: switching selection invalidates the open edit context", () => {
  const effStart = html.indexOf("// useEffect 2: business-specific data -- live listeners");
  const eff = html.slice(effStart, effStart + 1600);
  assert.ok(eff.includes("setEditingId(null);"), "edit id reset on selection switch");
  assert.ok(eff.includes("editingDateRef.current = null;"), "edit date identity reset on selection switch");
});

test("F48: last-year load for an old selection is ignored (business AND tenant)", () => {
  assert.ok(html.includes("activeBizIdRef.current !== bizAtLoad || window._currentTenantId !== tenantAtSetup || !live"));
});

test("F49: post-save state uses the same canonical array that was persisted", () => {
  const src = saveEntrySlice();
  const upsertIdx = src.indexOf("upsertEntryByDate(");
  const persistIdx = src.indexOf("await persist(updated, null)");
  const setIdx = src.indexOf("setEntries(updated)");
  assert.ok(upsertIdx !== -1 && persistIdx !== -1 && setIdx !== -1 && upsertIdx < persistIdx && persistIdx < setIdx,
    "canonical `updated` is computed once, persisted, then applied to state");
});

test("F50 + edit identity wiring: editor-open sites capture the date; new/cancel/success clear it", () => {
  assert.ok(html.includes("editingDateRef.current = isMissing ? null : (window.MarjinEntries.entryDateKey(e.date));"), "history editor-open");
  assert.ok(html.includes("editingDateRef.current = existing ? (window.MarjinEntries.entryDateKey(existing.date)) : null;"), "quick-add editor-open");
  const clears = html.split("editingDateRef.current = null").length - 1 + (html.split("editingDateRef.current=null").length - 1);
  assert.ok(clears >= 3, `new-entry, cancel, success and switch paths must clear the identity (found ${clears})`);
});

// ── G. NON-REGRESSION / consumers ────────────────────────────────────────────

test("G: entries listener canonicalizes through the shared helper and wholesale-replaces state", () => {
  const start = html.indexOf("sub(`biz:${currentBizId}:entries`");
  const slice = html.slice(start, start + 1100);
  assert.ok(slice.includes("window.MarjinEntries.canonicalizeEntries(val)"));
  assert.ok(slice.includes("setEntries(deduped)"));
});

test("G: dashboard chart and MTD metrics consume the same effective entries collection", () => {
  assert.ok(html.includes("const monthEntries = entries.filter(e => e.date && e.date.startsWith(monthPrefix));"));
  assert.ok(html.includes("calcMetrics(monthEntries"));
  assert.ok(html.includes("buildChart(monthEntries)"));
});

test("G: undated rows cannot enter or survive the collection; trimmed dates collide correctly", () => {
  assert.deepEqual(plain(ME.upsertEntryByDate([day("2026-07-24", 1)], { date: "", sales: 9 }, null)), [day("2026-07-24", 1)]);
  assert.equal(ME.canonicalizeEntries([{ sales: 9 }, day("2026-07-24", 1)]).length, 1);
  const trimmed = ME.canonicalizeEntries([day(" 2026-07-24", 100), day("2026-07-24", 0, { food_cost: 5 })]);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].date, "2026-07-24");
  assert.equal(trimmed[0].sales, 100);
});

test("G: upsert replay is idempotent (repeated save of the same logical day)", () => {
  const once = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const twice = ME.upsertEntryByDate(once, day("2026-07-24", 27753), null);
  assert.deepEqual(plain(twice), plain(once));
});

test("G: save-then-hydration round trip is stable", () => {
  const state = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const hydrated = ME.canonicalizeEntries(plain(state));
  assert.deepEqual(plain(hydrated), plain(state));
  assert.deepEqual(plain(ME.canonicalizeEntries(hydrated)), plain(hydrated));
});
