// P0-DATA-01 STORAGE V2 — HARDENING R1 (Codex candidate blockers SV2-01…SV2-09).
//
// Emulator-free, deterministic proof of every runtime-side hardening, against the
// ACTUAL production code vm-extracted from index.html (MarjinSaveLifecycle +
// MarjinStorageV2), the storage tooling, the pinned Rules contract and the S0 guard.
// The server-side (Rules) half of each finding is proven by the emulator matrix
// (test/emulator/storage-v2-matrix.mjs, V2-H01…H10); this suite pins the client
// contract and the exact production wiring so neither can drift silently.
//
// Run: node --test test/dashboard/entries-storage-v2-hardening.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gitIn } from "../support/git-context.mjs";
import { authorizedEntriesRulesDelta, EXPECTED_ENTRIES_DELTA, expectedWriteRule, CUTOVER_GUARD, authorizedVersionFenceRulesDelta, expectedFencedWriteRule, FENCE_GUARD, EXPECTED_STORAGE_V2_CONTROL_RULES } from "../support/rules-authorized-delta.mjs";
import { createLegacyPreflight, PREFLIGHT_BLOCKERS } from "../../tools/storage-v2/preflight.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const S0_BASE = "686b4350c6b6186c81d7f821d8c26a960428d30b";

function loadProduction() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "P0-DATA-01 anchor");
  const f = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  assert.notEqual(f, -1, "MarjinStorageV2 export");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
const W = loadProduction();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
const GK = V2.ROW_GEN_KEY;
const plain = (v) => JSON.parse(JSON.stringify(v));

// deterministic canonical ids
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2");
const row = (id, date, sales, extra = {}) => ({ id, date, sales, deliveries: 0, ...extra });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const ctxFor = (tenantId = "T", bizId = "B") => { const c = ML.createSelectionController(); c.invalidate(tenantId, bizId); return c; };
const seed = (gen = 1, rows = [row(ID1, "2026-08-01", 101), row(ID2, "2026-08-02", 202)]) => {
  const map = {}; rows.forEach((r) => { map[r.id] = { ...r, [GK]: gen }; });
  const node = { schemaVersion: 2, generation: gen, _v: JSON.stringify(rows) };
  if (rows.length) node.rows = map;
  return node;
};

// ── an in-memory RTDB node with CAS transactions and a listener, RTDB-normalized ──
function fakeRemote(initial) {
  const normalize = (v) => V2.canonicalStorageValue(v) === undefined ? null : plain(V2.canonicalStorageValue(v));
  const st = { node: normalize(initial), listeners: [], denyIf: null, log: [] };
  const emit = () => st.listeners.forEach((l) => l(st.node === null ? null : plain(st.node)));
  const setAt = (sub, value) => {
    if (!sub) { st.node = normalize(value); return; }
    const parts = sub.split("/"); let cur = st.node || {};
    if (st.node === null) st.node = cur;
    for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
    const nv = normalize(value);
    if (nv === null) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = nv;
    // RTDB: an object with no children does not exist
    const prune = (o) => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } };
    if (st.node) { prune(st.node); if (!Object.keys(st.node).length) st.node = null; }
  };
  const getAt = (sub) => { let cur = st.node; for (const p of sub ? sub.split("/") : []) { cur = cur && typeof cur === "object" ? cur[p] : undefined; } return cur === undefined ? null : plain(cur); };
  const transact = async (sub, fn, hooks) => {
    st.log.push({ sub });
    if (hooks && hooks.beforeRun) await hooks.beforeRun();
    const next = fn(getAt(sub));
    if (next === undefined) return { committed: false };
    if (st.denyIf && st.denyIf(sub, next)) { const e = new Error("PERMISSION_DENIED: Permission denied"); e.code = "PERMISSION_DENIED"; throw e; }
    if (hooks && hooks.beforeCommit) await hooks.beforeCommit();
    setAt(sub, next);
    if (!(hooks && hooks.silent)) emit();
    if (hooks && hooks.afterCommit) await hooks.afterCommit();
    return { committed: true };
  };
  return { st, transact, emit, getAt, setAt,
    listen: (l) => { st.listeners.push(l); return () => { st.listeners.splice(st.listeners.indexOf(l), 1); }; } };
}
// a V2 mutator over the fake remote, with a controllable live mode and hooks
function v2Over(remote, { mode = "v2", generation = 1, hooks } = {}) {
  const ctrl = ctxFor();
  const live = { mode, generation: mode === "v2" ? generation : null };
  const m = V2.createV2EntriesMutator({ selection: ctrl, mode: () => live,
    transactRow: (t, k, id, fn) => remote.transact("rows/" + id, fn, hooks),
    transactNode: (t, k, fn) => remote.transact("", fn, hooks) });
  return { ctrl, live, mutate: (i, b) => m.mutate(i, ctrl.capture(), b || { mode: live.mode, generation: live.generation }) };
}

// ═══ H1/H2 — generation contract ═══════════════════════════════════════════
test("[H2] the generation is a strictly positive integer epoch — never a token, a float, zero or a timestamp-like value", () => {
  for (const ok of [1, 2, 3, 1000]) assert.equal(V2.isGenerationToken(ok), true, String(ok));
  for (const bad of [0, -1, 1.5, "1", uuid("g"), null, undefined, NaN, Infinity, "2026-09-19T00:00:00Z"]) assert.equal(V2.isGenerationToken(bad), false, String(bad));
  assert.equal(V2.GENERATION_FIRST, 1); assert.equal(V2.nextGenerationOf(1), 2); assert.equal(V2.nextGenerationOf(41), 42);
  assert.equal(GK, "_gen", "the reserved epoch stamp key");
});
test("[H2] clear-all is the ONLY advancer, always by exactly +1, derived inside the CAS — and an empty collection rotates too", async () => {
  const remote = fakeRemote(seed(1));
  const A = v2Over(remote);
  const res = await A.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint(V2.readV2Rows(remote.getAt("")).rows) });
  assert.equal(res.status, "committed"); assert.equal(res.generation, 2); assert.equal(res.retiredGeneration, 1); assert.deepEqual(plain(res.rows), []);
  assert.equal(remote.getAt("").generation, 2); assert.equal(remote.getAt("rows"), null);
  assert.equal(remote.getAt("")._v, seed(1)._v, "frozen snapshot byte-identical");
  // empty collection: still rotates
  A.live.generation = 2;
  const again = await A.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint([]) });
  assert.equal(again.status, "committed", "no `already_empty` short-circuit"); assert.equal(again.generation, 3);
  assert.equal(remote.getAt("").generation, 3);
  // caller-chosen next epoch is refused, whatever it is
  A.live.generation = 3;
  for (const chosen of [3, 4, 99, uuid("g"), null]) {
    const r = await A.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint([]), nextGeneration: chosen });
    assert.equal(r.status, "blocked"); assert.equal(r.reason, "next_generation_not_callable");
  }
  assert.equal(remote.getAt("").generation, 3, "nothing changed");
});
test("[H2] an intent is bound to the epoch it was submitted under; a newer live epoch refuses it instead of restamping it", async () => {
  const remote = fakeRemote(seed(1));
  const B = v2Over(remote, { generation: 1 });
  const formedUnder = { mode: "v2", generation: 1 };
  const stale = create(row(ID1, "2026-08-01", 101));
  // someone else clears; B's listener hydrates the rotation
  remote.setAt("", { schemaVersion: 2, generation: 2, _v: seed(1)._v }); B.live.generation = 2;
  const r = await B.mutate(stale, formedUnder);
  assert.equal(r.status, "blocked"); assert.equal(r.reason, "generation_retired"); assert.equal(r.bound, 1); assert.equal(r.live, 2);
  assert.equal(remote.getAt("rows"), null, "no resurrection");
  assert.equal(remote.st.log.length, 0, "nothing was even sent");
  // an unbound intent never reaches the store either
  const unbound = await B.mutate(create(row(ID1, "2026-08-01", 101)), {});
  assert.equal(unbound.status, "blocked_unhydrated"); assert.equal(unbound.reason, "intent_not_bound_to_generation");
  // a fresh intent under the live epoch is fine
  const fresh = await B.mutate(create(row(ID1, "2026-08-01", 101)));
  assert.equal(fresh.status, "committed"); assert.equal(remote.getAt("rows/" + ID1)[GK], 2);
});
test("[H2] the server fence: a row write in a retired epoch that the client still believes is live is refused as rules_rejected", async () => {
  const remote = fakeRemote(seed(2, []));
  remote.st.denyIf = (sub, next) => sub.startsWith("rows/") && next && next[GK] !== remote.getAt("").generation;
  const stale = v2Over(remote, { generation: 1 });                  // never observed the rotation
  const r = await stale.mutate(create(row(ID1, "2026-08-01", 101)));
  assert.equal(r.status, "blocked"); assert.equal(r.reason, "rules_rejected");
  assert.equal(remote.getAt("rows"), null);
});
test("[H2] inside the row CAS a row from another epoch is a typed conflict, and clear-all re-checks the epoch under CAS", async () => {
  const remote = fakeRemote(seed(1));
  remote.setAt("rows/" + ID1 + "/" + GK, 7);                        // corrupted / foreign stamp
  const A = v2Over(remote);
  const r = await A.mutate(upsert(ID1, { sales: 5 }, { sales: 101 }));
  assert.equal(r.status, "conflict"); assert.deepEqual(plain(r.conflictPaths), [GK]); assert.equal(r.detail, "generation_changed");
  const remote2 = fakeRemote(seed(1));
  const B = v2Over(remote2, { hooks: { beforeRun: async () => { remote2.setAt("", { schemaVersion: 2, generation: 2, _v: "[]" }); } } });
  const rc = await B.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint(V2.readV2Rows(seed(1)).rows) });
  assert.equal(rc.status, "blocked"); assert.equal(rc.reason, "precondition_failed"); assert.equal(rc.detail, "generation_changed");
  assert.equal(remote2.getAt("").generation, 2, "untouched");
});

// ═══ H3 — the listener is the authority after a row commit ═══════════════════
function coordinatorOver(remote, { onMode } = {}) {
  const ctrl = ctxFor();
  const st = { mode: null, displayed: null, echoes: [] };
  const v2 = V2.createV2EntriesMutator({ selection: ctrl, mode: () => st.mode,
    transactRow: (t, k, id, fn) => remote.transact("rows/" + id, fn, st.hooks),
    transactNode: (t, k, fn) => remote.transact("", fn, st.hooks) });
  const legacy = { mutate: async () => { st.legacyCalls = (st.legacyCalls || 0) + 1; return { status: "committed", rows: [] }; } };
  const router = V2.createEntriesStorageRouter({ mode: () => st.mode, legacy, v2 });
  const coord = ML.createEntriesWriteCoordinator({ selection: ctrl, canonicalize: ME.canonicalizeEntries, entryDateKey: ME.entryDateKey,
    fingerprint: (rows) => JSON.stringify(rows), contentFingerprint: ML.contentFingerprint,
    storageBinding: () => { const m = st.mode; return m ? { mode: m.mode, generation: m.generation === undefined ? null : m.generation } : undefined; },
    applyRows: (rows) => { st.displayed = rows; }, mutate: router.mutate });
  const deliver = (raw) => {                                          // exactly index.html's listener wiring
    const ctx = ctrl.capture();
    if (raw === null) { if (st.mode === null) st.mode = { mode: "absent", generation: null }; return coord.markHydrated(ctx, []); }
    const read = V2.readEntriesNode(raw);
    if (read.status) { st.mode = { mode: "malformed", reason: read.reason || read.status }; return coord.onListenerError(ctx); }
    st.mode = { mode: read.mode, generation: read.generation === undefined ? null : read.generation };
    if (onMode) onMode(st.mode);
    const r = coord.onListenerEcho(read.rows, ctx); st.echoes.push(r.status); return r;
  };
  const sales = (id) => { const r = (st.displayed || []).find((x) => x.id === id); return r ? r.sales : undefined; };
  return { ctrl, st, coord, deliver, sales, attach: () => remote.listen(deliver) };
}
test("[H3-A] echo arrives DURING the write (the real SDK order): the deferred authoritative value is applied at commit", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.attach(); C.deliver(remote.getAt(""));
  assert.equal(C.sales(ID1), 101);
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed"); assert.equal(r.rows, undefined, "a row commit carries no collection value");
  assert.ok(C.st.echoes.includes("deferred_pending_local"), "the echo was parked while writing");
  assert.equal(C.sales(ID1), 555, "converged on the listener value at commit");
  assert.equal(C.coord._state().deferredPending, false);
  assert.equal(C.coord._state().pending, 0);
});
test("[H3-B] echo arrives AFTER the commit: applied directly; nothing is parked", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.deliver(remote.getAt(""));
  C.st.hooks = { silent: true };
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed"); assert.equal(C.sales(ID1), 101, "no echo yet");
  const e = C.deliver(remote.getAt(""));
  assert.equal(e.status, "applied"); assert.equal(C.sales(ID1), 555);
});
test("[H3-C] two queued intents: the echo parked during the first is superseded, the final display is the last authoritative value", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.attach(); C.deliver(remote.getAt(""));
  const [r1, r2] = await Promise.all([
    C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 })),
    C.coord.submitIntent(upsert(ID2, { sales: 666 }, { sales: 202 })),
  ]);
  assert.equal(r1.status, "committed"); assert.equal(r2.status, "committed");
  assert.equal(C.sales(ID1), 555); assert.equal(C.sales(ID2), 666);
  assert.equal(C.coord._state().deferredPending, false);
});
test("[H3-D] a FOREIGN row write lands during ours: both are visible afterwards, nothing is invented", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.attach(); C.deliver(remote.getAt(""));
  const other = v2Over(remote);
  C.st.hooks = { beforeCommit: async () => { await other.mutate(upsert(ID2, { sales: 999 }, { sales: 202 })); } };
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed");
  assert.equal(C.sales(ID1), 555); assert.equal(C.sales(ID2), 999);
});
test("[H3-E] a non-commit (conflict) with a parked echo converges exactly as before (R10 path preserved)", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.attach(); C.deliver(remote.getAt(""));
  const other = v2Over(remote);
  C.st.hooks = { beforeRun: async () => { await other.mutate(upsert(ID1, { sales: 777 }, { sales: 101 })); } };
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "conflict"); assert.equal(r.converged, true);
  assert.equal(C.sales(ID1), 777, "the foreign value is displayed");
});
test("[H3-C'] two independent clients write different rows and complete in the OPPOSITE order: both converge on the same authoritative set", async () => {
  const remote = fakeRemote(seed(1));
  const A = coordinatorOver(remote), B = coordinatorOver(remote);
  A.attach(); B.attach(); A.deliver(remote.getAt("")); B.deliver(remote.getAt(""));
  let releaseA; const gateA = new Promise((r) => { releaseA = r; });
  A.st.hooks = { beforeCommit: () => gateA };                       // A started first, commits last
  const pa = A.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  await new Promise((r) => setTimeout(r, 0));
  const rb = await B.coord.submitIntent(upsert(ID2, { sales: 666 }, { sales: 202 }));
  assert.equal(rb.status, "committed");
  assert.equal(B.sales(ID2), 666); assert.equal(B.sales(ID1), 101, "B sees the store as it is: A has not committed yet");
  releaseA(); const ra = await pa;
  assert.equal(ra.status, "committed");
  const truth = JSON.stringify(V2.readV2Rows(remote.getAt("")).rows.map((r) => [r.id, r.sales]));
  assert.equal(JSON.stringify((A.st.displayed || []).map((r) => [r.id, r.sales])), truth, "A converged");
  assert.equal(JSON.stringify((B.st.displayed || []).map((r) => [r.id, r.sales])), truth, "B converged");
  assert.equal(A.coord._state().deferredPending, false); assert.equal(B.coord._state().deferredPending, false);
});
test("[H3-E2] clear-all lands while a stale row mutation is in flight: the mutation fails typed and the client converges on the cleared state", async () => {
  const remote = fakeRemote(seed(1));
  const A = coordinatorOver(remote), B = coordinatorOver(remote);
  A.attach(); B.attach(); A.deliver(remote.getAt("")); B.deliver(remote.getAt(""));
  B.st.hooks = { beforeRun: async () => {
    const rc = await A.coord.submitClearAll({ expectedNodeFingerprint: A.coord.currentFingerprint(), confirmToken: "tok" });
    assert.equal(rc.status, "committed", JSON.stringify(rc)); assert.equal(rc.generation, 2);
  } };
  const rb = await B.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(rb.status, "blocked"); assert.equal(rb.reason, "target_not_found");
  assert.equal(rb.converged, true);
  assert.deepEqual(plain(B.st.displayed), [], "B shows the cleared collection");
  assert.equal(B.st.mode.generation, 2, "B's mode followed the listener");
  assert.equal(remote.getAt("rows"), null, "nothing was resurrected");
  // a NEW intent formed after the rotation is bound to epoch 2 and succeeds
  B.st.hooks = undefined;
  const stale = await B.coord.submitIntent(create(row(ID1, "2026-08-01", 101)));
  assert.equal(stale.status, "committed", "a NEW intent is bound to the live epoch 2 and succeeds");
  assert.equal(remote.getAt("rows/" + ID1)[GK], 2);
});
test("[H3] a parked echo for a RETIRED selection is never applied to the new one", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.deliver(remote.getAt(""));
  C.st.hooks = { beforeCommit: async () => { C.deliver(remote.getAt("")); C.ctrl.invalidate("T", "OTHER"); C.coord.invalidate(); C.st.displayed = "untouched"; } };
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed");
  assert.equal(C.st.displayed, "untouched", "nothing applied across a selection change");
});
test("[H3] the legacy engine's committed collection value is still applied directly (R10 behaviour unchanged)", async () => {
  const remote = fakeRemote({ _v: JSON.stringify([row(ID1, "2026-08-01", 101)]) });
  const C = coordinatorOver(remote); C.deliver(remote.getAt(""));
  assert.equal(C.st.mode.mode, "legacy");
  const r = await C.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed"); assert.deepEqual(plain(r.rows), []); assert.equal(C.st.legacyCalls, 1);
  assert.deepEqual(plain(C.st.displayed), [], "the legacy transaction result is authoritative, as in R10");
});

// ═══ H4 — clear-all through the REAL coordinator entry point ═════════════════
test("[H4] submitClearAll(fingerprint, confirmToken) — exactly what the UI passes — clears and rotates, with a typed result", async () => {
  const remote = fakeRemote(seed(1));
  const C = coordinatorOver(remote); C.attach(); C.deliver(remote.getAt(""));
  const r = await C.coord.submitClearAll({ expectedNodeFingerprint: C.coord.currentFingerprint(), confirmToken: "tok" });
  assert.equal(r.status, "committed"); assert.equal(r.destructive, true); assert.equal(r.generation, 2); assert.deepEqual(plain(r.rows), []);
  assert.equal(remote.getAt("").generation, 2); assert.equal(remote.getAt("rows"), null);
  assert.deepEqual(plain(C.st.displayed), []); assert.equal(C.st.mode.generation, 2, "the mode ref followed the listener");
  // and a stale confirmation is refused, as in R10
  const other = v2Over(remote, { generation: 2 });
  await other.mutate(create(row(ID1, "2026-08-01", 1)));
  const fpBefore = C.coord.currentFingerprint();
  await other.mutate(upsert(ID1, { sales: 2 }, { sales: 1 }));
  const rs = await C.coord.submitClearAll({ expectedNodeFingerprint: fpBefore, confirmToken: "tok" });
  assert.equal(rs.status, "blocked"); assert.equal(rs.reason, "precondition_failed");
  assert.equal(remote.getAt("rows/" + ID1).sales, 2, "nothing cleared");
});
test("[H4] the production clear-all call site passes NO next generation and the coordinator adds none", () => {
  const site = html.indexOf("entriesWriteCoordRef.current.submitClearAll({");
  assert.notEqual(site, -1);
  const call = html.slice(site, html.indexOf("});", site));
  assert.ok(!/nextGeneration/.test(call), "no caller-chosen epoch at the call site");
  const sub = html.indexOf("submitClearAll: (args) => submitIntent({");
  assert.ok(!/nextGeneration/.test(html.slice(sub, html.indexOf("}),", sub))), "nor in the coordinator");
  assert.ok(html.includes("if (intent.nextGeneration !== undefined) return { status: \"blocked\", reason: \"next_generation_not_callable\" };"));
});

// ═══ H5 — absent business bootstraps into V2 ═════════════════════════════════
test("[H5] an absent destination is a V2 destination: the first create initialises the envelope; later writes use the row lane", async () => {
  const remote = fakeRemote(null);
  const C = coordinatorOver(remote); C.attach(); C.deliver(null);
  assert.deepEqual(plain(C.st.mode), { mode: "absent", generation: null }); assert.equal(C.coord.isReady(), true);
  const r = await C.coord.submitIntent(create(row(ID1, "2026-09-01", 10)));
  assert.equal(r.status, "committed"); assert.equal(r.generation, 1); assert.equal(C.st.legacyCalls, undefined, "the legacy engine never ran");
  const node = remote.getAt("");
  assert.equal(node.schemaVersion, 2); assert.equal(node.generation, 1); assert.equal(node._v, undefined, "no legacy blob, ever");
  assert.equal(node.rows[ID1][GK], 1);
  assert.equal(C.st.mode.mode, "v2"); assert.equal(C.sales(ID1), 10);
  assert.deepEqual(remote.st.log.map((l) => l.sub), [""], "one node-level initialisation");
  const r2 = await C.coord.submitIntent(create(row(ID2, "2026-09-02", 20)));
  assert.equal(r2.status, "committed");
  assert.deepEqual(remote.st.log.map((l) => l.sub), ["", "rows/" + ID2], "…then the row lane");
  const again = await C.coord.submitIntent(create(row(ID1, "2026-09-01", 10)));
  assert.equal(again.status, "committed_idempotent"); assert.equal(again.reason, "already_created", "the identical first save, repeated, is idempotent");
});
test("[H5] absent mode refuses everything but a create, and a concurrent initialisation is a typed conflict", async () => {
  const remote = fakeRemote(null);
  const A = v2Over(remote, { mode: "absent" });
  assert.equal((await A.mutate(upsert(ID1, { sales: 1 }, { sales: 0 }))).reason, "target_not_found");
  assert.equal((await A.mutate(ML.buildEntryDeleteIntent(row(ID1, "2026-09-01", 1), {}))).reason, "target_not_found");
  assert.equal((await A.mutate({ type: "clear_all", expectedNodeFingerprint: "x" })).reason, "clear_all_requires_full_hydration");
  assert.equal((await A.mutate(create(row(ID1, "2026-09-01", 1)), { mode: "v2", generation: 1 })).reason, "generation_retired", "a V2-bound intent on an absent node");
  const B = v2Over(remote, { mode: "absent", hooks: { beforeRun: async () => { remote.setAt("", seed(1, [row(ID2, "2026-09-02", 2)])); } } });
  const r = await B.mutate(create(row(ID1, "2026-09-01", 1)));
  assert.equal(r.status, "conflict"); assert.equal(r.detail, "storage_initialised_concurrently");
  assert.equal(remote.getAt("").rows[ID1], undefined, "nothing was overwritten");
});
test("[H5] the router sends absent and v2 to the V2 engine, legacy to the legacy engine, and unknown/malformed nowhere", async () => {
  const calls = [];
  const router = V2.createEntriesStorageRouter({ mode: () => calls.mode,
    legacy: { mutate: async (i, c, b) => { calls.push(["legacy", b]); return { status: "committed" }; } },
    v2: { mutate: async (i, c, b) => { calls.push(["v2", b]); return { status: "committed" }; } } });
  const ctx = { tenantId: "T", bizId: "B", gen: 0 };
  calls.mode = null; assert.equal((await router.mutate({}, ctx, { generation: 1 })).status, "blocked_unhydrated");
  calls.mode = { mode: "malformed", reason: "x" }; assert.equal((await router.mutate({}, ctx, { generation: 1 })).reason, "x");
  calls.mode = { mode: "absent", generation: null }; await router.mutate({}, ctx, { mode: "absent", generation: null });
  calls.mode = { mode: "v2", generation: 3 }; await router.mutate({}, ctx, { mode: "v2", generation: 3 });
  calls.mode = { mode: "legacy", generation: null }; await router.mutate({}, ctx, { mode: "legacy", generation: null });
  assert.deepEqual(calls.map((c) => c[0]), ["v2", "v2", "legacy"]);
  assert.deepEqual(calls[0][1], { mode: "absent", generation: null }); assert.deepEqual(calls[1][1], { mode: "v2", generation: 3 });
});
test("[H5] production wiring: the mode ref is reset on every selection change, set by the listener or the absent probe only, and bound at submission", () => {
  const effect = html.indexOf("// R-V2-H5: the storage mode/epoch belongs to ONE destination.");
  assert.notEqual(effect, -1);
  const effectBody = html.slice(effect, effect + 400);
  assert.ok(effectBody.includes("entriesStorageModeRef.current = null;"), "reset before any listener of the new selection");
  assert.ok(html.includes('if (entriesStorageModeRef.current === null) entriesStorageModeRef.current = { mode: "absent", generation: null };'), "absent probe sets the mode only while unknown");
  assert.ok(html.includes("entriesWriteCoordRef.current.markHydrated(ctxAtSetup, [])"), "R9 absent readiness retained");
  assert.ok(html.includes("entriesStorageModeRef.current = { mode: read.mode, generation: read.generation === undefined ? null : read.generation };"), "listener sets mode + epoch");
  assert.ok(html.includes("mode: () => entriesStorageModeRef.current,"), "the V2 engine reads the live mode");
  assert.ok(html.includes("storageBinding: () => {"), "the coordinator captures the binding");
  assert.ok(html.includes("const binding = io.storageBinding ? io.storageBinding() : undefined;"), "…at submitIntent");
  assert.ok(html.includes("try { res = await io.mutate(job.intent, ctx, job.binding); }"), "…and dispatches the captured binding, never the live one");
  assert.ok(html.includes("convergeDeferred(writeLane);\n      }\n      // R10-GATE-011:"), "a rows-less commit converges on the parked echo");
  assert.equal((html.match(/entriesStorageModeRef\.current = /g) || []).length, 4, "exactly: reset, malformed, listener, absent probe");
});

// ═══ H6 — conversion preserves domain fields; representation policy ═══════════
const preflightDeps = () => ({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId,
  isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r), entryDateKey: ME.entryDateKey,
  detectStorageMode: V2.detectStorageMode, rowGenKey: GK, mapFields: V2.MAP_FIELDS });
test("[H6] a legacy `gen` domain field survives conversion under its own name; the epoch stamp is structurally separate", async () => {
  const { preflightLegacyNode } = createLegacyPreflight(preflightDeps());
  const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST });
  const odd = row(ID1, "2026-08-01", 1, { gen: "legacy-domain-value", nullable: null, supplier_payments: {}, list: [], notes: "" });
  const remote = fakeRemote({ _v: JSON.stringify([odd]) });
  const rep = preflightLegacyNode(remote.getAt(""));
  assert.equal(rep.ok, true); assert.deepEqual(plain(rep.normalization), { rowsAffected: 1, rows: [{ index: 0, paths: ["nullable", "supplier_payments", "list"] }], numericKeyMaps: { rowsAffected: 0, rows: [] } });
  const res = await upgradeBusinessToV2({ transactNode: (t, k, fn) => remote.transact("", fn) }, { tenantId: "T", bizId: "B" });
  assert.equal(res.status, "committed"); assert.equal(res.generation, 1); assert.deepEqual(plain(res.normalization), plain(rep.normalization));
  const stored = remote.getAt("rows/" + ID1);
  assert.equal(stored.gen, "legacy-domain-value"); assert.equal(stored[GK], 1); assert.equal(stored.notes, "");
  const sem = V2.readV2Rows(remote.getAt("")).rows[0];
  assert.equal(sem.gen, "legacy-domain-value"); assert.equal(sem[GK], undefined);
  assert.equal((await upgradeBusinessToV2({ transactNode: (t, k, fn) => remote.transact("", fn) }, { tenantId: "T", bizId: "B", generation: 5 })).reason, "generation_not_callable");
});
test("[H6] representation blockers: reserved key, unrepresentable key, unrepresentable value — reported, never repaired", () => {
  const { preflightLegacyNode } = createLegacyPreflight(preflightDeps());
  const codes = (rows) => preflightLegacyNode({ _v: JSON.stringify(rows) }).blockers.map((b) => b.code);
  assert.deepEqual(codes([row(ID1, "2026-08-01", 1, { [GK]: 3 })]), [PREFLIGHT_BLOCKERS.RESERVED_FIELD_PRESENT]);
  assert.deepEqual(codes([row(ID1, "2026-08-01", 1, { "bad.key": 1 })]), [PREFLIGHT_BLOCKERS.UNREPRESENTABLE_FIELD_KEY]);
  assert.deepEqual(codes([row(ID1, "2026-08-01", 1, { nested: { "a/b": 1 } })]), [PREFLIGHT_BLOCKERS.UNREPRESENTABLE_FIELD_KEY]);
  assert.deepEqual(codes([row(ID1, "2026-08-01", 1, { arr: [1, null] })]), [PREFLIGHT_BLOCKERS.UNREPRESENTABLE_VALUE]);
  const rep = preflightLegacyNode({ _v: JSON.stringify([row(ID1, "2026-08-01", 1, { [GK]: 3 })]) });
  assert.equal(rep.blockers[0].remedy, "operator_resolution_required"); assert.equal(rep.rows, undefined);
  assert.throws(() => createLegacyPreflight({ ...preflightDeps(), rowGenKey: undefined }), /rowGenKey/);
});

// ═══ H7 — semantic idempotent create ══════════════════════════════════════════
test("[H7] canonical storage form: null / undefined / {} / [] are absent, everything else is kept verbatim", () => {
  assert.deepEqual(plain(V2.canonicalStorageValue({ a: null, b: undefined, c: {}, d: [], e: { f: {} }, g: "", h: 0, i: false, j: [0, ""], k: { l: 1 } })),
                   { g: "", h: 0, i: false, j: [0, ""], k: { l: 1 } });
  assert.equal(V2.canonicalStorageValue({}), undefined); assert.equal(V2.canonicalStorageValue(null), undefined);
  assert.equal(V2.canonicalRowKey({ a: 1, b: {} }), V2.canonicalRowKey({ b: null, a: 1 }));
  assert.notEqual(V2.canonicalRowKey({ a: 1 }), V2.canonicalRowKey({ a: "1" }), "type differences are real differences");
  assert.notEqual(V2.canonicalRowKey({ a: 1 }), V2.canonicalRowKey({ a: 1, b: 0 }), "a zero is a value");
});
test("[H7] an exact retry of a create whose empty maps RTDB dropped is idempotent; any real difference is still a collision", () => {
  const nr = { id: ID1, date: "2026-08-09", sales: 5, supplier_payments: {}, hourly_payroll: "", notes: null };
  const storedByRtdb = { id: ID1, date: "2026-08-09", sales: 5, hourly_payroll: "" };
  assert.equal(V2.applyRowIntent(storedByRtdb, create(nr)).status, "already_created");
  assert.equal(V2.applyRowIntent(storedByRtdb, create({ ...nr, sales: 6 })).reason, "id_collision");
  assert.equal(V2.applyRowIntent(storedByRtdb, create({ ...nr, extra: 1 })).reason, "id_collision");
  assert.equal(V2.applyRowIntent(storedByRtdb, create({ ...nr, supplier_payments: { s1: 1 } })).reason, "id_collision");
  assert.equal(V2.applyRowIntent(storedByRtdb, create({ ...nr, [GK]: 1 })).reason, "reserved_field", "the reserved key is not a row field");
  // the delete precondition is the same canonical equality
  const del = ML.buildEntryDeleteIntent({ ...storedByRtdb, supplier_payments: {} }, {});
  assert.equal(V2.applyRowIntent(storedByRtdb, del).ok, true);
  assert.equal(V2.applyRowIntent({ ...storedByRtdb, sales: 6 }, del).status, "conflict");
});
test("[H7] what the V2 engine writes IS the canonical form (no silent store-side transformation)", async () => {
  const written = [];
  const m = V2.createV2EntriesMutator({ selection: ctxFor(), mode: () => ({ mode: "v2", generation: 1 }),
    transactRow: async (t, k, id, fn) => { written.push(fn(null)); return { committed: true }; }, transactNode: async () => { throw new Error("no"); } });
  const r = await m.mutate(create({ id: ID1, date: "2026-08-09", sales: 5, supplier_payments: {}, x: null }), ctxFor().capture(), { mode: "v2", generation: 1 });
  assert.equal(r.status, "committed");
  assert.deepEqual(plain(written[0]), { id: ID1, date: "2026-08-09", sales: 5, [GK]: 1 });
});

// ═══ H9 — the legacy engine refuses V2 nodes ══════════════════════════════════
test("[H9] parseEntriesNode classifies ANY V2-structured node as `storage_v2_node`, never as a legacy blob", () => {
  for (const node of [seed(1), { schemaVersion: 2, generation: 1 }, { generation: 1, _v: "[]" }, { rows: {}, _v: "[]" }, { schemaVersion: 3, _v: "[]" }]) {
    const p = ML.parseEntriesNode(node); assert.equal(p.malformed, true); assert.equal(p.reason, "storage_v2_node");
  }
  assert.deepEqual(plain(ML.parseEntriesNode({ _v: "[]" })), { rows: [] });
  assert.equal(V2.detectStorageMode({ _v: "[]" }).mode, "legacy");
  assert.equal(V2.readEntriesNode({ _v: "not json" }).reason, "legacy_unparseable");
});
test("[H9] the legacy engine returns blocked/storage_mode_mismatch on a V2 node — for a no-op-looking write too — and writes nothing", async () => {
  const remote = fakeRemote(seed(1));
  const ctrl = ctxFor();
  const m = ML.createRemoteEntriesMutator({ selection: ctrl, transact: (t, k, fn) => remote.transact("", fn) });
  const same = await m.mutate(upsert(ID1, { sales: 101 }, { sales: 101 }), ctrl.capture());
  assert.equal(same.status, "blocked"); assert.equal(same.reason, "storage_mode_mismatch"); assert.equal(same.detail, "storage_v2_node");
  const diff = await m.mutate(upsert(ID1, { sales: 999 }, { sales: 101 }), ctrl.capture());
  assert.equal(diff.status, "blocked"); assert.equal(diff.reason, "storage_mode_mismatch");
  assert.deepEqual(remote.getAt(""), plain(seed(1)));
  assert.match(ML.describeSaveOutcome(same, false), /רענן/, "operator-facing text, not the generic catch-all");
  assert.match(ML.describeSaveOutcome({ status: "blocked", reason: "generation_retired" }, false), /רענן/);
  assert.match(ML.describeSaveOutcome({ status: "blocked", reason: "rules_rejected" }, false), /רענן/);
});

// ═══ H8/H1 — the pinned Rules contract ════════════════════════════════════════
const rulesNow = () => JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
const dkOf = (r) => r.rules.tenants["$tenantId"]["$dataKey"];
test("[H8] the shipped Rules ARE the pinned contract: rows must be a map, epochs monotonic, cutover permanent, row stamp under the reserved key", () => {
  const dk = dkOf(rulesNow());
  assert.equal(dk.rows[".validate"], EXPECTED_ENTRIES_DELTA.rows[".validate"]);
  assert.match(dk.rows[".validate"], /newData\.hasChildren\(\)/);
  assert.match(dk.rows["$rowId"][".validate"], /newData\.child\('_gen'\)\.isNumber\(\) && newData\.child\('_gen'\)\.val\(\) === newData\.parent\(\)\.parent\(\)\.child\('generation'\)\.val\(\)/);
  assert.match(dk.generation[".validate"], /newData\.val\(\) === data\.val\(\) \+ 1 && !newData\.parent\(\)\.child\('rows'\)\.exists\(\)/);
  assert.match(dk[".validate"], /: newData\.child\('generation'\)\.val\(\) === 1\)/);
  assert.match(dk[".validate"], /!newData\.child\('rows'\)\.exists\(\) \|\| newData\.child\('rows'\)\.hasChildren\(\)/);
  assert.ok(dk[".write"].includes(CUTOVER_GUARD));
  assert.equal(CUTOVER_GUARD, "(!(data.child('schemaVersion').val() === 2) || newData.child('schemaVersion').val() === 2)");
  assert.equal(readFileSync(join(ROOT, "database.rules.json"), "utf8"), readFileSync(join(ROOT, "test/emulator/database.rules.json"), "utf8"), "emulator copy byte-identical");
});

// ═══ H10 — the S0 guard is semantic ═══════════════════════════════════════════
test("[H10] the S0 rules exception accepts the candidate and rejects every inert / loosening / smuggling mutation", () => {
  const show = gitIn(ROOT, ["show", `${S0_BASE}:database.rules.json`]);
  assert.equal(show.status, 0, show.stderr);
  // VERSION FENCE: the live Rules are the approved Storage V2 core (8cac71c1) plus the exact
  // fence delta. Layer 1: core == BASE + entries contract. Layer 2: live == core + fence.
  const coreShow = gitIn(ROOT, ["show", "8cac71c1248ad5cc49dfa1a727bf292398ae74e8:database.rules.json"]);
  assert.equal(coreShow.status, 0, coreShow.stderr);
  const before = JSON.parse(show.stdout), core = JSON.parse(coreShow.stdout), after = rulesNow();
  assert.deepEqual(authorizedEntriesRulesDelta(before, core), { ok: true });
  assert.equal(dkOf(core)[".write"], expectedWriteRule(dkOf(before)[".write"]));
  assert.deepEqual(authorizedVersionFenceRulesDelta(core, after), { ok: true });
  assert.equal(dkOf(after)[".write"], expectedFencedWriteRule(dkOf(core)[".write"]));
  assert.deepEqual(after.rules.storage_v2_control, EXPECTED_STORAGE_V2_CONTROL_RULES);
  assert.equal(authorizedEntriesRulesDelta(before, after).ok, false, "the fenced rules are NOT accepted as a plain core (no blanket exemption)");
  // mutations are applied to the LIVE rules and checked against the core→fence exception
  const mutate = (f) => { const x = structuredClone(after); f(dkOf(x), x); return authorizedVersionFenceRulesDelta(core, x); };
  const cases = {
    "unrelated authorization change": (d) => { d[".write"] = "true"; },
    "unexpected rule path": (d) => { d.unexpected = { ".validate": "true" }; },
    "plain inert row validator": (d) => { d.rows["$rowId"][".validate"] = "true"; },
    "inert row expression retaining tokens": (d) => { d.rows["$rowId"][".validate"] = "true || (" + d.rows["$rowId"][".validate"] + ")"; },
    "inert envelope retaining tokens": (d) => { d[".validate"] = "true || (" + d[".validate"] + ")"; },
    "inert generation retaining tokens": (d) => { d.generation[".validate"] = "true || (" + d.generation[".validate"] + ")"; },
    "inert _v retaining tokens": (d) => { d._v[".validate"] = "true || (" + d._v[".validate"] + ")"; },
    "inert schemaVersion retaining tokens": (d) => { d.schemaVersion[".validate"] = "(" + d.schemaVersion[".validate"] + ") || true"; },
    "row child authorization injection": (d) => { d.rows["$rowId"].id[".write"] = "true"; },
    "cutover guard dropped": (d) => { d[".write"] = d[".write"].replace(" && " + CUTOVER_GUARD, ""); },
    "cutover guard weakened": (d) => { d[".write"] = d[".write"].replace(CUTOVER_GUARD, "true"); },
    "fence guard dropped (core rules)": (d) => { d[".write"] = dkOf(core)[".write"]; },
    "fence guard wrapped inert": (d) => { d[".write"] = d[".write"].replace(FENCE_GUARD, "(true || " + FENCE_GUARD + ")"); },
    "fence: whole-record absence replaced by missing-phase test": (d) => { d[".write"] = d[".write"].replace(".exists() ||", ".child('phase').exists() === false ||"); },
    "fence: init flag conjunct removed": (d) => { d[".write"] = d[".write"].replace(": root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('allowV2Initialization').val() === true)", ": true)"); },
    "fence: populated-legacy conversion allowed": (d) => { d[".write"] = d[".write"].replace("(data.exists() ? data.child('schemaVersion').val() === 2 : ", "(data.exists() ? true : "); },
    "fence: frozen _v guard removed": (d) => { d[".write"] = d[".write"].replace(" && (!data.child('_v').exists() || newData.child('_v').val() === data.child('_v').val())", ""); },
    "fence: quiesced admitted to the legacy branch": (d) => { d[".write"] = d[".write"].replace("=== 'legacy')) && !(newData", "=== 'legacy' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'quiesced')) && !(newData"); },
    "fence: contract validity conjunct removed": (d) => { d[".write"] = d[".write"].replace(".child('contractVersion').val() === 1 && ", ""); },
    "control root client-writable at the business node": (d, x) => { x.rules.storage_v2_control["$tenantId"]["$bizId"][".write"] = "auth !== null"; },
    "control root client-writable at the tenant node": (d, x) => { x.rules.storage_v2_control["$tenantId"][".write"] = "true"; },
    "control root widened read": (d, x) => { x.rules.storage_v2_control["$tenantId"]["$bizId"][".read"] = "auth !== null"; },
    "control root missing": (d, x) => { delete x.rules.storage_v2_control; },
    "control root extra child": (d, x) => { x.rules.storage_v2_control.extra = { ".write": "true" }; },
    "rows map rule dropped": (d) => { delete d.rows[".validate"]; },
    "epoch step loosened": (d) => { d.generation[".validate"] = d.generation[".validate"].replace("data.val() + 1", "data.val() + 2"); },
    "epoch rollback permitted": (d) => { d.generation[".validate"] = d.generation[".validate"].replace("newData.val() === data.val() ||", "newData.val() <= data.val() ||"); },
    "row stamp renamed away from the reserved key": (d) => { d.rows["$rowId"][".validate"] = d.rows["$rowId"][".validate"].split("'_gen'").join("'gen'"); },
    "legacy regex loosened": (d) => { d._v[".validate"] = d._v[".validate"].replace("length <= 1048576", "length <= 2097152"); },
    "extra child rule under rows": (d) => { d.rows.extra = { ".validate": "true" }; },
    "VAT-adjacent node touched": (d, x) => { x.rules.tenants["$tenantId"].config = { ".validate": "true" }; },
  };
  for (const [name, f] of Object.entries(cases)) {
    const r = mutate(f); assert.equal(r.ok, false, name); assert.ok(r.reason, name);
  }
  const ws = structuredClone(after); dkOf(ws).generation[".validate"] = dkOf(ws).generation[".validate"].replace(/ && /g, "  &&  ");
  assert.deepEqual(authorizedVersionFenceRulesDelta(core, ws), { ok: true }, "whitespace normalization only (outside the exact-string write rule)");
  // the fence predicate itself is compared as an EXACT string: even whitespace inside it is a change
  const fw = structuredClone(after); dkOf(fw)[".write"] = dkOf(fw)[".write"].replace("=== 'v2_active' &&", "=== 'v2_active'  &&");
  assert.equal(authorizedVersionFenceRulesDelta(core, fw).ok, false, "fence guard is exact");
});
test("[H10] the VAT S0 guard consumes the semantic module (no token checks remain) and its VAT assertions are untouched", () => {
  const vat = readFileSync(join(ROOT, "test/finance/vat-invariant.test.mjs"), "utf8");
  assert.ok(vat.includes('import { authorizedEntriesRulesDelta, authorizedVersionFenceRulesDelta, APPROVED_FENCE_RULES_BLOB } from "../support/rules-authorized-delta.mjs";'));
  // VERSION FENCE: Layer A validates the exact core→fence Rules delta and the reviewed blob;
  // no blanket post-core allowance and no path exemption
  assert.ok(vat.includes("const fenceDelta = authorizedVersionFenceRulesDelta(coreRules, liveRules);"));
  assert.ok(vat.includes("APPROVED_FENCE_RULES_BLOB, \"database.rules.json is the reviewed fenced version (exact blob)\""));
  assert.ok(vat.includes('rel === "database.rules.json"))'), "only the validated Rules change is projected out of the reader layer");
  assert.ok(vat.includes("return authorizedEntriesRulesDelta(before, after).ok === true;"));
  assert.ok(!vat.includes('.includes("matches(")'), "token presence is no longer an acceptance criterion");
  assert.ok(!vat.includes("biz:[^:]+:entries\")) return false"), "token presence is no longer an acceptance criterion");
  // P0-DATA-01 server readers (CTO, 2026-09-23): the scope test is now two-layered —
  // Layer A keeps the historical contract BASE → approved core, Layer B authorizes the
  // pinned server-reader delta by CONTENT through the semantic module.
  assert.ok(vat.includes('from "../support/server-reader-authorized-delta.mjs";'));
  assert.ok(vat.includes("const verdict = serverReaderScopeVerdict(live);"));
  assert.ok(vat.includes("assert.deepEqual(verdict, { ok: true },"));
  assert.ok(!/authorized\s*[:=]\s*\[\s*["']src\/[a-z]+\/["']/.test(vat), "no directory allowlist in the guard");
  // Against the candidate's parent: the ONLY differences are the imports and the body
  // of the S0 scope test up to its added-line content check. Every VAT assertion (1–4)
  // and the added-line regex are byte-identical.
  const parent = gitIn(ROOT, ["show", "cb8ac84e2dbc5c23b6fe0eee2083be6f326d3894:test/finance/vat-invariant.test.mjs"]);
  assert.equal(parent.status, 0, parent.stderr);
  const strip = (src) => src
    .replace(/import \{[^}]*\} from "\.\.\/support\/rules-authorized-delta\.mjs";\n/, "")
    .replace(/import \{[^}]*\} from "\.\.\/support\/server-reader-authorized-delta\.mjs";\n/, "")
    .replace(/(test\("S0 diff contains no historical data transform, migration, RTDB rules, or forbidden runtime area", \(\) => \{\n)[\s\S]*?(?=  const runtimeDiff = )/, "$1<scope-checks>");
  assert.equal(strip(vat), strip(parent.stdout), "nothing outside the scope-check body changed");
  assert.ok(strip(vat).includes("<scope-checks>"), "the scope test was located");
});
