// Alert checkers (CTO D2): storage access converged, externally NON-FIRING; no new persisted/emailed alerts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, ROOT, T, B } from "../support/server-reader-harness.mjs";
import { FIXTURES, asLegacy, asV2, malformedNodes, noFallbackNode, plain, row } from "../support/entries-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const CK = await srv.import("src/alerts/checkers.js");
const RN = await srv.import("src/alerts/runner.js");
const R = await import("../../lib/analytics/entriesReader.js");
const SRC = readFileSync(join(ROOT, "src/alerts/checkers.ts"), "utf8");
// The bait puts the anomalous payments on 2026-09-20; the checkers look back 28 days from
// "today" — shift the fixture so its last day is today (business-independent relative window).
const today = new Date().toISOString().slice(0, 10);
const shift = (rows) => { const last = rows[rows.length - 1].date; const delta = (new Date(today) - new Date(last)); return rows.map((r) => ({ ...r, date: new Date(new Date(r.date).getTime() + delta).toISOString().slice(0, 10) })); };
const BAIT = shift(FIXTURES.F9_anomaly_bait);

test("[D2 source pin] the kill-switch constant is false and both checkers return before any read", () => {
  assert.match(SRC, /export const ENTRIES_ANOMALY_CHECKS_ENABLED = false;/);
  for (const fn of ["checkSupplierAnomaly", "checkExpensiveEmployee"]) {
    const start = SRC.indexOf(`export async function ${fn}(`); assert.ok(start > 0, fn);
    const body = SRC.slice(start, SRC.indexOf("\n}\n", start));
    const guard = body.indexOf("if (!ENTRIES_ANOMALY_CHECKS_ENABLED) return alerts;"), read = body.indexOf("db.ref(");
    assert.ok(guard > 0 && read > guard, fn + ": the guard precedes the read");
    assert.ok(!body.includes("orderByKey"), fn + ": the dead date-key query is gone");
    assert.ok(body.includes("requireEntriesRows(") && body.includes("rowsInRange("), fn + ": converged read path prepared");
  }
  assert.equal(CK.ENTRIES_ANOMALY_CHECKS_ENABLED, false);
});
test("[D2 behaviour] anomaly bait in BOTH physical forms: zero supplier/employee alerts, no reads, no saveAlert, no digest", async () => {
  for (const node of [asLegacy(BAIT), asV2(BAIT, { keepV: true }), noFallbackNode().node, malformedNodes().rows_scalar]) {
    const db = installDb(makeDb()); seedBusiness(db, { entries: node });
    db.seed(`tenants/${T}/biz:${B}:suppliers`, { _v: JSON.stringify([{ id: "s1", name: "S1" }]) });
    let reads = 0; const origRef = db.ref; db.ref = (p) => { if (p.endsWith(":entries")) reads++; return origRef(p); };
    assert.deepEqual(await CK.checkSupplierAnomaly(T, B, { supplierDeviationPct: 30 }), []);
    assert.deepEqual(await CK.checkExpensiveEmployee(T, B, { employeeDeviationPct: 40 }), []);
    assert.equal(reads, 0, "no entries read while disabled (a malformed node cannot even throw)");
    const result = await RN.runAlertsForBiz(T, B);
    const saved = db.writes.filter((w) => w.op === "set" && w.path.includes("/alerts/"));
    assert.deepEqual(saved.filter((w) => /supplier_anomaly|expensive_employee/.test(w.path)), [], "no supplier/employee alert persisted");
    assert.deepEqual((globalThis.__EMAILS || []).filter((e) => e.kind === "digest" && e.alerts.some((a) => a.type === "supplier_anomaly" || a.type === "expensive_employee")), [], "no digest attributable to them");
    assert.deepEqual(result.errors.filter((e) => /^supplier:|^employee:/.test(e)), [], "and no error either — they are silent");
  }
});
test("[D2 prepared path — evidence only] with the constant flipped by module injection the converged read is dual-form equivalent and malformed-safe", async () => {
  const src = readFileSync(join(srv.dir, "src/alerts/checkers.js"), "utf8");
  assert.ok(src.includes("ENTRIES_ANOMALY_CHECKS_ENABLED = false"));
  const flipped = join(srv.dir, "src/alerts/checkers.__enabled__.js");
  writeFileSync(flipped, src.replace("ENTRIES_ANOMALY_CHECKS_ENABLED = false", "ENTRIES_ANOMALY_CHECKS_ENABLED = true"));
  const EN = await import(pathToFileURL(flipped).href);
  assert.equal(EN.ENTRIES_ANOMALY_CHECKS_ENABLED, true);
  const run = async (node) => { const db = installDb(makeDb()); seedBusiness(db, { entries: node }); db.seed(`tenants/${T}/biz:${B}:suppliers`, { _v: JSON.stringify([{ id: "s1", name: "S1" }]) });
    return { s: plain(await EN.checkSupplierAnomaly(T, B, { supplierDeviationPct: 30 })), e: plain(await EN.checkExpensiveEmployee(T, B, { employeeDeviationPct: 40 })) }; };
  const a = await run(asLegacy(BAIT)), b = await run(asV2(BAIT, { keepV: true }));
  assert.deepEqual(JSON.parse(JSON.stringify(b, (k, v) => (k === "firedAt" ? undefined : v))), JSON.parse(JSON.stringify(a, (k, v) => (k === "firedAt" ? undefined : v)))); assert.equal(a.s.length, 1); assert.equal(a.s[0].type, "supplier_anomaly"); assert.equal(a.e.length, 1); assert.equal(a.e[0].context.employeeId, "e1");
  const db = installDb(makeDb()); seedBusiness(db, { entries: malformedNodes().gen_mismatch });
  await assert.rejects(() => EN.checkSupplierAnomaly(T, B, { supplierDeviationPct: 30 }), (e) => R.isEntriesStorageError(e), "malformed → typed error (would be caught per checker by the runner)");
});
