// CC1 — the checklist write (setBizDocGuarded, lib/repositories/bizDataRepo.js) under the RTDB transaction contract, driven through
// the REAL api/admin.js handlers (set-checklist-template-items / set-checklist-run / set-checklist-simple-run) with the I4 boundary
// harness. The harness database is the SERVER; each test gives the transaction a server instance's LOCAL cache, exactly as the
// documented RTDB semantics (and the CD-M2 model in entry-exceptions-repo-cold-cache.test.mjs) describe:
//   * the first invocation of the update function receives the LOCAL cache (null on a cold instance, possibly stale on a warm one);
//   * returning `undefined` aborts WITHOUT consulting the server;
//   * returning a value makes the server compare it with its own value: equal → commit; different → re-run with the server value.
// Before CC1 the transaction aborted on the first (cache) run, so an edit of an EXISTING checklist with its correct token was refused
// with 409 checklist_conflict on a cold instance (I7-O1 / I7E-O1). The same behaviour is proven on the real emulator in
// test/emulator/checklist-cold-cache-emulator.mjs (CCE-01..07).
//   CC-01  cold cache, existing document, the correct token: served (200) and persisted — every family
//   CC-02  warm cache equal to the server: served (unchanged)
//   CC-03  STALE warm cache, the client's token is the CURRENT one: the server value decides — served
//   CC-04  a real conflict (stale token) cold, warm-correct and stale-warm: 409, the newer document kept; no write after the server value
//   CC-05  a STALE cache that happens to match the stale token while the server moved on: refused (the cache is never trusted)
//   CC-06  missing record: wrong token refused with nothing created; the null-document token creates; a stale cache of a deleted doc refused
//   CC-07  two writers with the same token (cold instances): exactly one served, the winner's document stored
//   CC-08  authorization and registry precedence: 401 / 403 / 403 / 403 / 503 with no transaction and no write
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { adminHarness, closeSdk, clone, env, seed } from "../support/i4-boundary-harness.mjs";
import { checklistVersionToken } from "../../lib/checklistVersion.js";

const DOC0 = { items: [{ id: "a", label: "Open", done: false }] };
const DOC1 = { items: [{ id: "a", label: "Open", done: true }] };
const DOC2 = { items: [{ id: "a", label: "Open", done: true }, { id: "b", label: "Close", done: false }] };
const tok = (d) => checklistVersionToken(d);
const FAMILIES = [
  ["set-checklist-template-items", { templateId: "t1" }, "checklist_template_items:t1"],
  ["set-checklist-run", { businessDate: "2026-10-01" }, "checklist_runs:2026-10-01"],
  ["set-checklist-simple-run", { businessDate: "2026-10-01", templateId: "t1" }, "checklist_simple_runs:2026-10-01:t1"],
];
const docPath = (suffix) => `tenants/tenantA/biz:bizA:${suffix}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let H = null;
async function harness() { if (!H) H = await adminHarness(); return H; }
after(async () => { await closeSdk(); });

/** Reset the server and give every transaction on `path` the instance cache `cache` (undefined → cold: null). */
function server(h, docs = {}, caches = {}) {
  const s = seed();
  for (const [p, v] of Object.entries(docs)) { const ks = p.split("/"); let o = s; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks.at(-1)] = clone(v); }
  h.reset(s);
  const txns = [];
  const ref0 = h.__ref0 ??= h.db.ref;
  h.db.ref = (p) => {
    const r = ref0(p);
    r.transaction = async (fn) => {
      const t = { path: p, runs: 0, seen: [], committed: null, wrote: false }; txns.push(t);
      let local = Object.prototype.hasOwnProperty.call(caches, p) ? clone(caches[p]) : null;
      for (let i = 0; i < 25; i++) {
        t.runs++; t.seen.push(clone(local));
        const out = fn(clone(local));
        if (out === undefined) { t.committed = false; return { committed: false }; }                 // abort: no server round-trip
        const cur = h.db.read(p);
        if (same(local, cur)) { h.db.writes.push(p); h.db.put(p, out); t.committed = true; t.wrote = !same(out, cur); caches[p] = clone(out); return { committed: true }; }
        local = clone(cur); caches[p] = clone(cur);                                                  // hash mismatch: re-run with the server value
      }
      throw new Error("maxretry");
    };
    return r;
  };
  return { txns, caches };
}
const write = (h, [action, extra], doc, expectedVersionToken, actor = "mgr", over = {}) =>
  h.call(action, { tenantId: "tenantA", bizId: "bizA", ...extra, doc, expectedVersionToken, ...over }, actor);

test("CC-01 cold cache, existing document, the correct token: served (200) and persisted — every family", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    const { txns } = server(h, { [p]: env(DOC0) });
    const r = await write(h, fam, DOC1, tok(DOC0));
    assert.deepEqual([r.code, r.body], [200, { ok: true, document: DOC1, versionToken: tok(DOC1) }], fam[0]);
    assert.deepEqual(h.db.read(p), env(DOC1), fam[0] + " persisted");
    assert.deepEqual(txns.map((t) => [t.path, t.seen[0], t.runs >= 2]), [[p, null, true]], fam[0] + ": the cold cache was seen first and the server consulted");
  }
});

test("CC-02 warm cache equal to the server: served in one run (unchanged behaviour)", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    const { txns } = server(h, { [p]: env(DOC0) }, { [p]: env(DOC0) });
    const r = await write(h, fam, DOC1, tok(DOC0));
    assert.equal(r.code, 200, fam[0]); assert.deepEqual(h.db.read(p), env(DOC1));
    assert.equal(txns[0].runs, 1, fam[0] + ": one run");
  }
});

test("CC-03 STALE warm cache, the client's token is the CURRENT one: the server value decides — served", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    server(h, { [p]: env(DOC2) }, { [p]: env(DOC0) });                          // the instance still caches DOC0; the server holds DOC2
    const r = await write(h, fam, DOC1, tok(DOC2));                              // the client read DOC2
    assert.equal(r.code, 200, fam[0]); assert.deepEqual(h.db.read(p), env(DOC1), fam[0] + " persisted");
  }
});

test("CC-04 a real conflict (stale token): 409 checklist_conflict, the newer document kept — cold, warm-correct and stale-warm", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    for (const [label, caches] of [["cold", {}], ["warm", { [p]: env(DOC2) }], ["stale-warm", { [p]: env(DOC1) }]]) {
      const { txns } = server(h, { [p]: env(DOC2) }, caches);                   // the server holds DOC2; the client read DOC0
      const r = await write(h, fam, DOC1, tok(DOC0));
      assert.deepEqual([r.code, r.body], [409, { ok: false, error: "checklist_conflict" }], `${fam[0]} ${label}`);
      assert.deepEqual(h.db.read(p), env(DOC2), `${fam[0]} ${label}: the newer document kept`);
      assert.equal(txns.length, 1);
      // once the server's value has been seen, a mismatch aborts (no write); only a cache that already equals the server can be re-submitted
      // unchanged (an identical-value commit: nothing changes)
      assert.equal(txns[0].wrote, false, `${fam[0]} ${label}: the stored value never changes`);
      if (label !== "warm") assert.equal(txns[0].committed, false, `${fam[0]} ${label}: aborted on the server value`);
    }
  }
});

test("CC-05 a STALE cache that matches the stale token while the server moved on: refused — the cache is never trusted", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    const { txns } = server(h, { [p]: env(DOC2) }, { [p]: env(DOC0) });       // cache DOC0 = the client's (stale) read; server DOC2
    const r = await write(h, fam, DOC1, tok(DOC0));
    assert.equal(r.code, 409, fam[0]); assert.deepEqual(h.db.read(p), env(DOC2), fam[0] + ": DOC2 kept");
    assert.deepEqual([txns[0].committed, txns[0].runs], [false, 2], fam[0] + ": the server value decided");
  }
});

test("CC-06 missing record: wrong token refused with nothing created; the null-document token creates; a stale cache of a deleted doc refused", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    server(h);
    let r = await write(h, fam, DOC0, tok(DOC1));
    assert.deepEqual([r.code, r.body], [409, { ok: false, error: "checklist_conflict" }], fam[0] + " wrong token");
    assert.equal(h.db.read(p), null, fam[0] + ": nothing created");
    r = await write(h, fam, DOC0, tok(null));
    assert.equal(r.code, 200, fam[0] + " create"); assert.deepEqual(h.db.read(p), env(DOC0));
    server(h, {}, { [p]: env(DOC0) });                                          // the instance still caches a document the server no longer has
    r = await write(h, fam, DOC1, tok(DOC0));
    assert.equal(r.code, 409, fam[0] + " deleted on the server"); assert.equal(h.db.read(p), null, fam[0] + ": not resurrected");
  }
});

test("CC-07 two writers with the same token on cold instances: exactly one served, the winner's document stored", async () => {
  const h = await harness();
  for (const fam of FAMILIES) {
    const p = docPath(fam[2]);
    const st = server(h, { [p]: env(DOC0) });
    const a = await write(h, fam, DOC1, tok(DOC0));
    delete st.caches[p];                                                        // the second writer runs on another cold instance
    const b = await write(h, fam, DOC2, tok(DOC0));
    assert.deepEqual([a.code, b.code], [200, 409], fam[0]);
    assert.deepEqual(h.db.read(p), env(DOC1), fam[0] + ": the first writer's document stands");
  }
});

test("CC-08 authorization and registry precedence unchanged: refused before any transaction or write", async () => {
  const h = await harness();
  const fam = FAMILIES[0], p = docPath(fam[2]);
  const reg = (v) => ({ "tenants/tenantA/app/business": v });
  const cases = [
    ["unauthenticated", null, {}, {}, 401],
    ["viewer (below manager)", "view", {}, {}, 403],
    ["another tenant's owner", "foreign", {}, {}, 403],
    ["unregistered business", "mgr", reg(env([{ id: "bizB", name: "Beta" }])), {}, 403],
    ["ambiguous registry (padded twin)", "mgr", reg(env([{ id: "bizA", name: "A" }, { id: " bizA", name: "A2" }])), {}, 503],
  ];
  for (const [label, actor, docs, over, code] of cases) {
    const { txns } = server(h, { [p]: env(DOC0), ...docs });
    const before = h.db.value();
    const r = await write(h, fam, DOC1, tok(DOC0), actor, over);
    assert.equal(r.code, code, label + ": " + JSON.stringify(r.body));
    assert.deepEqual(txns, [], label + ": no transaction");
    assert.deepEqual(h.db.writes, [], label + ": no write");
    assert.deepEqual(h.db.value(), before, label + ": state unchanged");
    assert.ok(!h.db.refs.includes(p), label + ": the document is never referenced");
  }
});
