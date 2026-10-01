// Marjin — CD-M2: "Business closed" action against a REAL Firebase RTDB Emulator.
//
// Runs the ACTUAL production code vm-extracted from index.html — the closure seam
// (window.MarjinClosureLifecycle), the destination lane and the remote-atomic mutator —
// over real RTDB transactions (demo project, loopback emulator, repository Rules). The
// structured-exception step uses the REAL server transaction body (lib/entryExceptions.js
// applyOperation, requestHash, safeStateView) inside a real RTDB transaction at the real
// ledger path, as api/admin.js does with the Admin SDK. The result is then read back by the
// APPROVED CD-M1 server loader and canonical report (compiled src/finance-server/*), so the
// financial meaning is proven from storage, not from the client's view.
//
// Deliberately NOT named *.test.mjs (needs an emulator). Exits 0 only when every case passes.
//
// Run (see test/emulator/README.md for the emulator start):
//   env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
//     GCLOUD_PROJECT=demo-marjin-rules GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
//     FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 node test/emulator/closure-action-emulator.mjs

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { requestHash, safeStateView, validateSetInput } from "../../lib/entryExceptions.js";
import { runEntryExceptionTxn, listEntryExceptions } from "../../lib/repositories/entryExceptionsRepo.js";
import { compileServer } from "../support/server-reader-harness.mjs";

const PROJECT = "demo-marjin-rules";
const NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU_HOSTPORT = "127.0.0.1:9000";
const DB_URL = `http://${EMU_HOSTPORT}?ns=${NAMESPACE}`;
function fail(msg) { console.error(`SAFETY ABORT: ${msg}`); process.exit(2); }
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..");
function assertSafeEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU_HOSTPORT) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be exactly ${EMU_HOSTPORT}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) fail("FIREBASE_DATABASE_URL must be absent");
  if (Buffer.compare(readFileSync(join(DIR, "database.rules.json")), readFileSync(join(ROOT, "database.rules.json"))) !== 0)
    fail("test/emulator/database.rules.json differs from canonical database.rules.json");
}

// ─── production code from index.html ───────────────────────────────────────────
const html = readFileSync(join(ROOT, "index.html"), "utf8");
function loadSeams() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  const f = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  if (start === -1 || f === -1 || html.indexOf("window.MarjinClosureLifecycle = Object.freeze({", start) > f) fail("index.html anchors for the lifecycle/closure/storage-v2 blocks not found");
  const sandbox = { window: { crypto: globalThis.crypto }, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
const W = loadSeams();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, MC = W.MarjinClosureLifecycle, MS = W.MarjinStorageV2;
if (!html.includes("return await runTransaction(ref(db, path), txnFn, { applyLocally: false });")) fail("production mutateFor transaction call changed — update this harness");
const plain = (x) => JSON.parse(JSON.stringify(x));
const entriesPath = (t, b) => `tenants/${t}/${`biz:${b}:entries`.replace(/[.#$[\]]/g, "_")}`;
const ledgerPath = (t, b) => `tenants/${t}/entry_exceptions/${b}`;

const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid4 = (seed) => { const a = __hash("a" + seed), b = __hash("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
let __seq = 0;
const nextId = () => uuid4("cdm2-emu-" + (++__seq));

const T = "tenantA", B = "bizA", D = "2026-09-10", TODAY = "2026-09-15";
const R1 = uuid4("r1"), R2 = uuid4("r2");
const IDS = { owner: { uid: "u_owner", token: { email: "owner@demo.example" } }, manager: { uid: "u_manager", token: { email: "manager@demo.example" } } };
function fixtures() {
  const rows = [
    { id: R1, date: D, sales: 300, deliveries: 0, other_income: 0, supplier_payments: { s1: "40" }, payroll: "100", unknown_field: "keep" },
    { id: R2, date: D, sales: "200", twin: "yes" },
    { id: uuid4("r0"), date: "2026-09-09", sales: 999, deliveries: 0, other_income: 0 },
  ];
  return { tenants: { [T]: {
    members: { u_owner: true, u_manager: true }, roles: { u_owner: "owner", u_manager: "manager" }, biz_access: { [B]: { u_manager: true } },
    [`biz:${B}:entries`]: { _v: JSON.stringify(rows) },
    [`biz:${B}:config`]: { _v: JSON.stringify({}) },
  } } };
}

const apps = {};
function initApps() {
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");     // admin: fixtures + the server's ledger transaction
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: IDS.owner }, "owner");
  apps.manager = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: IDS.manager }, "manager");
}
const seedDb = () => apps.seed.database();
async function reseed() { detachAll(); await seedDb().ref("/").set(fixtures()); }
async function readRows() { const s = await seedDb().ref(entriesPath(T, B)).once("value"); return ML.parseEntriesNode(s.exists() ? s.val() : null).rows; }
async function readLedger() { const s = await seedDb().ref(ledgerPath(T, B)).once("value"); return s.exists() ? s.val() : null; }

// The server's set/clear-entry-exception: the PRODUCTION repository transaction
// (lib/repositories/entryExceptionsRepo.js runEntryExceptionTxn) on the real ledger node, with
// api/admin.js's validation, request hash and status mapping (eeRespond). `cold:true` gives every
// request a FRESH server instance (a new Admin app ⇒ empty local cache), as a serverless cold start.
let __coldSeq = 0;
function serverApi(role, uid, { cold = false } = {}) {
  const calls = [];
  const apiFetch = async (url, opts) => {
    if (/action=list-entry-exceptions/.test(url)) {
      // api/admin.js handleListEntryExceptions: the PRODUCTION repository read (Admin SDK, server side)
      const q = new URL("http://x" + url).searchParams;
      calls.push({ action: "list", from: q.get("fromDate"), to: q.get("toDate") });
      const exceptions = await listEntryExceptions({ tenantId: q.get("tenantId"), bizId: q.get("bizId"), fromDate: q.get("fromDate"), toDate: q.get("toDate") });
      return { ok: true, status: 200, json: async () => ({ ok: true, exceptions: JSON.parse(JSON.stringify(exceptions)) }) };
    }
    const action = /set-entry-exception/.test(url) ? "set" : "clear";
    const body = JSON.parse(opts.body);
    calls.push({ action, body });
    let normalized = { reasonCode: null, reasonText: null };
    if (action === "set") normalized = validateSetInput({ reasonCode: body.reasonCode, reasonText: body.reasonText });
    const cmd = { action, tenantId: body.tenantId, bizId: body.bizId, businessDate: body.businessDate, reasonCode: normalized.reasonCode, reasonText: normalized.reasonText,
      actorUid: uid, actorRole: role, expectedRevision: body.expectedRevision, operationId: body.operationId, now: 1790000000000 };
    cmd.requestHash = requestHash(cmd);
    let app = null;
    if (cold) app = admin.initializeApp({ databaseURL: DB_URL }, "cold-server-" + (++__coldSeq));
    let outcome;
    try { outcome = await runEntryExceptionTxn(cmd, cold ? app.database() : seedDb()); }
    finally { if (app) await app.delete().catch(() => {}); }
    if (outcome.outcome === "conflict") {
      const map = { revision_conflict: 409, idempotency_conflict: 409, operation_owner_required: 409, operation_hard_limit_reached: 409, txn_failed: 502 };
      return { ok: false, status: map[outcome.code] || 409, json: async () => ({ ok: false, error: outcome.code }) };
    }
    const applied = outcome.outcome === "applied";
    return { ok: true, status: 200, json: async () => ({ ok: true, exception: safeStateView(outcome.state), revision: outcome.revision, applied, replayed: outcome.outcome === "replayed", rebuildRequired: applied }) };
  };
  return { apiFetch, calls };
}

const LIVE = [];
function makeClient(appKey) {
  const db = apps[appKey].database();
  const ctrl = ML.createSelectionController(); ctrl.invalidate(T, B);
  const mutator = ML.createRemoteEntriesMutator({ selection: ctrl,
    transact: async (t, key, txnFn) => { const res = await db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`).transaction(txnFn, undefined, false); return { committed: res.committed, snapshot: res.snapshot }; } });
  const lane = ML.createEntriesWriteCoordinator({ selection: ctrl, canonicalize: ME.canonicalizeEntries, entryDateKey: ME.entryDateKey,
    fingerprint: (rows) => JSON.stringify(rows), contentFingerprint: ML.contentFingerprint, applyRows: () => {}, mutate: (intent, ctx) => mutator.mutate(intent, ctx) });
  const client = { ctrl, lane, db, _ref: null, _h: null,
    attach() { const c0 = ctrl.capture(); const ref = db.ref(entriesPath(T, B)); return new Promise((res, rej) => { let first = true;
      const h = ref.on("value", (snap) => { const p = ML.parseEntriesNode(snap.exists() ? snap.val() : null); if (p.absent) lane.markHydrated(c0, []); else if (p.rows) lane.onListenerEcho(p.rows, c0); if (first) { first = false; res(client); } },
        (err) => { lane.onListenerError(c0); if (first) { first = false; rej(err); } }); client._ref = ref; client._h = h; }); },
    detach() { if (client._ref) client._ref.off("value", client._h); client._ref = null; },
    rows: () => lane._state().desired || [],
  };
  LIVE.push(client);
  return client;
}
function detachAll() { while (LIVE.length) { try { LIVE.pop().detach(); } catch (_) {} } }
const settle = () => new Promise((r) => setTimeout(r, 150));

let __opSeq = 0;
function closureIo(client, api, own, extra = {}) {
  return { selection: client.ctrl, date: D, rows: client.rows(), today: TODAY, role: "owner", confirmedFingerprint: null,
    exceptionState: { get: (d) => own.getState(d), set: (d, st) => own.setState(d, st), applyActive: () => {} },
    opIds: { ensure: (d, mk) => own.ensureOpId(d, mk), consume: (d) => own.consumeOpId(d) },
    newOpId: () => "emu-op-" + (++__opSeq), newRowId: nextId, emptyEntry: {},
    apiFetch: api.apiFetch,
    persistMutation: (intent) => client.lane.submitIntent(intent).then((r) => ({ ok: r.status === "committed" || r.status === "committed_idempotent", canonical: r.rows, status: r.status, reason: r.reason, detail: r.detail })),
    // CD-M2 R1 (T2): the production mutateFor contract — runTransaction(ref, fn, {applyLocally:false})
    // — on THIS client's database handle (its listener cache is the only local state it has)
    verifyTransact: async (t, key, fn) => { const res = await client.db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`).transaction(fn, undefined, false); return { committed: res.committed, snapshot: res.snapshot }; },
    readNode: (raw) => MS.readEntriesNode(raw),
    applyRows: () => {}, reloadExceptions: async () => {}, rebuildInsights: async () => {}, onInsightsFailure: () => {}, setError: () => {},
    ...extra };
}

// CD-M1 server meaning, read from the emulator through the approved loader + canonical report.
const srv = compileServer();
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const PF = await srv.import("src/policy/productFinance.js");
async function canonical() {
  const nowMs = Date.UTC(2026, 8, 15, 9);
  const inputs = await CI.loadCanonicalInputs(seedDb(), T, B, { site: "cd-m2-emulator", nowMs, need: { config: true, fixed: false, exceptions: true } });
  const { report, provenance } = CM.canonicalMonthReport(inputs, { kind: "open_month", month: "2026-09" });
  return { exceptionsState: inputs.exceptionsState, cal: provenance.operatingCalendar, closed: report.operatingCalendar.closedDates, declared: PF.productClosureCalendar(inputs).closedDates, cov: report.coverage.revenue,
    contradiction: report.flags.filter((f) => f.code === "closed_day_has_recorded_values").map((f) => f.date) };
}

const results = []; let failures = 0;
async function run(id, description, fn) {
  const t0 = Date.now();
  try { const notes = await fn(); results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: notes || "" }); }
  catch (err) { failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: (err && err.message) || String(err) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

async function main() {
  assertSafeEnvironment();
  initApps();

  await run("CDM2-EMU-01", "cancel: the confirmation request writes nothing to RTDB (entries and ledger byte-identical)", async () => {
    await reseed();
    const before = JSON.stringify(await readRows());
    const A = await makeClient("manager").attach();
    const api = serverApi("manager", "u_manager");
    const r = plain(await MC.executeClosureAction(closureIo(A, api, ML.createExceptionOwnership(), { role: "manager" })));
    eq(r.status, "confirmation_required", "status"); eq(r.plan.displayTotal, 500, "shown amount");
    await settle();
    eq(api.calls.length, 0, "no ledger call"); eq(JSON.stringify(await readRows()), before, "entries unchanged"); eq(await readLedger(), null, "ledger unchanged");
  });

  await run("CDM2-EMU-02", "confirmed closure while ANOTHER client edits a supplier on the same row: closure + explicit zero committed, the other edit survives; CD-M1 server report reads a valid closed day", async () => {
    await reseed();
    const A = await makeClient("manager").attach();
    const Bc = await makeClient("owner").attach();
    const api = serverApi("manager", "u_manager"); const own = ML.createExceptionOwnership();
    const ask = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager" })));
    // another independent client commits an unrelated change to the same row after the dialog was shown
    const prev = Bc.rows().find((r) => r.id === R1);
    const sup = await Bc.lane.submitIntent(ML.buildEntryUpsertIntent(prev, { ...prev, supplier_payments: { s1: "40", s2: "77" } }, {}));
    expect(sup.status === "committed", "other client's supplier edit committed: " + sup.status);
    await settle();
    const res = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager", confirmedFingerprint: ask.plan.fingerprint })));
    eq(res.status, "closed", "closure outcome");
    const rows = await readRows();
    const r1 = rows.find((r) => r.id === R1), r2 = rows.find((r) => r.id === R2);
    eq([r1.sales, r1.supplier_payments, r1.unknown_field, r1.payroll, r2.sales, r2.twin], [0, { s1: "40", s2: "77" }, "keep", "100", 0, "yes"], "row contents");
    const led = await readLedger();
    eq([led[D].state.status, led[D].state.reasonCode, Object.keys(led[D].operations).length], ["active", "closure", 1], "ledger");
    const c = await canonical();
    eq([c.exceptionsState, c.cal, c.closed, c.cov.closedDays, c.cov.invalidDays, c.contradiction], ["present", "entry_exception_closure", [D], [D], [], []], "canonical meaning");
  });

  await run("CDM2-EMU-03", "a concurrent REVENUE change by another client after confirmation: remote conflict, nothing overwritten, closure recorded ⇒ CD-M1 reports the contradiction; repair re-confirms and converges", async () => {
    await reseed();
    const A = await makeClient("manager").attach();
    const Bc = await makeClient("owner").attach();
    const api = serverApi("manager", "u_manager"); const own = ML.createExceptionOwnership();
    const ask = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager" })));
    const prev = Bc.rows().find((r) => r.id === R2);
    const changed = await Bc.lane.submitIntent(ML.buildEntryUpsertIntent(prev, { ...prev, sales: "777" }, {}));
    expect(changed.status === "committed", "other client's revenue change committed");
    // A's view still predates B's change only if A's listener has not echoed yet — force the realistic race:
    const staleRows = A.rows().map((r) => (r.id === R2 ? { ...r, sales: "200" } : r));
    const res = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager", rows: staleRows, confirmedFingerprint: ask.plan.fingerprint })));
    eq([res.status, res.stage], ["partial", "revenue"], "typed partial");
    expect((await readRows()).find((r) => r.id === R2).sales === "777", "B's revenue is not overwritten");
    let c = await canonical();
    eq([c.closed, c.cov.invalidDays, c.contradiction], [[D], [D], [D]], "visible contradiction, never a complete fact");
    await settle();
    const again = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager", confirmedFingerprint: ask.plan.fingerprint })));
    eq(again.status, "confirmation_required", "the outdated confirmation cannot zero 777");
    const done = plain(await MC.executeClosureAction(closureIo(A, api, own, { role: "manager", confirmedFingerprint: again.plan.fingerprint })));
    eq([done.status, done.closureApplied], ["closed", false], "repair converges without a second closure op");
    c = await canonical();
    eq([c.cov.invalidDays, c.cov.closedDays, c.contradiction], [[], [D], []], "converged meaning");
  });

  await run("CDM2-EMU-04", "reopen clears the closure only; revenue stays the explicit 0 (no entries write); CD-M1 reads an operating zero", async () => {
    await reseed();
    const A = await makeClient("owner").attach();
    const api = serverApi("owner", "u_owner"); const own = ML.createExceptionOwnership();
    const ask = plain(await MC.executeClosureAction(closureIo(A, api, own)));
    eq(plain(await MC.executeClosureAction(closureIo(A, api, own, { confirmedFingerprint: ask.plan.fingerprint }))).status, "closed", "closed");
    const before = JSON.stringify(await readRows());
    eq(plain(await MC.executeClosureReopen(closureIo(A, api, own))).status, "reopened", "reopened");
    eq(JSON.stringify(await readRows()), before, "no entries change on reopen");
    const led = await readLedger(); eq([led[D].state.status, led[D].state.revision], ["cleared", 2], "ledger cleared");
    const c = await canonical();
    eq([c.closed, c.cov.closedDays, c.cov.invalidDays, c.cov.missingDays.includes(D)], [[], [], [], false], "operating zero");
  });

  await run("CDM2-EMU-05", "future date: ledger only, no entries write; CD-M1 lists it as a declared closure", async () => {
    await reseed();
    const A = await makeClient("owner").attach();
    const api = serverApi("owner", "u_owner");
    const before = JSON.stringify(await readRows());
    const r = plain(await MC.executeClosureAction(closureIo(A, api, ML.createExceptionOwnership(), { date: "2026-09-20" })));
    eq([r.status, r.timing, r.revenueIntents], ["closed", "future", 0], "future closure");
    eq(JSON.stringify(await readRows()), before, "no future row written");
    const c = await canonical(); eq([c.declared, c.closed], [["2026-09-20"], []], "declared closure (outside the completed Actual window)");
  });

  await run("CDM2-EMU-06", "COLD server instance per request: close → reopen → close again all succeed through the production ledger transaction (no spurious revision_conflict)", async () => {
    await reseed();
    const A = await makeClient("owner").attach();
    const api = serverApi("owner", "u_owner", { cold: true }); const own = ML.createExceptionOwnership();
    const ask = plain(await MC.executeClosureAction(closureIo(A, api, own)));
    eq(plain(await MC.executeClosureAction(closureIo(A, api, own, { confirmedFingerprint: ask.plan.fingerprint }))).status, "closed", "close (fresh node)");
    const errs = [];
    const ro = plain(await MC.executeClosureReopen(closureIo(A, api, own, { setError: (m) => errs.push(m) })));
    eq([ro.status, errs], ["reopened", []], "reopen on a cold instance");
    await settle();
    const again = plain(await MC.executeClosureAction(closureIo(A, api, own, { setError: (m) => errs.push(m) })));
    eq([again.status, errs], ["closed", []], "re-close an existing (cleared) state on a cold instance");
    const led = await readLedger(); eq([led[D].state.status, led[D].state.revision, Object.keys(led[D].operations).length], ["active", 3, 3], "ledger: three operations, rev 3");
  });


  // ══ CD-M2 R1 — CDM2-F01 on a REAL RTDB: success only after the authoritative T2/T3 check ══
  const zeroFixture = async () => { await reseed(); await seedDb().ref(entriesPath(T, B)).set({ _v: JSON.stringify([{ id: R1, date: D, sales: 0, deliveries: 0, other_income: 0, payroll: "100", unknown_field: "keep" }]) }); };
  const otherClientSales = async (id, sales) => { const rows = await readRows(); rows.find((r) => r.id === id).sales = sales; await seedDb().ref(entriesPath(T, B)).set({ _v: JSON.stringify(rows) }); };

  await run("CDM2-EMU-07", "CDM2-F01 exact race: explicit-zero row (no zeroing intent); another client writes sales 50 after the ledger committed ⇒ partial, 50 kept, fresh plan of 50; confirming exactly those server rows closes", async () => {
    await zeroFixture();
    const A = await makeClient("owner").attach();
    const api = serverApi("owner", "u_owner"); const own = ML.createExceptionOwnership();
    const view = A.rows();
    const apiRace = async (url, opts) => { const r = await api.apiFetch(url, opts); if (/set-entry-exception/.test(url)) await otherClientSales(R1, 50); return r; };
    const res = plain(await MC.executeClosureAction(closureIo(A, api, own, { rows: view, apiFetch: apiRace })));
    eq([res.status, res.stage, res.reason], ["partial", "verify", "revenue_changed_concurrently"], "never closed");
    eq((await readRows()).find((r) => r.id === R1).sales, 50, "50 not zeroed");
    eq([res.replan.needsConfirmation, res.replan.displayTotal], [true, 50], "fresh plan from the server rows");
    let c = await canonical(); eq([c.cov.invalidDays, c.contradiction], [[D], [D]], "CD-M1 contradiction (what the operator is told)");
    const done = plain(await MC.executeClosureAction(closureIo(A, api, own, { rows: res.verifiedRows, confirmedFingerprint: res.replan.fingerprint })));
    eq([done.status, done.closureApplied], ["closed", false], "repair closes after the explicit confirmation");
    const rows = await readRows(); eq([rows[0].sales, rows[0].unknown_field], [0, "keep"], "zeroed, unrelated field kept");
    c = await canonical(); eq([c.cov.invalidDays, c.cov.closedDays, c.contradiction], [[], [D], []], "valid closed day");
  });

  await run("CDM2-EMU-08", "a revenue write after the FINAL zeroing transaction committed (before verification) ⇒ partial, never overwritten", async () => {
    await reseed();
    const A = await makeClient("owner").attach();
    const api = serverApi("owner", "u_owner"); const own = ML.createExceptionOwnership();
    const ask = plain(await MC.executeClosureAction(closureIo(A, api, own)));
    let n = 0;
    const base = closureIo(A, api, own);
    const res = plain(await MC.executeClosureAction(closureIo(A, api, own, { confirmedFingerprint: ask.plan.fingerprint,
      persistMutation: async (intent) => { const r = await base.persistMutation(intent); if (++n === ask.plan.rows.length) await otherClientSales(R1, 70); return r; } })));
    eq([res.status, res.stage, res.reason, n], ["partial", "verify", "revenue_changed_concurrently", 2], "never closed");
    eq((await readRows()).find((r) => r.id === R1).sales, 70, "70 kept");
  });

  await run("CDM2-EMU-09", "valid explicit-zero path on real Rules: the identity compare-and-set is ACCEPTED for a manager, changes no stored byte, and the ledger is re-read; result closed", async () => {
    await zeroFixture();
    const before = JSON.stringify(await readRows());
    const A = await makeClient("manager").attach();
    const api = serverApi("manager", "u_manager");
    const res = plain(await MC.executeClosureAction(closureIo(A, api, ML.createExceptionOwnership(), { role: "manager" })));
    eq([res.status, res.revenueIntents, res.verified.closureRevision, res.verified.mode], ["closed", 0, 1, "legacy"], "closed and verified");
    eq(JSON.stringify(await readRows()), before, "entries byte-identical");
    expect(api.calls.some((c2) => c2.action === "list" && c2.from === D && c2.to === D), "ledger re-read for the date");
  });

  await run("CDM2-EMU-10", "Storage V2 node (v2_active policy): the identity compare-and-set is accepted by the V2 Rules; a valid zero row closes; a concurrent revenue write after the ledger commit is detected", async () => {
    await reseed();
    await seedDb().ref(`storage_v2_control/${T}/${B}`).set({ contractVersion: 1, phase: "v2_active", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 2 });
    const v2 = { schemaVersion: 2, generation: 1, rows: { [R1]: { id: R1, date: D, sales: 0, deliveries: 0, other_income: 0, _gen: 1, unknown_field: "keep" } } };
    await seedDb().ref(entriesPath(T, B)).set(v2);
    const A = makeClient("owner");
    const h = A.db.ref(entriesPath(T, B)).on("value", () => {}); await settle();           // a live listener: the client has a local cache
    const view = [{ id: R1, date: D, sales: 0, deliveries: 0, other_income: 0, unknown_field: "keep" }];
    const api = serverApi("owner", "u_owner");
    const before = JSON.stringify((await seedDb().ref(entriesPath(T, B)).once("value")).val());
    const ok = plain(await MC.executeClosureAction(closureIo(A, api, ML.createExceptionOwnership(), { rows: view })));
    eq([ok.status, ok.verified.mode], ["closed", "v2"], "V2 verified closed");
    eq(JSON.stringify((await seedDb().ref(entriesPath(T, B)).once("value")).val()), before, "V2 node byte-identical (as stored)");
    // race on a V2 row
    await seedDb().ref(ledgerPath(T, B)).remove();
    const apiRace = async (url, opts) => { const r = await api.apiFetch(url, opts); if (/set-entry-exception/.test(url)) await seedDb().ref(`${entriesPath(T, B)}/rows/${R1}/sales`).set(50); return r; };
    const race = plain(await MC.executeClosureAction(closureIo(A, api, ML.createExceptionOwnership(), { rows: view, apiFetch: apiRace })));
    eq([race.status, race.reason, race.replan.displayTotal], ["partial", "revenue_changed_concurrently", 50], "V2 race detected");
    A.db.ref(entriesPath(T, B)).off("value", h);
  });

  await run("CDM2-EMU-11", "AUTHORITY of the T2 read on a real RTDB: the client's listener cache is provably STALE (offline during another client's write); the identity compare-and-set is rejected by the server and re-runs on the server value", async () => {
    await zeroFixture();
    const A = await makeClient("owner").attach();
    eq(A.rows()[0].sales, 0, "cache shows 0");
    A.db.goOffline();
    await otherClientSales(R1, 50);                                  // the server now holds 50; A cannot know
    const seenFirst = [];
    const io = closureIo(A, serverApi("owner", "u_owner"), ML.createExceptionOwnership(), {
      verifyTransact: async (t, key, fn) => { const ref = A.db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`);
        const p = ref.transaction((raw) => { seenFirst.push(raw && raw._v ? JSON.parse(raw._v)[0].sales : raw); return fn(raw); }, undefined, false);
        A.db.goOnline();
        const res = await p; return { committed: res.committed, snapshot: res.snapshot }; } });
    const r = plain(await MC.readEntriesAuthoritative(io, A.ctrl.capture()));
    eq(r.status, "verified", "verified");
    eq(seenFirst[0], 0, "the first run saw the STALE local cache (the reviewed situation)");
    eq(r.rows[0].sales, 50, "the committed result is the SERVER value");
    expect(r.runs >= 2, "the server rejected the stale hash and the function re-ran (runs=" + r.runs + ")");
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  for (const r of results) console.log(`${w(r.id, 14)} ${w(r.status, 5)} ${w(r.ms, 6)} ${r.description}${r.notes ? " — " + r.notes : ""}`);
  const EXPECTED = 11;
  console.log(`\n=== TOTALS ===\ntotal=${results.length} passed=${results.filter((r) => r.status === "PASS").length} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`INCOMPLETE MATRIX: expected ${EXPECTED}`); process.exitCode = 3; return; }
  if (failures) { process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED");
}

const __direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (__direct) main().then(async () => { detachAll(); await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
  .catch(async (err) => { console.error("HARNESS ERROR:", (err && err.stack) || err); process.exitCode = 4; detachAll(); await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
