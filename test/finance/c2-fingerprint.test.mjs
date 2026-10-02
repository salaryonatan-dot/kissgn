// WP-C2 — the canonical financial fingerprint that decides the analytics rebuild after an entry
// save (VD-46, supersedes VD-15; preflight 03 §J C2-01…04, 07 §C2 C2-T01…T07; FZ-11).
//
// Everything here runs the PRODUCTION text of index.html: the C2 block (window.MarjinC2) is
// vm-loaded over the committed fincore/v1 bundle, and the rebuild decision is driven through the
// extracted production `saveEntry` → `executeEntrySave` call site (ui-call-site harness).
// The oracles never restate the fingerprint: C2-T01 compares against the core normalizer's own
// output (normalizeRows, and groupByDate — the canonical day the server builds).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFinance } from "../support/c1-seam.mjs";
import { loadC2, c2Source } from "../support/c2-seam.mjs";
import { REPO } from "../support/fincore-load.mjs";
import { makeUiEnv, settleAll, drainLiveRigs, mkId, plain, SOURCE } from "../support/ui-call-site-harness.mjs";

afterEach(drainLiveRigs);

const F = await loadFinance();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C2 = loadC2(HTML);
// results cross the vm realm boundary; compare them as plain JSON values
const json = (v) => JSON.parse(JSON.stringify(v));
const changed = (prev, next) => json(C2.financialChanged(F, prev, next));
const D = "2026-08-04";

// ── deterministic generator of stored / proposed rows ────────────────────────
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const AMOUNTS = [undefined, null, "", " ", "0", 0, "100", 100, "100.00", "100.5", 100.5, "1,000", "1000", "-5", "abc", "1,00", "12.50", 7, "7"];
const SUP = [undefined, "", "0", 0, "skip", "50", 50, "50.0", "x", "-3"];
const HOURLY = [undefined, {}, { e1: "80" }, { e1: "90" }, { e1: "80", e2: "10" }, "bad", { e1: "oops" }];
const TEXT = [undefined, "", "busy", "rain", "שבת"];
function pick(r, a) { return a[Math.floor(r() * a.length)]; }
function row(r) {
  const o = { id: "id-" + Math.floor(r() * 1e6), date: D };
  for (const f of ["sales", "deliveries", "other_income", "payroll", "other_expense", "food_cost"]) { const v = pick(r, AMOUNTS); if (v !== undefined) o[f] = v; }
  const sp = r() < 0.15 ? "notamap" : r() < 0.3 ? undefined : Object.fromEntries(["s1", "s2"].filter(() => r() < 0.7).map((k) => [k, pick(r, SUP)]).filter(([, v]) => v !== undefined));
  if (sp !== undefined) o.supplier_payments = sp;
  const h = pick(r, HOURLY); if (h !== undefined) o.hourly_payroll = h;
  for (const f of ["notes", "weather_impact", "exception_reason", "exception_note"]) { const v = pick(r, TEXT); if (v !== undefined) o[f] = v; }
  if (r() < 0.3) o.is_exception = r() < 0.6;
  if (r() < 0.2) o.security_event = r() < 0.5;
  return o;
}
const MUTABLE = ["sales", "deliveries", "other_income", "payroll", "other_expense", "food_cost", "supplier_payments", "hourly_payroll", "notes", "weather_impact", "is_exception", "exception_reason", "security_event", "includeVat", "id"];
function mutate(r, base) {
  const o = structuredClone(base);
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const f = pick(r, MUTABLE);
    if (f === "supplier_payments") o[f] = r() < 0.5 ? { ...(typeof o[f] === "object" && o[f] ? o[f] : {}), [pick(r, ["s1", "s2", "s3"])]: pick(r, SUP) } : pick(r, [undefined, {}, "notamap"]);
    else if (f === "hourly_payroll") o[f] = pick(r, HOURLY);
    else if (f === "is_exception") o[f] = pick(r, [true, false, undefined]);
    else if (f === "security_event") o[f] = pick(r, [true, false]);
    else if (f === "includeVat") o[f] = false;
    else if (f === "id") o[f] = "id-other";
    else if (["notes", "weather_impact", "exception_reason"].includes(f)) o[f] = pick(r, TEXT);
    else o[f] = pick(r, AMOUNTS);
    if (o[f] === undefined) delete o[f];
  }
  return o;
}
function pairs(seed, n) {
  const r = prng(seed), out = [];
  for (let i = 0; i < n; i++) { const p = row(r); out.push([p, r() < 0.15 ? row(r) : mutate(r, p)]); }
  return out;
}

// ── oracles straight from the core's own output (no fingerprint restated) ────
const ser = (m) => ({ presence: m.presence, partial: m.partial, value: m.value === null ? null : F.finance.decimal.serializeDec(m.value) });
function normalizedFacts(rowObj) {
  const n = F.finance.normalize.normalizeRows([rowObj], { asOfBusinessDate: D }).rows[0];
  return {
    parts: [ser(n.revenueParts.sales), ser(n.revenueParts.deliveries), ser(n.revenueParts.otherIncome)],
    purchases: { source: n.purchaseSource, total: ser(n.metrics.purchases), contributions: n.purchaseContributions.map((c) => [c.source, F.finance.decimal.serializeDec(c.value)]) },
    hourlyLabor: ser(n.metrics.hourlyLabor), otherExpense: ser(n.metrics.otherExpense), isException: n.isException,
  };
}
function canonicalDayFacts(rowObj) {
  const n = F.finance.normalize.normalizeRows([rowObj], { asOfBusinessDate: D });
  const day = F.finance.normalize.dayToJson(F.finance.normalize.groupByDate(n.rows, { from: D, to: D })[0]);
  return { revenue: day.revenue, purchases: day.purchases, hourlyLabor: day.hourlyLabor, otherExpense: day.otherExpense, exception: day.exception.isException };
}

test("C2-T01 parity: for 200 (prev, next) pairs financialChanged equals the normalizeRows comparison and the canonical-day comparison", () => {
  const P = pairs(20261002, 200);
  let yes = 0, no = 0;
  for (const [prev, next] of P) {
    const got = changed(prev, next);
    const byRows = !isDeepStrictEqual(normalizedFacts(prev), normalizedFacts(next));
    const byDay = !isDeepStrictEqual(canonicalDayFacts(prev), canonicalDayFacts(next));
    assert.equal(got.changed, byRows, "normalizeRows oracle: " + JSON.stringify([prev, next]));
    assert.equal(got.changed, byDay, "groupByDate (server canonical day) oracle: " + JSON.stringify([prev, next]));
    // changed ⇔ the fingerprints differ, and the reasons are exactly non-empty when changed
    assert.equal(got.changed, C2.financialFingerprint(F, prev) !== C2.financialFingerprint(F, next));
    assert.equal(got.reasons.length > 0, got.changed);
    for (const x of got.reasons) assert.ok(C2.REASONS.includes(x), x);
    if (got.changed) yes++; else no++;
  }
  assert.ok(yes >= 40 && no >= 40, `the generator exercises both outcomes (changed ${yes}, unchanged ${no})`);
});

test("C2-T01b the fingerprint is the core's: a differently seeded batch, the bundle versions and the block's own text", () => {
  for (const [prev, next] of pairs(7, 200)) assert.equal(changed(prev, next).changed, !isDeepStrictEqual(normalizedFacts(prev), normalizedFacts(next)));
  assert.match(C2.financialFingerprint(F, { date: D, sales: "1" }), /^MARJIN_FFP\/1\|MARJIN_NORM\/3\|/);
  const src = c2Source(HTML);
  assert.ok(src.includes("F.finance.normalize.normalizeRows("), "delegates to the core normalizer");
  for (const forbidden of [/Number\(/, /parseFloat/, /parseInt/, /isFinite/, /\breplace\(/, /hourly_payroll/, /\brow\s*[.[]/, /\bprev\s*[.[]/, /\bnext\s*[.[]/]) {
    assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ""), forbidden, "no page-side amount parsing or field formula: " + forbidden);
  }
});

test("C2-T02 hourly_payroll-only edits never change the fingerprint (VD-46: never counted, C-06)", () => {
  const base = { id: "a", date: D, sales: "1000", payroll: "300", supplier_payments: { s1: "200" } };
  for (const [a, b] of [[undefined, { e1: "80" }], [{ e1: "80" }, { e1: "95" }], [{ e1: "80" }, {}], [{}, "bad"], [{ e1: "80" }, { e1: "oops", e2: "4" }]]) {
    const prev = a === undefined ? { ...base } : { ...base, hourly_payroll: a };
    assert.deepEqual(changed(prev, { ...base, hourly_payroll: b }), { changed: false, reasons: [] }, JSON.stringify([a, b]));
  }
});

test("C2-T03 supplier \"0\" ↔ \"skip\" (and 0) are the same explicit present zero; absent is different", () => {
  const b = (v) => ({ id: "a", date: D, sales: "500", supplier_payments: v === undefined ? {} : { s1: v } });
  assert.equal(changed(b("0"), b("skip")).changed, false);
  assert.equal(changed(b("skip"), b(0)).changed, false);
  assert.equal(changed(b(0), b("0.00")).changed, false);
  assert.deepEqual(changed(b(undefined), b("skip")), { changed: true, reasons: ["purchases"] }, "absent → explicit zero is a recorded fact");
  assert.deepEqual(changed(b("skip"), b("")), { changed: true, reasons: ["purchases"] }, "explicit zero → absent");
});

test("C2-T04 purchases change only when the canonical purchases change (supplier value; food_cost behind a supplier map)", () => {
  const withSup = (s1, food) => ({ id: "a", date: D, sales: "500", supplier_payments: { s1 }, ...(food === undefined ? {} : { food_cost: food }) });
  assert.deepEqual(changed(withSup("100"), withSup("120")), { changed: true, reasons: ["purchases"] });
  assert.deepEqual(changed(withSup("100", "40"), withSup("100", "45")), { changed: false, reasons: [] }, "food_cost is not the selected source while a supplier amount is recorded");
  assert.deepEqual(changed(withSup("100"), withSup("100.0")), { changed: false, reasons: [] }, "the same exact amount");
  const food = (v) => ({ id: "a", date: D, sales: "500", food_cost: v });
  assert.deepEqual(changed(food("40"), food("45")), { changed: true, reasons: ["purchases"] }, "legacy food_cost is the selected source when no supplier amount is recorded");
  assert.deepEqual(changed(food("40"), { ...food("40"), supplier_payments: { s1: "40" } }), { changed: true, reasons: ["purchases"] }, "the selected source changes (legacy → supplier) even at the same total");
});

test("C2-T05 notes and every other annotation are not financial facts", () => {
  const base = { id: "a", date: D, sales: "100", is_exception: false };
  for (const extra of [{ notes: "x" }, { weather_impact: "rain" }, { exception_reason: "holiday" }, { exception_note: "n" }, { security_event: true }, { id: "b" }, { includeVat: false }, { unknown_field: 1 }]) {
    assert.deepEqual(changed(base, { ...base, ...extra }), { changed: false, reasons: [] }, JSON.stringify(extra));
  }
});

test("C2-T06 an is_exception toggle changes the fingerprint (reason is_exception)", () => {
  const base = { id: "a", date: D, sales: "100" };
  assert.deepEqual(changed(base, { ...base, is_exception: true }), { changed: true, reasons: ["is_exception"] });
  assert.deepEqual(changed({ ...base, is_exception: true }, { ...base, is_exception: false }), { changed: true, reasons: ["is_exception"] });
  assert.deepEqual(changed({ ...base, is_exception: false }, base), { changed: false, reasons: [] }, "false and absent are the same fact (normalizer: === true)");
});

test("C2-T08 revenue: presence and exact canonical strings per part", () => {
  const r = (o) => ({ id: "a", date: D, ...o });
  assert.deepEqual(changed(r({ sales: "100" }), r({ sales: 100 })), { changed: false, reasons: [] }, "numeric string ≡ number");
  assert.deepEqual(changed(r({ sales: "100" }), r({ sales: "1,00" })), { changed: true, reasons: ["revenue"] }, "valid → invalid cell");
  assert.deepEqual(changed(r({ sales: "" }), r({ sales: "0" })), { changed: true, reasons: ["revenue"] }, "absent → explicit 0 (TI-14 presence)");
  assert.deepEqual(changed(r({ sales: "100", deliveries: "0" }), r({ sales: "0", deliveries: "100" })), { changed: true, reasons: ["revenue"] }, "same total, different parts");
  assert.deepEqual(changed(r({ sales: "0.1" }), r({ sales: "0.10" })), { changed: false, reasons: [] }, "exact canonical decimal");
  assert.deepEqual(changed(r({ payroll: "300" }), r({ payroll: "301" })), { changed: true, reasons: ["hourly_labor"] });
  assert.deepEqual(changed(r({ other_expense: "5" }), r({ other_expense: "" })), { changed: true, reasons: ["other_expense"] });
});

test("C2-T09 decisions taken without comparing facts: new entry, core not ready, unreadable row", () => {
  assert.deepEqual(changed(null, { date: D }), { changed: true, reasons: ["new_entry"] });
  assert.deepEqual(json(C2.financialChanged(null, { date: D, sales: "1" }, { date: D, sales: "1" })), { changed: true, reasons: ["fincore_unavailable"] }, "never skips a rebuild it cannot evaluate");
  assert.deepEqual(changed({ date: D, sales: "1" }, { date: "2026-02-30", sales: "1" }), { changed: true, reasons: ["row_unreadable"] });
  assert.deepEqual(changed({ date: D, sales: "1" }, "not-a-row"), { changed: true, reasons: ["row_unreadable"] });
  assert.equal(C2.financialFacts(F, { date: "bad" }), null);
  assert.match(C2.financialFingerprint(F, { date: "bad" }), /\|unreadable$/);
  // a future-dated row is still a row (asOf does not quarantine the fingerprint)
  assert.notEqual(C2.financialFacts(F, { date: "2099-01-01", sales: "1" }), null);
  assert.deepEqual(json(C2.REASONS), ["new_entry", "fincore_unavailable", "row_unreadable", "revenue", "purchases", "hourly_labor", "other_expense", "is_exception"]);
  assert.ok(Object.isFrozen(C2) && Object.isFrozen(C2.REASONS));
});

// ── C2-T07 lifecycle: the production save call site drives the decision ─────
const ID = mkId("c2-row");
const STORED = () => ({ id: ID, date: "2026-08-01", sales: 100, deliveries: 0, other_income: 0, payroll: 300, supplier_payments: { s1: "0" }, hourly_payroll: { e1: "80" }, notes: "a" });
async function save(form, opts = {}) {
  const e = makeUiEnv({ form, editingDate: "2026-08-01", ...opts });
  e.at("T1", "A").seed([STORED()]);
  e.attach(); e.hydrate(); e.reset();
  await e.saveEntry();
  await settleAll();
  return e;
}
test("C2-T07 lifecycle: through the production saveEntry → executeEntrySave call site, only canonical changes rebuild", async () => {
  const base = STORED();
  const cases = [
    ["hourly_payroll-only edit", { ...base, hourly_payroll: { e1: "95" } }, false],
    ["notes-only edit", { ...base, notes: "b" }, false],
    ['supplier "0" → "skip"', { ...base, supplier_payments: { s1: "skip" } }, false],
    ["numeric string for the same amount", { ...base, sales: "100" }, false],
    ["sales change", { ...base, sales: 101 }, true],
    ["supplier value change", { ...base, supplier_payments: { s1: "40" } }, true],
    ["payroll change", { ...base, payroll: 301 }, true],
  ];
  for (const [label, form, rebuild] of cases) {
    const e = await save(form);
    assert.equal(e.state.saved, true, label + ": the save itself succeeds");
    assert.deepEqual(e.effects("rebuildInsights").length > 0, rebuild, label);
  }
});

test("C2-T07b lifecycle: the call site and injection are unchanged; a core that is not ready requests the rebuild", async () => {
  assert.ok(HTML.includes("  const __revenueMaterialChanged = io.materialChanged;"));
  assert.ok(HTML.includes("  const __revenueChanged = __revenueMaterialChanged(__prevEntry, netForm);"));
  assert.ok(HTML.includes("  const shouldRebuild = __revenueChanged || (__exResponse && __exResponse.applied === true && __exResponse.rebuildRequired === true);"));
  assert.ok(HTML.includes("        materialChanged: __revenueMaterialChanged,"));
  assert.equal(HTML.split("__revenueMaterialChanged(").length - 1, 1, "exactly one call");
  assert.ok(SOURCE.materialChanged.includes("window.MarjinC2.financialChanged(fin, prev, next).changed"));
  for (const st of ["loading", "failed"]) {
    const e = await save({ ...STORED(), notes: "b" }, { fincore: st });
    assert.ok(e.effects("rebuildInsights").length > 0, st + ": not evaluated ⇒ rebuild requested");
  }
});

test("C2-T06b lifecycle: an is_exception toggle rebuilds through the production call site (server rebuildRequired, and the fingerprint term)", async () => {
  const resp = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  const toggled = { ...STORED(), is_exception: true, exception_reason: "holiday" };
  const applied = await save(toggled, { apiFetch: resp({ ok: true, applied: true, rebuildRequired: true, exception: { status: "active", reasonCode: "holiday" }, revision: 1 }) });
  assert.ok(applied.effects("rebuildInsights").length > 0, "server-applied toggle rebuilds (unchanged behaviour)");
  const replayed = await save(toggled, { apiFetch: resp({ ok: true, applied: false, replayed: true, rebuildRequired: false, exception: { status: "active", reasonCode: "holiday" }, revision: 1 }) });
  assert.ok(replayed.effects("rebuildInsights").length > 0, "the fingerprint term alone also rebuilds (C2-TD-1: recorded, not decided here)");
});

// Recorded contract interaction (C2 handoff, OPEN_DECISIONS C2-TD-1): the call site compares the
// STORED row with the FORM (netForm). On a date governed by an ACTIVE structured exception the
// stored row carries no is_exception (CD-M2 strips it) while the form shows the structured state,
// so the fingerprints differ and an otherwise irrelevant save requests a rebuild. This pins the
// behaviour the unchanged call site produces, so a reviewer decision changes it visibly.
test("C2-T10 recorded interaction: a notes-only save on an active structured exception day requests a rebuild", () => {
  const stored = { id: "a", date: D, sales: "100" };
  const form = { ...stored, notes: "x", is_exception: true, exception_reason: "holiday", exception_note: "" };
  assert.deepEqual(changed(stored, form), { changed: true, reasons: ["is_exception"] });
  assert.deepEqual(changed({ ...stored, is_exception: true }, form), { changed: false, reasons: [] }, "legacy-flagged stored row: no rebuild");
});

test("C2 negative controls: the oracles detect a fingerprint that drops a fact or adds hourly_payroll / notes", () => {
  const variants = {
    drop_is_exception: (s) => s.replace('["isException", "is_exception"]]', "]").replace(', ["otherExpense", "other_expense"], ]', ', ["otherExpense", "other_expense"]]'),
    drop_parts: (s) => s.replace("revenue: { sales: exact(F, n.revenueParts.sales), deliveries: exact(F, n.revenueParts.deliveries), otherIncome: exact(F, n.revenueParts.otherIncome) },", "revenue: exact(F, n.metrics.revenue),"),
    drop_contributions: (s) => s.replace("contributions: n.purchaseContributions.map(", "contributions: [].map("),
    add_hourly: (s) => s.replace("isException: n.isException === true,", "isException: n.isException === true, hourly: [n.legacyHourlyPayroll.recorded].concat(n.legacyHourlyPayroll.entries.map(function (e) { return [e.employee, F.finance.decimal.serializeDec(e.value)]; })),").replace('["isException", "is_exception"]]', '["isException", "is_exception"], ["hourly", "hourly"]]'),
    add_notes: (s) => s.replace("isException: n.isException === true,", "isException: n.isException === true, notes: n.annotations.notes,").replace('["isException", "is_exception"]]', '["isException", "is_exception"], ["notes", "notes"]]'),
    no_presence: (s) => s.replace("return { presence: m.presence, partial: m.partial === true, value: m.value === null ? null : F.finance.decimal.serializeDec(m.value) };", 'return m.value === null ? "0" : F.finance.decimal.serializeDec(m.value);'),
  };
  for (const [name, mut] of Object.entries(variants)) {
    const html = mut(HTML);
    assert.notEqual(html, HTML, name + ": mutation applied");
    const M = loadC2(html);
    const P = [...pairs(20261002, 200), ...pairs(7, 200)];
    const wrong = P.filter(([a, b]) => M.financialChanged(F, a, b).changed !== !isDeepStrictEqual(normalizedFacts(a), normalizedFacts(b)));
    assert.ok(wrong.length > 0, name + " must be detected by the C2-T01 oracle");
  }
});

// ── FZ-11 (09_AGENT_DAILY_HANDOFF.md §1–§2): the fingerprint definition and reason codes ──────
// Daily's analytics-receipt input fingerprint must reuse this definition (no second one).
// The golden freezes keys and types (never values) plus the contract identifiers.
import { shapeOf, shapeDiff } from "../support/fz-shape.mjs";
const FZ11_PATH = join(REPO, "test/finance/goldens/fz-11.json");
const FZ11 = process.env.C2_FZ11_EMIT ? null : JSON.parse(readFileSync(FZ11_PATH, "utf8"));
const EXCLUDED = ["hourly_payroll", "notes", "weather_impact", "exception_reason", "exception_note", "security_event", "id", "includeVat"];
function fz11Live() {
  const samples = [...pairs(20261002, 200), ...pairs(7, 200)];
  const facts = samples.flat().map((r) => C2.financialFacts(F, r)).filter((x) => x !== null).map(json);
  const results = samples.map(([a, b]) => json(C2.financialChanged(F, a, b)))
    .concat([null, "fincore_unavailable", "row_unreadable"].map((k) => json(k === null ? C2.financialChanged(F, null, { date: D }) : k === "fincore_unavailable" ? C2.financialChanged(null, { date: D }, { date: D }) : C2.financialChanged(F, { date: D }, { date: "bad" }))));
  return {
    ids: {
      FINGERPRINT_VERSION: C2.FINGERPRINT_VERSION,
      normalizer: F.versions.norm,
      REASONS: json(C2.REASONS),
      facts: Object.keys(facts[0]),
      excluded: EXCLUDED,
    },
    shapes: {
      api: shapeOf([C2]),
      facts: shapeOf(facts),
      changed: shapeOf(results),
      fingerprint: shapeOf(samples.flat().map((r) => C2.financialFingerprint(F, r))),
    },
  };
}
test("FZ-11 golden: the live fingerprint definition, fact shape, result shape and reason codes equal test/finance/goldens/fz-11.json", () => {
  const live = fz11Live();
  assert.equal(FZ11.id, "FZ-11"); assert.equal(FZ11.owner, "C2");
  assert.deepEqual(live.ids, FZ11.ids, "contract identifiers");
  for (const k of Object.keys(FZ11.shapes)) assert.deepEqual(shapeDiff(FZ11.shapes[k], live.shapes[k]), [], "shape " + k);
  assert.deepEqual(Object.keys(live.shapes).sort(), Object.keys(FZ11.shapes).sort());
  for (const f of FZ11.ids.excluded) {
    const base = { id: "a", date: D, sales: "1", hourly_payroll: { e1: "1" }, notes: "a", weather_impact: "a", exception_reason: "a", exception_note: "a", security_event: false, includeVat: false };
    const other = { ...base, [f]: f === "hourly_payroll" ? { e1: "2" } : f === "security_event" ? true : f === "includeVat" ? undefined : "b" };
    assert.equal(C2.financialFingerprint(F, base), C2.financialFingerprint(F, other), "excluded field " + f);
  }
});
test("FZ-11 negative control: an added, removed or retyped fact key, or a changed reason code, fails the golden", () => {
  const live = fz11Live();
  const f = structuredClone(live.shapes.facts);
  const added = { ...f, hourly: "string" }, removed = { ...f }; delete removed.isException;
  const retyped = { ...f, isException: "string" };
  for (const [label, s] of [["added", added], ["removed", removed], ["retyped", retyped]]) assert.notDeepEqual(shapeDiff(FZ11.shapes.facts, s), [], label);
  assert.notDeepEqual({ ...live.ids, REASONS: [...live.ids.REASONS, "notes"] }, FZ11.ids);
});
