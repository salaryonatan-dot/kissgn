// Server-side entries reader — decision table, invariants and the D1 ambiguity contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../lib/analytics/entriesReader.js";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, plain, uuid, row } from "../support/entries-fixtures.mjs";

const logical = (rows) => plain(rows).map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort()))).sort();

test("decision table: absent / legacy / v2 / malformed", () => {
  assert.deepEqual(R.readEntriesNode(null), { ok: true, mode: "absent", rows: [], generation: null });
  assert.deepEqual(R.readEntriesNode(undefined), { ok: true, mode: "absent", rows: [], generation: null });
  const rows = FIXTURES.F2_multi;
  const legacy = R.readEntriesNode(asLegacy(rows));
  assert.equal(legacy.ok, true); assert.equal(legacy.mode, "legacy"); assert.equal(legacy.generation, null);
  assert.deepEqual(plain(legacy.rows), plain(rows), "legacy array verbatim — no sort, no dedupe");
  const v2 = R.readEntriesNode(asV2(rows, { generation: 4 }));
  assert.equal(v2.ok, true); assert.equal(v2.mode, "v2"); assert.equal(v2.generation, 4);
  assert.deepEqual(logical(v2.rows), logical(rows.map((r) => plain(r))), "same logical rows");
  assert.deepEqual(v2.rows.map((r) => r.date), ["2026-08-01", "2026-08-02", "2026-09-03", "2026-09-04", "2026-09-05"], "deterministic (date,id) output order");
  for (const r of v2.rows) assert.equal(r._gen, undefined, "reserved stamp stripped");
  assert.deepEqual(R.readEntriesNode({ schemaVersion: 2, generation: 2 }), { ok: true, mode: "v2", rows: [], generation: 2 }, "cleared collection");
  assert.deepEqual(R.readEntriesNode({ _v: "[]" }), { ok: true, mode: "legacy", rows: [], generation: null });
  assert.deepEqual(R.readEntriesNode(rows.slice(0, 1)).mode, "legacy", "bare array is legacy");
  for (const [name, node] of Object.entries(malformedNodes())) {
    const r = R.readEntriesNode(node);
    assert.equal(r.ok, false, name); assert.ok(r.status === "malformed_v2" || r.status === "malformed_storage", name); assert.ok(r.reason, name);
    assert.equal(r.rows, undefined, name + ": no rows handed out");
  }
  assert.equal(R.readEntriesNode(malformedNodes().rows_scalar).reason, "rows_not_a_map");
  assert.equal(R.readEntriesNode(malformedNodes().gen_mismatch).reason, "row_generation_mismatch");
  assert.equal(R.readEntriesNode(malformedNodes().stripped_marker).reason, "v2_structure_without_schema_version");
  assert.equal(R.readEntriesNode(malformedNodes().unsupported_schema).reason, "unsupported_schema_version");
  assert.equal(R.readEntriesNode(malformedNodes().legacy_unparseable).reason, "legacy_unparseable");
  assert.equal(R.readEntriesNode(5).ok, false); assert.equal(R.readEntriesNode(true).ok, false); assert.equal(R.readEntriesNode({ _v: 5 }).ok, false);
});
test("once schemaVersion === 2 the frozen `_v` is never read — poison and malformed alike", () => {
  const { node, current } = noFallbackNode();
  const bad = malformedNodes();
  const poisonStrings = new Set([node._v, ...Object.values(bad).filter((n) => n.schemaVersion === 2 || n.rows).map((n) => n._v)]);
  const seen = []; const origParse = JSON.parse;
  JSON.parse = function (s, ...a) { seen.push(s); return origParse.call(this, s, ...a); };
  let r, results;
  try {
    r = R.readEntriesNode(node);
    results = Object.entries(bad).map(([name, n]) => [name, R.readEntriesNode(n)]);
  } finally { JSON.parse = origParse; }
  assert.equal(r.ok, true); assert.deepEqual(logical(r.rows), logical(current)); assert.equal(r.rows.find((x) => x.date === "2026-08-10").sales, "555");
  for (const [name, m] of results) { assert.equal(m.ok, false, name); assert.equal(m.rows, undefined, name); }
  assert.deepEqual(seen.filter((s) => poisonStrings.has(s)), [], "JSON.parse was never called on a V2 node's `_v`");
  assert.ok(seen.includes("not json"), "the LEGACY malformed blob is parsed (and refused) — the spy works");
  assert.throws(() => R.requireEntriesRows(node.rows ? { ...node, rows: "x" } : node), (e) => R.isEntriesStorageError(e) && e.status === "malformed_v2" && e.reason === "rows_not_a_map");
});
test("metadata never becomes a row; immutable ids and duplicate dates are preserved", () => {
  const rows = FIXTURES.F3_dup;
  for (const form of [asLegacy(rows), asV2(rows, { keepV: true })]) {
    const r = R.readEntriesNode(form);
    assert.equal(r.rows.length, 3); assert.equal(r.rows.filter((x) => x.date === "2026-08-10").length, 2, "both duplicate rows kept");
    assert.deepEqual(r.rows.map((x) => x.id).sort(), rows.map((x) => x.id).sort());
    for (const x of r.rows) { assert.equal(x.schemaVersion, undefined); assert.equal(x.generation, undefined); assert.equal(x._v, undefined); assert.equal(x._gen, undefined); }
  }
});
test("rowForDate: 0 → absent, 1 → single, >1 → ambiguous; never a winner", () => {
  const rows = R.readEntriesNode(asV2(FIXTURES.F3_dup)).rows;
  assert.deepEqual(R.rowForDate(rows, "2026-08-12"), { status: "absent", row: null });
  assert.equal(R.rowForDate(rows, "2026-08-11").status, "single"); assert.equal(R.rowForDate(rows, "2026-08-11").row.sales, "700");
  const amb = R.rowForDate(rows, "2026-08-10");
  assert.equal(amb.status, "ambiguous"); assert.equal(amb.row, null); assert.equal(amb.count, 2);
  assert.deepEqual(amb.ids, [uuid("f3a"), uuid("f3b")].sort());
  // order of the input never changes the verdict (no first/last/uuid winner)
  assert.deepEqual(R.rowForDate(rows.slice().reverse(), "2026-08-10"), amb);
  assert.deepEqual(R.rowForDate(R.readEntriesNode(asLegacy(FIXTURES.F3_dup.slice().reverse())).rows, "2026-08-10"), amb);
  assert.throws(() => R.requireRowForDate(rows, "2026-08-10", { tenantId: "T", bizId: "B", site: "t" }),
    (e) => R.isEntriesAmbiguityError(e) && e.status === "duplicate_business_date" && e.date === "2026-08-10" && e.count === 2 && e.ids.length === 2 && e.tenantId === "T" && e.site === "t");
  assert.equal(R.requireRowForDate(rows, "2026-08-11").sales, "700"); assert.equal(R.requireRowForDate(rows, "2026-08-12"), null);
  assert.equal(R.isEntriesReadError(new R.EntriesAmbiguityError({ date: "x", count: 2, ids: [] })), true);
  assert.equal(R.isEntriesReadError(new Error("x")), false);
});
test("rowsInRange keeps every row (no collapse); duplicateDates reports dates + stable ids", () => {
  const rows = R.readEntriesNode(asLegacy(FIXTURES.F3_dup)).rows;
  assert.equal(R.rowsInRange(rows, "2026-08-10", "2026-08-10").length, 2);
  assert.equal(R.rowsInRange(rows, "2026-08-11", "2026-08-31").length, 1);
  assert.equal(R.rowsInRange([{ id: "x" }, ...rows], "2026-08-01", "2026-08-31").length, 3, "date-less rows are not in any range");
  assert.deepEqual(R.duplicateDates(rows), [{ date: "2026-08-10", ids: [uuid("f3a"), uuid("f3b")].sort() }]);
  assert.deepEqual(R.duplicateDates(FIXTURES.F2_multi), []);
  assert.deepEqual(R.duplicateDates([row("x", "2026-01-01"), { date: "2026-01-01" }]), [{ date: "2026-01-01", ids: [uuid("x"), null] }], "an id-less legacy row is reported as null");
});
test("requireEntriesRows attaches context and typed status", () => {
  assert.throws(() => R.requireEntriesRows({ _v: "nope" }, { tenantId: "T", bizId: "B", site: "s" }),
    (e) => R.isEntriesStorageError(e) && e.status === "malformed_storage" && e.reason === "legacy_unparseable" && e.bizId === "B");
  assert.throws(() => R.requireEntriesRows(malformedNodes().bad_key), (e) => e.status === "malformed_v2" && e.reason === "row_key_not_canonical_id" && e.key === "row-1");
  assert.deepEqual(R.requireEntriesRows(null), []);
});
