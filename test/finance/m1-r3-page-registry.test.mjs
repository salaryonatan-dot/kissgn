// M1 integration R3 (LOCAL; pending independent Codex review) — the page judges the STORED business-registry node by the
// server rule, and the first-business setup can never replace an existing registry.
// Review findings R2-01 (an existing registry `[null]` / `[{name}]` opened the first-business setup, and completing it
// replaced the stored list) and R2-03 (a raw-array registry — unreadable on the server — loaded the dashboard with figures).
//   PR3-01  businessRegistryNodeView: the stored node → absent / empty / ready / unreadable (literal expectations), over the
//           real runtime shapes (the `{_v}` envelope) and the rejected ones (raw array, bare JSON string, object map, …)
//   PR3-02  behavioural PARITY with the server rule (lib/businessRegistry.js decodeRegistryNode + classifyRegistryTarget) over
//           a corpus of stored nodes × requested ids: the page binds financial data to (node, id) ONLY when the server
//           classifies that target "registered"; a node the server cannot decode is never "ready" on the page
//   PR3-03  firstSetupEligible: only a confirmed absent / empty registry (or an unknown tenant), never a non-empty one
//   PR3-04  registrySetupWrite (the CAS body): adds the record only over the registry the page decided on; a malformed,
//           non-runtime or changed node is refused (never replaced)
//   PR3-05  the ACTUAL completeSetup of the page (its source, evaluated with recording storage / state seams): a malformed,
//           raw or changed registry is refused — the stored node is untouched and no config / supplier / fixed-cost / user
//           write follows; a legitimate first setup (absent / empty) and an add-business over the same list still write
//   PR3-06  the page source: both load paths read the raw node and decode through the node view; setup is gated by the
//           eligibility rule; no whole-node business-list write remains in completeSetup
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { loadSeam } from "../support/c1-seam.mjs";
import { decodeRegistryNode, classifyRegistryTarget } from "../../lib/businessRegistry.js";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const env = (list) => ({ _v: JSON.stringify(list) });
const plain = (v) => JSON.parse(JSON.stringify(v));
const A = { id: "bizA", name: "A" }, Bz = { id: "bizB", name: "B" };

test("PR3-01 the stored node → absent / empty / ready / unreadable (literal)", () => {
  const cases = [
    [null, { state: "absent", list: [], selectable: [] }],
    [undefined, { state: "absent", list: [], selectable: [] }],
    [env([]), { state: "empty", list: [], selectable: [] }],
    [env([A]), { state: "ready", list: [A], selectable: [A] }],
    [env([null, A, { name: "x" }]), { state: "ready", list: [A, { name: "x" }], selectable: [A] }],
    [env([null]), { state: "unreadable", reason: "registry_no_business" }],
    [env([null, null]), { state: "unreadable", reason: "registry_no_business" }],
    [env([{ name: "unknown" }]), { state: "unreadable", reason: "registry_no_business" }],
    [env([{ id: "" }, { id: 5 }, 7, "bizA"]), { state: "unreadable", reason: "registry_no_business" }],
    [[A], { state: "unreadable", reason: "registry_shape" }],
    [[null, A], { state: "unreadable", reason: "registry_shape" }],
    [JSON.stringify([A]), { state: "unreadable", reason: "registry_shape" }],
    [{ bizA: A }, { state: "unreadable", reason: "registry_shape" }],
    [{ _v: 5 }, { state: "unreadable", reason: "registry_shape" }],
    ["", { state: "unreadable", reason: "registry_shape" }],
    [{ _v: "[{\"id\":" }, { state: "unreadable", reason: "registry_json" }],
    [{ _v: "{}" }, { state: "unreadable", reason: "registry_not_array" }],
  ];
  for (const [node, want] of cases) assert.deepEqual(plain(C1.businessRegistryNodeView(node)), want, JSON.stringify(node));
});

// the corpus: real runtime shapes (`{_v}` envelopes, as every runtime writer stores them) and the rejected representations
const NODES = [
  null, env([]), env([A]), env([A, Bz]), env([null, A]), env([A, null, { name: "x" }, 7, { id: "" }, { id: "bad:id" }]),
  env([null]), env([{ name: "unknown" }]), env([{ id: 5 }]), env([{ id: "5" }, { id: 5 }]),
  env([A, { ...A, name: "dup" }]), env([{ ...A, active: false }, A]), env([A, { id: " bizA" }]), env([{ id: " bizA", name: "padded" }]),
  [A], [null, A], JSON.stringify([A]), { bizA: A }, { _v: "[" }, { _v: 5 }, { _v: "{}" }, "",
];
const IDS = ["bizA", "bizB", "5", " bizA", "null"];
const pageBinds = (node, id) => {
  const view = C1.businessRegistryNodeView(node);
  if (view.state !== "ready") return false;
  if (!view.selectable.some((b) => b.id === id)) return false;
  const sel = { tenantId: "t", bizId: id, gen: 1 };
  return C1.historyBinding({ tenantId: "t", bizId: id, gen: 1 }, sel, id, view.list).ok === true;
};

test("PR3-02 parity with the server rule: the page binds (node, id) only when the server classifies it registered", () => {
  const rows = [];
  for (const node of NODES) {
    const view = C1.businessRegistryNodeView(node);
    if (!decodeRegistryNode(node).ok) assert.notEqual(view.state, "ready", "a node the server cannot decode is never ready: " + JSON.stringify(node));
    for (const id of IDS) {
      const server = classifyRegistryTarget(node, id).state, page = pageBinds(node, id);
      rows.push([JSON.stringify(node), id, server, page]);
      if (page) assert.equal(server, "registered", "page binds ⇒ server registered: " + JSON.stringify(node) + " / " + JSON.stringify(id));
      if (server === "registered" && view.state === "ready") assert.equal(page, true, "server registered + page ready ⇒ the page binds: " + JSON.stringify(node) + " / " + id);
    }
  }
  // literal spot checks (independent of the loop's logic)
  assert.equal(pageBinds(env([null, A]), "bizA"), true, "valid target beside a null stays available");
  assert.equal(pageBinds(env([A, null, { name: "x" }, 7, { id: "" }, { id: "bad:id" }]), "bizA"), true, "valid target beside unrelated defects");
  assert.equal(pageBinds([A], "bizA"), false, "raw array: never bound");
  assert.equal(pageBinds(JSON.stringify([A]), "bizA"), false, "bare JSON string: never bound");
  assert.equal(pageBinds(env([A, { ...A, name: "dup" }]), "bizA"), false, "duplicate (first order)");
  assert.equal(pageBinds(env([{ ...A, active: false }, A]), "bizA"), false, "duplicate (second order)");
  assert.equal(pageBinds(env([A, { id: " bizA" }]), "bizA"), false, "padded twin collides");
  assert.equal(pageBinds(env([{ id: "5" }, { id: 5 }]), "5"), false, "coercion-only twin collides");
  assert.ok(rows.length === NODES.length * IDS.length);
});

test("PR3-03 first-business setup is eligible only over a confirmed absent / empty registry (or an unknown tenant)", () => {
  for (const [state, list, want] of [["unknown", [], true], ["absent", [], true], ["empty", [], true], ["ready", [], true], ["ready", [A], false], ["unavailable", [], false], ["unreadable", [], false], [undefined, [], false]])
    assert.equal(C1.firstSetupEligible(state, list), want, state + " " + JSON.stringify(list));
  for (const node of NODES) {
    const v = C1.businessRegistryNodeView(node);
    const eligible = C1.firstSetupEligible(v.state === "unreadable" ? "unavailable" : v.state, v.list || []);
    assert.equal(eligible, node === null || JSON.stringify(node) === JSON.stringify(env([])), "setup eligibility of " + JSON.stringify(node));
  }
});

test("PR3-04 registrySetupWrite: the record is added only over the registry the page decided on", () => {
  const N = { id: "biz_1", name: "New" };
  const ok = (v) => ({ ok: true, value: { _v: JSON.stringify(v) } });
  const cases = [
    [null, [], ok([N])],
    [env([]), [], ok([N])],
    [env([A]), [A], ok([A, N])],
    [env([null, A]), [A], ok([A, N])],
    [env([A, { ...N, name: "old" }]), [A, { ...N, name: "old" }], ok([A, N])],
    [env([null]), [], { ok: false, reason: "registry_no_business" }],
    [env([{ name: "unknown" }]), [], { ok: false, reason: "registry_no_business" }],
    [[A], [A], { ok: false, reason: "registry_shape" }],
    [JSON.stringify([A]), [A], { ok: false, reason: "registry_shape" }],
    [{ _v: "[" }, [], { ok: false, reason: "registry_json" }],
    [env([A]), [], { ok: false, reason: "registry_changed" }],
    [env([A, Bz]), [A], { ok: false, reason: "registry_changed" }],
    [null, [A], { ok: false, reason: "registry_changed" }],
    [env([]), [A], { ok: false, reason: "registry_changed" }],
    [env([A]), null, { ok: false, reason: "setup_input" }],
  ];
  for (const [current, expected, want] of cases) assert.deepEqual(plain(C1.registrySetupWrite(current, expected, N)), want, JSON.stringify([current, expected]));
});

// ── PR3-05: the page's own completeSetup, evaluated with recording seams ────────────────────────────────────────────────
const CS_START = "  const completeSetup = async (cfg, sups, fixed, firstOwner) => {", CS_END = "  const saveAppUsers = async (users) => {";
function completeSetupOf(html, { stored, businesses }) {
  const i = html.indexOf(CS_START), j = html.indexOf(CS_END, i);
  assert.ok(i > 0 && j > i, "completeSetup source");
  const seam = loadSeam(html);
  let node = stored === undefined ? null : JSON.parse(JSON.stringify(stored));
  const writes = [], state = {};
  const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const storage = {
    // RTDB transaction semantics: the first run sees the (cold) local value null; a run whose base differs from the server
    // node is re-run against the server node; `undefined` aborts.
    mutateFor: async (tenantId, key, fn) => {
      let base = null;
      for (let k = 0; k < 5; k++) {
        const next = fn(clone(base));
        if (next === undefined) return { committed: false, snapshot: { val: () => clone(node) } };
        if (key === "app-businesses" ? JSON.stringify(base) === JSON.stringify(node) : true) {
          writes.push({ op: "txn", tenantId, key, value: clone(next) });
          if (key === "app-businesses") node = clone(next);
          return { committed: true, snapshot: { val: () => clone(node) } };
        }
        base = clone(node);
      }
      throw new Error("maxretry");
    },
    set: async (key, value) => { writes.push({ op: "set", key, value }); if (key === "app-businesses") node = { _v: value }; },
    setFor: async (tenantId, key, value) => { writes.push({ op: "setFor", key, value }); },
    getUid: () => "u1",
  };
  const window = { storage, MarjinC1: seam, setTenantId: () => {}, _currentTenantId: "tenantA", _rtdbSet: async (p) => { writes.push({ op: "rtdbSet", key: p }); }, _auth: null };
  const set = (k) => (v) => { state[k] = typeof v === "function" ? v(state[k]) : v; };
  const ctx = {
    window, loggedInUser: { _tenantId: "tenantA", role: "super_owner" }, businesses,
    invalidateSelection: () => {}, sessionStorage: { setItem: () => {}, getItem: () => null },
    fetch: async () => ({ ok: false, json: async () => ({}) }), setTimeout: (f) => f(), console: { log() {}, error() {}, warn() {} },
    setBusinesses: set("businesses"), setBizRegistry: set("bizRegistry"), setShowSetup: set("showSetup"), setBusinessConfig: set("config"),
    setSuppliers: set("suppliers"), setFixedList: set("fixed"), setAppUsers: set("users"), setLoggedInUser: set("loggedInUser"),
    setCurrentBizId: set("currentBizId"), setSetupDone: set("setupDone"), setShowBizSelect: set("showBizSelect"),
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function("ctx", "with (ctx) { " + html.slice(i, j) + "\n return completeSetup; }")(ctx);
  return { run: () => fn({ businessName: "New" }, [{ id: "s", name: "S" }], [{ id: "f", amount: 1 }], null), writes, state, node: () => node };
}
const nonRegistryWrites = (w) => w.filter((x) => x.key !== "app-businesses" && x.op !== "rtdbSet");

test("PR3-05 the page's completeSetup never replaces a malformed, raw or changed registry; legitimate setup still writes", async () => {
  for (const [label, stored, businesses, reason] of [
    ["[null] (the R2 view: no business)", env([null]), [], "registry_no_business"],
    ["[{name}] (the R2 view: no selectable business)", env([{ name: "unknown" }]), [{ name: "unknown" }], "registry_no_business"],
    ["raw array (the R2 view: one business)", [A], [A], "registry_shape"],
    ["changed since load", env([A, Bz]), [A], "registry_changed"],
    ["created by another device after an absent load", env([Bz]), [], "registry_changed"],
  ]) {
    const cs = completeSetupOf(HTML, { stored, businesses });
    await cs.run();
    assert.deepEqual(cs.node(), stored, label + ": the stored registry is untouched");
    assert.deepEqual(cs.writes.filter((w) => w.key === "app-businesses" && w.op !== "txn"), [], label + ": no whole-node business-list write");
    assert.deepEqual(nonRegistryWrites(cs.writes), [], label + ": no config / supplier / fixed-cost / user write");
    assert.deepEqual(cs.state.bizRegistry, { state: "unavailable", reason }, label + ": the explicit unavailable state");
    assert.equal(cs.state.currentBizId, undefined, label + ": no business selected");
  }
  for (const [label, stored, businesses, want] of [
    ["absent (first setup)", undefined, [], []],
    ["empty runtime list", env([]), [], []],
    ["add-business over the same list", env([A]), [A], [A]],
    ["add-business beside a null", env([null, A]), [A], [A]],
  ]) {
    const cs = completeSetupOf(HTML, { stored, businesses });
    await cs.run();
    const after = cs.node(), list = JSON.parse(after._v);
    assert.deepEqual(list.slice(0, -1), want, label + ": the existing businesses are kept");
    assert.match(list[list.length - 1].id, /^biz_\d+$/, label + ": the new record");
    assert.equal(list[list.length - 1].name, "New");
    assert.deepEqual(cs.state.bizRegistry, { state: "ready" }, label);
    assert.ok(nonRegistryWrites(cs.writes).some((w) => /:config$/.test(w.key)), label + ": the new business's config is written");
    assert.equal(cs.state.currentBizId, list[list.length - 1].id, label + ": the new business is selected");
  }
});

test("PR3-06 the page source: raw-node loads, node-view decoding, the eligibility gate and the CAS setup write", () => {
  const count = (s) => HTML.split(s).length - 1;
  assert.equal(count('window.storage.getNode("app-businesses")'), 2, "both load paths read the stored node");
  assert.equal(count("window.MarjinC1.businessRegistryNodeView(node)"), 2, "… and decode it through the node view");
  assert.equal(count('window.storage.get("app-businesses"'), 0, "the JSON-text read (which hid a raw array) is gone");
  assert.equal(count("window.MarjinC1.businessRegistryView(rb.value)"), 0);
  const cs = HTML.slice(HTML.indexOf(CS_START), HTML.indexOf(CS_END));
  assert.ok(!/storage\.set\("app-businesses"/.test(cs), "completeSetup has no whole-node business-list write");
  assert.equal((cs.match(/"app-businesses"/g) || []).length, 1, "completeSetup touches the business list once …");
  assert.ok(cs.includes('window.storage.mutateFor(tenantId, "app-businesses", (current) => {') && cs.includes("window.MarjinC1.registrySetupWrite(current, expectedBizList,"), "… through the CAS");
  assert.ok(cs.indexOf("if(!registryWrite.ok) {") < cs.indexOf("biz:${bizId}:config"), "a refusal returns before the config write");
  const unavailableGate = HTML.indexOf('(bizRegistry.state === "unavailable" || (selectableBizList.length === 0 && !window.MarjinC1.firstSetupEligible(bizRegistry.state, businesses)))');
  const setupGate = HTML.indexOf("if(loaded && loggedInUser && selectableBizList.length === 0 && !currentBizId)");
  assert.ok(unavailableGate > 0 && setupGate > unavailableGate, "the eligibility gate is decided before the first-business setup");
  assert.ok(HTML.includes("window.storage.getNode = async (key) => {"), "the raw-node read exists in the storage transport");
});
