// P0-DATA-01 R10 — GATE 5 REAL UI CALL-SITE HARNESS (test-only).
//
// PURPOSE: execute the ACTUAL production UI handlers from `index.html` — not a copy,
// not a shim, not a re-implementation, not a source-string assertion.
//
// HOW IT WORKS. Each handler's source text is located in `index.html` by an
// unambiguous production anchor and extracted by BRACE MATCHING, then evaluated in a
// `node:vm` sandbox whose globals are exactly the closure dependencies that the real
// React component provides. The evaluated text is therefore the production text: if a
// production branch is deleted, inverted or renamed, the anchor assertion fails or the
// behavioural assertion fails. Nothing about the handler's control flow is restated
// here.
//
// The dependencies injected are the REAL production seams wherever a seam exists:
//   • window.MarjinSaveLifecycle / window.MarjinEntries — vm-loaded from index.html
//   • entriesWriteCoordRef.current  — real createEntriesWriteCoordinator
//   • entriesMutatorRef.current     — real createRemoteEntriesMutator
//   • saveUiRunnerRef.current       — real createSaveUiRunner
//   • supplierResultOwnershipRef    — real createSupplierResultOwnership
//   • exceptionOwnershipRef         — real createExceptionOwnership
//   • selectionCtrlRef.current      — real createSelectionController
//   • the remote                    — the Gate-3-approved destination-partitioned service
// Only terminal I/O and React state setters are controlled, and every setter is a spy
// so the visible/stateful effect of each outcome is observable.
//
// This module is TEST-ONLY: no runtime import, no CLI, no credentials.

import assert from "node:assert/strict";
import vm from "node:vm";
import { loadFinance } from "./c1-seam.mjs";
import { loadC2 } from "./c2-seam.mjs";
import {
  html, plain, tick, settleAll, mkId, day, entriesKey,
  makeRemoteService, drainLiveRigs,
} from "./cross-writer-harness.mjs";

export { html, plain, tick, settleAll, mkId, day, entriesKey, makeRemoteService, drainLiveRigs };

// C2: the rebuild trigger delegates to window.MarjinC2 (the REAL fingerprint block of this
// index.html) over the REAL generated fincore/v1 bundle, exactly as the page does once the C1
// bootstrap reports the core "ready". A test may model a core that is not ready (opts.fincore).
export const FINCORE = await loadFinance();
export const C2 = loadC2(html);

// ── Production seams, loaded into a sandbox that also supplies the timer the real
// `scheduleNav` needs. The Gate-3-approved harness is imported UNCHANGED for topology
// and fixtures; this second load exists solely so Gate 5 can drive the timer
// deterministically instead of altering an approved file.
// The fake timer NEVER fires on its own — no real timers, no sleeps — so a scheduled
// navigation is observable and, when a test wants it, explicitly fireable.
export const TIMERS = [];
let __timerSeq = 0;
function loadLifecycleWithTimers() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "[gate5] index.html must contain the P0-DATA-01 helper block");
  const f = html.indexOf("window.MarjinSaveLifecycle = Object.freeze({", start);
  assert.notEqual(f, -1, "[gate5] index.html must expose window.MarjinSaveLifecycle");
  const src = html.slice(start, html.indexOf("});", f) + 3);
  const sandbox = {
    window: {}, Math, Number, Object, Array, JSON, console, Error, Promise,
    encodeURIComponent, setImmediate,
    setTimeout: (fn, ms) => { const id = ++__timerSeq; TIMERS.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = TIMERS.find(x => x.id === id); if (t) t.cleared = true; },
  };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W5 = loadLifecycleWithTimers();
export const ME = W5.MarjinEntries;
export const ML = W5.MarjinSaveLifecycle;

// ── PRODUCTION SOURCE EXTRACTION ─────────────────────────────────────────────
// Brace-matched slice starting at `anchor`, tolerant of strings and comments.
// Indentation-independent, so reformatting cannot silently change what is extracted.
function braceSlice(source, anchor, label) {
  const start = source.indexOf(anchor);
  assert.notEqual(start, -1, `[gate5] production anchor missing for ${label}: ${JSON.stringify(anchor.slice(0, 60))}`);
  assert.equal(source.indexOf(anchor, start + 1), -1,
    `[gate5] production anchor for ${label} is not unique — refusing to guess which call site to test`);
  let i = source.indexOf("{", start);
  assert.notEqual(i, -1, `[gate5] no block found for ${label}`);
  let depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (line) { if (c === "\n") line = false; continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === str) str = null; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`[gate5] unbalanced block while extracting ${label}`);
}

// Extract the expression of a JSX attribute on a specific rendered element. The
// element is located by a unique nearby production anchor and the attribute value is
// taken by BRACE MATCHING, so the handler text is the production text — this module
// never contains a copy of it. Used for the daily-labor input's `onChange`, which is
// the rendered call site the operator actually triggers.
function jsxAttrExpression(source, elementAnchor, attr, label) {
  const at = source.indexOf(elementAnchor);
  assert.notEqual(at, -1, `[gate5] element anchor missing for ${label}: ${JSON.stringify(elementAnchor)}`);
  assert.equal(source.indexOf(elementAnchor, at + 1), -1,
    `[gate5] element anchor for ${label} is not unique — refusing to guess which element to test`);
  const close = source.indexOf("/>", at);
  assert.notEqual(close, -1, `[gate5] no element end found for ${label}`);
  const el = source.slice(at, close + 2);
  const a = el.indexOf(attr + "={");
  assert.notEqual(a, -1, `[gate5] element for ${label} has no ${attr} attribute — it is not wired to a handler`);
  assert.equal(el.indexOf(attr + "={", a + 1), -1, `[gate5] ${label} has more than one ${attr} attribute`);
  let i = a + attr.length + 1, depth = 0, str = null, esc = false;
  for (; i < el.length; i++) {
    const c = el[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return el.slice(a + attr.length + 2, i); }
  }
  throw new Error(`[gate5] unbalanced ${attr} expression while extracting ${label}`);
}

// Same idea for an element that is NOT self-closing: locate it by a unique marker
// anywhere inside its opening tag, walk back to the tag start, then brace-match the
// requested attribute expression.
function jsxAttrOnTag(source, marker, tag, attr, label) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `[gate5] marker missing for ${label}: ${JSON.stringify(marker)}`);
  assert.equal(source.indexOf(marker, at + 1), -1, `[gate5] marker for ${label} is not unique`);
  const start = source.lastIndexOf("<" + tag, at);
  assert.notEqual(start, -1, `[gate5] no <${tag} enclosing ${label}`);
  const a = source.indexOf(attr + "={", start);
  assert.ok(a !== -1 && a < at, `[gate5] ${label} has no ${attr} attribute before its marker — it is not wired`);
  let i = a + attr.length + 1, depth = 0, str = null, esc = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return source.slice(a + attr.length + 2, i); }
  }
  throw new Error(`[gate5] unbalanced ${attr} expression while extracting ${label}`);
}

// Every extracted handler must still contain the production markers the tests rely on.
// A rewrite that drops a branch fails HERE, before any behavioural assertion.
function requireMarkers(src, markers, label) {
  markers.forEach(m => assert.ok(src.includes(m), `[gate5] ${label} no longer contains the production marker ${JSON.stringify(m)}`));
}

const BASE_GLOBALS = () => ({
  JSON, Math, Number, Object, Array, Promise, Error, String, Boolean, Date,
  isNaN, parseInt, parseFloat, Set, Map, encodeURIComponent, setImmediate,
});

// Build the sandbox PRESERVING property descriptors, so that live accessors on `deps`
// (`entries`, `form`, …) are read at CALL time exactly as a React render closure reads
// them. Spreading would invoke each getter once and freeze the value.
function makeSandbox(deps) {
  const sandbox = { ...BASE_GLOBALS(), __OUT: null };
  for (const k of Object.keys(deps)) {
    Object.defineProperty(sandbox, k, Object.getOwnPropertyDescriptor(deps, k));
  }
  return sandbox;
}
// Evaluate an extracted DECLARATION (`const NAME = ...`) and return the declared value.
function evalDeclaration(src, name, deps) {
  const sandbox = makeSandbox(deps);
  vm.runInNewContext(`${src}\n;__OUT = ${name};`, sandbox);
  return sandbox.__OUT;
}
// Evaluate an extracted EXPRESSION (e.g. a JSX onClick arrow) and return it.
function evalExpression(src, deps) {
  const sandbox = makeSandbox(deps);
  vm.runInNewContext(`__OUT = (${src});`, sandbox);
  return sandbox.__OUT;
}

// ── The five production call sites, with their exact anchors ─────────────────
export const CALL_SITES = {
  revenue: {
    name: "saveEntry",
    anchor: "const saveEntry = async (skipSuppliers=false) => {",
    markers: ["saveUiRunnerRef.current.run(", "window.MarjinSaveLifecycle.executeEntrySave({",
              "persistMutation: (intent2, c2) => entriesWriteCoordRef.current.submitIntent(intent2)",
              "detail: r.detail || r.reason || r.error", "resetFormAndEditing:", "setError: setEntrySaveError"],
  },
  supplier: {
    name: "setSupPayDate",
    anchor: "const setSupPayDate = async (supId, date, val, rowsHint) => {",
    markers: ["const __sel = captureSelectionCtx();",
              "supplierResultOwnershipRef.current.begin(__sel)",
              "let __targetId = __row && __row.id != null ? __row.id : undefined",
              "supCreateRef.current[__createKey] = __newId",
              "entriesWriteCoordRef.current.submitSupplierEdit({",
              "targetId: __targetId,", "baseValue: __base, newId: __newId",
              "supplierResultOwnershipRef.current.settle(token, res, selectionCtrlRef.current"],
  },
  labor: {
    name: "submitLaborEntry",
    anchor: "const submitLaborEntry = (date, val) => {",
    markers: ["ambiguous_date_requires_id", "blocked_entry_identity_required",
              "entriesWriteCoordRef.current.submitIntent({", "createIfMissing: !existing"],
  },
  deleteByDate: {
    name: "deleteEntryByDate",
    anchor: "const deleteEntryByDate = async (date) => {",
    markers: ["buildEntryDeleteIntent(target, {})", "isValidEntryId(target.id)",
              "קיימות מספר רשומות לתאריך זה", "submitIntent(__intent)"],
  },
  deleteById: {
    name: "deleteEntryById",
    anchor: "const deleteEntryById = async (rowId) => {",
    markers: ["isValidEntryId(rowId)", "buildEntryDeleteIntent(target, {})",
              "submitIntent(__intent)", "describeSaveOutcome(res || \"failed\", false)"],
  },
  clearAll: {
    name: "clearAllOnClick",
    // The anchor starts at the arrow itself so brace matching begins at the arrow body,
    // not at the enclosing JSX expression brace. `precededBy` proves this arrow really
    // is the button's onClick handler and not some other arrow in the file.
    anchor: 'async ()=>{\n                  if(!window.confirm("למחוק את כל הרשומות?")) return;',
    precededBy: "onClick={",
    expression: true,
    markers: ["entriesWriteCoordRef.current.submitClearAll({",
              "expectedNodeFingerprint: entriesWriteCoordRef.current.currentFingerprint()",
              "confirmToken: newRowId()", "precondition_failed",
              "describeSaveOutcome(__res || \"failed\", false)"],
  },
  // R10-GATE-014 (L-GAP-1): the EmployeesScreen wrapper the rendered input calls.
  // It is the layer that used to discard the typed result.
  laborScreen: {
    name: "setDailyLabor",
    anchor: "const setDailyLabor = async (date, val) => {",
    markers: ["await submitLaborEntry(date, val)", "setLaborSaveError(\"\")",
              "describeSaveOutcome(res || \"failed\", false)",
              "st === \"stale\"", "st === \"committed\""],
  },
  materialChanged: {
    name: "__revenueMaterialChanged",
    anchor: "const __revenueMaterialChanged = (prev, next) => {",
    // C2: the body is the canonical fingerprint comparison over the C1-verified core, nothing else
    markers: ['window.__marjinFinance.state === "ready"', "window.MarjinFinance", "window.MarjinC2.financialChanged(fin, prev, next).changed"],
  },
};

// Extract once; every test reuses the same production text.
export const SOURCE = Object.fromEntries(Object.entries(CALL_SITES).map(([k, cs]) => {
  if (cs.precededBy) {
    const at = html.indexOf(cs.anchor);
    assert.equal(html.slice(at - cs.precededBy.length, at), cs.precededBy,
      `[gate5] ${cs.name} is no longer wired as ${cs.precededBy} — the handler under test is not the UI's handler`);
  }
  const src = braceSlice(html, cs.anchor, cs.name);
  requireMarkers(src, cs.markers, cs.name);
  return [k, src];
}));

// The RENDERED daily-labor input's onChange, extracted from the element itself. If the
// input is ever unwired, or wired to something other than setDailyLabor, this fails.
SOURCE.laborOnChange = jsxAttrExpression(html, 'placeholder="\u20aa \u05e0\u05d5\u05db\u05d7\u05d5\u05ea"', "onChange", "laborOnChange");
requireMarkers(SOURCE.laborOnChange, ["setDailyLabor(", "e.target.value"], "laborOnChange");

// R10-GATE-015 (D-GAP-1): the RENDERED per-duplicate delete button's own onClick.
SOURCE.dupDeleteOnClick = jsxAttrOnTag(html, 'data-testid="dup-delete"', "button", "onClick", "dupDeleteOnClick");
requireMarkers(SOURCE.dupDeleteOnClick, ["window.confirm(", "deleteEntryById(dup.id)"], "dupDeleteOnClick");

// Location of each handler in index.html (1-indexed), recorded for the artifact.
export const LOCATION = Object.fromEntries(Object.entries(CALL_SITES).map(([k, cs]) => {
  const idx = html.indexOf(cs.anchor);
  return [k, html.slice(0, idx).split("\n").length];
}));

// ── The controlled React component environment ───────────────────────────────
// Everything below models ONLY the component's closure: state values, state setters
// (spies), refs holding REAL production seams, and terminal I/O. No production control
// flow is reproduced here.
export function makeUiEnv(opts = {}) {
  const o = opts;
  const remote = o.remote || makeRemoteService();
  const tenantId = o.tenantId || "T1";
  const bizId = o.bizId || "A";

  const selection = ML.createSelectionController();
  selection.invalidate(tenantId, bizId);

  const calls = [];                       // every observable UI effect, in order
  const rec = (kind, payload) => { calls.push({ kind, payload }); return payload; };
  const state = {
    entries: plain(o.entries || []),
    form: { ...(o.form || {}) },
    editingDate: o.editingDate === undefined ? null : o.editingDate,
    editingId: o.editingId === undefined ? null : o.editingId,
    saved: false,
    entrySaveError: "",
    laborSaveError: "",
    supplierWriteError: "",
    dashboardInsightsWarning: "",
    entryStep: "form",
    screen: "entry",
    inFlight: false,
    exceptions: {},
    navScheduled: [],
    consoleWarnings: [],
  };

  const EMPTY_ENTRY = { date: "", sales: "", deliveries: "", other_income: "", food_cost: "",
                        payroll: "", other_expense: "", supplier_payments: {}, hourly_payroll: {} };

  // ── REAL production seams ──────────────────────────────────────────────────
  const mutator = ML.createRemoteEntriesMutator({
    selection,
    transact: (t, k, fn) => remote.transact(t, k, fn),
  });
  const coordinatorCalls = [];            // exact typed intents the UI handed the lane
  const rawCoord = ML.createEntriesWriteCoordinator({
    selection,
    canonicalize: ME.canonicalizeEntries,
    entryDateKey: ME.entryDateKey,
    fingerprint: (rows) => JSON.stringify(rows),
    contentFingerprint: ML.contentFingerprint,
    applyRows: (rows) => { state.entries = plain(rows); rec("applyRows", plain(rows)); },
    mutate: (intent, ctx) => mutator.mutate(intent, ctx),
  });
  // Capture EXACTLY what the production handler submits, then delegate unchanged.
  const coordinator = {
    ...rawCoord,
    submitIntent: (intent) => { coordinatorCalls.push({ api: "submitIntent", intent: plain(intent) }); return rawCoord.submitIntent(intent); },
    submitSupplierEdit: (args) => { coordinatorCalls.push({ api: "submitSupplierEdit", args: plain(args) }); return rawCoord.submitSupplierEdit(args); },
    submitClearAll: (args) => { coordinatorCalls.push({ api: "submitClearAll", args: plain(args) }); return rawCoord.submitClearAll(args); },
  };
  const supplierResultOwnership = ML.createSupplierResultOwnership();
  const exceptionOwnership = ML.createExceptionOwnership();
  const saveUiRunner = ML.createSaveUiRunner({
    ownership: ML.createSaveOwnership(),
    selection,
    setInFlight: (v) => { state.inFlight = v; rec("setInFlight", v); },
    makeOpId: () => "op-" + (++idSeq),
  });

  let idSeq = 0;
  const generated = [];
  const newRowId = () => { const id = o.nextId ? o.nextId() : mkId("ui-gen-" + (++idSeq)); generated.push(id); return id; };

  const listeners = [];
  const attach = () => {
    const ctxAtSetup = selection.capture();
    const d = { tenantId: ctxAtSetup.tenantId, key: entriesKey(ctxAtSetup.bizId) };
    const un = remote.atKey(d.tenantId, d.key).subscribe(
      (rows) => rawCoord.onListenerEcho(rows, ctxAtSetup),
      () => rawCoord.onListenerError(ctxAtSetup));
    listeners.push(un);
    return un;
  };
  const hydrate = () => {
    const c = selection.current();
    const rows = remote.atKey(c.tenantId, entriesKey(c.bizId)).rows();
    if (rows !== null) rawCoord.onListenerEcho(rows, selection.capture());
    state.entries = plain(rawCoord._state().desired || []);
    return env;
  };

  // ── The closure the production handlers see ────────────────────────────────
  const win = {
    MarjinEntries: ME,
    MarjinSaveLifecycle: ML,
    confirm: (msg) => { rec("confirm", msg); return o.confirm === undefined ? true : o.confirm; },
    apiFetch: o.apiFetch || (async () => ({ ok: true, json: async () => ({ ok: true }) })),
    crypto: { randomUUID: () => mkId("crypto-" + (++idSeq)) },
  };

  const supCreateRef = { current: {} };
  const deps = {
    window: win,
    console: { warn: (...a) => { state.consoleWarnings.push(a.join(" ")); rec("console.warn", a.join(" ")); },
               error: () => {}, log: () => {} },
    EMPTY_ENTRY,
    newRowId,
    // live closure values — read at CALL time, exactly as a React render closure would
    get entries() { return state.entries; },
    get form() { return state.form; },
    get loggedInUser() { return o.loggedInUser || { role: "owner" }; },
    entriesWriteCoordRef: { current: coordinator },
    entriesMutatorRef: { current: mutator },
    selectionCtrlRef: { current: selection },
    supplierResultOwnershipRef: { current: supplierResultOwnership },
    // SUP-DRAFT: the grid's per-(tenant|business|date) created-row id memo (a useRef in production)
    supCreateRef,
    exceptionOwnershipRef: { current: exceptionOwnership },
    saveUiRunnerRef: { current: saveUiRunner },
    saveNavTimerRef: { current: null },
    editingDateRef: { get current() { return state.editingDate; }, set current(v) { state.editingDate = v; } },
    suppressNextDashboardInsightsLoadForBizRef: { current: null },
    captureSelectionCtx: () => selection.capture(),
    // state setters — spies, so every visible/stateful effect is observable
    setEntries: (rows) => { state.entries = plain(rows); rec("setEntries", plain(rows)); },
    setForm: (f) => { state.form = plain(typeof f === "function" ? f(state.form) : f); rec("setForm", plain(state.form)); },
    setEditingId: (v) => { state.editingId = v; rec("setEditingId", v); },
    setSaved: (v) => { state.saved = v; rec("setSaved", v); },
    setEntrySaveError: (m) => { state.entrySaveError = m; rec("setEntrySaveError", m); },
    setLaborSaveError: (m) => { state.laborSaveError = m; rec("setLaborSaveError", m); },
    setSupplierWriteError: (m) => { state.supplierWriteError = m; rec("setSupplierWriteError", m); },
    setDashboardInsightsWarning: (m) => { state.dashboardInsightsWarning = m; rec("setDashboardInsightsWarning", m); },
    setDashboardInsights: (v) => rec("setDashboardInsights", v),
    setDashboardInsightsDate: (v) => rec("setDashboardInsightsDate", v),
    setDashboardInsightsLoading: (v) => rec("setDashboardInsightsLoading", v),
    setDashboardInsightsError: (v) => rec("setDashboardInsightsError", v),
    setEntryExceptions: (f) => { state.exceptions = plain(typeof f === "function" ? f(state.exceptions) : f); rec("setEntryExceptions", plain(state.exceptions)); },
    setEntryStep: (v) => { state.entryStep = v; rec("setEntryStep", v); },
    setScreen: (v) => { state.screen = v; rec("setScreen", v); },
    // terminal I/O the seam calls
    normalizeDailyEntryRevenueForVat: o.vatNormalize || ((f) => f),
    israelDateKey: (off) => (off === 0 ? "2026-08-10" : off === 1 ? "2026-08-11" : "2026-08-09"),
    loadEntryExceptions: async () => rec("loadEntryExceptions", true),
    rebuildInsightsAfterEntrySave: async (d) => rec("rebuildInsights", d),
    loadDashboardInsights: async (d) => { rec("loadInsights", d); return { ok: true, found: true, date: d }; },
  };
  // __revenueMaterialChanged is itself production code — extracted, never restated.
  // C2: its window is the page's: the C2 block, the core bundle and the C1 bootstrap state.
  const fincoreState = o.fincore || "ready";
  deps.__revenueMaterialChanged = evalDeclaration(SOURCE.materialChanged, "__revenueMaterialChanged", {
    ...BASE_GLOBALS(),
    window: { MarjinC2: C2, MarjinFinance: FINCORE, __marjinFinance: { state: fincoreState, error: null } },
  });

  const timerBase = TIMERS.length;
  const env = {
    remote, selection, state, calls, coordinatorCalls, generated, deps,
    // Navigation scheduled by the real `scheduleSelectionBoundTimeout`. Never fires by
    // itself; `fireNav()` runs the pending callbacks explicitly.
    scheduledNav: () => TIMERS.slice(timerBase).filter(t => !t.cleared),
    fireNav: () => { TIMERS.slice(timerBase).filter(t => !t.cleared).forEach(t => { t.cleared = true; t.fn(); }); },
    coordinator, mutator, supplierResultOwnership, exceptionOwnership, saveUiRunner,
    EMPTY_ENTRY,
    attach, hydrate,
    at: (t, b) => remote.at(t, b),
    destination: () => { const c = selection.current(); return { tenantId: c.tenantId, key: entriesKey(c.bizId) }; },
    effects: (kind) => calls.filter(c => c.kind === kind).map(c => c.payload),
    effectKinds: () => calls.map(c => c.kind),
    reset: () => { calls.length = 0; coordinatorCalls.length = 0; },
    switchTo: (t, b) => { listeners.splice(0).forEach(un => un()); selection.invalidate(t, b); rawCoord.invalidate(); return env; },
  };
  // DETERMINISTIC WATCHDOG, identical in threshold and behaviour to the accepted
  // Gate 3 one: an invocation that never settles fails ITS OWN test after 60
  // deterministic ticks, naming the held transaction. No timers, no sleeps, no
  // automatic acknowledgement, no swallowed rejections.
  const guard = (p, label) => {
    const r = { settled: false };
    Promise.resolve(p).then(() => { r.settled = true; }, () => { r.settled = true; });
    const watchdog = (async () => {
      for (let i = 0; i < 60; i++) { await tick(); if (r.settled) break; }
      if (r.settled) return new Promise(() => {});
      throw new Error(`[gate5] ${label} never settled after 60 deterministic ticks. `
        + `inFlight=${remote.inFlight()}, HELD=[${remote.outstandingHolds().join(",")}]. `
        + `Release the held transaction, or assert the blocked result instead of awaiting it.`);
    })();
    return Promise.race([Promise.resolve(p), watchdog]);
  };
  // The REAL production handlers, bound to this environment.
  const H = {
    saveEntry: evalDeclaration(SOURCE.revenue, "saveEntry", deps),
    setSupPayDate: evalDeclaration(SOURCE.supplier, "setSupPayDate", deps),
    submitLaborEntry: evalDeclaration(SOURCE.labor, "submitLaborEntry", deps),
    deleteEntryByDate: evalDeclaration(SOURCE.deleteByDate, "deleteEntryByDate", deps),
    deleteEntryById: evalDeclaration(SOURCE.deleteById, "deleteEntryById", deps),
    clearAllClick: evalExpression(SOURCE.clearAll, deps),
  };
  // The EmployeesScreen wrapper, bound to the REAL extracted submitLaborEntry above.
  // Nothing between the rendered input and the coordinator is re-implemented here.
  H.setDailyLabor = evalDeclaration(SOURCE.laborScreen, "setDailyLabor", {
    ...BASE_GLOBALS(), window: win,
    submitLaborEntry: H.submitLaborEntry,
    setLaborSaveError: deps.setLaborSaveError,
  });
  Object.entries(H).forEach(([k, fn]) => { env[k] = (...a) => guard(fn(...a), k); });
  // The rendered call site: input onChange -> setDailyLabor -> submitLaborEntry.
  // `date` is the render-loop variable of the row being edited.
  env.laborInputChange = (date, value) => {
    const onChange = evalExpression(SOURCE.laborOnChange, { ...BASE_GLOBALS(), date, setDailyLabor: env.setDailyLabor });
    return onChange({ target: { value } });
  };
  // The rendered duplicate-row delete: onClick -> window.confirm -> deleteEntryById.
  env.dupDeleteClick = (dup, cardEntry) => {
    const onClick = evalExpression(SOURCE.dupDeleteOnClick, {
      ...BASE_GLOBALS(), window: win, dup, e: cardEntry, deleteEntryById: env.deleteEntryById,
    });
    return onClick();
  };
  env.__raw = H;
  return env;
}
