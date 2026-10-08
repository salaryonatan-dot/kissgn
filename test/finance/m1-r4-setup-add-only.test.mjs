// M1 integration R4 (LOCAL; pending independent Codex review) — review findings S1 (a new-business creation replaced an
// existing business on an id collision) and S2 (the client side of the setup's authorization / unknown-outcome windows).
// The page's OWN code: the C1 seam helpers (window.MarjinC1, extracted from index.html) and the page's own completeSetup
// (extracted verbatim and run with recording seams: an RTDB-transaction-faithful mutateFor — a cold null first pass, re-run
// against the server node, `undefined` aborts — a fixed clock, and a bootstrap endpoint answering as api/admin.js does).
//   SA-01  the review's case: a valid unchanged registry already holding biz_42; creating biz_42 is REFUSED
//          (registry_id_collision), never a replacement — also for a trimmed / coerced spelling of the same id
//   SA-02  the actual completeSetup with Date.now() fixed at 42 over a stored biz_42 (the "+" add-business branch): a FRESH
//          id (biz_42_1) is created beside it; biz_42's record and its config are untouched
//   SA-03  a concurrent addition of the same id between the page's read and its write: the transaction (on its re-run against
//          the server node) refuses; nothing replaced; no config / supplier / fixed-cost / user write
//   SA-04  an UNKNOWN registry-write outcome (the transaction threw): the stored node is re-read — committed ⇒ setup continues
//          exactly once; not committed / changed / unreadable re-read ⇒ setup stops with no further write
//   SA-05  the bootstrap answer gates the setup: tenant_has_data / a failed bootstrap ⇒ NOTHING is written (no registry, no
//          mapping, no config); an existing tenant (409 tenant_already_initialized) ⇒ the add-business write proceeds without
//          any mapping write; legitimate first onboarding (2xx) ⇒ the registry, mapping and config are written
//   SA-06  freshBusinessId / registryIdTaken / registrySetupReread / setupBootstrapProceed, literal
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { loadSeam } from "../support/c1-seam.mjs";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const env = (list) => ({ _v: JSON.stringify(list) });
const plain = (v) => JSON.parse(JSON.stringify(v));
const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));
const ORIGINAL = { id: "biz_42", name: "original" };

test("SA-01 the review's case: creating an id the unchanged registry already holds is refused, never a replacement", () => {
  assert.deepEqual(plain(C1.registrySetupWrite(env([ORIGINAL]), [ORIGINAL], { id: "biz_42", name: "new" })), { ok: false, reason: "registry_id_collision" });
  const X = { id: "bizX" };   // keeps the registry readable, so the collision itself is what refuses
  for (const [stored, id] of [[[{ id: "biz_42 " }], "biz_42"], [[{ id: " biz_42" }], "biz_42"], [[X, "biz_42"], "biz_42"], [[X, { id: 42 }], "42"], [[{ name: "x" }, { id: "biz_42", inactive: true }], "biz_42"]]) {
    const r = C1.registrySetupWrite(env(stored), C1.businessRegistryNodeView(env(stored)).list, { id, name: "new" });
    assert.deepEqual(plain(r), { ok: false, reason: "registry_id_collision" }, JSON.stringify(stored));
  }
  assert.deepEqual(plain(C1.registrySetupWrite(env([ORIGINAL]), [ORIGINAL], { id: "biz_43", name: "new" })), { ok: true, value: env([ORIGINAL, { id: "biz_43", name: "new" }]) }, "a fresh id is added beside it");
});

// ── the page's own completeSetup ─────────────────────────────────────────────────────────────────────────────────────────
const CS_START = "  const completeSetup = async (cfg, sups, fixed, firstOwner) => {", CS_END = "  const saveAppUsers = async (users) => {";
/**
 * opts: stored (registry node), businesses (the page's list), now (Date.now), tenant ("existing" | "new"),
 *       bootstrap: { status, body } | "throws", race (node written by "another device" before the first server run),
 *       lostAck: "after-commit" | "before-commit", reread: "throws" | undefined
 */
function completeSetupOf(opts) {
  const i = HTML.indexOf(CS_START), j = HTML.indexOf(CS_END, i);
  assert.ok(i > 0 && j > i, "completeSetup source");
  let node = opts.stored === undefined ? null : clone(opts.stored);
  const writes = [], state = {}, calls = [];
  let raced = false;
  const storage = {
    mutateFor: async (tenantId, key, fn) => {
      calls.push({ op: "mutateFor", tenantId, key });
      if (opts.race && !raced) { raced = true; node = clone(opts.race); }
      let base = null;
      for (let k = 0; k < 5; k++) {
        const next = fn(clone(base));
        if (next === undefined) return { committed: false, snapshot: { val: () => clone(node) } };
        if (JSON.stringify(base) === JSON.stringify(node)) {
          if (opts.lostAck === "before-commit") throw new Error("transport closed before commit");
          writes.push({ op: "txn", tenantId, key, value: clone(next) });
          node = clone(next);
          if (opts.lostAck === "after-commit") throw new Error("acknowledgement lost");
          return { committed: true, snapshot: { val: () => clone(node) } };
        }
        base = clone(node);
      }
      throw new Error("maxretry");
    },
    getNode: async (key) => { calls.push({ op: "getNode", key }); if (opts.reread === "throws") throw new Error("read failed"); if (opts.rereadChanged) return env([{ id: "zzz" }]); return clone(node); },
    set: async (key, value) => { writes.push({ op: "set", key, value }); },
    getUid: () => "u1",
  };
  const fetch = async (url, o) => {
    calls.push({ op: "fetch", url, body: o && o.body });
    if (opts.bootstrap === "throws") throw new Error("network");
    const b = opts.bootstrap || { status: 409, body: { error: "tenant_already_initialized" } };
    return { ok: b.status >= 200 && b.status < 300, status: b.status, json: async () => b.body };
  };
  const existing = opts.tenant !== "new";
  const window = { storage, MarjinC1: C1, setTenantId: (t) => calls.push({ op: "setTenantId", t }), _currentTenantId: existing ? "tenantA" : null,
    _rtdbSet: async (p, v) => { writes.push({ op: "rtdbSet", key: p, value: v }); }, _auth: { currentUser: { uid: "u1", getIdToken: async () => "t" } } };
  const set = (k) => (v) => { state[k] = typeof v === "function" ? v(state[k]) : v; };
  const ctx = {
    window, loggedInUser: existing ? { _tenantId: "tenantA", role: "super_owner" } : null, businesses: opts.businesses || [],
    invalidateSelection: () => {}, sessionStorage: { setItem: (k, v) => writes.push({ op: "session", key: k, value: v }), getItem: () => null },
    fetch, setTimeout: (f) => f(), console: { log() {}, error() {}, warn() {} }, Date: { now: () => opts.now ?? 42 },
    setBusinesses: set("businesses"), setBizRegistry: set("bizRegistry"), setShowSetup: set("showSetup"), setBusinessConfig: set("config"),
    setSuppliers: set("suppliers"), setFixedList: set("fixed"), setAppUsers: set("users"), setLoggedInUser: set("loggedInUser"),
    setCurrentBizId: set("currentBizId"), setSetupDone: set("setupDone"), setShowBizSelect: set("showBizSelect"),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function("ctx", "with (ctx) { " + HTML.slice(i, j) + "\n return completeSetup; }")(ctx);
  return { run: () => fn({ businessName: "New" }, [{ id: "s", name: "S" }], [{ id: "f", amount: 1 }], null), writes, state, calls, node: () => node };
}
const businessWrites = (w) => w.filter((x) => x.op === "set" && /^biz:/.test(x.key));
const mappingWrites = (w) => w.filter((x) => x.op === "rtdbSet" && /^user_tenants\//.test(x.key));

test("SA-02 the actual completeSetup with a fixed clock over a stored biz_42: a fresh id is created beside it", async () => {
  const cs = completeSetupOf({ stored: env([ORIGINAL]), businesses: [ORIGINAL], now: 42 });
  await cs.run();
  const list = JSON.parse(cs.node()._v);
  assert.deepEqual(list, [ORIGINAL, { id: "biz_42_1", name: "New" }], "the existing record is kept, the new one has a fresh id");
  assert.deepEqual(businessWrites(cs.writes).map((w) => w.key), ["biz:biz_42_1:config", "biz:biz_42_1:suppliers", "biz:biz_42_1:fixed"], "only the NEW business's config / suppliers / fixed costs are written");
  assert.equal(cs.state.currentBizId, "biz_42_1");
  assert.deepEqual(cs.state.bizRegistry, { state: "ready" });
});

test("SA-03 a concurrent addition of the same id: the transaction refuses on its re-run; nothing replaced, nothing else written", async () => {
  // the page read [] (absent); another device then wrote biz_42 — the very id this page generates at Date.now() = 42
  for (const [label, stored, businesses, race] of [
    ["absent read, then biz_42 created elsewhere", undefined, [], env([ORIGINAL])],
    ["[A] read, then biz_42 appended elsewhere", env([{ id: "bizA" }]), [{ id: "bizA" }], env([{ id: "bizA" }, ORIGINAL])],
  ]) {
    const cs = completeSetupOf({ stored, businesses, race, now: 42 });
    await cs.run();
    assert.deepEqual(cs.node(), race, label + ": the other device's registry is untouched");
    assert.deepEqual(cs.writes.filter((w) => w.op === "txn"), [], label + ": no registry write");
    assert.deepEqual(businessWrites(cs.writes), [], label + ": no config / supplier / fixed-cost write");
    assert.equal(cs.state.bizRegistry.state, "unavailable", label);
    assert.equal(cs.state.currentBizId, undefined, label);
  }
});

test("SA-04 an unknown registry-write outcome is decided by re-reading the stored node", async () => {
  {
    const cs = completeSetupOf({ stored: env([]), businesses: [], lostAck: "after-commit" });
    await cs.run();
    assert.deepEqual(JSON.parse(cs.node()._v), [{ id: "biz_42", name: "New" }], "committed once");
    assert.equal(cs.writes.filter((w) => w.op === "txn").length, 1, "never written twice");
    assert.deepEqual(businessWrites(cs.writes).map((w) => w.key), ["biz:biz_42:config", "biz:biz_42:suppliers", "biz:biz_42:fixed"], "the committed setup continues");
    assert.deepEqual(cs.state.bizRegistry, { state: "ready" });
  }
  for (const [label, o, reason] of [
    ["not committed", { lostAck: "before-commit" }, "not_committed"],
    ["re-read fails", { lostAck: "after-commit", reread: "throws" }, "write_unknown"],
    ["re-read shows another change", { lostAck: "after-commit", rereadChanged: true }, "write_unknown"],
  ]) {
    const cs = completeSetupOf({ stored: env([]), businesses: [], ...o });
    await cs.run();
    assert.deepEqual(businessWrites(cs.writes), [], label + ": no config / supplier / fixed-cost write");
    assert.deepEqual(cs.state.bizRegistry, { state: "unavailable", reason }, label);
    assert.equal(cs.state.currentBizId, undefined, label);
  }
});

test("SA-05 the bootstrap answer gates the setup: refused / failed ⇒ nothing written; existing tenant / onboarding ⇒ proceeds", async () => {
  for (const [label, bootstrap, reason] of [
    ["a role-less tenant holding data", { status: 409, body: { error: "tenant_has_data" } }, "setup_tenant_has_data"],
    ["bootstrap 500", { status: 500, body: { error: "bootstrap failed" } }, "setup_bootstrap_failed"],
    ["bootstrap 503", { status: 503, body: { error: "bootstrap check failed" } }, "setup_bootstrap_failed"],
    ["network failure", "throws", "setup_bootstrap_failed"],
    ["unauthenticated", { status: 401, body: { error: "unauthorized" } }, "setup_bootstrap_failed"],
  ]) {
    const cs = completeSetupOf({ tenant: "new", stored: undefined, businesses: [], bootstrap });
    await cs.run();
    assert.equal(cs.node(), null, label + ": no registry write");
    assert.deepEqual(cs.calls.filter((c) => c.op === "mutateFor"), [], label + ": the registry transaction never starts");
    assert.deepEqual(mappingWrites(cs.writes), [], label + ": no user mapping");
    assert.deepEqual(cs.writes.filter((w) => w.op !== "session"), [], label + ": nothing written at all");
    assert.deepEqual(cs.state.bizRegistry, { state: "unavailable", reason }, label);
  }
  {
    const cs = completeSetupOf({ stored: env([{ id: "bizA" }]), businesses: [{ id: "bizA" }], bootstrap: { status: 409, body: { error: "tenant_already_initialized" } } });
    await cs.run();
    assert.deepEqual(JSON.parse(cs.node()._v).map((b) => b.id), ["bizA", "biz_42"], "existing tenant: the add-business write proceeds");
    assert.deepEqual(mappingWrites(cs.writes), [], "… with no mapping write (the server granted nothing)");
  }
  {
    const cs = completeSetupOf({ tenant: "new", stored: undefined, businesses: [], bootstrap: { status: 200, body: { ok: true, tenantId: "biz_42", role: "super_owner" } } });
    await cs.run();
    assert.equal(cs.calls.find((c) => c.op === "fetch").body, JSON.stringify({ tenantId: "biz_42" }), "a new tenant is the fresh business id");
    assert.deepEqual(JSON.parse(cs.node()._v), [{ id: "biz_42", name: "New" }], "legitimate onboarding writes the registry");
    assert.deepEqual(mappingWrites(cs.writes).map((w) => [w.key, w.value]), [["user_tenants/u1", "biz_42"]], "… and the mapping");
    assert.ok(businessWrites(cs.writes).some((w) => w.key === "biz:biz_42:config"), "… and the config");
  }
});

test("SA-06 the helpers, literal", () => {
  assert.equal(C1.freshBusinessId([], 42), "biz_42");
  assert.equal(C1.freshBusinessId([ORIGINAL], 42), "biz_42_1");
  assert.equal(C1.freshBusinessId([ORIGINAL, { id: "biz_42_1" }, { id: " biz_42_2" }], 42), "biz_42_3");
  assert.equal(C1.registryIdTaken([null, { name: "x" }], "undefined"), true, "an id-less record collides with 'undefined' exactly as the server rule");
  assert.equal(C1.registryIdTaken([null], "null"), false, "a bare null carries no identity");
  const N = { id: "n", name: "N" };
  assert.equal(C1.registrySetupReread(env([ORIGINAL, N]), [ORIGINAL], N), "committed");
  assert.equal(C1.registrySetupReread(env([ORIGINAL]), [ORIGINAL], N), "not_committed");
  assert.equal(C1.registrySetupReread(null, [], N), "not_committed");
  assert.equal(C1.registrySetupReread(env([N, ORIGINAL]), [ORIGINAL], N), "changed");
  assert.equal(C1.registrySetupReread([ORIGINAL, N], [ORIGINAL], N), "changed");
  assert.deepEqual(plain(C1.setupBootstrapProceed(200, { ok: true })), { proceed: true, owner: true });
  assert.deepEqual(plain(C1.setupBootstrapProceed(200, { ok: false })), { proceed: false, reason: "setup_bootstrap_failed" });
  assert.deepEqual(plain(C1.setupBootstrapProceed(409, { error: "tenant_already_initialized" })), { proceed: true, owner: false });
  assert.deepEqual(plain(C1.setupBootstrapProceed(409, { error: "tenant_has_data" })), { proceed: false, reason: "setup_tenant_has_data" });
  assert.deepEqual(plain(C1.setupBootstrapProceed(409, {})), { proceed: false, reason: "setup_bootstrap_failed" });
});
