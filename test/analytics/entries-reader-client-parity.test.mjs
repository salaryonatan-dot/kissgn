// The server reader is a mirror of the browser's MarjinStorageV2.readEntriesNode — pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../lib/analytics/entriesReader.js";
import { FIXTURES, asLegacy, asV2, noFallbackNode, malformedNodes, loadClientStorageV2, plain } from "../support/entries-fixtures.mjs";

const client = loadClientStorageV2().MarjinStorageV2;
const norm = (r) => { const o = plain(r); if (o.ok) return { ok: true, mode: o.mode, rows: o.rows, generation: o.generation }; return { ok: false, mode: o.mode, status: o.status, reason: o.reason, key: o.key }; };
const clientNorm = (raw) => { const r = client.readEntriesNode(raw); const o = plain(r); return r.status ? { ok: false, mode: o.mode, status: o.status, reason: o.reason, key: o.key } : { ok: true, mode: o.mode, rows: o.rows, generation: o.generation === undefined ? null : o.generation }; };

test("parity for every fixture in both forms, absent, cleared, poison and malformed", () => {
  const cases = [null, { schemaVersion: 2, generation: 3 }, { _v: "[]" }, noFallbackNode().node, ...Object.values(malformedNodes()), 5, "[]", [{ id: "x", date: "2026-01-01" }]];
  for (const rows of Object.values(FIXTURES)) { cases.push(asLegacy(rows)); cases.push(asV2(rows, { generation: 2, keepV: true })); }
  let n = 0;
  for (const raw of cases) { assert.deepEqual(norm(R.readEntriesNode(raw)), clientNorm(raw), JSON.stringify(raw).slice(0, 120)); n++; }
  assert.ok(n >= 30);
});
test("the browser's ROW_GEN_KEY and id contract are the server's", () => {
  assert.equal(R.ROW_GEN_KEY, client.ROW_GEN_KEY); assert.equal(R.ENTRIES_STORAGE_V2, client.STORAGE_V2);
  assert.equal(R.isGenerationEpoch(1), client.isGenerationToken(1)); assert.equal(R.isGenerationEpoch("1"), client.isGenerationToken("1"));
});
