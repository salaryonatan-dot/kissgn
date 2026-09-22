// P0-DATA-01 STORAGE V2 — HARDENING R2: PRODUCTION WIRING (Codex R1-F1 / R1-F2 / R1-F3).
//
// Every case runs the ACTUAL dashboard initialization block and the ACTUAL selection-
// effect listener/bootstrap block of index.html (see test/support/dashboard-wiring-
// harness.mjs) — not a re-implementation of the wiring — over an in-memory RTDB with
// CAS transactions, asynchronous listeners and deterministic interleaving hooks.
//
// Run: node --test test/dashboard/entries-storage-v2-production-wiring.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gitIn } from "../support/git-context.mjs";
import { HTML, createDashboard, makeMemoryStorage, loadProductionWindow, extractInitBlock, plain } from "../support/dashboard-wiring-harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PARENT = "6c879b66df98e41a1e88b641b3688e24ce4c8675";
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2");
const row = (id, date, sales, extra = {}) => ({ id, date, sales, deliveries: 0, ...extra });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const KEY = (biz) => `biz:${biz}:entries`;
const v2node = (gen, rows) => { const m = {}; rows.forEach((r) => { m[r.id] = { ...r, _gen: gen }; }); const n = { schemaVersion: 2, generation: gen, _v: JSON.stringify(rows) }; if (rows.length) n.rows = m; return n; };

async function boot({ nodeA = v2node(1, [row(ID1, "2026-08-01", 101), row(ID2, "2026-08-02", 202)]), nodeB, html = HTML } = {}) {
  const storage = makeMemoryStorage();
  if (nodeA !== undefined) storage.seed(KEY("A"), nodeA);
  if (nodeB !== undefined) storage.seed(KEY("B"), nodeB);
  const dash = createDashboard({ html, storage, tenantId: "T1", bizId: "A" });
  dash.selectBusiness("A");
  await dash.settle();
  return { storage, dash };
}
const nodeLane = (log, biz = "A") => log.filter((l) => l.key === KEY(biz) && l.sub === "").length;
const rowLane = (log, biz = "A") => log.filter((l) => l.key === KEY(biz) && l.sub.startsWith("rows/")).length;

// ═══ Blocker 1 — the production adapter carries the captured binding ═════════
test("[B1-A] absent business: the first save through the REAL labor call site initialises V2 at epoch 1", async () => {
  const { storage, dash } = await boot({ nodeA: null });
  assert.deepEqual(plain(dash.mode()), { mode: "absent", generation: null }, "absent probe marked the destination");
  assert.equal(dash.coord().isReady(), true);
  const r = await dash.submitLaborEntry("2026-09-01", "450");
  assert.equal(r.status, "committed", JSON.stringify(r)); assert.equal(r.generation, 1); assert.equal(r.created, true);
  const node = storage.read(KEY("A"));
  assert.equal(node.schemaVersion, 2); assert.equal(node.generation, 1); assert.equal(node._v, undefined, "no legacy blob ever written");
  const [id] = Object.keys(node.rows); assert.equal(node.rows[id]._gen, 1); assert.equal(node.rows[id].payroll, "450");
  await dash.settle();
  assert.equal(dash.mode().mode, "v2", "the listener hydrated the new node"); assert.equal(dash.mode().generation, 1);
  assert.equal(dash.displayed().length, 1); assert.equal(dash.displayed()[0].payroll, "450");
  assert.equal(nodeLane(storage.log), 1, "one node-level initialisation"); assert.equal(rowLane(storage.log), 0);
  // and the identical first save, repeated, is idempotent through the row lane
  const again = await dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id, date: "2026-09-01", payroll: "450" }));
  assert.equal(again.status, "committed_idempotent"); assert.equal(again.reason, "already_created");
});
test("[B1-B/C/D] V2 create, edit and delete commit through the production path on the row lane", async () => {
  const { storage, dash } = await boot();
  assert.equal(dash.mode().generation, 1); assert.equal(dash.salesOf(ID1), 101);
  const NEW = uuid("new");
  const rc = await dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id: NEW, date: "2026-08-03", sales: 5 }));
  assert.equal(rc.status, "committed", JSON.stringify(rc)); assert.equal(storage.read(KEY("A"), "rows/" + NEW)._gen, 1);
  const re = await dash.coord().submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(re.status, "committed", JSON.stringify(re)); assert.equal(storage.read(KEY("A"), "rows/" + ID1).sales, 555);
  await dash.settle(); assert.equal(dash.salesOf(ID1), 555, "display converged on the listener");
  const seen = dash.displayed().find((r) => r.id === ID2);
  const rd = await dash.coord().submitIntent(dash.ML.buildEntryDeleteIntent(seen, {}));
  assert.equal(rd.status, "committed", JSON.stringify(rd)); assert.equal(storage.read(KEY("A"), "rows/" + ID2), null);
  await dash.settle(); assert.equal(dash.salesOf(ID2), undefined);
  assert.equal(rowLane(storage.log), 3); assert.equal(nodeLane(storage.log), 0, "no collection-scoped write for ordinary intents");
  // the real labor call site edits an existing row by immutable id
  const rl = await dash.submitLaborEntry("2026-08-01", "900");
  assert.equal(rl.status, "committed"); assert.equal(storage.read(KEY("A"), "rows/" + ID1).payroll, "900");
});
test("[B1-E] the real clear-all arguments commit and rotate the epoch through the production path", async () => {
  const { storage, dash } = await boot();
  const r = await dash.clearAll();
  assert.equal(r.status, "committed", JSON.stringify(r)); assert.equal(r.generation, 2); assert.equal(r.destructive, true);
  const node = storage.read(KEY("A"));
  assert.equal(node.generation, 2); assert.equal(node.rows, undefined); assert.equal(typeof node._v, "string");
  await dash.settle(); assert.deepEqual(plain(dash.displayed()), []); assert.equal(dash.mode().generation, 2);
});
test("[B1-F] a binding captured under a retired epoch is refused before any transaction", async () => {
  const { storage, dash } = await boot();
  let release; const gate = new Promise((r) => { release = r; });
  storage.setHooks({ beforeRun: () => gate });                       // hold the first job at its transaction
  const first = dash.coord().submitIntent(upsert(ID2, { sales: 1 }, { sales: 202 }));
  const second = dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id: uuid("late"), date: "2026-08-09", sales: 9 }));   // queued, bound to epoch 1
  await dash.settle(2);
  storage.setHooks({});
  storage.inject(KEY("A"), "", { schemaVersion: 2, generation: 2, _v: "[]" });     // a foreign clear-all rotates 1 -> 2
  await dash.settle(); assert.equal(dash.mode().generation, 2, "the listener hydrated the rotation");
  release();
  const r1 = await first, r2 = await second;
  assert.equal(r1.status, "blocked"); assert.equal(r1.reason, "target_not_found");
  assert.equal(r2.status, "blocked", JSON.stringify(r2)); assert.equal(r2.reason, "generation_retired", "the queued intent kept its epoch-1 binding");
  assert.equal(storage.read(KEY("A"), "rows"), null, "nothing resurrected");
  assert.equal(storage.log.filter((l) => l.sub.startsWith("rows/" + uuid("late"))).length, 0, "the retired create never reached a transaction");
});
test("[B1-G] switching business after a binding was captured: no cross-business reuse", async () => {
  const { storage, dash } = await boot({ nodeA: v2node(3, [row(ID1, "2026-08-01", 101)]), nodeB: v2node(1, [row(ID2, "2026-08-02", 202)]) });
  assert.equal(dash.mode().generation, 3);
  let release; const gate = new Promise((r) => { release = r; });
  storage.setHooks({ beforeRun: () => gate });
  const inflight = dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }));
  const queued = dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id: uuid("qa"), date: "2026-08-09", sales: 9 }));
  await dash.settle(2);
  dash.selectBusiness("B");                                          // the user switches business
  assert.equal(dash.mode(), null, "the mode ref is reset for the new destination");
  storage.setHooks({});
  await dash.settle();
  assert.equal(dash.mode().generation, 1, "B hydrated from ITS node"); assert.equal(dash.salesOf(ID2), 202);
  release();
  const ra = await inflight, rq = await queued;
  assert.equal(rq.status, "cancelled_selection_changed", "queued work for A is cancelled");
  assert.ok(ra.status === "committed" || ra.status === "stale", ra.status);   // the in-flight A write may complete, but never touches B's state
  assert.equal(dash.salesOf(ID2), 202); assert.equal(dash.salesOf(ID1), undefined, "A's rows never reach B's display");
  const rb = await dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id: uuid("nb"), date: "2026-08-10", sales: 7 }));
  assert.equal(rb.status, "committed", JSON.stringify(rb)); assert.equal(rb.generation, 1, "bound to B's epoch, not A's 3");
  assert.equal(storage.read(KEY("B"), "rows/" + uuid("nb"))._gen, 1);
  assert.equal(storage.read(KEY("A"), "rows/" + uuid("nb")), null, "nothing written to A");
  assert.equal(storage.read(KEY("A")).generation, 3);
});
test("[B1-legacy] a legacy business still routes to the legacy engine and the binding is irrelevant to it", async () => {
  const { storage, dash } = await boot({ nodeA: { _v: JSON.stringify([row(ID1, "2026-08-01", 101)]) } });
  assert.deepEqual(plain(dash.mode()), { mode: "legacy", generation: null });
  const r = await dash.coord().submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed"); assert.deepEqual(plain(r.rows).map((x) => x.sales), [555]);
  const node = storage.read(KEY("A")); assert.equal(typeof node._v, "string"); assert.equal(node.schemaVersion, undefined);
  assert.equal(nodeLane(storage.log), 1); assert.equal(rowLane(storage.log), 0);
  assert.equal(dash.salesOf(ID1), 555);
});
test("[B1-H] NEGATIVE CONTROL: the parent commit's dashboard block drops the binding and refuses before any transaction", async () => {
  const parent = gitIn(ROOT, ["show", `${PARENT}:index.html`]);
  assert.equal(parent.status, 0, parent.stderr);
  assert.ok(extractInitBlock(parent.stdout).includes("mutate: (intent, ctx) => entriesStorageRouterRef.current.mutate(intent, ctx),"), "the parent adapter is two-argument");
  assert.ok(extractInitBlock(HTML).includes("mutate: (intent, ctx, binding) => entriesStorageRouterRef.current.mutate(intent, ctx, binding),"), "the candidate adapter forwards the binding");
  for (const kind of ["create", "edit", "delete", "clear", "absent-create"]) {
    const { storage, dash } = await boot({ nodeA: kind === "absent-create" ? null : undefined, html: parent.stdout });
    let r;
    if (kind === "clear") r = await dash.clearAll();
    else if (kind === "edit") r = await dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }));
    else if (kind === "delete") r = await dash.coord().submitIntent(dash.ML.buildEntryDeleteIntent(dash.displayed().find((x) => x.id === ID1), {}));
    else r = await dash.coord().submitIntent(create({ ...dash.EMPTY_ENTRY, id: uuid("x" + kind), date: "2026-08-09", sales: 1 }));
    assert.equal(r.status, "blocked_unhydrated", kind); assert.equal(r.reason, "intent_not_bound_to_generation", kind);
    assert.equal(storage.log.length, 0, kind + ": zero transactions");
  }
});

// ═══ Blocker 2 — clear completion never overwrites a NEWER listener snapshot ═══
test("[B2-A] clear echo, then a new-epoch row echo, then the clear promise resolves: the new row stays visible", async () => {
  const { storage, dash } = await boot();
  const NEW = uuid("777");
  storage.setHooks({ afterCommit: async () => {
    // the clear committed (its echo, epoch 2, [] was delivered synchronously); another
    // client now creates a row in epoch 2 and this client receives that echo too
    storage.inject(KEY("A"), "rows/" + NEW, { ...row(NEW, "2026-08-05", 777), _gen: 2 });
    assert.equal(dash.mode().generation, 2);
  } });
  const r = await dash.clearAll();
  storage.setHooks({});
  assert.equal(r.status, "committed"); assert.equal(r.generation, 2);
  assert.equal(dash.salesOf(NEW), 777, "the authoritative newer snapshot won over the stale [] result");
  assert.equal(dash.displayed().length, 1);
  assert.equal(JSON.stringify(dash.coord().rawSnapshot()), JSON.stringify(dash.displayed()), "raw snapshot converged too");
  assert.equal(dash.coord()._state().deferredPending, false); assert.equal(dash.coord()._state().ownPending, 0);
  // a later unrelated echo is applied normally (no stale own-echo marker swallows it)
  storage.inject(KEY("A"), "rows/" + NEW + "/sales", 778); await dash.settle();
  assert.equal(dash.salesOf(NEW), 778);
});
test("[B2-B] clear promise resolves, then the clear echo, then a new row echo: the new row is visible", async () => {
  const { storage, dash } = await boot();
  storage.setHooks({ silent: true });
  const r = await dash.clearAll(); storage.setHooks({});
  assert.equal(r.status, "committed"); assert.deepEqual(plain(dash.displayed()), []);
  storage.emit(KEY("A")); await dash.settle();
  assert.deepEqual(plain(dash.displayed()), [], "own clear echo ignored/idempotent");
  const NEW = uuid("778"); storage.inject(KEY("A"), "rows/" + NEW, { ...row(NEW, "2026-08-05", 778), _gen: 2 }); await dash.settle();
  assert.equal(dash.salesOf(NEW), 778);
});
test("[B2-C] a foreign active-epoch row appears while clear completion is pending (row lands after the clear echo): the row survives", async () => {
  const { storage, dash } = await boot();
  const NEW = uuid("779");
  storage.setHooks({ afterCommit: async () => { await dash.settle(1); storage.inject(KEY("A"), "rows/" + NEW, { ...row(NEW, "2026-08-06", 779), _gen: 2 }); await dash.settle(1); } });
  const r = await dash.clearAll(); storage.setHooks({});
  assert.equal(r.status, "committed");
  assert.equal(dash.salesOf(NEW), 779); assert.equal(storage.read(KEY("A"), "rows/" + NEW).sales, 779, "persisted row untouched");
});
test("[B2-D] a stale pre-clear mutation completing after the rotation cannot resurrect or overwrite", async () => {
  const { storage, dash } = await boot();
  const other = createDashboard({ storage, tenantId: "T1", bizId: "A", W: loadProductionWindow() }); other.selectBusiness("A"); await other.settle();
  let release; const gate = new Promise((r) => { release = r; });
  storage.setHooks({ beforeRun: () => gate });
  const stale = other.coord().submitIntent(upsert(ID1, { sales: 999 }, { sales: 101 }));   // in flight under epoch 1
  await dash.settle(2); storage.setHooks({});
  const rc = await dash.clearAll(); assert.equal(rc.status, "committed"); assert.equal(rc.generation, 2);
  release(); const rs = await stale;
  assert.equal(rs.status, "blocked"); assert.equal(rs.reason, "target_not_found", "the row is gone; nothing to overwrite");
  await other.settle();
  assert.deepEqual(plain(other.displayed()), [], "the stale client converged on the cleared state"); assert.equal(other.mode().generation, 2);
  assert.equal(storage.read(KEY("A"), "rows"), null, "nothing resurrected");
  const rq = await other.coord().submitIntent(create(row(ID1, "2026-08-01", 101)));      // new intent, new epoch: legitimate
  assert.equal(rq.status, "committed"); assert.equal(storage.read(KEY("A"), "rows/" + ID1)._gen, 2);
});
test("[B2-E] no post-clear row: the display is empty (parked clear echo and no echo alike)", async () => {
  const a = await boot();
  const ra = await a.dash.clearAll(); assert.equal(ra.status, "committed");
  assert.deepEqual(plain(a.dash.displayed()), []); await a.dash.settle(); assert.deepEqual(plain(a.dash.displayed()), []);
  const b = await boot(); b.storage.setHooks({ silent: true });
  const rb = await b.dash.clearAll(); b.storage.setHooks({});
  assert.equal(rb.status, "committed"); assert.deepEqual(plain(b.dash.displayed()), []);
  // legacy engine: its collection result is still applied as before
  const c = await boot({ nodeA: { _v: JSON.stringify([row(ID1, "2026-08-01", 101)]) } });
  const rcl = await c.dash.clearAll(); assert.equal(rcl.status, "committed"); assert.deepEqual(plain(c.dash.displayed()), []);
  assert.equal(c.storage.read(KEY("A"))._v, "[]");
});
test("[B2-F] business switch while a clear is pending: completion cannot alter the newly selected business", async () => {
  const { storage, dash } = await boot({ nodeB: v2node(1, [row(ID2, "2026-08-02", 202)]) });
  storage.setHooks({ afterCommit: async () => { dash.selectBusiness("B"); await dash.settle(); } });
  const r = await dash.clearAll(); storage.setHooks({});
  assert.equal(r.status, "committed");
  assert.equal(dash.salesOf(ID2), 202, "B's authoritative rows are displayed"); assert.equal(dash.displayed().length, 1);
  assert.equal(dash.mode().generation, 1); assert.equal(dash.coord()._state().hydrated, true);
  assert.equal(storage.read(KEY("A")).generation, 2, "A was cleared"); assert.equal(storage.read(KEY("B"), "rows/" + ID2).sales, 202);
});

// ═══ Blocker 3 — RTDB numeric-key map readback and canonical equality ════════
const asRtdbArray = (m) => { const keys = Object.keys(m); const arr = []; keys.forEach((k) => { arr[Number(k)] = m[k]; }); return arr; };
test("[B3-unit] canonical equality: numeric-key MAP fields equal their RTDB array readback; other arrays keep order; content differences still differ", () => {
  const W = loadProductionWindow(); const V2 = W.MarjinStorageV2;
  assert.deepEqual(plain(V2.MAP_FIELDS), ["supplier_payments", "hourly_payroll"]);
  const submitted = { id: ID1, date: "2026-08-01", sales: 5, hourly_payroll: { "0": 10, "1": 20 }, supplier_payments: { "3": 7 } };
  const readBack = { id: ID1, date: "2026-08-01", sales: 5, hourly_payroll: [10, 20], supplier_payments: { "3": 7 } };
  assert.equal(V2.canonicalRowKey(submitted), V2.canonicalRowKey(readBack));
  assert.equal(V2.canonicalRowKey({ hourly_payroll: [10, null, 30] }), V2.canonicalRowKey({ hourly_payroll: { "0": 10, "2": 30 } }), "a hole is an absent key");
  assert.notEqual(V2.canonicalRowKey(submitted), V2.canonicalRowKey({ ...readBack, hourly_payroll: [10, 21] }), "changed amount");
  assert.notEqual(V2.canonicalRowKey(submitted), V2.canonicalRowKey({ ...readBack, hourly_payroll: [10, 20, 30] }), "changed cardinality");
  assert.notEqual(V2.canonicalRowKey(submitted), V2.canonicalRowKey({ ...readBack, hourly_payroll: [20, 10] }), "swapped amounts are different keys");
  assert.notEqual(V2.canonicalRowKey({ list: [1, 2] }), V2.canonicalRowKey({ list: [2, 1] }), "a non-map array keeps its order");
  assert.notEqual(V2.canonicalRowKey({ other: { "0": 1 } }), V2.canonicalRowKey({ other: [1] }), "numeric-key objects OUTSIDE map fields are not reinterpreted");
  assert.equal(V2.canonicalRowKey({ a: 1, b: {} }), V2.canonicalRowKey({ b: null, a: 1 }), "existing canonical equality unchanged");
  assert.deepEqual(plain(V2.stampRow({ id: ID1, date: "d", hourly_payroll: [10, 20] }, 1)), { id: ID1, date: "d", hourly_payroll: { "0": 10, "1": 20 }, _gen: 1 }, "written form is the canonical map");
  // NEGATIVE CONTROL: the pre-R2 comparator (canonicalStorageValue over the whole row) reports a false difference
  const old = (r) => W.MarjinSaveLifecycle.stableStringify(V2.canonicalStorageValue(r) || {});
  assert.notEqual(old(submitted), old(readBack), "the old comparator would collide on an identical retry");
});
test("[B3-runtime] an identical same-epoch create retry after array readback is idempotent; real changes still collide", async () => {
  const { storage, dash } = await boot();
  // RTDB semantics: dense integer-key maps come back as arrays
  const origRead = storage.read;
  storage.read = (k, sub = "") => { const v = origRead(k, sub); const conv = (o) => { if (o && typeof o === "object" && !Array.isArray(o)) { for (const f of ["hourly_payroll", "supplier_payments"]) if (o[f] && typeof o[f] === "object" && !Array.isArray(o[f]) && Object.keys(o[f]).every((x) => /^\d+$/.test(x))) o[f] = asRtdbArray(o[f]); } return o; };
    if (sub.startsWith("rows/") && sub.split("/").length === 2) return conv(v); if (!sub && v && v.rows) Object.keys(v.rows).forEach((id) => conv(v.rows[id])); return v; };
  const origMutate = storage.mutateForPath;
  storage.mutateForPath = (t, key, sub, fn) => origMutate(t, key, sub, (cur) => fn(cur === null ? null : storage.read(key, sub)));
  const NEW = uuid("pay");
  const intent = create({ ...dash.EMPTY_ENTRY, id: NEW, date: "2026-08-09", sales: 5, hourly_payroll: { "0": 10, "1": 20 }, supplier_payments: { "7": 30 } });
  const r1 = await dash.coord().submitIntent(intent); assert.equal(r1.status, "committed", JSON.stringify(r1));
  assert.deepEqual(plain(storage.read(KEY("A"), "rows/" + NEW).hourly_payroll), [10, 20], "read back as an array");
  const r2 = await dash.coord().submitIntent(intent); assert.equal(r2.status, "committed_idempotent", JSON.stringify(r2)); assert.equal(r2.reason, "already_created");
  const r3 = await dash.coord().submitIntent(create({ ...intent.newRow, hourly_payroll: { "0": 10, "1": 21 } })); assert.equal(r3.status, "blocked"); assert.equal(r3.detail, "id_collision");
  const r4 = await dash.coord().submitIntent(create({ ...intent.newRow, hourly_payroll: { "0": 10, "1": 20, "2": 5 } })); assert.equal(r4.detail, "id_collision");
  const r5 = await dash.coord().submitIntent(create({ ...intent.newRow, supplier_payments: { "8": 30 } })); assert.equal(r5.detail, "id_collision", "a different key is a different value");
  assert.equal(storage.read(KEY("A"), "rows/" + NEW).sales, 5);
});
