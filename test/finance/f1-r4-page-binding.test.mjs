// Core/F1 R4 — the page's cost-history binding, evaluated from the REAL index.html sources: the selection
// controller, the finRaw subscription effect, the C1 seam's historyBinding and the finSrc memo, over the
// committed fincore bundle. Without a VERIFIED tenant + REGISTERED business context the history is explicitly
// unavailable (never the current settings, never unverified history, never complete-looking figures).
//   PB-01 initial load: bound subscription, loading → present / absent / unreadable, all bound to the selection
//   PB-02 tenantless context (no verified tenant): context_unbound — even with a raw node in hand; views unavailable
//   PB-03 tenant switch (same business id): context_switching → re-subscribe; the old tenant's data never shows;
//         the old subscription's late (stale) delivery is ignored; data of the other tenant is decoded bound to it
//   PB-04 business switch: stale callbacks and late async reads of the old business are ignored; an unregistered
//         business is business_unregistered even with data
//   PB-05 subscription update / retry: a later delivery replaces the node; a failed read is read_failed (bound), a
//         recovering delivery is present again; a malformed update is unreadable
//   PB-06 same-selection re-invalidation (generation bump without a business change) re-subscribes — never stuck
//   PB-07 the editor is given the node ONLY for the live selection (page literals) and decodes bound
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance, loadSeam } from "../support/c1-seam.mjs";
import { reviewEntry } from "../support/f1-history-fixtures.mjs";

const html = readFileSync(join(REPO, "index.html"), "utf8");
const F = await loadFinance();
const C1 = loadSeam(html);
const slice = (startMarker, endMarker) => { const a = html.indexOf(startMarker); const b = html.indexOf(endMarker, a + 1); assert.ok(a > -1 && b > a, "page markers: " + startMarker); return html.slice(a, b); };
const EFFECT_SRC = slice("  const [finRaw, setFinRaw] = useState(", "  // Months a screen asked for that lie before the default ledger window");
const FINSRC_SRC = slice("  const finSrc = React.useMemo(() => {", "  const finStatus =");
const SELECTION_SRC = slice("function createSelectionController() {", "// Delayed navigation/success timer");
const createSelectionController = vm.runInNewContext(SELECTION_SRC + "; createSelectionController", {});
const T = "tenantA", T2 = "tenantB", B = "bizA", B2 = "bizB";
const A = "00000000-0000-4000-8000-0000000000a1";
const clone = (x) => JSON.parse(JSON.stringify(x));
const ASOF = "2026-10-02";
/** A valid, accepted (cleared + decision accepted) revision-1 history bound to tenant / business. */
function history(tenantId = T, bizId = B) {
  const v = { versionId: A, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-01", recordedAt: 1759395600000, recordedBy: "owner", basis: "recorded", globalEmployeesCount: 0, fixedItemsCount: 1,
    rent: { mode: "none" }, royalty: { mode: "none" }, predecessorVersionId: "none", fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }] };
  return { head: { revision: 1, headVersionId: A }, versions: { [A]: v }, review: { [A]: reviewEntry(v, "accepted", {}, { tenantId, bizId }) } };
}

/** A faithful model of the page's state + effect + memo wiring around the REAL extracted sources. */
function pageModel() {
  const selection = createSelectionController();
  const subs = [];                                       // every subscription ever made (to replay late deliveries)
  const storage = {
    subscribeNode(key, onRaw, onFail) { const s = { kind: "node", key, onRaw, onFail, live: true }; subs.push(s); return () => { s.live = false; }; },
    get: async (key) => { const err = new Error("not found"); throw err; },   // config / fixed absent in this model
    subscribeCostHistory(bizId, onRaw, onFail) { const s = { kind: "history", bizId, onRaw, onFail, live: true }; subs.push(s); return () => { s.live = false; }; },
  };
  let finRaw = null, cleanup = null, renders = 0;
  const setFinRaw = (v) => { finRaw = typeof v === "function" ? v(finRaw) : v; renders += 1; };
  const sandboxBase = { window: { storage, MarjinC1: C1 }, selectionCtrlRef: { current: selection }, captureSelectionCtx: () => selection.capture(), isSelectionLive: (ctx) => selection.isLive(ctx), FIN_NODE_LOADING: Object.freeze({ kind: "loading" }), Array, Object, JSON, Promise, String, Error };
  let currentBizId = null, businesses = [{ id: B, name: "A" }, { id: B2, name: "B" }];
  const model = {
    selection, subs, storage,
    get finRaw() { return finRaw; }, get renders() { return renders; },
    set businesses(list) { businesses = list; },
    /** React commit: (re)run the finRaw effect for the current selection + business (cleanup first, like React). */
    commit(bizId = currentBizId) {
      currentBizId = bizId;
      if (cleanup) { cleanup(); cleanup = null; }
      const sandbox = { ...sandboxBase, currentBizId, useState: (init) => [finRaw === null ? (finRaw = init) : finRaw, setFinRaw], useEffect: (fn) => { cleanup = fn(); } };
      vm.runInNewContext(EFFECT_SRC, sandbox);
    },
    /** One render of finSrc with the LIVE selection (finSel), the current finRaw and the registry. */
    finSrc(bizId = currentBizId) {
      let captured = null;
      const sandbox = { ...sandboxBase, React: { useMemo: (fn) => { captured = fn(); return captured; } }, finF: F, finAsOf: ASOF, entries: [], finRaw, finLedger: { state: "loading", key: null }, finLedgerKey: "k", finRowsReady: true,
        currentBizId: bizId, finSel: selection.current(), businesses };
      vm.runInNewContext(FINSRC_SRC, sandbox);
      return clone(captured);                            // plain-context copy (vm objects have their own prototypes)
    },
    /** The editor's historyNode prop exactly as the page computes it. */
    editorNode(bizId = currentBizId) { const finSel = selection.current(); return finRaw.bizId === bizId && finRaw.tenantId === finSel.tenantId && finRaw.gen === finSel.gen ? finRaw.costHistory : { kind: "loading" }; },
    editorBiz(bizId = currentBizId) { const finSel = selection.current(); return finSel.bizId === bizId ? bizId : null; },
    liveHistorySub() { return subs.filter((s) => s.kind === "history" && s.live).at(-1); },
  };
  return model;
}
const views = (src) => clone({ inputs: C1.inputsFor(F, src, { from: "2026-10-01", to: "2026-10-31" }), month: C1.monthReport(F, src, "2026-10"), dashboard: C1.dashboard(F, { ...src, asOf: ASOF }, { nowMs: Date.parse("2026-10-02T09:00:00Z"), lastYearSales: null, dow: 4, suppliers: [] }) });
const noFigures = (src, label) => {
  const v = views(src);
  for (const [k, r] of Object.entries(v)) { assert.ok(["loading", "unavailable"].includes(r.status), label + " " + k + " " + JSON.stringify(r).slice(0, 120)); assert.equal(r.report, undefined, label + " " + k + " carries no report"); }
  return v;
};

test("PB-01 initial load: the subscription is bound to the verified selection; loading → present (bound decode) / absent / read_failed; a tenant-foreign node is unreadable", () => {
  const m = pageModel();
  m.selection.invalidate(T, B); m.commit(B);
  assert.deepEqual({ bizId: m.finRaw.bizId, tenantId: m.finRaw.tenantId, gen: m.finRaw.gen }, { bizId: B, tenantId: T, gen: 1 });
  let src = m.finSrc(); assert.deepEqual(src.costHistory, { state: "loading" });
  noFigures(src, "loading");
  const sub = m.liveHistorySub(); assert.equal(sub.bizId, B);
  sub.onRaw(history(T, B));
  src = m.finSrc(); assert.equal(src.costHistory.state, "present"); assert.deepEqual(src.costHistory.versions.map((v) => v.versionId), [A]);
  assert.equal(views(src).inputs.status, "loading", "the ledger is still loading in this model: not ready, not fabricated");
  sub.onRaw(null); src = m.finSrc(); assert.deepEqual(src.costHistory, { state: "absent" });
  sub.onFail(); src = m.finSrc(); assert.equal(src.costHistory.state, "unreadable"); assert.equal(src.costHistory.reason, "read_failed"); noFigures(src, "read_failed");
  sub.onRaw(history(T2, B)); src = m.finSrc(); assert.equal(src.costHistory.state, "unreadable", "a node whose evidence is bound to another tenant never decodes here");
  assert.equal(src.costHistory.reason, "review_invalid"); noFigures(src, "foreign evidence");
  sub.onRaw(history(T, B2)); src = m.finSrc(); assert.equal(src.costHistory.state, "unreadable", "a node bound to another business never decodes here");
});

test("PB-02 tenantless context: no verified tenant ⇒ no subscription, context_unbound, never current settings, never a raw node in hand, never figures", () => {
  const m = pageModel();
  m.selection.invalidate(null, B); m.commit(B);
  assert.equal(m.finRaw.tenantId, null); assert.equal(m.liveHistorySub(), undefined, "no subscription without a verified tenant");
  let src = m.finSrc();
  assert.deepEqual(src.costHistory, { state: "unreadable", reason: "context_unbound" });
  noFigures(src, "unbound");
  assert.deepEqual(clone(C1.inputsFor(F, { ...src, config: { state: "absent" }, fixed: { state: "absent" } }, { from: "2026-10-01", to: "2026-10-31" })), { status: "unavailable", reason: "cost_history_unreadable" }, "even with settings in hand the history is unavailable — no current-settings fallback");
  // a raw node somehow held (e.g. delivered before the tenant was cleared) is STILL unbound: nothing decodes it
  m.selection.invalidate(T, B); m.commit(B); m.liveHistorySub().onRaw(history(T, B));
  assert.equal(m.finSrc().costHistory.state, "present");
  m.selection.invalidate(null, B);                       // tenant reset / logout: the selection loses its tenant synchronously
  src = m.finSrc();
  assert.deepEqual(src.costHistory, { state: "unreadable", reason: "context_unbound" }, "the held node is not decoded for an unbound selection (no context_switching, no loading-forever, no data)");
  noFigures(src, "unbound with node");
  assert.deepEqual(m.editorNode(), { kind: "loading" }); assert.equal(m.editorBiz(), B);
  // a selection with a tenant but no business, or a business that is not the current one
  m.selection.invalidate(T, null); assert.deepEqual(m.finSrc(B).costHistory, { state: "unreadable", reason: "context_unbound" });
  m.selection.invalidate(T, B2); assert.deepEqual(m.finSrc(B).costHistory, { state: "unreadable", reason: "context_unbound" });
  // the binding helper itself
  assert.deepEqual(clone(C1.historyBinding({ tenantId: T, bizId: B, gen: 1 }, { tenantId: T, bizId: B, gen: 1 }, B, [{ id: B }])), { ok: true, bind: { tenantId: T, bizId: B } });
  for (const [sel, biz, list, reason] of [[{ tenantId: null, bizId: B, gen: 1 }, B, [{ id: B }], "context_unbound"], [{ tenantId: "", bizId: B, gen: 1 }, B, [{ id: B }], "context_unbound"],
    [{ tenantId: T, bizId: B, gen: 1 }, null, [{ id: B }], "context_unbound"], [{ tenantId: T, bizId: B2, gen: 1 }, B, [{ id: B }], "context_unbound"],
    [{ tenantId: T, bizId: B, gen: 1 }, B, [], "business_unregistered"], [{ tenantId: T, bizId: B, gen: 1 }, B, null, "business_unregistered"], [{ tenantId: T, bizId: B, gen: 1 }, B, [{ id: B2 }], "business_unregistered"],
    [{ tenantId: T, bizId: B, gen: 2 }, B, [{ id: B }], "context_switching"]]) {
    assert.deepEqual(clone(C1.historyBinding({ tenantId: T, bizId: B, gen: 1 }, sel, biz, list)), { ok: false, reason }, JSON.stringify([sel, biz, list]));
  }
  assert.deepEqual(clone(C1.historyBinding({ tenantId: T2, bizId: B, gen: 1 }, { tenantId: T, bizId: B, gen: 1 }, B, [{ id: B }])), { ok: false, reason: "context_switching" }, "a node subscribed for another tenant is never decoded for this one");
  assert.deepEqual(clone(C1.historyBinding(null, { tenantId: T, bizId: B, gen: 1 }, B, [{ id: B }])), { ok: false, reason: "context_switching" });
});

test("PB-03 tenant switch with the SAME business id: the old tenant's node is never shown (context_switching → loading), the re-subscription binds the new tenant, the old subscription's late delivery is ignored", () => {
  const m = pageModel();
  m.selection.invalidate(T, B); m.commit(B);
  const oldSub = m.liveHistorySub(); oldSub.onRaw(history(T, B));
  assert.equal(m.finSrc().costHistory.state, "present");
  // the tenant switches synchronously (gen 2, tenantB); the render BEFORE the effect re-runs must not show tenantA's history
  m.selection.invalidate(T2, B);
  let src = m.finSrc(); assert.deepEqual(src.costHistory, { state: "loading" }); noFigures(src, "switching");
  assert.deepEqual(m.editorNode(), { kind: "loading" }, "the editor gets no node across the switch");
  // the effect re-runs for the new generation (deps include the selection generation)
  m.commit(B);
  assert.equal(oldSub.live, false, "the old subscription was cleaned up");
  assert.deepEqual({ tenantId: m.finRaw.tenantId, gen: m.finRaw.gen, kind: m.finRaw.costHistory.kind }, { tenantId: T2, gen: 2, kind: "loading" });
  // a late (stale) delivery from the OLD subscription must be ignored even though its unsubscribe is best-effort
  oldSub.onRaw(history(T, B));
  assert.equal(m.finRaw.costHistory.kind, "loading", "stale delivery ignored");
  assert.deepEqual(m.finSrc().costHistory, { state: "loading" });
  // the new subscription delivers: tenantA's bytes are unreadable under tenantB; tenantB's own history is present
  const newSub = m.liveHistorySub(); assert.notEqual(newSub, oldSub);
  newSub.onRaw(history(T, B)); src = m.finSrc(); assert.equal(src.costHistory.state, "unreadable"); noFigures(src, "foreign bytes");
  newSub.onRaw(history(T2, B)); src = m.finSrc(); assert.equal(src.costHistory.state, "present");
  // switching back: again loading until the effect re-binds, never the stale tenantB node
  m.selection.invalidate(T, B); assert.deepEqual(m.finSrc().costHistory, { state: "loading" });
});

test("PB-04 business switch: late async reads and callbacks of the old business are ignored; an unregistered business is business_unregistered even with a delivered node", async () => {
  const m = pageModel();
  m.selection.invalidate(T, B); m.commit(B);
  const subA = m.liveHistorySub(); subA.onRaw(history(T, B));
  assert.equal(m.finSrc().costHistory.state, "present");
  m.selection.invalidate(T, B2);
  assert.deepEqual(m.finSrc(B2).costHistory, { state: "loading" }, "before the effect: the old business node is not decoded for the new one");
  m.commit(B2);
  assert.equal(subA.live, false);
  subA.onRaw(history(T, B)); subA.onFail();
  assert.equal(m.finRaw.costHistory.kind, "loading", "old-business callbacks ignored");
  await new Promise((r) => setTimeout(r, 5));          // the old business's async config / fixed reads settle late
  assert.equal(m.finRaw.bizId, B2); assert.equal(m.finRaw.config.kind, "absent", "the NEW business's own reads settle");
  const subB = m.liveHistorySub(); assert.equal(subB.bizId, B2);
  subB.onRaw(history(T, B2)); assert.equal(m.finSrc(B2).costHistory.state, "present");
  // the business is removed from the tenant's registry while selected ⇒ unavailable, even though the node is in hand
  m.businesses = [{ id: B }];
  const src = m.finSrc(B2); assert.deepEqual(src.costHistory, { state: "unreadable", reason: "business_unregistered" }); noFigures(src, "unregistered");
  m.businesses = [{ id: B }, { id: B2 }]; assert.equal(m.finSrc(B2).costHistory.state, "present");
  m.businesses = []; assert.equal(m.finSrc(B2).costHistory.reason, "business_unregistered"); m.businesses = null; assert.equal(m.finSrc(B2).costHistory.reason, "business_unregistered");
});

test("PB-05 subscription update and retry: a later delivery replaces the node; a failed read is read_failed and a recovering delivery is present; a malformed update is unreadable", async () => {
  const m = pageModel();
  m.selection.invalidate(T, B); m.commit(B);
  await new Promise((r) => setTimeout(r, 5));          // config / fixed reads settle (absent)
  const sub = m.liveHistorySub();
  sub.onFail(); let src = m.finSrc(); assert.deepEqual(src.costHistory, { state: "unreadable", reason: "read_failed", detail: "read_failed" }); noFigures(src, "failed");
  sub.onRaw(history(T, B)); src = m.finSrc(); assert.equal(src.costHistory.state, "present");
  const bad = history(T, B); bad.versions[A].fixedItems[0].monthlyAmount = "1"; sub.onRaw(bad);
  src = m.finSrc(); assert.equal(src.costHistory.state, "unreadable"); noFigures(src, "malformed update");
  const two = history(T, B); const v2 = { ...two.versions[A], versionId: "00000000-0000-4000-8000-0000000000a2", predecessorVersionId: A, recordedAt: two.versions[A].recordedAt + 1, fixedItems: [{ itemKey: "f1", monthlyAmount: "3200" }] };
  two.head = { revision: 2, headVersionId: v2.versionId }; two.versions[v2.versionId] = v2; two.review[v2.versionId] = reviewEntry(v2, "cleared");
  sub.onRaw(two); src = m.finSrc(); assert.equal(src.costHistory.state, "present"); assert.equal(src.costHistory.versions.length, 2, "the update is reflected");
  const pendingNode = history(T, B); pendingNode.review[A] = reviewEntry(pendingNode.versions[A], "pending"); sub.onRaw(pendingNode);
  src = m.finSrc(); assert.equal(src.costHistory.reason, "authorization_review_pending"); assert.equal(views(src).inputs.reason, "cost_history_authorization_review_pending");
  const rejectedAll = history(T, B); rejectedAll.review[A] = reviewEntry(rejectedAll.versions[A], "rejected"); sub.onRaw(rejectedAll);
  src = m.finSrc(); assert.equal(src.costHistory.state, "present"); assert.deepEqual(src.costHistory.versions, [], "a rejected activation: present with NO effective version");
  assert.equal(F.costHistory.timelineSourceFor(src.costHistory).source, "cost_history"); assert.equal(src.costHistory.activationDate, null);
});

test("PB-06 a generation bump WITHOUT a business change (re-selecting the same business, tenant re-init) re-subscribes and re-binds — never a loading-forever selection", () => {
  const m = pageModel();
  m.selection.invalidate(T, B); m.commit(B);
  m.liveHistorySub().onRaw(history(T, B)); assert.equal(m.finSrc().costHistory.state, "present");
  m.selection.invalidate(T, B);                          // same tenant + business, gen 2
  assert.deepEqual(m.finSrc().costHistory, { state: "loading" }, "the render before the effect is loading, not the stale generation's node");
  m.commit(B);                                           // the effect depends on the generation ⇒ re-runs
  assert.equal(m.finRaw.gen, 2);
  m.liveHistorySub().onRaw(history(T, B)); assert.equal(m.finSrc().costHistory.state, "present");
  const effectDeps = html.slice(html.indexOf("    return () => { live = false; unsubs.forEach(u => typeof u === \"function\" && u()); };"), html.indexOf("  // Months a screen asked for"));
  assert.ok(effectDeps.includes("}, [currentBizId, finSel.gen, finSel.tenantId]);"), "the subscription effect is bound to the selection generation and tenant");
});

test("PB-07 page literals: the editor receives the node ONLY for the live selection, a null business when the selection is elsewhere, decodes bound, and the two capability checks name MARJIN_COSTH/6", () => {
  const prop = 'historyNode={finRaw.bizId===currentBizId&&finRaw.tenantId===finSel.tenantId&&finRaw.gen===finSel.gen?finRaw.costHistory:{kind:"loading"}}';
  assert.equal(html.split(prop).length - 1, 2, "both editor call sites bind the node to the live selection");
  assert.equal(html.split("tenantId={finSel.tenantId} bizId={finSel.bizId===currentBizId?currentBizId:null}").length - 1, 2);
  assert.ok(html.includes('    : !bound ? {state:"unreadable",reason:"context_unbound"}'), "the editor is unavailable without a binding");
  assert.ok(html.includes("    : codec.decodeHistoryStructure({exists:node.kind === \"raw\",value:node.raw},{tenantId,bizId});"), "the editor decodes bound");
  assert.ok(html.includes('const histBind = window.MarjinC1.historyBinding(finRaw, finSel, currentBizId, businesses);'));
  assert.ok(html.includes('      : !histBind.ok ? { state: "unreadable", reason: histBind.reason }'));
  assert.ok(html.includes('finF.costHistory.codec.decodeHistory({ failed: "read_failed" }, histBind.bind)'));
  assert.ok(html.includes('finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, histBind.bind)'));
  assert.equal(html.split('v.costHistory !== "MARJIN_COSTH/6"').length - 1, 1); assert.equal(html.split('api.versions.costHistory !== "MARJIN_COSTH/6"').length - 1, 1);
  assert.ok(!/MARJIN_COSTH\/[45]"/.test(html), "no earlier capability literal"); assert.ok(!/acknowledged/.test(html), "no fifth-state literal in the page");
  assert.ok(!/decodeHistory\([^)]*\)\s*(;|,)/.test(FINSRC_SRC.replace(/histBind\.bind\)/g, "BOUND)")) || !/decodeHistory\(\{[^}]*\}\)/.test(FINSRC_SRC), "no unbound decodeHistory call in finSrc");
  assert.ok(!FINSRC_SRC.includes("_currentTenantId"), "finSrc never binds to the global tenant variable");
});
