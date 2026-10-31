// BIZ-RESELECT — choosing the business that is already the live selection in "בחירת סניף" is not a
// switch: before the fix the wrapper invalidated the selection (new generation, entries lane reset)
// while currentBizId stayed equal, so the listeners effect never re-ran and every financial screen
// stayed at "loading" (and labor writes were refused) until a reload. Browser harness reselect2.mjs
// covers Dashboard, P&L, Purchases, labor and the daily-revenue list (with a previous month).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const wrapper = HTML.slice(HTML.indexOf("  const setCurrentBizId = id => {"), HTML.indexOf("  // R3/R6: unmount marks the observable UI ports dead FIRST"));

/** Runs the production wrapper text with recording stubs. */
function run(state, id) {
  const calls = [];
  const sandbox = {
    window: { _currentTenantId: state.tenantId, storage: { getUid: () => null } },
    sessionStorage: { setItem: () => {} },
    currentBizId: state.currentBizId,
    selectionCtrlRef: { current: { current: () => ({ gen: 7, tenantId: state.ctrlTenant, bizId: state.ctrlBiz }) } },
    invalidateSelection: (t, b) => calls.push(["invalidate", t, b]),
    setEditingId: () => calls.push(["setEditingId"]), setEntryExceptions: () => calls.push(["setEntryExceptions"]),
    setEntrySaveInFlight: () => {}, setSupplierWriteError: () => {}, setCurrentBizId_: (v) => calls.push(["set", v]),
  };
  vm.runInNewContext(wrapper.replace("const setCurrentBizId = id =>", "globalThis.fn = id =>"), sandbox);
  sandbox.fn(id);
  return calls;
}

test("BIZ-RESELECT-01 re-selecting the live business (same tenant, controller bound to it) changes nothing", () => {
  const calls = run({ tenantId: "T", currentBizId: "A", ctrlTenant: "T", ctrlBiz: "A" }, "A");
  assert.deepEqual(calls, []);
});

test("BIZ-RESELECT-02 a real switch, a cleared selection or an unbound controller still invalidates synchronously", () => {
  assert.deepEqual(run({ tenantId: "T", currentBizId: "A", ctrlTenant: "T", ctrlBiz: "A" }, "B")[0], ["invalidate", "T", "B"]);
  assert.deepEqual(run({ tenantId: "T", currentBizId: "A", ctrlTenant: "T", ctrlBiz: "A" }, null)[0], ["invalidate", "T", null]);
  assert.deepEqual(run({ tenantId: "T", currentBizId: "A", ctrlTenant: "T", ctrlBiz: null }, "A")[0], ["invalidate", "T", "A"], "controller not yet bound (mount / restored session)");
  assert.deepEqual(run({ tenantId: "T2", currentBizId: "A", ctrlTenant: "T", ctrlBiz: "A" }, "A")[0], ["invalidate", "T2", "A"], "tenant changed");
});
