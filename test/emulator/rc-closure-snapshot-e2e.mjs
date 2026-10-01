// Marjin 1.0 RC — end-to-end on a REAL Firebase RTDB Emulator: the CD-M2 R1 closure action
// (production seam from index.html, real lane + remote-atomic mutator over a Rules-evaluated
// client, production ledger transaction + list read) writes; the B2 morning snapshot (compiled
// production snapshotBuilder/snapshotEmail over the real Admin SDK) reads the same database.
//
// Deliberately NOT named *.test.mjs (needs an emulator). Exits 0 only when every case passes.
//   env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
//     GCLOUD_PROJECT=demo-marjin-rules GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
//     FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 node test/emulator/rc-closure-snapshot-e2e.mjs
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { requestHash, safeStateView, validateSetInput } from "../../lib/entryExceptions.js";
import { runEntryExceptionTxn, listEntryExceptions } from "../../lib/repositories/entryExceptionsRepo.js";
import { compileServer } from "../support/server-reader-harness.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb", EMU = "127.0.0.1:9000";
const DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const fail = (m) => { console.error("SAFETY ABORT: " + m); process.exit(2); };
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail("demo project required");
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail("emulator host must be " + EMU);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_DATABASE_URL) fail("credentials / database URL must be absent");
  if (!validateFirebaseConfig(process.env.FIREBASE_CONFIG).ok) fail("FIREBASE_CONFIG rejected");
}

const html = readFileSync(join(ROOT, "index.html"), "utf8");
const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
const fz = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
if (start === -1 || fz === -1) fail("index.html anchors not found");
const sandbox = { window: { crypto: globalThis.crypto }, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
vm.runInNewContext(html.slice(start, html.indexOf("});", fz) + 3), sandbox);
const { MarjinEntries: ME, MarjinSaveLifecycle: ML, MarjinClosureLifecycle: MC, MarjinStorageV2: MS } = sandbox.window;
const plain = (x) => JSON.parse(JSON.stringify(x));

const srv = compileServer();
const SB = await srv.import("src/snapshot/snapshotBuilder.js");

const T = "tenantA", B = "bizA", D = "2026-09-10", FUT = "2026-09-30", TODAY = "2026-09-29";
const NOW = Date.UTC(2026, 8, 29, 9);
const __h = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const uid = (s) => { const a = __h("a" + s), b = __h("b" + s); return `${hx(a, 8)}-${hx(b, 4)}-4${hx(a, 3)}-8${hx(b, 3)}-${hx(a, 6)}${hx(b, 6)}`; };
const entriesPath = `tenants/${T}/biz:${B}:entries`;
const sept = () => Array.from({ length: 28 }, (_, i) => { const d = `2026-09-${String(i + 1).padStart(2, "0")}`; return { id: uid("rc" + d), date: d, sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0" }; });

let apps = {};
const seedDb = () => apps.seed.database();
async function reseed() {
  await seedDb().ref("/").set({ tenants: { [T]: {
    members: { u_owner: true }, roles: { u_owner: "owner" }, biz_access: {},
    app: { business: { _v: JSON.stringify([{ id: B, name: "Biz " + B }]) } },
    [`biz:${B}:entries`]: { _v: JSON.stringify(sept()) },
    [`biz:${B}:config`]: { _v: JSON.stringify({ employees: [{ id: "g1", type: "global", name: "G", monthlySalary: "3000" }] }) },
    [`biz:${B}:fixed`]: { _v: JSON.stringify([{ id: "f1", name: "F", amount: "3100" }]) },
  } } });
}
async function readRows() { const s = await seedDb().ref(entriesPath).once("value"); return ML.parseEntriesNode(s.val()).rows; }

// server API: production repository transaction + list read (as api/admin.js)
function serverApi() {
  return async (url, opts) => {
    if (/list-entry-exceptions/.test(url)) {
      const q = new URL("http://x" + url).searchParams;
      const ex = await listEntryExceptions({ tenantId: q.get("tenantId"), bizId: q.get("bizId"), fromDate: q.get("fromDate"), toDate: q.get("toDate") });
      return { ok: true, status: 200, json: async () => ({ ok: true, exceptions: plain(ex) }) };
    }
    const action = /set-entry-exception/.test(url) ? "set" : "clear";
    const body = JSON.parse(opts.body);
    const n = action === "set" ? validateSetInput({ reasonCode: body.reasonCode }) : { reasonCode: null, reasonText: null };
    const cmd = { action, tenantId: body.tenantId, bizId: body.bizId, businessDate: body.businessDate, reasonCode: n.reasonCode, reasonText: n.reasonText,
      actorUid: "u_owner", actorRole: "owner", expectedRevision: body.expectedRevision, operationId: body.operationId, now: 1790000000000 };
    cmd.requestHash = requestHash(cmd);
    const out = await runEntryExceptionTxn(cmd, seedDb());
    if (out.outcome === "conflict") return { ok: false, status: 409, json: async () => ({ ok: false, error: out.code }) };
    const applied = out.outcome === "applied";
    return { ok: true, status: 200, json: async () => ({ ok: true, exception: safeStateView(out.state), revision: out.revision, applied, rebuildRequired: applied }) };
  };
}

const LIVE = [];
async function client() {
  const db = apps.owner.database();
  const ctrl = ML.createSelectionController(); ctrl.invalidate(T, B);
  const tx = async (t, key, fn) => { const r = await db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; };
  const mutator = ML.createRemoteEntriesMutator({ selection: ctrl, transact: tx });
  const lane = ML.createEntriesWriteCoordinator({ selection: ctrl, canonicalize: ME.canonicalizeEntries, entryDateKey: ME.entryDateKey, fingerprint: (r) => JSON.stringify(r), contentFingerprint: ML.contentFingerprint, applyRows: () => {}, mutate: (i, c) => mutator.mutate(i, c) });
  const ref = db.ref(entriesPath); const c0 = ctrl.capture();
  await new Promise((res) => { let first = true; const h = ref.on("value", (s) => { const p = ML.parseEntriesNode(s.val()); if (p.rows) lane.onListenerEcho(p.rows, c0); if (first) { first = false; res(); } }); LIVE.push(() => ref.off("value", h)); });
  const own = ML.createExceptionOwnership(); let n = 0;
  const io = (date, extra = {}) => ({ selection: ctrl, date, rows: lane._state().desired || [], today: TODAY, role: "owner", confirmedFingerprint: null,
    exceptionState: { get: (d) => own.getState(d), set: (d, s) => own.setState(d, s), applyActive: () => {} },
    opIds: { ensure: (d, mk) => own.ensureOpId(d, mk), consume: (d) => own.consumeOpId(d) }, newOpId: () => "rc-op-" + (++n), newRowId: () => uid("rc-new-" + (++n)), emptyEntry: {},
    apiFetch: serverApi(),
    persistMutation: (i) => lane.submitIntent(i).then((r) => ({ ok: r.status === "committed" || r.status === "committed_idempotent", canonical: r.rows, status: r.status })),
    verifyTransact: tx, readNode: (raw) => MS.readEntriesNode(raw),
    applyRows: () => {}, reloadExceptions: async () => {}, rebuildInsights: async () => {}, setError: () => {}, ...extra });
  return { io };
}
const close = async (c, date) => { const ask = plain(await MC.executeClosureAction(c.io(date))); return ask.status === "confirmation_required" ? plain(await MC.executeClosureAction(c.io(date, { confirmedFingerprint: ask.plan.fingerprint }))) : ask; };
const snap = () => SB.buildSnapshotForBiz(T, B, { nowMs: NOW });
const settle = () => new Promise((r) => setTimeout(r, 150));

const results = []; let failures = 0;
async function run(id, d, fn) { const t0 = Date.now(); try { const n = await fn(); results.push({ id, d, s: "PASS", ms: Date.now() - t0, n }); } catch (e) { failures++; results.push({ id, d, s: "FAIL", ms: Date.now() - t0, n: e.message }); } finally { while (LIVE.length) LIVE.pop()(); } }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.owner = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: "u_owner" } }, "owner");
  globalThis.__DB = seedDb();

  await run("RC-E2E-01", "closure of a completed day (real Rules, real ledger txn) ⇒ B2 snapshot: known 0, closedDays, costs on 27 eligible days", async () => {
    await reseed(); const c = await client();
    eq((await close(c, D)).status, "closed", "CD-M2 outcome");
    const s = await snap(), f = s.financials;
    eq([f.coverage.closedDays, f.amounts.revenue.exact, f.amounts.revenue.state, f.costAllocation.allocationEligibleDays, f.provenance.exceptionsState], [[D], "27000", "complete", 27, "present"], "B2 view");
    eq((await readRows()).find((r) => r.date === D).sales, 0, "stored explicit zero");
  });
  await run("RC-E2E-02", "race: revenue written after the ledger committed ⇒ CD-M2 partial AND B2 contradiction (no false success anywhere)", async () => {
    await reseed(); await seedDb().ref(entriesPath).set({ _v: JSON.stringify(sept().map((r) => (r.date === D ? { ...r, sales: "0" } : r))) }); await settle();
    const c = await client();
    const api = serverApi();
    const r = plain(await MC.executeClosureAction(c.io(D, { apiFetch: async (u, o) => { const x = await api(u, o); if (/set-entry/.test(u)) { const rows = await readRows(); rows.find((y) => y.date === D).sales = "50"; await seedDb().ref(entriesPath).set({ _v: JSON.stringify(rows) }); } return x; } })));
    eq([r.status, r.reason], ["partial", "revenue_changed_concurrently"], "CD-M2 outcome");
    const s = await snap();
    eq([s.financials.coverage.closedWithRevenue, s.netProfit], [[D], null], "B2 contradiction");
  });
  await run("RC-E2E-03", "reopen ⇒ B2 operating zero (not closed, not missing, revenue not restored)", async () => {
    await reseed(); const c = await client();
    eq((await close(c, D)).status, "closed", "closed"); await settle();
    eq(plain(await MC.executeClosureReopen(c.io(D))).status, "reopened", "reopened");
    const f = (await snap()).financials;
    eq([f.coverage.closedDays, f.coverage.revenue.missing, f.amounts.revenue.exact, f.costAllocation.allocationEligibleDays], [[], [], "27000", 28], "B2 view");
  });
  await run("RC-E2E-04", "future closure ⇒ no row; B2 forecast drops the day at once; Actual and denominator unchanged", async () => {
    await reseed(); const before = await snap(); const c = await client();
    eq((await close(c, FUT)).status, "closed", "closed");
    const after = await snap();
    eq([(await readRows()).some((r) => r.date === FUT), after.financials.projection.futureClosureDates], [false, [FUT]], "ledger only");
    eq(JSON.stringify(after.financials.amounts) === JSON.stringify(before.financials.amounts) && JSON.stringify(after.financials.costAllocation) === JSON.stringify(before.financials.costAllocation), true, "Actual / denominator unchanged");
    if (!(after.paceRevenue < before.paceRevenue)) throw new Error("forecast did not fall");
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  for (const r of results) console.log(`${w(r.id, 11)} ${w(r.s, 5)} ${w(r.ms, 6)} ${r.d}${r.n ? " — " + r.n : ""}`);
  const EXPECTED = 4;
  console.log(`\n=== TOTALS ===\ntotal=${results.length} passed=${results.filter((r) => r.s === "PASS").length} failed=${failures}`);
  if (results.length !== EXPECTED) { process.exitCode = 3; return; }
  if (failures) { process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED");
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
  .catch(async (e) => { console.error("HARNESS ERROR:", e && e.stack); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
