// VERSION FENCE — honest-client behaviour through the ACTUAL production dashboard blocks
// (test/support/dashboard-wiring-harness.mjs): policy lane per selection, typed fail-closed
// states, dispatch gate with revision binding, business switch isolation, foreground /
// reconnect re-check, rollback detection, no false "saved". Server-side denial is proven
// separately on the real emulator (test/emulator/storage-v2-version-fence.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HTML, createDashboard, makeMemoryStorage, loadProductionWindow, extractInitBlock, extractListenerBlock, plain } from "../support/dashboard-wiring-harness.mjs";
import * as LIB from "../../lib/storagePolicy.js";

const W = loadProductionWindow();
const P = W.MarjinStoragePolicy;
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2");
const row = (id, date, sales, extra = {}) => ({ id, date, sales, deliveries: 0, ...extra });
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });
const KEY = (biz) => `biz:${biz}:entries`;
const legacy = (rows) => ({ _v: JSON.stringify(rows) });
const v2node = (gen, rows) => { const m = {}; rows.forEach((r) => { m[r.id] = { ...r, _gen: gen }; }); const n = { schemaVersion: 2, generation: gen }; if (rows.length) n.rows = m; return n; };
const POL = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const ACTIVE = (over = {}) => POL({ phase: "v2_active", minStorageProtocol: 2, ...over });

async function boot({ nodeA, nodeB, policyA, policyB, select = "A" } = {}) {
  const storage = makeMemoryStorage();
  if (nodeA !== undefined) storage.seed(KEY("A"), nodeA);
  if (nodeB !== undefined) storage.seed(KEY("B"), nodeB);
  if (policyA) storage.seedPolicy("T1", "A", policyA);
  if (policyB) storage.seedPolicy("T1", "B", policyB);
  const dash = createDashboard({ storage, tenantId: "T1", bizId: select, W: loadProductionWindow() });
  dash.selectBusiness(select);
  await dash.settle();
  return { storage, dash };
}
const txnCount = (log) => log.length;

test("parity: the browser policy block decides exactly like lib/storagePolicy.js", () => {
  const raws = [null, undefined, 7, "legacy", [POL()], {}, { policyRevision: 7 }, { phase: "v2_active" }, POL(), POL({ phase: "quiesced" }), POL({ phase: "recovery_hold" }), ACTIVE(), ACTIVE({ allowV2Initialization: true }),
    POL({ phase: "bogus" }), POL({ policyRevision: 0 }), POL({ policyRevision: 1.5 }), POL({ policyRevision: "1" }), POL({ allowV2Initialization: "true" }), POL({ allowV2Initialization: true }), POL({ minStorageProtocol: 0 }),
    POL({ contractVersion: 2, phase: "v2_active" }), POL({ contractVersion: "1" }), ACTIVE({ minStorageProtocol: 3 }), POL({ phase: "quiesced", operation: { id: "x", kind: "cutover", owner: "o", startedAt: 1 } }), POL({ phase: "quiesced", operation: { id: "", kind: "cutover", owner: "o", startedAt: 1 } }),
    POL({ conversionAttempted: true }), POL({ conversionAttempted: "no" }), ACTIVE({ updatedAt: 5, updatedBy: "op", approvedReleaseId: "r" })];
  const modes = [null, "absent", "legacy", "v2", "malformed"];
  for (const raw of raws) {
    assert.deepEqual(plain(P.parsePolicyRecord(raw)), plain(LIB.parsePolicyRecord(raw)), JSON.stringify(raw));
    for (const m of modes) for (const proto of [2, 1]) assert.deepEqual(plain(P.decideEntriesAccess(P.parsePolicyRecord(raw), m, proto)), plain(LIB.decideEntriesAccess(LIB.parsePolicyRecord(raw), m, proto)), `${JSON.stringify(raw)} / ${m} / ${proto}`);
  }
  assert.equal(P.STORAGE_PROTOCOL, 2); assert.equal(P.POLICY_CONTRACT_VERSION, LIB.POLICY_CONTRACT_VERSION); assert.equal(typeof P.MARJIN_RELEASE_ID, "string");
});

test("source pins: binding carries policyRevision; the adapter gates then forwards the ORIGINAL binding to the unchanged router; effect resets the lane; banner + texts exist", () => {
  const init = extractInitBlock(HTML), listener = extractListenerBlock(HTML);
  assert.ok(init.includes("policyRevision: lane ? lane.revision() : null }"), "binding carries the policy revision");
  assert.ok(init.includes("const gate = window.MarjinStoragePolicy.gatePolicyDispatch(lane ? lane.decision() : null, binding);"));
  assert.ok(init.includes("return entriesStorageRouterRef.current.mutate(intent, ctx, binding);"), "original binding forwarded, never restamped");
  assert.ok(listener.includes("window.storage.subscribePolicy(ctxAtSetup.tenantId, currentBizId,"), "policy subscription is selection-scoped");
  assert.ok(listener.includes('window.addEventListener("visibilitychange", __onVisible);') && listener.includes('window.addEventListener("online", __policyRefresh);'));
  assert.ok(HTML.includes("    entriesPolicyRef.current = null;   // VERSION FENCE: a new selection starts with no policy lane"));
  assert.ok(HTML.includes('data-policy-state={entriesPolicyUi ? entriesPolicyUi.state : ""}'), "banner rendered on the main layout");
  assert.ok(HTML.includes('if (status === "blocked_policy") {'), "typed outcome text");
  // the coordinator / router / V2 mutator / legacy mutator bodies are untouched (block-level identity vs the base)
  for (const fn of ["function createEntriesWriteCoordinator(io) {", "function createEntriesStorageRouter(io) {", "function createV2EntriesMutator(io) {", "function createRemoteEntriesMutator(io) {"]) assert.ok(HTML.includes(fn), fn);
});

test("VF-02: legacy business with NO record → legacy write allowed, no banner, revision sentinel 0", async () => {
  const { storage, dash } = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]) });
  assert.equal(dash.policyUi().state, "legacy"); assert.equal(dash.policyUi().writable, true); assert.equal(P.describePolicyState(dash.policyUi()), null);
  const r = await dash.coord().submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
  assert.equal(r.status, "committed"); assert.equal(storage.read(KEY("A"))._v.includes("555"), true);
  assert.equal(dash.policy().revision(), 0);
  // explicit valid legacy record: identical behaviour
  const b = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]), policyA: POL() });
  assert.equal(b.dash.policyUi().state, "legacy"); assert.equal((await b.dash.coord().submitIntent(upsert(ID1, { sales: 7 }, { sales: 101 }))).status, "committed"); assert.equal(b.dash.policy().revision(), 1);
});

test("VF-12: quiesced / recovery_hold / update-required / malformed / phase-missing → typed read-only state, NO transaction, draft untouched, truthful text", async () => {
  const cases = [
    [POL({ phase: "quiesced" }), "maintenance_read_only", "maintenance"], [POL({ phase: "recovery_hold" }), "maintenance_read_only", "maintenance"],
    [ACTIVE({ minStorageProtocol: 3 }), "update_required", "update"], [POL({ contractVersion: 2, phase: "v2_active" }), "update_required", "update"],
    [{ policyRevision: 7 }, "policy_malformed", "blocked"], [{ phase: "legacy" }, "policy_malformed", "blocked"], [7, "policy_malformed", "blocked"],
    [POL({ phase: "active" }), "policy_malformed", "blocked"], [POL({ policyRevision: 1.5 }), "policy_malformed", "blocked"], [POL({ allowV2Initialization: "true" }), "policy_malformed", "blocked"],
    [{ contractVersion: 1, policyRevision: 2, allowV2Initialization: false, minStorageProtocol: 1 }, "policy_malformed", "blocked"],
  ];
  for (const [policy, state, kind] of cases) {
    const { storage, dash } = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]), policyA: policy });
    assert.equal(dash.policyUi().state, state, JSON.stringify(policy)); assert.equal(dash.policyUi().writable, false);
    const surface = P.describePolicyState(dash.policyUi()); assert.equal(surface.kind, kind); assert.ok(surface.text.length > 10); if (kind === "update") assert.equal(surface.reload, true);
    const before = txnCount(storage.log);
    const r = await dash.coord().submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
    assert.equal(r.status, "blocked_policy", JSON.stringify(policy)); assert.equal(r.reason, state);
    assert.equal(txnCount(storage.log), before, "no transaction was attempted");
    assert.equal(storage.read(KEY("A"))._v.includes("555"), false, "nothing written");
    assert.equal(dash.salesOf(ID1), 101, "displayed rows (the operator's view) untouched");
    const text = dash.ML.describeSaveOutcome(r, false); assert.ok(/לא נשמר/.test(text), "text says NOT saved: " + text); assert.ok(!/נשמר בהצלחה/.test(text));
  }
});

test("VF-14/15/16 (client): absent business — no policy or flag=false → initialization_not_enabled with NO transaction (never a legacy fallback); v2_active+flag=true → V2 initialised at epoch 1", async () => {
  for (const policy of [null, POL(), ACTIVE({ allowV2Initialization: false })]) {
    const { storage, dash } = await boot({ nodeA: null, policyA: policy });
    assert.deepEqual(plain(dash.mode()), { mode: "absent", generation: null });
    assert.equal(dash.policyUi().state, "initialization_not_enabled", JSON.stringify(policy));
    const r = await dash.coord().submitIntent(create(row(ID1, "2026-08-01", 5)));
    assert.equal(r.status, "blocked_policy"); assert.equal(r.reason, "initialization_not_enabled");
    assert.equal(txnCount(storage.log), 0, "no transaction"); assert.equal(storage.read(KEY("A")), null, "no legacy fallback node was created");
  }
  const { storage, dash } = await boot({ nodeA: null, policyA: ACTIVE({ allowV2Initialization: true }) });
  assert.equal(dash.policyUi().state, "v2"); assert.equal(dash.policyUi().initialization, true);
  const r = await dash.coord().submitIntent(create(row(ID1, "2026-08-01", 5)));
  assert.equal(r.status, "committed"); assert.equal(storage.read(KEY("A")).schemaVersion, 2); assert.equal(storage.read(KEY("A")).generation, 1);
});

test("existing V2 node under NO / legacy policy is blocked (v2_without_policy); active policy over a still-legacy node is conversion_pending", async () => {
  for (const policy of [null, POL()]) {
    const { storage, dash } = await boot({ nodeA: v2node(1, [row(ID1, "2026-08-01", 101)]), policyA: policy });
    assert.equal(dash.policyUi().state, "v2_without_policy");
    const r = await dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 })); assert.equal(r.status, "blocked_policy"); assert.equal(txnCount(storage.log), 0);
  }
  const { storage, dash } = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]), policyA: ACTIVE() });
  assert.equal(dash.policyUi().state, "conversion_pending");
  const r = await dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 })); assert.equal(r.status, "blocked_policy"); assert.equal(txnCount(storage.log), 0);
});

test("policy changes while the page is open: legacy → quiesced blocks the next save; an intent queued under the old revision is refused as policy_changed before any transaction; quiesced → v2_active after conversion re-hydrates the lane", async () => {
  const { storage, dash } = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]), policyA: POL({ policyRevision: 1 }) });
  assert.equal(dash.policyUi().state, "legacy");
  // job 1 is in flight; while it is, the operator quiesces (revision 2); job 2 was submitted under revision 1
  let second;
  // (a) a revision bump with the SAME phase while job 1 is in flight: job 2, bound to revision 1, is refused (never restamped)
  // (the hook yields first so job 2 is submitted — and its binding captured — BEFORE the policy moves)
  storage.setHooks({ beforeCommit: async () => { await new Promise((r) => setImmediate(r)); storage.injectPolicy("T1", "A", POL({ policyRevision: 2 })); await dash.settle(); } });
  const first = dash.coord().submitIntent(upsert(ID1, { sales: 111 }, { sales: 101 }));
  second = dash.coord().submitIntent(upsert(ID1, { sales: 222 }, { sales: 111 }));
  const r1 = await first, r2 = await second;
  storage.setHooks({});
  assert.equal(r1.status, "committed", "job 1 was dispatched before the change (server Rules decide during a hold — see emulator)");
  assert.equal(r2.status, "blocked_policy"); assert.equal(r2.reason, "policy_changed");
  assert.equal(storage.read(KEY("A"))._v.includes("222"), false, "job 2 never reached the transport");
  assert.equal(dash.policyUi().state, "legacy"); assert.equal(dash.policy().revision(), 2);
  // (b) the operator quiesces: the next save is refused as maintenance, nothing reaches the transport
  storage.injectPolicy("T1", "A", POL({ phase: "quiesced", policyRevision: 3, operation: { id: "op", kind: "cutover", owner: "op", startedAt: 1 } })); await dash.settle();
  assert.equal(dash.policyUi().state, "maintenance_read_only");
  const before = txnCount(storage.log);
  const rq = await dash.coord().submitIntent(upsert(ID1, { sales: 444 }, { sales: 111 })); assert.equal(rq.status, "blocked_policy"); assert.equal(rq.reason, "maintenance_read_only");
  assert.equal(txnCount(storage.log), before); assert.equal(storage.read(KEY("A"))._v.includes("444"), false);
  // conversion happens elsewhere (Admin) and the policy becomes v2_active: the RAW listener flips the mode, the lane re-derives
  storage.inject(KEY("A"), "", v2node(1, [row(ID1, "2026-08-01", 111)]));
  storage.injectPolicy("T1", "A", ACTIVE({ policyRevision: 4 }));
  await dash.settle();
  assert.deepEqual(plain(dash.mode()), { mode: "v2", generation: 1 }); assert.equal(dash.policyUi().state, "v2");
  const r3 = await dash.coord().submitIntent(upsert(ID1, { sales: 333 }, { sales: 111 }));
  assert.equal(r3.status, "committed"); assert.equal(storage.read(KEY("A")).rows[ID1].sales, 333);
});

test("VF-08: business switch — the previous policy lane and revision are never reused; a late policy callback for the old business is discarded; a binding captured under A cannot dispatch to B", async () => {
  const { storage, dash } = await boot({ nodeA: v2node(1, [row(ID1, "2026-08-01", 101)]), nodeB: legacy([row(ID2, "2026-08-02", 202)]), policyA: ACTIVE({ policyRevision: 9 }), policyB: POL({ phase: "quiesced", policyRevision: 4 }) });
  assert.equal(dash.policyUi().state, "v2"); assert.equal(dash.policy().revision(), 9);
  const laneA = dash.policy();
  const bindingA = dash.coord().submitIntent ? { mode: "v2", generation: 1, policyRevision: 9 } : null;
  dash.selectBusiness("B"); await dash.settle();
  assert.notEqual(dash.policy(), laneA, "a fresh lane for B"); assert.equal(dash.policyUi().state, "maintenance_read_only"); assert.equal(dash.policy().revision(), 4);
  const r = await dash.coord().submitIntent(upsert(ID2, { sales: 1 }, { sales: 202 })); assert.equal(r.status, "blocked_policy"); assert.equal(r.reason, "maintenance_read_only");
  storage.injectPolicy("T1", "A", ACTIVE({ policyRevision: 10 })); await dash.settle();
  assert.equal(dash.policyUi().state, "maintenance_read_only", "A's late callback did not touch B's state"); assert.equal(dash.policy().revision(), 4);
  // the gate is selection-scoped: a binding formed under A is stale for B's coordinator context (existing selection guard)
  const ctxOld = { gen: 0, tenantId: "T1", bizId: "A" };
  const gated = await dash.refs.router.current.mutate(upsert(ID1, { sales: 1 }, { sales: 101 }), ctxOld, bindingA);
  assert.equal(gated.status, "stale");
  storage.injectPolicy("T1", "B", ACTIVE({ policyRevision: 5 })); storage.inject(KEY("B"), "", v2node(1, [row(ID2, "2026-08-02", 202)])); await dash.settle();
  assert.equal(dash.policyUi().state, "v2"); assert.equal((await dash.coord().submitIntent(upsert(ID2, { sales: 3 }, { sales: 202 }))).status, "committed");
});

test("foreground / reconnect re-check: a policy changed while the subscription was silent is picked up on visibilitychange/online; a failed read is fail-closed until it recovers; a lower revision than already observed is a rollback (blocked)", async () => {
  const { storage, dash } = await boot({ nodeA: legacy([row(ID1, "2026-08-01", 101)]), policyA: POL({ policyRevision: 2 }) });
  assert.equal(dash.policyUi().state, "legacy");
  storage.seedPolicy("T1", "A", POL({ phase: "recovery_hold", policyRevision: 3 }));   // stored without an emit (silent subscription)
  assert.ok(dash.W.dispatchEvent("visibilitychange") >= 1); await dash.settle();
  assert.equal(dash.policyUi().state, "maintenance_read_only"); assert.equal(dash.policy().revision(), 3);
  storage.failPolicy("T1", "A", true); dash.W.dispatchEvent("online"); await dash.settle();
  assert.equal(dash.policyUi().state, "policy_unavailable"); assert.equal((await dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }))).status, "blocked_policy");
  storage.failPolicy("T1", "A", false); storage.seedPolicy("T1", "A", POL({ policyRevision: 4 })); dash.W.dispatchEvent("online"); await dash.settle();
  assert.equal(dash.policyUi().state, "legacy"); assert.equal(dash.policy().revision(), 4);
  storage.injectPolicy("T1", "A", POL({ policyRevision: 3 })); await dash.settle();
  assert.equal(dash.policyUi().state, "policy_rollback"); assert.equal((await dash.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }))).status, "blocked_policy");
  // switching away removes the event listeners of the old effect
  const before = dash.W.listenerCount("online"); dash.selectBusiness("A"); await dash.settle(); assert.equal(dash.W.listenerCount("online"), before, "old effect unsubscribed, new one subscribed");
});

test("a write the SERVER denies (fence race) is a typed rules_rejected outcome — never reported as saved", async () => {
  const { storage, dash } = await boot({ nodeA: v2node(1, [row(ID1, "2026-08-01", 101)]), policyA: ACTIVE() });
  storage.setHooks({ denyIf: () => true });
  const r = await dash.coord().submitIntent(upsert(ID1, { sales: 5 }, { sales: 101 }));
  storage.setHooks({});
  assert.equal(r.status, "blocked"); assert.equal(r.reason, "rules_rejected");
  assert.ok(/לא נשמר/.test(dash.ML.describeSaveOutcome(r, false)));
  assert.equal(storage.read(KEY("A")).rows[ID1].sales, 101); assert.equal(dash.salesOf(ID1), 101);
});
