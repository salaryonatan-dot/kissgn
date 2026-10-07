// M1 integration R2 (LOCAL; pending independent Codex review) — the page's business-list load / selection path.
// Review finding P1 (M1 R1): the page's own loader dereferenced `bizList[0].id` / `bizList.find(b => b.id …)` and logged
// `bizList.map(b => b.id)`; a bare null anywhere in the stored list threw, the error was swallowed, no business was selected
// and the page stalled before the R1 registry rule ever ran. Review P3: the prose said a bare null collides with "null".
//   PBR2-01  businessRegistryView: the stored list WITHOUT its bare nulls (everything else kept, in order) + the selectable
//            records (a record with a non-empty string id, once) — expected values stated literally
//   PBR2-02  removing bare nulls is identity-neutral under the SERVER rule (lib/businessRegistry.js) for every corpus list and
//            requested id, and the page rule over the view's list agrees with the server on "registered"
//   PBR2-03  values that are not a JSON array are "unreadable" (the page then ends loading in its explicit unavailable state)
//   PBR2-04  pickBusiness: the first remembered id that is selectable, else the first selectable record, else nothing
//   PBR2-05  the page source: every business-list load path goes through the ONE decoder; no element dereference survives;
//            the unavailable gate precedes the first-business setup gate; the setup / selector gates count selectable records
//   PBR2-06  P3: a bare null carries no identity on the page and on the server (`[{id:"null"}, null]` registered;
//            `[{id:"null"}, {id:null}]` ambiguous / not registered)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { loadSeam } from "../support/c1-seam.mjs";
import { classifyRegistryTarget } from "../../lib/businessRegistry.js";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const env = (list) => ({ _v: JSON.stringify(list) });
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm-context arrays → this realm, for deepEqual
const A = { id: "bizA", name: "A" }, Bz = { id: "bizB", name: "B" };

test("PBR2-01 the business-list view keeps every element but bare nulls, and selects each usable record once", () => {
  const cases = [
    [[null, A], [A], [A]],
    [[A, null], [A], [A]],
    [[null, null], [], []],
    [[], [], []],
    [[null, "bizX", 7, true, [A.id], { name: "no id" }, { id: "" }, { id: 9 }, { id: null }, A, Bz, { id: "bizB", name: "B2" }, null],
      ["bizX", 7, true, [A.id], { name: "no id" }, { id: "" }, { id: 9 }, { id: null }, A, Bz, { id: "bizB", name: "B2" }],
      [A, Bz]],
    [[A, { id: "bizA", name: "dup" }], [A, { id: "bizA", name: "dup" }], [A]],                       // duplicated: selectable once
    [[{ id: "biz:C" }, { id: " bizA" }, A], [{ id: "biz:C" }, { id: " bizA" }, A], [{ id: "biz:C" }, { id: " bizA" }, A]],
  ];
  for (const [stored, list, selectable] of cases) {
    const v = plain(C1.businessRegistryView(JSON.stringify(stored)));
    assert.deepEqual(v, { state: "ready", list, selectable }, JSON.stringify(stored));
    assert.deepEqual(plain(C1.selectableBusinesses(stored)), selectable, "selectableBusinesses over the stored list " + JSON.stringify(stored));
  }
  assert.deepEqual(plain(C1.selectableBusinesses(undefined)), []); assert.deepEqual(plain(C1.selectableBusinesses({ 0: A })), []);
});

test("PBR2-02 removing bare nulls is identity-neutral under the server rule, and the page rule agrees with the server", () => {
  const corpus = [
    [null, A], [A, null, null], [null, A, A], [A, { id: "bizA" }, null], [null, { id: " bizA" }, A], [null, "bizA", A], [A, { id: null }],
    [{ id: "null" }, null], [{ id: "null" }, { id: null }, null], [{ id: "5" }, { id: 5 }, null], [null, 5, { id: "5" }], [null, { id: "5" }],
    [null, Bz, Bz, A], [null], [], [null, { name: "x" }, [A], A],
  ];
  for (const stored of corpus) {
    const view = plain(C1.businessRegistryView(JSON.stringify(stored)));
    for (const id of ["bizA", "bizB", "null", "5", "bizX"]) {
      const before = classifyRegistryTarget(env(stored), id), after = classifyRegistryTarget(env(view.list), id);
      assert.equal(after.state, before.state, `server state for ${id} over ${JSON.stringify(stored)}`);
      assert.equal(after.reason, before.reason, `server reason for ${id} over ${JSON.stringify(stored)}`);
      const sel = { tenantId: "tenantA", bizId: id, gen: 1 };
      const bind = C1.historyBinding({ tenantId: "tenantA", bizId: id, gen: 1 }, sel, id, view.list);
      assert.equal(bind.ok === true, before.state === "registered", `page binding = server "registered" for ${id} over ${JSON.stringify(stored)}`);
    }
  }
});

test("PBR2-03 a stored value that is not a JSON array is unreadable (never an empty business list)", () => {
  for (const [value, reason] of [["[", "registry_json"], ["", "registry_json"], ["not json", "registry_json"], ["{}", "registry_not_array"], [JSON.stringify({ bizA: A }), "registry_not_array"], ["5", "registry_not_array"], ["null", "registry_not_array"], ['"[]"', "registry_not_array"], [undefined, "registry_json"]]) {
    assert.deepEqual(plain(C1.businessRegistryView(value)), { state: "unreadable", reason }, String(value));
  }
  assert.deepEqual(plain(C1.businessRegistryView("[]")), { state: "ready", list: [], selectable: [] });
});

test("PBR2-04 pickBusiness: a remembered selectable id, else the first selectable record, else nothing", () => {
  assert.equal(C1.pickBusiness([A, Bz], ["bizB"]), "bizB");
  assert.equal(C1.pickBusiness([A, Bz], ["gone", "bizB"]), "bizB", "the first remembered id that is still selectable");
  assert.equal(C1.pickBusiness([A, Bz], ["gone", null, 5]), "bizA", "no remembered selectable id → the first selectable");
  assert.equal(C1.pickBusiness([A, Bz], []), "bizA");
  assert.equal(C1.pickBusiness([], ["bizA"]), null, "nothing selectable → nothing selected");
  assert.equal(C1.pickBusiness(undefined, undefined), null);
  const view = C1.businessRegistryView(JSON.stringify([null, "bizX", { name: "no id" }, Bz, A]));
  assert.equal(C1.pickBusiness(view.selectable, []), "bizB", "never the null / primitive / id-less element");
});

test("PBR2-05 the page source: one decoder for every business-list load; no element dereference of the stored list survives", () => {
  const count = (s) => HTML.split(s).length - 1;
  // M1 R3: both load paths now read the STORED node and decode it through businessRegistryNodeView (which applies this
  // view to the runtime envelope's list) — test/finance/m1-r3-page-registry.test.mjs PR3-06
  assert.equal(count("window.MarjinC1.businessRegistryNodeView(node)"), 2, "the initial load and the manual-login reload both decode through the shared view");
  for (const gone of ["JSON.parse(rb.value)", "bizList[0].id", "bizList.find(", "resolveAndSet(bizList)", "bizList.map(b=>"]) assert.equal(count(gone), 0, gone + " no longer exists");
  assert.equal(count("bizList.map("), 1, "the one remaining map (the setup-edit commit) …");
  assert.equal(count("bizList.map((b) => (b && b.id === ctx.bizId"), 1, "… guards every element before reading its id");
  assert.equal(count("window.MarjinC1.pickBusiness("), 2, "both load paths select through pickBusiness");
  const unavailableGate = HTML.indexOf('bizRegistry.state === "unavailable"'), setupGate = HTML.indexOf("if(loaded && loggedInUser && selectableBizList.length === 0 && !currentBizId)");
  assert.ok(unavailableGate > 0 && setupGate > unavailableGate, "the explicit unavailable state is decided before the first-business setup");
  assert.ok(HTML.includes("if(loaded && loggedInUser && !currentBizId && selectableBizList.length > 0)"), "the selector gate counts selectable records");
  assert.ok(HTML.includes('data-m1="registry-unavailable"'), "the explicit unavailable state is rendered");
  assert.ok(HTML.includes("const allowedBusinesses = isSuperOwner\n    ? selectableBizList\n"), "selector lists come from the selectable records");
});

test("PBR2-06 P3: a bare null carries no identity — on the page and on the server — including for the literal id \"null\"", () => {
  for (const [stored, server, page] of [
    [[{ id: "null" }, null], "registered", true],
    [[null, { id: "null" }], "registered", true],
    [[{ id: "null" }, { id: null }], "ambiguous", false],
    [[{ id: null }], "ambiguous", false],
    [[null], "not_registered", false],
  ]) {
    assert.equal(classifyRegistryTarget(env(stored), "null").state, server, "server " + JSON.stringify(stored));
    assert.equal(C1.historyBinding({ tenantId: "t", bizId: "null", gen: 1 }, { tenantId: "t", bizId: "null", gen: 1 }, "null", stored).ok === true, page, "page " + JSON.stringify(stored));
  }
  const prose = readFileSync(join(REPO, "lib", "businessRegistry.js"), "utf8");
  assert.ok(prose.includes("A bare `null` element (and an array element) carries NO identity"), "the server contract prose states the bare-null rule");
  assert.ok(HTML.includes("A bare null (or array) element carries no identity"), "the page rule's prose states it too");
  assert.ok(!/bare primitive whose String\(\) is bizId/.test(HTML), "the old page prose (bare null as a collision) is gone");
});
