// P0-DATA-01 SERVER READERS — PREFLIGHT DUPLICATE-DATE REPORT (CTO D1, informational).
//
// The legacy→V2 preflight now REPORTS every business date carried by more than one row
// (`duplicateDates: [{date, ids}]`). It is an operator report only: it never blocks a
// conversion, never deletes, merges, reorders or picks a winner, and the report agrees
// exactly with the shared server reader's `duplicateDates()` so the operator sees the
// same dates the converged readers will refuse as `duplicate_business_date`.
//
// Run: node --test test/storage-v2/preflight-duplicates.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLegacyPreflight, PREFLIGHT_BLOCKERS } from "../../tools/storage-v2/preflight.mjs";
import { duplicateDates, readEntriesNode } from "../../lib/analytics/entriesReader.js";
import { FIXTURES, asLegacy, asV2, row, uuid, loadClientStorageV2 } from "../support/entries-fixtures.mjs";

const W = loadClientStorageV2();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
const deps = () => ({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId,
  isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r), entryDateKey: ME.entryDateKey,
  detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS });
const plain = (v) => JSON.parse(JSON.stringify(v));

test("no duplicates → empty report, conversion still ok", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  const rep = preflightLegacyNode(asLegacy(FIXTURES.F8_month));
  assert.equal(rep.ok, true);
  assert.deepEqual(rep.duplicateDates, []);
  assert.deepEqual(rep.blockers, []);
});

test("D1: duplicate business dates are REPORTED with sorted stable ids, never a blocker, never resolved", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  const raw = asLegacy(FIXTURES.F3_dup);
  const before = plain(raw);
  const rep = preflightLegacyNode(raw);
  assert.equal(rep.ok, true, "duplicate dates do not block conversion");
  assert.deepEqual(rep.blockers, []);
  assert.equal(rep.duplicateDates.length, 1);
  assert.equal(rep.duplicateDates[0].date, "2026-08-10");
  const expectIds = FIXTURES.F3_dup.filter((r) => r.date === "2026-08-10").map((r) => String(r.id)).sort();
  assert.deepEqual(rep.duplicateDates[0].ids, expectIds);
  assert.equal(rep.duplicateDates[0].ids.length, 2, "both rows are named — no winner");
  assert.equal(rep.rowCount, FIXTURES.F3_dup.length, "rowCount counts every row; nothing merged");
  assert.equal(rep.rows.length, FIXTURES.F3_dup.length, "rows returned for conversion keep both duplicates");
  assert.deepEqual(plain(raw), before, "input node untouched (pure)");
  assert.deepEqual(preflightLegacyNode(raw), rep, "deterministic");
});

test("report is sorted by date; ids sorted; three-way duplicates count once per date", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  const rows = [
    row("z1", "2026-09-03", { sales: 1 }), row("a1", "2026-09-01", { sales: 1 }),
    row("z2", "2026-09-03", { sales: 2 }), row("m1", "2026-09-02", { sales: 3 }),
    row("z3", "2026-09-03", { sales: 3 }), row("a2", "2026-09-01", { sales: 4 }),
  ];
  const rep = preflightLegacyNode(asLegacy(rows));
  assert.equal(rep.ok, true);
  assert.deepEqual(rep.duplicateDates.map((d) => d.date), ["2026-09-01", "2026-09-03"]);
  assert.deepEqual(rep.duplicateDates[0].ids, [uuid("a1"), uuid("a2")].sort());
  assert.deepEqual(rep.duplicateDates[1].ids, [uuid("z1"), uuid("z2"), uuid("z3")].sort());
});

test("report is present on BLOCKED legacy nodes too (informational alongside real blockers)", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  const rows = [...FIXTURES.F3_dup, { date: "2026-08-12", sales: 1 }]; // missing id → blocker
  const rep = preflightLegacyNode(asLegacy(rows));
  assert.equal(rep.ok, false);
  assert.ok(rep.blockers.some((b) => b.code === PREFLIGHT_BLOCKERS.MISSING_ENTRY_ID));
  assert.equal(rep.duplicateDates.length, 1);
  assert.equal(rep.duplicateDates[0].date, "2026-08-10");
});

test("preflight report agrees exactly with the shared server reader's duplicateDates()", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  for (const [name, rows] of Object.entries(FIXTURES)) {
    if (!Array.isArray(rows)) continue;
    const legacy = asLegacy(rows);
    const rep = preflightLegacyNode(legacy);
    if (rep.mode !== "legacy" || rep.rowCount === null) continue;
    const read = readEntriesNode(legacy);
    assert.equal(read.ok, true, name);
    assert.deepEqual(rep.duplicateDates, duplicateDates(read.rows), `reader/preflight agree: ${name}`);
    // and the converted (V2) form reads back to the same duplicate report
    const v2 = readEntriesNode(asV2(rows, { generation: 1 }));
    if (v2.ok) assert.deepEqual(duplicateDates(v2.rows), rep.duplicateDates, `v2 form agrees: ${name}`);
  }
});

test("already-V2 / absent / malformed nodes: no duplicate report is fabricated", () => {
  const { preflightLegacyNode } = createLegacyPreflight(deps());
  assert.equal(preflightLegacyNode(asV2(FIXTURES.F3_dup, { generation: 1 })).ok, false);
  assert.equal(preflightLegacyNode(asV2(FIXTURES.F3_dup, { generation: 1 })).duplicateDates, undefined);
  assert.equal(preflightLegacyNode(null).duplicateDates, undefined);
  assert.deepEqual(preflightLegacyNode(null).rows, []);
  assert.equal(preflightLegacyNode({ _v: "{not json" }).duplicateDates, undefined);
});
