// P0-DATA-01 regression guard: transient duplicate dashboard revenue.
// Identity for a daily entry is (tenant, business, business-date) — the storage
// path carries tenant+business; inside one entries blob the canonical key is the
// trimmed date string. These tests exercise the ACTUAL inline helpers from
// index.html (vm-extracted, not re-implemented) plus lifecycle source guards.
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
// vm-created objects live in another realm (different Object.prototype); normalize
// before deep comparisons so assertions compare structure, not realm identity.
const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra });
const totalRevenue = (list) =>
  list.reduce((a, e) => a + (Number(e.sales) || 0) + (Number(e.deliveries) || 0) + (Number(e.other_income) || 0), 0);

// Deterministic incident fixture — July 2026, 24 entered days:
// 22 days × ₪24,031 + one day ₪24,048 (07-23) + 2026-07-24 ₪27,753 = ₪580,483.
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

test("1. new-entry form saved onto an existing date replaces the row — never appends", () => {
  const before = incidentEntries();
  const resaved = day("2026-07-24", 27753);
  const after = ME.upsertEntryByDate(before, resaved, null); // editingId === null (new-entry mode)
  assert.equal(after.length, 24, "one effective row per date");
  assert.equal(after.filter((e) => e.date === "2026-07-24").length, 1);
  assert.equal(totalRevenue(after), 580483, "replaying the same day cannot change the MTD total");
  assert.notEqual(totalRevenue(after), 608236);
});

test("2. editing an entry so its date collides with another date leaves exactly one row (the saved entry)", () => {
  const entries = [day("2026-07-20", 1000, { food_cost: 111 }), day("2026-07-24", 27753)];
  const edited = day("2026-07-24", 5000, { food_cost: 999 }); // index 0 edited, date changed onto 07-24
  const after = ME.upsertEntryByDate(entries, edited, 0);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0], edited, "the explicit save wins wholesale");
});

test("3. raw hydrated payload with duplicate date rows canonicalizes without summing revenue", () => {
  const dupPayload = [...incidentEntries(), day("2026-07-24", 27753)];
  const canon = ME.canonicalizeEntries(dupPayload);
  assert.equal(canon.length, 24);
  assert.equal(totalRevenue(canon), 580483, "duplicate 07-24 rows must not double revenue");
  // precedence: earliest non-zero scalar wins; revenue never summed
  const m1 = ME.canonicalizeEntries([day("2026-07-10", 100), day("2026-07-10", 200)]);
  assert.equal(m1[0].sales, 100);
  const m2 = ME.canonicalizeEntries([day("2026-07-10", 0), day("2026-07-10", 200)]);
  assert.equal(m2[0].sales, 200);
  // supplier payments merge per supplier by summation (legacy split-row healing)
  const m3 = ME.canonicalizeEntries([
    day("2026-07-10", 100, { supplier_payments: { s1: 50 } }),
    day("2026-07-10", 0, { supplier_payments: { s1: 25, s2: 10 } }),
  ]);
  assert.deepEqual(plain(m3[0].supplier_payments), { s1: 75, s2: 10 });
  // non-numeric: first truthy wins
  const m4 = ME.canonicalizeEntries([day("2026-07-10", 1, { note: "" }), day("2026-07-10", 0, { note: "b" })]);
  assert.equal(m4[0].note, "b");
});

test("4. save followed by listener/hydration replacement is stable (round-trip idempotent)", () => {
  const state = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const hydrated = ME.canonicalizeEntries(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(hydrated, state, "hydration wholesale-replacement reproduces the saved state exactly");
  assert.deepEqual(ME.canonicalizeEntries(hydrated), hydrated, "canonicalization is idempotent");
});

test("5. incident fixture: ₪27,753 replay can never turn ₪580,483 into ₪608,236", () => {
  const correct = incidentEntries();
  for (const attack of [
    ME.upsertEntryByDate(correct, day("2026-07-24", 27753), null),
    ME.canonicalizeEntries([...correct, day("2026-07-24", 27753)]),
    ME.canonicalizeEntries([...correct, ...correct]),
  ]) {
    assert.equal(totalRevenue(attack), 580483);
  }
});

test("6. exactly one 2026-07-24 point reaches the month view", () => {
  const state = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const monthEntries = state.filter((e) => e.date && e.date.startsWith("2026-07-")); // same filter shape as the dashboard
  assert.equal(monthEntries.filter((e) => e.date === "2026-07-24").length, 1);
});

test("7. different dates stay separate — Asia/Jerusalem days cannot merge; equal revenue is kept twice", () => {
  const canon = ME.canonicalizeEntries([day("2026-07-24", 27753), day("2026-07-25", 27753)]);
  assert.equal(canon.length, 2, "2026-07-25 must never collapse into 2026-07-24");
  assert.equal(totalRevenue(canon), 55506, "identical revenue on different dates is counted twice");
  const after = ME.upsertEntryByDate([day("2026-07-24", 27753)], day("2026-07-25", 27753), null);
  assert.equal(after.length, 2);
});

test("8. documented precedence: explicit save wins wholesale, including zeroing a field", () => {
  const after = ME.upsertEntryByDate([day("2026-07-24", 5000, { food_cost: 700 })], day("2026-07-24", 0), null);
  assert.equal(after.length, 1);
  assert.equal(after[0].sales, 0, "the saved entry replaces the old row entirely — no non-zero preference on save");
  assert.equal(after[0].food_cost, undefined);
});

test("9. undated rows cannot enter or survive the collection; trimmed dates collide correctly", () => {
  assert.deepEqual(plain(ME.upsertEntryByDate([day("2026-07-24", 1)], { date: "", sales: 9 }, null)), [day("2026-07-24", 1)]);
  assert.equal(ME.canonicalizeEntries([{ sales: 9 }, day("2026-07-24", 1)]).length, 1);
  const trimmed = ME.canonicalizeEntries([day(" 2026-07-24", 100), day("2026-07-24", 0, { food_cost: 5 })]);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].date, "2026-07-24");
  assert.equal(trimmed[0].sales, 100);
});

test("10. upsert replay is idempotent (repeated save of the same logical day)", () => {
  const once = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const twice = ME.upsertEntryByDate(once, day("2026-07-24", 27753), null);
  assert.deepEqual(twice, once);
});

// ── Lifecycle wiring guards (the repaired production paths, asserted on source) ──

function saveEntrySlice() {
  const start = html.indexOf("const saveEntry = async");
  const end = html.indexOf("const deleteEntry", start);
  assert.ok(start !== -1 && end !== -1);
  return html.slice(start, end);
}

test("saveEntry upserts by date and contains no index-based append/replace", () => {
  const src = saveEntrySlice();
  assert.ok(src.includes("window.MarjinEntries.upsertEntryByDate("), "save path must use the keyed upsert");
  assert.ok(!src.includes("[...entries,__applyExc"), "the appending [...entries, e] path must be gone");
  assert.ok(!src.includes("entries.map((e,i)=>i===editingId"), "the index-positional replace must be gone");
  assert.ok(src.includes("entrySaveInFlightRef.current"), "double-submit guard must remain");
  assert.ok(src.includes("activeBizIdRef.current === __saveForBizId"), "stale-business guard must protect setEntries after await");
});

test("entries listener canonicalizes through the shared helper and wholesale-replaces state", () => {
  const start = html.indexOf("sub(`biz:${currentBizId}:entries`");
  const slice = html.slice(start, start + 900);
  assert.ok(slice.includes("window.MarjinEntries.canonicalizeEntries(val)"));
  assert.ok(slice.includes("setEntries(deduped)"));
  assert.ok(slice.includes("deduped.length < val.length"), "self-heal write-back must remain");
});

test("persist canonicalizes every full-blob entries write (defensive boundary)", () => {
  const start = html.indexOf("const persist = async (e, f)");
  const slice = html.slice(start, start + 1400);
  const canonIdx = slice.indexOf("e = window.MarjinEntries.canonicalizeEntries(e);");
  const writeIdx = slice.indexOf("JSON.stringify(e), true");
  assert.ok(canonIdx !== -1 && writeIdx !== -1 && canonIdx < writeIdx, "canonicalization must precede the storage write");
});

test("business-switch lifecycle: listeners are torn down and stale async loads are discarded", () => {
  assert.ok(html.includes('return () => { unsubs.forEach(u => typeof u==="function" && u());'), "effect cleanup must unsubscribe all listeners");
  assert.ok(html.includes("activeBizIdRef.current = currentBizId;"), "active-business ref must track the live selection");
  assert.ok(html.includes("activeBizIdRef.current !== bizAtLoad"), "stale initial-load results must be discarded");
});

test("dashboard chart and MTD metrics consume the same effective entries collection", () => {
  assert.ok(html.includes("const monthEntries = entries.filter(e => e.date && e.date.startsWith(monthPrefix));"));
  assert.ok(html.includes("calcMetrics(monthEntries"), "MTD metrics derive from monthEntries");
  assert.ok(html.includes("buildChart(monthEntries)"), "chart derives from the same monthEntries");
});
