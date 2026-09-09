// P0-DATA-01 R10 — ENTRY-ID DATA CONTRACT + PURE MIGRATION TRANSFORMER.
// Offline only. No Firebase, no RTDB, no network, no runner, no automatic trigger.
// Exercises the ACTUAL production functions vm-extracted from index.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createOfflineEntryIdTransformer } from "../support/entries-id-offline-transformer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
function load() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity");
  const f = html.indexOf("window.MarjinSaveLifecycle = Object.freeze({", start);
  const sb = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate, Uint8Array };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sb);
  return sb.window.MarjinSaveLifecycle;
}
const ML = load();
// The transformer lives OUTSIDE the runtime. It is handed the real runtime contract
// helpers, so it can never drift from production semantics.
const T = createOfflineEntryIdTransformer({
  contentFingerprint: ML.contentFingerprint, isValidEntryId: ML.isValidEntryId,
  isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r),
});
const plain = (x) => JSON.parse(JSON.stringify(x));
// Deterministic canonical UUID v4 values for tests (version 4, variant 8).
const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid4 = (seed) => { const a = __hash("a" + seed), b = __hash("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
const ID = (n) => uuid4("mig" + n);
const row = (date, sales, extra = {}) => ({ date, sales, ...extra });

// ── data contract ────────────────────────────────────────────────────────────
test("[contract] id validity: collision-resistant string required; date/index/counter rejected", () => {
  assert.equal(ML.isValidEntryId("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true, "canonical v4 accepted");
  assert.equal(ML.isValidEntryId(ID(1)), true);
  assert.equal(ML.isValidEntryId(ML.generateEntryId({ randomUUID: () => "3f2504e0-4f89-41d3-9a0c-0305e82c3301" })), true);
  const bad = ["", "   ", null, undefined, 0, 12345, "12345678901234567890", "2026-08-01",
    "2026-08-01T00:00:00.000Z", "short", {}, [],
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",                 // wrong version + variant
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",                 // v1, not v4
    "3f2504e0-4f89-41d3-ca0c-0305e82c3301",                 // invalid variant nibble
    "3F2504E0-4F89-41D3-9A0C-0305E82C3301",                 // uppercase is not canonical
    "3f2504e0-4f89-41d3-9a0c-0305e82c330",                  // too short
    "3f2504e0-4f89-41d3-9a0c-0305e82c33011"];               // too long
  for (const b of bad) assert.equal(ML.isValidEntryId(b), false, `must reject ${JSON.stringify(b)}`);
  // both generator paths produce canonical v4
  const bytes = new Uint8Array(16).fill(0xff);
  const viaBytes = ML.generateEntryId({ getRandomValues: (b) => { b.set(bytes.subarray(0, b.length)); return b; } });
  assert.equal(ML.isValidEntryId(viaBytes), true, "getRandomValues fallback sets version/variant bits");
  assert.equal(viaBytes[14], "4", "version nibble");
  assert.ok(["8", "9", "a", "b"].includes(viaBytes[19]), "variant nibble");
});

test("[contract] node states: empty valid; missing id → migration_required; duplicate id invalid; duplicate DATE valid", () => {
  assert.equal(ML.validateEntriesNode(null).ok, true, "absent node is valid");
  assert.equal(ML.validateEntriesNode([]).ok, true, "empty node is valid");
  const m = ML.validateEntriesNode([{ id: ID(1), date: "d", sales: 1 }, row("d2", 2)]);
  assert.equal(m.status, "missing_entry_id");
  assert.equal(m.missingIdCount, 1);
  assert.equal(m.total, 2);
  assert.equal(ML.validateEntriesNode([{ id: ID(1), date: "a" }, { id: ID(1), date: "b" }]).status, "duplicate_id");
  assert.equal(ML.validateEntriesNode([{ id: ID(1), date: "same" }, { id: ID(2), date: "same" }]).ok, true,
    "duplicate business dates are VALID when ids differ");
  assert.equal(ML.validateEntriesNode("nope").status, "malformed_remote");
  assert.equal(ML.validateEntriesNode([{ id: ID(1), date: "a" }, 42]).status, "malformed_remote");
  assert.equal(ML.validateEntriesNode([{ id: "short", date: "a" }]).status, "malformed_remote");
});

test("[contract] ordinary mutations fail closed on an unmigrated / invalid node with ZERO change", () => {
  const legacy = [row("2026-08-01", 100), row("2026-08-02", 200)];
  const intent = { type: "upsert_entry", target: { id: ID(9) }, patch: { fields: { sales: 1 } }, base: { fields: { sales: 100 } } };
  const r = ML.applyEntryIntent(legacy, intent);
  assert.equal(r.ok, false);
  assert.equal(r.status, "missing_entry_id");
  assert.deepEqual(legacy, [row("2026-08-01", 100), row("2026-08-02", 200)], "input untouched");
  // clear-all is equally refused on an unmigrated node
  const c = ML.applyEntryIntent(legacy, { type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint(legacy) });
  assert.equal(c.status, "missing_entry_id");
});

test("[contract] an ordinary edit can never add, change or unset an id", () => {
  const r0 = { id: ID(1), date: "2026-08-01", sales: 100 };
  const direct = ML.applyEntryIntent([r0], { type: "upsert_entry", target: { id: ID(1) },
    patch: { fields: { id: ID(2) } }, base: { fields: { id: ID(1) } } });
  assert.equal(direct.status, "invalid_identity");
  assert.equal(direct.reason, "id_is_immutable");
  // the builder never emits an id patch even when `next` carries a different id
  const i = ML.buildEntryUpsertIntent(r0, { id: ID(2), date: "2026-08-01", sales: 150 }, {});
  assert.equal("id" in (i.patch.fields || {}), false);
  assert.deepEqual(plain(i.target), { id: ID(1) });
});

test("[contract] create requires a pre-generated id and is idempotent across retries", () => {
  const newRow = { id: ID(5), date: "2026-08-09", sales: 10 };
  const intent = { type: "upsert_entry", target: { id: ID(5) }, createIfMissing: true, newRow, patch: {}, base: {} };
  const first = ML.applyEntryIntent([], intent);
  assert.equal(first.ok, true);
  assert.equal(first.rows.length, 1);
  const replay = ML.applyEntryIntent(first.rows, intent);       // callback re-executed
  assert.equal(replay.noop, true, "identical create replays as a no-op, never duplicates");
  const conflicting = ML.applyEntryIntent(first.rows, { ...intent, newRow: { ...newRow, sales: 99 } });
  assert.equal(conflicting.status, "invalid_identity", "same id with different content fails closed");
  assert.equal(conflicting.reason, "id_collision", "a distinct identity-collision result, never a patch or empty_patch");
  assert.equal(conflicting.ok, false);
  // a create without a valid id is refused
  assert.equal(ML.buildEntryUpsertIntent(null, { date: "2026-08-09", sales: 1 }, {}).status, "invalid_identity");
});

// ── date-edit regression (R10-GATE-003) ──────────────────────────────────────
test("[gate-003] date edits mutate the stored date and never return a false idempotent success", () => {
  const a = { id: ID(1), date: "2026-08-05", sales: 100 };
  const b = { id: ID(2), date: "2026-08-06", sales: 100 };
  const toFree = ML.buildEntryUpsertIntent(a, { date: "2026-08-07", sales: 100 }, {});
  assert.equal(toFree.patch.fields.date, "2026-08-07");
  assert.equal(toFree.base.fields.date, "2026-08-05");
  const r1 = ML.applyEntryIntent([a], toFree);
  assert.equal(r1.ok, true);
  assert.equal(r1.rows[0].date, "2026-08-07", "the stored date actually changed");
  assert.equal(r1.rows[0].id, ID(1), "identity is unchanged by a date edit");
  // occupied target date: BOTH rows survive (ids differ), no silent no-op
  const toOccupied = ML.buildEntryUpsertIntent(a, { date: "2026-08-06", sales: 100 }, {});
  const r2 = ML.applyEntryIntent([a, b], toOccupied);
  assert.equal(r2.ok, true);
  assert.notEqual(r2.status, "empty_patch", "must NOT report a no-op (the audit's silent-success defect)");
  assert.equal(r2.rows.length, 2, "both rows preserved");
  assert.equal(r2.rows.filter(r => r.date === "2026-08-06").length, 2, "duplicate date with distinct ids is legal");
  assert.equal(r2.rows.find(r => r.id === ID(1)).date, "2026-08-06");
  assert.equal(r2.rows.find(r => r.id === ID(2)).sales, 100, "sibling untouched");
  // a stale date edit conflicts instead of overwriting
  const stale = ML.applyEntryIntent([{ ...a, date: "2026-08-08" }], toFree);
  assert.equal(stale.status, "conflict");
  assert.deepEqual(plain(stale.conflictPaths), ["date"]);
  // legacy (id-less) rows cannot be date-edited at all
  assert.equal(ML.buildEntryUpsertIntent({ date: "2026-08-05", sales: 100 }, { date: "2026-08-06", sales: 100 }, {}).status, "entry_identity_required");
});

// ── pure migration transformer ───────────────────────────────────────────────
const snapshot = [
  row("2026-08-03", 300),                              // unsorted on purpose
  row("2026-08-01", 100, { notes: "keep", extraUnknown: { a: 1 } }),
  { id: ID(7), date: "2026-08-02", sales: 200 },       // already identified
  row("2026-08-01", 100, { notes: "keep", extraUnknown: { a: 1 } }), // byte-identical duplicate
  row("2026-08-01", 999),                              // duplicate DATE, different values
];

test("[migration] plan assigns ids only to id-less rows and preserves everything else", () => {
  const ids = [ID(11), ID(12), ID(13), ID(14)];
  const plan = T.planEntryIdAssignment(snapshot, ids);
  assert.equal(plan.ok, true);
  assert.equal(plan.assignments.length, 4, "4 id-less rows");
  assert.deepEqual(plain(plan.assignments).map(a => a.index), [0, 1, 3, 4], "targets physical positions");
  assert.equal(plan.expectedFingerprint, ML.contentFingerprint(snapshot));
  const out = T.applyEntryIdAssignment(snapshot, plan);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, snapshot.length, "no row lost or added");
  assert.deepEqual(plain(out.rows).map(r => r.date), snapshot.map(r => r.date), "array ORDER preserved exactly");
  assert.equal(out.rows[2].id, ID(7), "existing valid id kept");
  assert.equal(out.rows[1].notes, "keep", "existing fields preserved");
  assert.deepEqual(plain(out.rows[1].extraUnknown), { a: 1 }, "unknown additive fields preserved");
  assert.equal(out.rows[3].sales, 100, "byte-identical duplicate row preserved as its own record");
  assert.notEqual(out.rows[1].id, out.rows[3].id, "identical duplicates get DISTINCT ids");
  assert.equal(out.rows.filter(r => r.date === "2026-08-01").length, 3, "duplicate dates preserved");
  assert.equal(ML.validateEntriesNode(out.rows).ok, true, "the migrated node satisfies the contract");
  // only `id` was added
  out.rows.forEach((r, i) => {
    const { id, ...rest } = r;
    const { id: _oid, ...origRest } = snapshot[i];
    assert.deepEqual(plain(rest), plain(origRest), `row ${i}: no field other than id changed`);
  });
});

test("[migration] deterministic replay: repeated callback execution is byte-identical", () => {
  const plan = T.planEntryIdAssignment(snapshot, [ID(11), ID(12), ID(13), ID(14)]);
  const a = T.applyEntryIdAssignment(snapshot, plan);
  const b = T.applyEntryIdAssignment(snapshot, plan);
  assert.equal(JSON.stringify(a.rows), JSON.stringify(b.rows), "same input + same plan → identical output");
  // ids come from the PLAN (generated outside the callback), so a retry reuses them
  assert.equal(a.rows[0].id, ID(11));
  // re-applying to the ALREADY migrated node aborts on the fingerprint precondition
  const again = T.applyEntryIdAssignment(a.rows, plan);
  assert.equal(again.ok, false);
  assert.equal(again.status, "precondition_failed");
});

test("[migration] complete-content precondition catches every kind of drift", () => {
  const plan = T.planEntryIdAssignment(snapshot, [ID(11), ID(12), ID(13), ID(14)]);
  const drifts = {
    value_changed: snapshot.map((r, i) => i === 0 ? { ...r, sales: 301 } : r),
    row_added: snapshot.concat([row("2026-08-09", 9)]),
    row_removed: snapshot.slice(1),
    reordered: [snapshot[1], snapshot[0], snapshot[2], snapshot[3], snapshot[4]],
    new_field: snapshot.map((r, i) => i === 0 ? { ...r, brandNew: 1 } : r),
  };
  for (const [name, rows] of Object.entries(drifts)) {
    const out = T.applyEntryIdAssignment(rows, plan);
    assert.equal(out.ok, false, `${name} must abort`);
    assert.equal(out.status, "precondition_failed", `${name}`);
  }
  const exact = T.applyEntryIdAssignment(snapshot, plan);
  assert.equal(exact.ok, true, "the exact approved snapshot still applies");
});

test("[migration] rejects duplicate existing ids, bad id sets and malformed content without writing", () => {
  assert.equal(T.planEntryIdAssignment([{ id: ID(1), date: "a" }, { id: ID(1), date: "b" }], []).status, "duplicate_id");
  assert.equal(T.planEntryIdAssignment([row("a", 1)], []).status, "id_count_mismatch");
  assert.equal(T.planEntryIdAssignment([row("a", 1)], ["short"]).status, "invalid_ids");
  assert.equal(T.planEntryIdAssignment([{ id: ID(1), date: "a" }, row("b", 2)], [ID(1)]).status, "duplicate_id",
    "a pre-generated id colliding with an existing id is refused");
  assert.equal(T.planEntryIdAssignment("nope", []).status, "malformed_remote");
  assert.equal(T.planEntryIdAssignment([42], []).status, "malformed_remote");
  assert.equal(T.planEntryIdAssignment([{ id: "bad", date: "a" }], []).status, "malformed_remote");
  const plan = T.planEntryIdAssignment([row("a", 1)], [ID(3)]);
  assert.equal(T.applyEntryIdAssignment("nope", plan).status, "malformed_remote");
});

test("[migration] an already-migrated node is a safe no-op; nothing is rewritten", () => {
  const done = [{ id: ID(1), date: "a", sales: 1 }, { id: ID(2), date: "a", sales: 2 }];
  const plan = T.planEntryIdAssignment(done, []);
  assert.equal(plan.ok, true);
  assert.equal(plan.alreadyIdentified, true);
  const out = T.applyEntryIdAssignment(done, plan);
  assert.equal(out.noop, true);
  assert.equal(out.status, "already_identified");
});

test("[boundary] the transformer is TEST-ONLY and unreachable from runtime", async () => {
  // 1. runtime does not contain the transformer
  assert.equal(/function planEntryIdAssignment|function applyEntryIdAssignment|planEntriesMigration|applyEntriesMigration/.test(html), false,
    "index.html contains no transformer");
  assert.equal(ML.planEntriesMigration, undefined, "runtime exports no transformer");
  assert.equal(ML.applyEntriesMigration, undefined);
  // 2. no runtime file imports it, and no package script references it
  const { readdirSync, statSync } = await import("node:fs");
  const NEEDLE = "entries-id-offline-transformer";
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === "test") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(m?js|ts|tsx|html|json)$/.test(name)) {
        if (readFileSync(full, "utf8").includes(NEEDLE)) offenders.push(full);
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders, [], "no runtime file or package script references the transformer");
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  assert.equal(pkg.includes(NEEDLE), false, "package.json does not reference it");
  // 3. hydration / listener / ordinary mutation cannot reach it
  assert.equal(/onListenerEcho[\s\S]{0,800}(planEntryIdAssignment|applyEntryIdAssignment)/.test(html), false);
  assert.equal(/submitIntent[\s\S]{0,800}(planEntryIdAssignment|applyEntryIdAssignment)/.test(html), false);
  // 4. the module is side-effect free and has no CLI entry point
  const src = readFileSync(join(ROOT, "test/support/entries-id-offline-transformer.mjs"), "utf8");
  for (const forbidden of ["process.argv", "process.env", "require(", "node:fs", "node:child_process", "fetch(", "firebase"]) {
    assert.equal(src.includes(forbidden), false, `transformer must not contain ${forbidden}`);
  }
  // 5. the runtime blocked-state name carries no data-action terminology
  assert.ok(html.includes("blocked_entry_identity_required"), "runtime uses the approved blocked-state name");
  assert.ok(html.includes("missing_entry_id"), "runtime uses the approved validation reason");
});
