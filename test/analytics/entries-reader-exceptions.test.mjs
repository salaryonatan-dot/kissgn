// listEntryExceptions: structured-first; legacy fallback through the shared reader; D1 legacy_ambiguous; D3 typed failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, seedBusiness, T, B } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, plain, uuid, row } from "../support/entries-fixtures.mjs";
import { buildEffectiveRecord, LEGACY_AMBIGUOUS, resolveEffectiveException } from "../../lib/entryExceptions.js";

const srv = compileServer();
const EX = await srv.import("lib/repositories/entryExceptionsRepo.js");
const R = await import("../../lib/analytics/entriesReader.js");
const list = (from = "2026-08-01", to = "2026-08-31") => EX.listEntryExceptions({ tenantId: T, bizId: B, fromDate: from, toDate: to });
async function withNode(node, structured = {}) { const db = installDb(makeDb()); seedBusiness(db, { entries: node }); for (const [d, env] of Object.entries(structured)) db.seed(`tenants/${T}/entry_exceptions/${B}/${d}`, env); return db; }

test("equivalence: embedded exception fallback identical from `_v` and rows; structured state authoritative in both", async () => {
  const structured = { "2026-08-02": { state: { status: "active", reasonCode: "storm", reasonText: "סופה", revision: 3 } }, "2026-08-03": { state: { status: "cleared", revision: 1 } } };
  await withNode(asLegacy(FIXTURES.F7_exceptions), structured); const a = plain(await list());
  await withNode(asV2(FIXTURES.F7_exceptions, { keepV: true }), structured); const b = plain(await list());
  assert.deepEqual(b, a);
  assert.equal(a["2026-08-01"].source, "legacy"); assert.equal(a["2026-08-01"].reasonCode, "holiday"); assert.equal(a["2026-08-01"].reasonText, "חג");
  assert.equal(a["2026-08-02"].source, "structured"); assert.equal(a["2026-08-02"].status, "active");
  assert.equal(a["2026-08-03"].source, "structured"); assert.equal(a["2026-08-03"].status, "cleared");
  assert.equal(a["2026-08-04"], undefined, "pure-normal days omitted");
  await withNode(null); assert.deepEqual(await list(), {}); await withNode(asV2([])); assert.deepEqual(await list(), {});
  const only = await withNode(asV2([]), structured); assert.deepEqual(Object.keys(plain(await list())).sort(), ["2026-08-02", "2026-08-03"], "structured-only days still listed");
});
test("NO-FALLBACK poison: rows say no exception, stale `_v` says exception → no entry; rows win", async () => {
  const { node } = noFallbackNode(); await withNode(node);
  const out = plain(await list());
  assert.equal(out["2026-08-12"], undefined, "the stale `_v` row (is_exception:true) is never seen"); assert.deepEqual(out, {});
});
test("D1: two rows on one date → source/origin legacy_ambiguous with duplicate metadata, never first/last; structured still wins", async () => {
  const dupFlagged = [row("f3a", "2026-08-10", { sales: "1", is_exception: true, exception_reason: "a" }), row("f3b", "2026-08-10", { sales: "2" }), row("f3c", "2026-08-11", { sales: "3", is_exception: true, exception_reason: "c" })];
  for (const node of [asLegacy(dupFlagged), asLegacy(dupFlagged.slice().reverse()), asV2(dupFlagged), asV2(dupFlagged, { shuffleKeys: false })]) {
    await withNode(node); const out = plain(await list());
    assert.deepEqual(out["2026-08-10"], { businessDate: "2026-08-10", source: "legacy_ambiguous", origin: "legacy_ambiguous", status: "normal", reasonCode: null, reasonText: null, revision: 0, structured: false, duplicateCount: 2, duplicateIds: [uuid("f3a"), uuid("f3b")].sort() });
    assert.equal(out["2026-08-11"].source, "legacy"); assert.equal(out["2026-08-11"].reasonCode, "c");
  }
  await withNode(asV2(dupFlagged), { "2026-08-10": { state: { status: "active", reasonCode: "storm", revision: 1 } } });
  const s = plain(await list()); assert.equal(s["2026-08-10"].source, "structured"); assert.equal(s["2026-08-10"].reasonCode, "storm");
  // the pure builder
  assert.equal(buildEffectiveRecord("d", null, { [LEGACY_AMBIGUOUS]: true, count: 2, ids: ["a", "b"] }).source, "legacy_ambiguous");
  assert.equal(buildEffectiveRecord("d", { state: { status: "cleared" } }, { [LEGACY_AMBIGUOUS]: true, count: 2, ids: [] }).source, "structured");
  assert.deepEqual(resolveEffectiveException(null, { is_exception: true }).origin, "legacy", "resolver untouched");
});
test("MALFORMED V2: typed EntriesStorageError (→ the API's list_failed boundary); never `_v`", async () => {
  for (const [name, node] of Object.entries(malformedNodes())) {
    await withNode(node, { "2026-08-02": { state: { status: "active", revision: 1 } } });
    await assert.rejects(() => list(), (e) => R.isEntriesStorageError(e) && e.site === "entryExceptionsRepo.listEntryExceptions", name);
  }
});
test("range boundaries inclusive; ledger never exposed", async () => {
  await withNode(asV2(FIXTURES.F7_exceptions), { "2026-08-05": { state: { status: "active", revision: 2 }, operations: { op1: { secret: 1 } } } });
  const out = plain(await list("2026-08-01", "2026-08-01")); assert.deepEqual(Object.keys(out), ["2026-08-01"]);
  const wide = plain(await list("2026-08-05", "2026-08-05")); assert.equal(wide["2026-08-05"].operations, undefined); assert.equal(JSON.stringify(wide).includes("secret"), false);
});
