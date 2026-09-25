// Marjin — CANARY TOOLING readers: the approved server readers over captured snapshots in a
// deny-write sandbox (CT-16, CT-22, CT-36): no writes, no sends, no network; legacy ≡ V2; poisoned
// `_v` changes nothing (no fallback); malformed V2 surfaces as a typed error; no job entry points.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../../tools/storage-v2/canary-readers.mjs";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import * as X from "../support/canary-fixtures.mjs";

const snap = (entries, over = {}) => ({ entries, config: { _v: JSON.stringify({ businessName: X.NAME, lat: 32.1, lon: 34.8 }) }, fixed: { _v: JSON.stringify([{ name: "rent", amount: "3000" }]) }, suppliers: null, exceptions: { "2026-09-03": { state: { status: "active", reasonCode: "holiday", reasonText: "חג", revision: 1 } } }, businessName: X.NAME, ...over });
const run = (entries, over) => R.runReaders({ tenantId: X.T, bizId: X.B, snapshot: snap(entries, over), dates: ["2026-09-02", "2026-09-03"], nowIso: "2026-09-25T10:00:00Z" });

test("sandbox denies writes, records emails without sending, and fetch is offline (CT-36)", async () => {
  const db = R.denyWriteDb();
  for (const op of ["set", "update", "remove", "transaction"]) await assert.rejects(async () => db.ref("x")[op]({}), (e) => e.code === "deny_write" && e.exitCode === 12, op);
  await assert.rejects(async () => db.ref("a").child("b").set(1), (e) => e.code === "deny_write");
  const out = await run(X.asLegacy(X.LEGACY_ROWS()));
  assert.deepEqual(out.errors, {}); assert.equal(out.meta.emails, 0);
  await assert.rejects(() => fetch("https://example.invalid"), /offline|fetch failed|ENOTFOUND|ECONNREFUSED/i);
  const src = readFileSync(new URL("../../tools/storage-v2/canary-readers.mjs", import.meta.url), "utf8");
  const imported = [...src.matchAll(/["']((?:src|lib)\/[^"']+\.js)["']/g)].map((x) => x[1]);
  assert.ok(imported.length >= 7, JSON.stringify(imported));
  for (const p of imported) assert.ok(!/api\/|jobs?\/|cron|proactive\/run|alerts\/run|snapshot\/send|mailer|email/i.test(p), "no job entry point: " + p);
});

test("legacy and V2 forms of the same rows give identical reader outputs; full-precision numbers reported as strings (CT-16)", async () => {
  const rows = X.LEGACY_ROWS(); rows[1].sales = "250.10"; rows[1].hourly_payroll = [{ name: "עובד", hours: "3.5", rate: "45.5" }];
  const a = await run(X.asLegacy(rows)), b = await run(X.asV2(rows, { keepV: true }));
  assert.deepEqual(a.errors, {}); assert.deepEqual(b.errors, {});
  assert.deepEqual(C.compareReaders({ baseline: a.outputs, post: b.outputs }).map((f) => f.code), ["reader_parity"]);
  assert.equal(a.outputs.latestDate, "2026-09-03"); assert.equal(a.outputs.daily.length, 3);
  assert.ok(Object.values(a.numberStrings).some((v) => v === "250.1"), "numbers carry their roundtrip strings");
  assert.ok(a.outputs.dailyBuilder["2026-09-02"].undefinedPaths.every((p) => p.startsWith("$.meta.location")), "only offline enrichment is undefined: " + JSON.stringify(a.outputs.dailyBuilder["2026-09-02"].undefinedPaths));
  assert.equal(a.outputs.dailyBuilder["2026-09-03"].doc.is_exception, true, "entry exception applied by the real builder");
  assert.equal(typeof a.outputs.snapshot, "object"); assert.ok(Object.keys(a.outputs.exceptions).length >= 1);
});

test("poisoned `_v` on a V2 node changes nothing (no fallback); malformed V2 surfaces as a typed error ⇒ STOP (CT-22)", async () => {
  const rows = X.LEGACY_ROWS();
  const clean = await run(X.asV2(rows, { keepV: true })), poisoned = await run(X.asV2(rows, { poisonV: JSON.stringify([X.row("ghost", "2026-01-01", { sales: "99999" })]) }));
  assert.deepEqual(C.deepDiff(clean.outputs, poisoned.outputs), []);
  const noV = await run(X.asV2(rows)); assert.deepEqual(C.deepDiff(clean.outputs, noV.outputs), []);
  const bad = await run({ schemaVersion: 2, generation: 1, rows: { junk: { id: "junk" } }, _v: "[]" });
  assert.ok(Object.keys(bad.errors).length > 0, "malformed V2 must not silently read as empty: " + JSON.stringify(bad.outputs.daily));
  const f = C.compareReaders({ baseline: clean.outputs, post: bad.outputs }); assert.ok(f.some((x) => x.level === "STOP"));
  const absent = await run(null); assert.deepEqual(absent.errors, {}); assert.deepEqual(absent.outputs.daily, []);
});
