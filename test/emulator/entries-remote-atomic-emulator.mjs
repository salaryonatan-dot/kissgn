// Marjin — P0-DATA-01 R10: REAL Firebase RTDB Emulator concurrency validation.
//
// Runs the ACTUAL production write path (vm-extracted from index.html:
// createSelectionController, createRemoteEntriesMutator, createEntriesWriteCoordinator,
// applyEntryIntent, buildEntryUpsertIntent, parseEntriesNode) against a LOCAL
// Firebase Realtime Database Emulator. There is NO mocked transaction, NO fake
// store and NO in-process CAS model anywhere in this file: every commit, abort and
// retry is decided by the real RTDB server over the wire.
//
// Deliberately NOT named *.test.mjs: it must never be picked up by the repository
// glob `node --test test/**/*.test.mjs`, which runs without an emulator.
//
// Host run (Java 21+ required): see test/emulator/README.md, section
// "Run the R10 concurrency validation".
//
// Exits 0 only when every case passes. Any unexpected result, harness error,
// safety/startup failure or incomplete totals exits nonzero.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";

// ─── Safety constants (identical to the authorization matrix) ────────────────
const PROJECT = "demo-marjin-rules";
const NAMESPACE = "demo-marjin-rules-default-rtdb";
const HOST = "127.0.0.1";
const PORT = "9000";
const EMU_HOSTPORT = `${HOST}:${PORT}`;
const DB_URL = `http://${EMU_HOSTPORT}?ns=${NAMESPACE}`;
const DEMO_DB_URLS = new Set([
  "https://demo-marjin-rules.firebaseio.com",
  "https://demo-marjin-rules-default-rtdb.firebaseio.com",
]);
const isLocalUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));

function fail(msg) { console.error(`SAFETY ABORT: ${msg}`); process.exit(2); }

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..");

function assertSafeEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU_HOSTPORT)
    fail(`FIREBASE_DATABASE_EMULATOR_HOST must be exactly ${EMU_HOSTPORT}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) {
    const u = String(process.env.FIREBASE_DATABASE_URL);
    if (!DEMO_DB_URLS.has(u) && !isLocalUrl(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`);
  }
  if (!PROJECT.startsWith("demo-")) fail("project id must start with demo-");
  if (!NAMESPACE.startsWith("demo-")) fail("namespace must start with demo-");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):9000\?ns=demo-/.test(DB_URL)) fail(`refusing non-local db url: ${DB_URL}`);
  const emulatedRules = readFileSync(join(DIR, "database.rules.json"));
  const canonicalRules = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(emulatedRules, canonicalRules) !== 0)
    fail("test/emulator/database.rules.json differs from canonical database.rules.json — refresh the copy before running");
}

// ─── Production code, vm-extracted from index.html ───────────────────────────
const html = readFileSync(join(ROOT, "index.html"), "utf8");

function loadProductionBlocks() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  if (start === -1) fail("anchor for the P0-DATA-01 production block not found in index.html");
  const f = html.indexOf("window.MarjinSaveLifecycle = Object.freeze({", start);
  if (f === -1) fail("window.MarjinSaveLifecycle export not found in index.html");
  const src = html.slice(start, html.indexOf("});", f) + 3);
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = loadProductionBlocks();
const ME = W.MarjinEntries;
const ML = W.MarjinSaveLifecycle;

// Source-anchored path guard. This harness reproduces the production RTDB path
// derivation (`window.storage.mutateFor` -> `fkeySharedForTenant`). If that
// derivation ever changes in index.html, this harness must change with it, so the
// exact production expression is asserted here rather than silently drifting.
const PATH_ANCHOR = "return `tenants/${tenantId}/${safe}`;";
if (!html.includes(PATH_ANCHOR))
  fail("production fkeySharedForTenant fallback path expression changed — update this harness before trusting it");
const MUTATE_ANCHOR = "return await runTransaction(ref(db, path), txnFn, { applyLocally: false });";
if (!html.includes(MUTATE_ANCHOR))
  fail("production mutateFor transaction call changed — update this harness before trusting it");

const entriesPath = (tenantId, bizId) => `tenants/${tenantId}/${`biz:${bizId}:entries`.replace(/[.#$[\]]/g, "_")}`;

// ─── Deterministic canonical UUID v4 ids (no crypto dependency) ──────────────
const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid4 = (seed) => { const a = __hash("a" + seed), b = __hash("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
let __seq = 0;
const nextId = () => uuid4("emu-gen-" + (++__seq));
const day = (date, sales) => ({ id: uuid4("d" + date), date, sales, deliveries: 0, other_income: 0 });

// A 160-date history — the same order of magnitude Codex used to reproduce the
// R9 independent-writer overwrite.
function history(n = 160) {
  const rows = [];
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    rows.push(day(d, 100 + i));
  }
  return rows;
}
const HISTORY = history();
const DATE_A = HISTORY[40].date;
const DATE_B = HISTORY[41].date;

// ─── Identities and fixtures ─────────────────────────────────────────────────
// u_owner  : role owner            -> may write any biz in tenantA
// u_manager: role manager + biz_access bizA only -> may write bizA, NOT bizB
// u_viewer : role viewer           -> may not write entries at all
const IDS = {
  owner:   { uid: "u_owner",   token: { email: "owner@demo.example" } },
  manager: { uid: "u_manager", token: { email: "manager@demo.example" } },
  viewer:  { uid: "u_viewer",  token: { email: "viewer@demo.example" } },
};

function fixtures() {
  return {
    tenants: {
      tenantA: {
        members: { u_owner: true, u_manager: true, u_viewer: true },
        roles: { u_owner: "owner", u_manager: "manager", u_viewer: "viewer" },
        biz_access: { bizA: { u_manager: true, u_viewer: true } },
        "biz:bizA:entries": { _v: JSON.stringify(HISTORY) },
        "biz:bizB:entries": { _v: JSON.stringify([day("2026-03-01", 999)]) },
      },
      tenantB: {
        members: { u_tenantB: true },
        roles: { u_tenantB: "owner" },
        "biz:bizA:entries": { _v: JSON.stringify([day("2026-03-02", 777)]) },
      },
    },
  };
}

const apps = {};
function initApps() {
  apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed"); // admin bypass, fixtures only
  for (const [k, override] of Object.entries(IDS)) {
    // Each identity gets TWO independent apps => two independent RTDB connections,
    // each with its own local cache. This is what makes clients genuinely separate.
    apps[`${k}#1`] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, `${k}_1`);
    apps[`${k}#2`] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: override }, `${k}_2`);
  }
  for (let i = 0; i < 8; i++) {
    apps[`swarm#${i}`] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: IDS.owner }, `swarm_${i}`);
  }
}
const seedDb = () => apps.__seed.database();
async function reseed() { detachAll(); await seedDb().ref("/").set(fixtures()); }
async function readRows(tenantId, bizId) {
  const snap = await seedDb().ref(entriesPath(tenantId, bizId)).once("value");
  const p = ML.parseEntriesNode(snap.exists() ? snap.val() : null);
  return p.rows || (p.absent ? null : "MALFORMED");
}
async function readRaw(tenantId, bizId) {
  const snap = await seedDb().ref(entriesPath(tenantId, bizId)).once("value");
  return snap.exists() ? snap.val() : null;
}
const isDenied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + " " + (e && (e.code || ""))));

const LIVE = [];
// ─── One genuinely independent production client ─────────────────────────────
// Own selection controller, own mutator, own coordinator, own RTDB connection.
// Nothing is shared between clients except the emulator itself.
function makeClient(appKey, { tenantId = "tenantA", bizId = "bizA", name = appKey } = {}) {
  const app = apps[appKey];
  const db = app.database();
  const ctrl = ML.createSelectionController();
  ctrl.invalidate(tenantId, bizId);
  const applied = [];
  let transactCalls = 0;
  const mutator = ML.createRemoteEntriesMutator({
    selection: ctrl,
    // Byte-for-byte the production contract: path from fkeySharedForTenant, a real
    // RTDB transaction, applyLocally = false. Admin SDK `ref.transaction(fn, cb,
    // applyLocally)` and Web SDK `runTransaction(ref, fn, {applyLocally:false})`
    // drive the same server-side compare-and-swap protocol.
    transact: async (t, key, txnFn) => {
      transactCalls++;
      const res = await db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`).transaction(txnFn, undefined, false);
      return { committed: res.committed, snapshot: res.snapshot };
    },
  });
  const lane = ML.createEntriesWriteCoordinator({
    selection: ctrl,
    canonicalize: ME.canonicalizeEntries,
    entryDateKey: ME.entryDateKey,
    fingerprint: (rows) => JSON.stringify(rows),
    contentFingerprint: ML.contentFingerprint,
    applyRows: (r) => applied.push(JSON.parse(JSON.stringify(r))),
    mutate: (intent, ctx) => mutator.mutate(intent, ctx),
  });
  const client = {
    name, ctrl, lane, mutator, applied, db, _ref: null, _handler: null,
    transactCalls: () => transactCalls,
    view: () => applied[applied.length - 1] || null,
    // Production parity: hydration is driven by a LIVE `onValue` listener bound to
    // the ctx captured at setup — exactly window.storage.subscribe. Keeping the
    // listener attached also keeps the RTDB client cache warm for that node, which
    // is the state every production write is issued from.
    attach() {
      const ctxAtSetup = ctrl.capture();
      const ref = db.ref(entriesPath(tenantId, bizId));
      return new Promise((resolve, reject) => {
        let first = true;
        const handler = ref.on("value", (snap) => {
          const p = ML.parseEntriesNode(snap.exists() ? snap.val() : null);
          if (p.absent) lane.markHydrated(ctxAtSetup, []);
          else if (p.rows) lane.onListenerEcho(p.rows, ctxAtSetup);
          if (first) { first = false; resolve(client); }
        }, (err) => {
          lane.onListenerError(ctxAtSetup);
          if (first) { first = false; reject(err); }
        });
        client._ref = ref; client._handler = handler;
      });
    },
    detach() { if (client._ref && client._handler) client._ref.off("value", client._handler); client._ref = null; client._handler = null; return client; },
    upsert(date, fields, opts = {}) {
      const rows = lane._state().desired || [];
      const prev = opts.byId ? (rows.find((r) => r && r.id === opts.byId) || null)
                             : (rows.filter((r) => r && r.date === date)[0] || null);
      const next = { ...(prev || { date }), ...fields, date: prev ? prev.date : date };
      const intent = ML.buildEntryUpsertIntent(prev, next, { newId: opts.newId || nextId() });
      if (intent.status) return Promise.resolve({ status: intent.status });
      return lane.submitIntent(intent);
    },
    // Direct mutator call, bypassing the lane's own de-duplication — used where a
    // case is about the remote primitive itself rather than the lane.
    direct(intent, ctx) { return mutator.mutate(intent, ctx || ctrl.capture()); },
  };
  LIVE.push(client);
  return client;
}
function detachAll() { while (LIVE.length) { try { LIVE.pop().detach(); } catch (_) {} } }

// The R9 loser, reimplemented HERE (never re-introduced into runtime): read the
// whole node once, mutate a private copy, write the whole array back with set().
async function legacyFullNodeWrite(appKey, date, sales, { tenantId = "tenantA", bizId = "bizA" } = {}) {
  const db = apps[appKey].database();
  const ref = db.ref(entriesPath(tenantId, bizId));
  const snap = await ref.once("value");
  const rows = ML.parseEntriesNode(snap.val()).rows.map((r) => ({ ...r }));
  const i = rows.findIndex((r) => r.date === date);
  rows[i].sales = sales;
  return { ref, rows, commit: () => ref.set({ _v: JSON.stringify(rows) }) };
}

// ─── Case runner ─────────────────────────────────────────────────────────────
const results = [];
let failures = 0;
async function run(id, area, description, fn) {
  const t0 = Date.now();
  try {
    const notes = await fn();
    results.push({ id, area, description, status: "PASS", ms: Date.now() - t0, notes: notes || "" });
  } catch (err) {
    failures++;
    results.push({ id, area, description, status: "FAIL", ms: Date.now() - t0, notes: (err && err.message) || String(err) });
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function expectEq(actual, want, msg) {
  if (actual !== want) throw new Error(`${msg}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
}
const salesAt = (rows, date) => { const r = (rows || []).find((x) => x && x.date === date); return r ? r.sales : undefined; };
const COMMITTED = (s) => s === "committed" || s === "committed_idempotent";

// ═════════════════════════════ CASES ═════════════════════════════════════════
async function main() {
  assertSafeEnvironment();
  initApps();

  // ── A. Independent writers over a real RTDB node ───────────────────────────
  for (const order of ["A_then_B", "B_then_A"]) {
    await run(`EMU-A-${order}`, "independent-writers",
      `two independent clients hydrate the same 160-date node and edit different dates (${order}) — both survive`,
      async () => {
        await reseed();
        const A = await makeClient("manager#1", { name: "A" }).attach();
        const B = await makeClient("owner#1", { name: "B" }).attach();
        expectEq((A.lane._state().desired || []).length, 160, "A hydrated row count");
        expectEq((B.lane._state().desired || []).length, 160, "B hydrated row count");
        const first = order === "A_then_B" ? A : B;
        const second = order === "A_then_B" ? B : A;
        const firstDate = order === "A_then_B" ? DATE_A : DATE_B;
        const secondDate = order === "A_then_B" ? DATE_B : DATE_A;
        const r1 = await first.upsert(firstDate, { sales: 11111 });
        const r2 = await second.upsert(secondDate, { sales: 22222 });
        expect(COMMITTED(r1.status), `first write status ${r1.status}`);
        expect(COMMITTED(r2.status), `second write status ${r2.status}`);
        const rows = await readRows("tenantA", "bizA");
        expectEq(rows.length, 160, "row count after both writes");
        expectEq(salesAt(rows, firstDate), 11111, `first writer's edit at ${firstDate}`);
        expectEq(salesAt(rows, secondDate), 22222, `second writer's edit at ${secondDate}`);
        return `both edits present, 160 dates retained`;
      });
  }

  await run("EMU-A-parallel", "independent-writers",
    "two independent clients dispatch simultaneously (Promise.all) — no lost update",
    async () => {
      await reseed();
      const A = await makeClient("manager#2", { name: "A" }).attach();
      const B = await makeClient("owner#2", { name: "B" }).attach();
      const [r1, r2] = await Promise.all([A.upsert(DATE_A, { sales: 31111 }), B.upsert(DATE_B, { sales: 32222 })]);
      expect(COMMITTED(r1.status), `A status ${r1.status}`);
      expect(COMMITTED(r2.status), `B status ${r2.status}`);
      const rows = await readRows("tenantA", "bizA");
      expectEq(rows.length, 160, "row count");
      expectEq(salesAt(rows, DATE_A), 31111, "A edit");
      expectEq(salesAt(rows, DATE_B), 32222, "B edit");
      return "both edits present under true simultaneity";
    });

  // ── B. R9 negative control: the harness must be able to SEE the old bug ─────
  for (const order of ["A_then_B", "B_then_A"]) {
    await run(`EMU-B-negctl-${order}`, "r9-negative-control",
      `R9 full-node read-modify-write reproduces the historical lost update on the same emulator (${order})`,
      async () => {
        await reseed();
        // Both writers read the SAME revision before either writes — the exact
        // R9 losing schedule.
        const wA = await legacyFullNodeWrite("manager#1", DATE_A, 41111);
        const wB = await legacyFullNodeWrite("owner#1", DATE_B, 42222);
        if (order === "A_then_B") { await wA.commit(); await wB.commit(); }
        else { await wB.commit(); await wA.commit(); }
        const rows = await readRows("tenantA", "bizA");
        const a = salesAt(rows, DATE_A), b = salesAt(rows, DATE_B);
        const survived = order === "A_then_B" ? b : a;
        const lost = order === "A_then_B" ? a : b;
        const lostWant = order === "A_then_B" ? 41111 : 42222;
        const survivedWant = order === "A_then_B" ? 42222 : 41111;
        expectEq(survived, survivedWant, "last writer's edit must survive");
        expect(lost !== lostWant, `the first writer's edit MUST be lost under R9 (found ${lost}) — negative control is blind`);
        return `edit at ${order === "A_then_B" ? DATE_A : DATE_B} lost, as in the R9 incident`;
      });
  }

  await run("EMU-B-r10-same-schedule", "r9-negative-control",
    "the identical schedule, driven through the R10 remote-atomic path, loses nothing",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const B = await makeClient("owner#1", { name: "B" }).attach();
      // Both hydrated the same revision, exactly like the negative control above.
      const r1 = await A.upsert(DATE_A, { sales: 41111 });
      const r2 = await B.upsert(DATE_B, { sales: 42222 });
      expect(COMMITTED(r1.status) && COMMITTED(r2.status), `statuses ${r1.status}/${r2.status}`);
      const rows = await readRows("tenantA", "bizA");
      expectEq(salesAt(rows, DATE_A), 41111, "A edit survives");
      expectEq(salesAt(rows, DATE_B), 42222, "B edit survives");
      expectEq(rows.length, 160, "history intact");
      return "same schedule, zero loss";
    });

  // ── C. Transaction conflict / retry / idempotency semantics ────────────────
  await run("EMU-C-retry", "transaction-semantics",
    "eight independent clients contend on one node — all commit, real CAS retries observed",
    async () => {
      await reseed();
      const clients = [];
      for (let i = 0; i < 8; i++) clients.push(await makeClient(`swarm#${i}`, { name: `S${i}` }).attach());
      const dates = clients.map((_, i) => HISTORY[100 + i].date);
      const outcomes = await Promise.all(clients.map((c, i) => c.direct({
        type: "upsert_entry",
        target: { id: (c.lane._state().desired || []).find((r) => r.date === dates[i]).id },
        patch: { fields: { sales: 50000 + i } },
        base: { fields: { sales: 200 + i } },
      })));
      const runs = outcomes.reduce((a, o) => a + (o.runs || 0), 0);
      for (let i = 0; i < 8; i++) expect(COMMITTED(outcomes[i].status), `client ${i} status ${outcomes[i].status} ${outcomes[i].reason || ""}`);
      const rows = await readRows("tenantA", "bizA");
      expectEq(rows.length, 160, "history intact under 8-way contention");
      for (let i = 0; i < 8; i++) expectEq(salesAt(rows, dates[i]), 50000 + i, `client ${i} edit at ${dates[i]}`);
      expect(runs > 8, `expected at least one CAS retry across 8 transactions, total txnFn runs = ${runs}`);
      return `8/8 committed, ${runs} txnFn runs for 8 transactions (retries exercised)`;
    });

  await run("EMU-C-conflict", "transaction-semantics",
    "an operator saving a form opened before someone else's edit is refused with exact conflictPaths, and the committed value stays byte-intact",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const B = await makeClient("owner#1", { name: "B" }).attach();
      // B opens the edit form for DATE_A: `prevAtFormOpen` is the row B is editing
      // FROM. Its listener stays attached (B is a healthy client) — the staleness is
      // in the form the operator is looking at, which is the real-world case.
      const prevAtFormOpen = (B.lane._state().desired || []).find((r) => r.date === DATE_A);
      const r1 = await A.upsert(DATE_A, { sales: 61111 });
      expect(COMMITTED(r1.status), `A status ${r1.status}`);
      const before = await readRaw("tenantA", "bizA");
      const staleIntent = ML.buildEntryUpsertIntent(prevAtFormOpen, { ...prevAtFormOpen, sales: 62222 }, { newId: nextId() });
      expect(!staleIntent.status, `intent build refused: ${staleIntent.status}`);
      const r2 = await B.direct(staleIntent);
      expectEq(r2.status, "conflict", "a save from a stale form must be a conflict");
      expect(Array.isArray(r2.conflictPaths) && r2.conflictPaths.includes("sales"),
        `conflictPaths must name the field, got ${JSON.stringify(r2.conflictPaths)}`);
      const after = await readRaw("tenantA", "bizA");
      expectEq(JSON.stringify(after), JSON.stringify(before), "node must be byte-intact after a refused write");
      // Re-based on what is actually stored now, the same edit commits.
      const r3 = await B.upsert(DATE_A, { sales: 62222 });
      expect(COMMITTED(r3.status), `re-based write status ${r3.status}`);
      expectEq(salesAt(await readRows("tenantA", "bizA"), DATE_A), 62222, "re-based edit committed");
      return `conflictPaths=${JSON.stringify(r2.conflictPaths)}, node untouched, commits after re-base`;
    });

  await run("EMU-C-idempotent", "transaction-semantics",
    "re-submitting an already-committed edit is classified committed_idempotent and writes nothing new",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const target = (A.lane._state().desired || []).find((r) => r.date === DATE_A);
      const intent = { type: "upsert_entry", target: { id: target.id },
        patch: { fields: { sales: 71111 } }, base: { fields: { sales: target.sales } } };
      const r1 = await A.direct(intent);
      expectEq(r1.status, "committed", `first submit ${r1.status}`);
      const raw1 = await readRaw("tenantA", "bizA");
      const r2 = await A.direct({ ...intent, base: { fields: { sales: 71111 } } });
      expectEq(r2.status, "committed_idempotent", `re-submit ${r2.status} ${r2.reason || ""}`);
      const raw2 = await readRaw("tenantA", "bizA");
      expectEq(JSON.stringify(raw2), JSON.stringify(raw1), "idempotent re-submit must not change the node");
      return `reason=${r2.reason}`;
    });

  await run("EMU-C-id-collision", "transaction-semantics",
    "a create whose pre-generated id already exists with different content is refused as id_collision",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const existing = (A.lane._state().desired || [])[0];
      const before = await readRaw("tenantA", "bizA");
      const r = await A.direct({
        type: "upsert_entry",
        target: { id: existing.id },
        patch: { fields: { sales: 81111 } },
        createIfMissing: true,
        newRow: { id: existing.id, date: "2026-12-31", sales: 81111, deliveries: 0, other_income: 0 },
      });
      expect(r.status === "blocked" || r.status === "conflict", `status ${r.status}`);
      const after = await readRaw("tenantA", "bizA");
      expectEq(JSON.stringify(after), JSON.stringify(before), "node must be untouched");
      return `status=${r.status} reason=${r.reason} detail=${r.detail}`;
    });

  // ── D. Tenant / business / generation ownership, enforced by real Rules ────
  await run("EMU-D-cross-business", "ownership",
    "a manager scoped to bizA cannot mutate bizB's entries through the coordinator — Rules deny, node unchanged",
    async () => {
      await reseed();
      const before = await readRaw("tenantA", "bizB");
      const M = makeClient("manager#1", { bizId: "bizB", name: "M" });
      // Hydration itself is denied for bizB; drive the mutator directly so the
      // write attempt genuinely reaches the emulator.
      let hydrationDenied = false;
      try { await M.attach(); } catch (e) { hydrationDenied = isDenied(e); }
      const r = await M.direct({
        type: "upsert_entry", target: { id: uuid4("x") },
        patch: { fields: { sales: 1 } }, createIfMissing: true,
        newRow: { id: uuid4("x"), date: "2026-05-05", sales: 1, deliveries: 0, other_income: 0 },
      });
      expectEq(r.status, "failed", `cross-business write must fail, got ${r.status}`);
      const after = await readRaw("tenantA", "bizB");
      expectEq(JSON.stringify(after), JSON.stringify(before), "bizB node must be unchanged");
      return `hydration denied=${hydrationDenied}, mutate=${r.status}/${r.error}`;
    });

  await run("EMU-D-cross-tenant", "ownership",
    "a tenantA principal cannot mutate tenantB's bizA entries — Rules deny, node unchanged",
    async () => {
      await reseed();
      const before = await readRaw("tenantB", "bizA");
      const X = makeClient("owner#1", { tenantId: "tenantB", bizId: "bizA", name: "X" });
      const r = await X.direct({
        type: "upsert_entry", target: { id: uuid4("y") },
        patch: { fields: { sales: 2 } }, createIfMissing: true,
        newRow: { id: uuid4("y"), date: "2026-05-06", sales: 2, deliveries: 0, other_income: 0 },
      });
      expectEq(r.status, "failed", `cross-tenant write must fail, got ${r.status}`);
      const after = await readRaw("tenantB", "bizA");
      expectEq(JSON.stringify(after), JSON.stringify(before), "tenantB node must be unchanged");
      return `mutate=${r.status}/${r.error}`;
    });

  await run("EMU-D-viewer", "ownership",
    "a viewer-role principal cannot mutate entries at all — Rules deny, node unchanged",
    async () => {
      await reseed();
      const before = await readRaw("tenantA", "bizA");
      const V = await makeClient("viewer#1", { name: "V" }).attach();  // viewers may read
      const target = (V.lane._state().desired || []).find((r) => r.date === DATE_A);
      const r = await V.direct({ type: "upsert_entry", target: { id: target.id },
        patch: { fields: { sales: 3 } }, base: { fields: { sales: target.sales } } });
      expectEq(r.status, "failed", `viewer write must fail, got ${r.status}`);
      const after = await readRaw("tenantA", "bizA");
      expectEq(JSON.stringify(after), JSON.stringify(before), "node must be unchanged");
      return `mutate=${r.status}/${r.error}`;
    });

  await run("EMU-D-stale-selection", "ownership",
    "a selection invalidated after capture is refused BEFORE any network I/O",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const ctx = A.ctrl.capture();
      const callsBefore = A.transactCalls();
      A.ctrl.invalidate("tenantA", "bizOther");        // business switched under the write
      const before = await readRaw("tenantA", "bizA");
      const r = await A.direct({ type: "upsert_entry", target: { id: uuid4("z") }, patch: { fields: { sales: 4 } } }, ctx);
      expectEq(r.status, "stale", `status ${r.status}`);
      expectEq(A.transactCalls(), callsBefore, "a stale write must not reach the transport at all");
      expectEq(JSON.stringify(await readRaw("tenantA", "bizA")), JSON.stringify(before), "node unchanged");
      return "refused with zero I/O";
    });

  await run("EMU-D-no-owner", "ownership",
    "a context with no business is refused as blocked_no_owner before any network I/O",
    async () => {
      await reseed();
      const A = await makeClient("manager#1", { name: "A" }).attach();
      const callsBefore = A.transactCalls();
      const r = await A.direct({ type: "upsert_entry", target: { id: uuid4("w") }, patch: { fields: { sales: 5 } } },
        { gen: 0, tenantId: "tenantA", bizId: null });
      expectEq(r.status, "blocked_no_owner", `status ${r.status}`);
      expectEq(A.transactCalls(), callsBefore, "must not reach the transport");
      return "refused with zero I/O";
    });

  // ── E. Real-RTDB behaviour the in-process fake store could not model ───────
  await run("EMU-E-cold-cache", "rtdb-semantics",
    "a mutation issued with no live listener on the node aborts locally and fails CLOSED — it never commits wrong data",
    async () => {
      await reseed();
      const rowsBefore = await readRows("tenantA", "bizA");
      const target = rowsBefore.find((r) => r.date === DATE_A);
      const before = await readRaw("tenantA", "bizA");
      // No attach(): the RTDB client cache for this node is cold, so the SDK runs
      // the transaction callback against `null` first. The production callback
      // treats an absent node as "target not found" and aborts, which RTDB honours
      // locally without ever contacting the server.
      const C = makeClient("manager#2", { name: "C" });
      const r = await C.direct({ type: "upsert_entry", target: { id: target.id },
        patch: { fields: { sales: 91111 } }, base: { fields: { sales: target.sales } } });
      expect(r.status !== "committed" && r.status !== "committed_idempotent",
        `a cold-cache edit must NOT report success, got ${r.status}`);
      expectEq(JSON.stringify(await readRaw("tenantA", "bizA")), JSON.stringify(before),
        "the node must be unchanged when the transaction aborts");
      // Production always writes from a hydrated lane, i.e. with the listener
      // attached; the same edit then commits.
      await C.attach();
      const r2 = await C.direct({ type: "upsert_entry", target: { id: target.id },
        patch: { fields: { sales: 91111 } }, base: { fields: { sales: target.sales } } });
      expect(COMMITTED(r2.status), `with the listener attached the same edit must commit, got ${r2.status}`);
      expectEq(salesAt(await readRows("tenantA", "bizA"), DATE_A), 91111, "edit committed once hydrated");
      return `cold=${r.status}/${r.reason || ""} (fail-closed), warm=${r2.status}`;
    });

  // ─── Report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 26)} ${w("area", 22)} ${w("status", 6)} ${w("ms", 6)} notes`);
  console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 26)} ${w(r.area, 22)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.notes}`);
  console.log("");
  const EXPECTED_CASES = 16;
  console.log("=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.filter((r) => r.status === "PASS").length} failed=${failures}`);
  if (results.length !== EXPECTED_CASES) {
    console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED_CASES} cases, ran ${results.length}`);
    process.exitCode = 3;
    return;
  }
  if (failures) {
    console.error("\n=== FAILURES ===");
    for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} [${r.area}] ${r.description}\n    ${r.notes}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nALL CASES PASSED");
}

// Side effects (safety gate, emulator I/O) run ONLY on direct execution, never on
// import — the same rule the authorization matrix follows, so this file can be
// imported by a focused test without touching an emulator.
const __directlyExecuted = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (__directlyExecuted) main().then(async () => {
  await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {})));
}).catch(async (err) => {
  console.error("HARNESS ERROR:", (err && err.stack) || err);
  process.exitCode = 4;
  await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {})));
});
