// Marjin — P0-DATA-01 STORAGE V2: row-keyed entries, proven against a REAL local
// Firebase RTDB emulator.
//
// Legacy storage keeps every row inside one JSON string, so Rules cannot see a row and
// cannot enforce row identity or uniqueness. V2 gives every row its own node keyed by
// its immutable id. This matrix proves, against the real Rules engine and the real
// transaction protocol: the cutover is atomic and cannot lose a concurrent legacy write
// (with a negative control that does), row identity is structurally enforced, duplicate
// ids are unrepresentable, duplicate dates survive, free text is just text, ordinary
// row writes stop contending, the accepted R10.1 stale-delete contract still holds,
// clear-all retires a generation so nothing can be resurrected, and a legacy client
// cannot corrupt a business after cutover.
//
// Deliberately NOT named *.test.mjs — it must never be swept up by the emulator-free
// repository glob. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { createLegacyPreflight } from "../../tools/storage-v2/preflight.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
const DEMO = new Set(["https://demo-marjin-rules.firebaseio.com", "https://demo-marjin-rules-default-rtdb.firebaseio.com"]);
const isLocal = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?].*)?$/.test(String(u));

function assertSafe() {
  if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG);
  if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) {
    const u = String(process.env.FIREBASE_DATABASE_URL);
    if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`);
  }
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
  const rules = JSON.parse(b.toString());
  const dk = rules?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  if (!dk?.rows?.["$rowId"]?.[".validate"]) fail("rules have no rows/$rowId validator — the contract under test is absent");
}

// ─── Production code, vm-extracted (lifecycle + storage V2 together) ─────────
const html = readFileSync(join(ROOT, "index.html"), "utf8");
function loadProduction() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  if (start === -1) fail("P0-DATA-01 anchor missing from index.html");
  const f = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  if (f === -1) fail("window.MarjinStorageV2 export missing from index.html");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
const W = loadProduction();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
// Source-anchored guards: this harness reproduces production path derivation, so drift
// must break the run rather than pass silently.
for (const anchor of ['return `tenants/${tenantId}/${safe}`;',
                      'return await runTransaction(ref(db, path), txnFn, { applyLocally: false });',
                      'window.storage.mutateForPath = async (tenantId, key, subPath, txnFn) => {']) {
  if (!html.includes(anchor)) fail("production transport changed — update this harness: " + anchor);
}

const { preflightLegacyNode } = createLegacyPreflight({
  parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId,
  isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r),
  entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode,
});
const { upgradeBusinessToV2, unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL } = createStorageV2Upgrader({
  preflightLegacyNode, isV2Node: V2.isV2Node, isGenerationToken: V2.isGenerationToken,
});

// ─── deterministic ids ───────────────────────────────────────────────────────
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2"), ID3 = uuid("r3"), GEN1 = uuid("g1"), GEN2 = uuid("g2");
const row = (id, date, sales, extra = {}) => ({ id, date, sales, deliveries: 0, other_income: 0, ...extra });
const LEGACY_ROWS = () => [row(ID1, "2026-08-01", 101, { notes: "רגיל" }), row(ID2, "2026-08-01", 202), row(ID3, "2026-08-02", 303)];
const envelope = (rows) => ({ _v: JSON.stringify(rows) });
const PATH = (biz = "bizA", tenant = "tenantA") => `tenants/${tenant}/biz:${biz}:entries`;

// ─── identities, fixtures, apps ──────────────────────────────────────────────
const IDS = { owner: { uid: "u_owner", token: { email: "o@demo.example" } },
              manager: { uid: "u_manager", token: { email: "m@demo.example" } },
              viewer: { uid: "u_viewer", token: { email: "v@demo.example" } }, unauth: null };
const apps = {};
function initApps() {
  apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  for (const [k, o] of Object.entries(IDS)) {
    apps[k] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: o }, `id_${k}`);
    apps[k + "#2"] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: o }, `id2_${k}`);
  }
}
const seedDb = () => apps.__seed.database();
const fixtures = () => ({ tenants: { tenantA: {
  members: { u_owner: true, u_manager: true, u_viewer: true },
  roles: { u_owner: "owner", u_manager: "manager", u_viewer: "viewer" },
  biz_access: { bizA: { u_manager: true, u_viewer: true } },
  "biz:bizA:entries": envelope(LEGACY_ROWS()),
  "biz:bizB:entries": envelope([row(uuid("b1"), "2026-03-01", 9)]),
} } });
async function reseed() { detachAll(); await seedDb().ref("/").set(fixtures()); }
async function seedV2(generation = GEN1, rows = LEGACY_ROWS(), biz = "bizA") {
  const map = {}; rows.forEach((r) => { map[r.id] = { ...r, gen: generation }; });
  const node = { schemaVersion: 2, generation, _v: JSON.stringify(rows) };
  if (rows.length) node.rows = map;
  await seedDb().ref(PATH(biz)).set(node);
}
const readNode = async (biz = "bizA", tenant = "tenantA") => {
  const s = await seedDb().ref(PATH(biz, tenant)).once("value"); return s.exists() ? s.val() : null;
};
const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));

const LIVE = [];
// A V2 client: its own connection, selection controller and mutator.
function v2Client(appKey, { tenantId = "tenantA", bizId = "bizA", generation = GEN1 } = {}) {
  const db = apps[appKey].database();
  const ctrl = ML.createSelectionController(); ctrl.invalidate(tenantId, bizId);
  let gen = generation;
  const mutator = V2.createV2EntriesMutator({
    selection: ctrl, generation: () => gen,
    transactRow: async (t, key, rowId, fn) => {
      const r = await db.ref(`tenants/${t}/${key}/rows/${rowId}`).transaction(fn, undefined, false);
      return { committed: r.committed, snapshot: r.snapshot };
    },
    transactNode: async (t, key, fn) => {
      const r = await db.ref(`tenants/${t}/${key}`).transaction(fn, undefined, false);
      return { committed: r.committed, snapshot: r.snapshot };
    },
  });
  const ref = db.ref(`tenants/${tenantId}/biz:${bizId}:entries`);
  let handler = null;
  const client = { ctrl, mutator, db, ref, setGeneration: (g) => { gen = g; }, generation: () => gen,
    // Production parity: a live listener on the entries node. It is also what keeps the
    // RTDB client cache warm, so a transaction never runs its first pass against `null`.
    attach() { return new Promise((res) => { let first = true;
      handler = ref.on("value", () => { if (first) { first = false; res(client); } }); }); },
    detach() { if (handler) { ref.off("value", handler); handler = null; } return client; },
    mutate: (i) => mutator.mutate(i, ctrl.capture()) };
  LIVE.push(client);
  return client;
}
function detachAll() { while (LIVE.length) { try { LIVE.pop().detach(); } catch (_) {} } }
const legacyIo = (appKey) => ({
  transactNode: async (t, key, fn) => {
    const r = await apps[appKey].database().ref(`tenants/${t}/${key}`).transaction(fn, undefined, false);
    return { committed: r.committed, snapshot: r.snapshot };
  },
  readNode: async (t, key) => { const s = await apps[appKey].database().ref(`tenants/${t}/${key}`).once("value"); return s.exists() ? s.val() : null; },
  writeNode: async (t, key, v) => { await apps[appKey].database().ref(`tenants/${t}/${key}`).set(v); },
});

// ─── runner ──────────────────────────────────────────────────────────────────
const results = []; let failures = 0;
async function run(id, area, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, area, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, area, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.message) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const COMMITTED = (s) => s === "committed" || s === "committed_idempotent";
const rowsOf = (node) => { const r = V2.readV2Rows(node); if (r.status) throw new Error("readV2Rows: " + r.status + "/" + (r.reason||"")); return r.rows; };
const salesAt = (rows, id) => { const r = rows.find((x) => x.id === id); return r ? r.sales : undefined; };
const buildDelete = (r) => ML.buildEntryDeleteIntent(r, {});
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });

async function main() {
  assertSafe(); initApps();

  // ══ LEGACY — unchanged before cutover ════════════════════════════════════
  await run("V2-L01", "legacy", "a legacy business still reads and writes exactly as before", async () => {
    await reseed();
    eq(V2.detectStorageMode(await readNode()).mode, "legacy", "mode");
    const ctrl = ML.createSelectionController(); ctrl.invalidate("tenantA", "bizA");
    const m = ML.createRemoteEntriesMutator({ selection: ctrl, transact: async (t, k, fn) => {
      const r = await apps.manager.database().ref(`tenants/${t}/${k}`).transaction(fn, undefined, false);
      return { committed: r.committed, snapshot: r.snapshot }; } });
    const lref = apps.manager.database().ref(`tenants/tenantA/biz:bizA:entries`);
    await new Promise((r) => { let first = true; lref.on("value", () => { if (first) { first = false; r(); } }); });
    const res = await m.mutate(upsert(ID1, { sales: 999 }, { sales: 101 }), ctrl.capture());
    lref.off("value");
    expect(COMMITTED(res.status), `legacy write ${res.status}`);
    const read = V2.readEntriesNode(await readNode());
    eq(read.mode, "legacy", "still legacy"); eq(salesAt(read.rows, ID1), 999, "legacy edit applied");
    return "legacy read/write intact";
  });

  // ══ PREFLIGHT ════════════════════════════════════════════════════════════
  await run("V2-P01", "preflight", "valid legacy data passes and is read-only", async () => {
    await reseed();
    const before = JSON.stringify(await readNode());
    const rep = preflightLegacyNode(await readNode());
    expect(rep.ok, "must pass"); eq(rep.rowCount, 3, "row count");
    eq(JSON.stringify(await readNode()), before, "preflight must not write anything");
    return "ok, 3 rows, node untouched";
  });
  await run("V2-P02", "preflight", "a row with no immutable id is a blocker and is NOT repaired", async () => {
    await reseed();
    await seedDb().ref(PATH()).set(envelope([row(ID1, "2026-08-01", 1), { date: "2026-08-02", sales: 2 }]));
    const rep = preflightLegacyNode(await readNode());
    expect(!rep.ok, "must block");
    const b = rep.blockers.find((x) => x.code === "missing_entry_id");
    expect(!!b, "missing_entry_id blocker"); eq(b.count, 1, "count");
    eq(b.remedy, "approved_offline_entry_id_assignment", "defers to the approved action");
    expect(!rep.rows, "no rows are handed onward when blocked");
    return `blocked: ${rep.blockers.map((x) => x.code).join(",")}`;
  });
  await run("V2-P03", "preflight", "duplicate immutable ids are a blocker requiring an operator decision", async () => {
    await seedDb().ref(PATH()).set(envelope([row(ID1, "2026-08-01", 1), row(ID1, "2026-08-02", 2)]));
    const rep = preflightLegacyNode(await readNode());
    expect(!rep.ok, "must block");
    const b = rep.blockers.find((x) => x.code === "duplicate_entry_id");
    expect(!!b && b.ids[0] === ID1, "duplicate id named");
    eq(b.remedy, "operator_resolution_required", "not auto-resolved");
    return "blocked";
  });
  await run("V2-P04", "preflight", "a malformed blob is a blocker", async () => {
    await seedDb().ref(PATH()).set({ _v: "not json" });
    const rep = preflightLegacyNode(await readNode());
    expect(!rep.ok && rep.blockers[0].code === "malformed_node", "malformed blocker");
    return "blocked";
  });

  // ══ CUTOVER ══════════════════════════════════════════════════════════════
  await run("V2-M01", "cutover", "a valid business converts atomically; every row, and duplicate dates, survive", async () => {
    await reseed();
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA", generation: GEN1 });
    eq(res.status, "committed", `cutover ${res.status} ${JSON.stringify(res.report || "")}`);
    const node = await readNode();
    eq(node.schemaVersion, 2, "schemaVersion"); eq(node.generation, GEN1, "generation");
    eq(typeof node._v, "string", "frozen snapshot retained");
    const rows = rowsOf(node);
    eq(rows.length, 3, "all rows"); eq(salesAt(rows, ID1), 101, "values preserved");
    eq(rows.filter((r) => r.date === "2026-08-01").length, 2, "duplicate business dates preserved");
    for (const r of rows) eq(node.rows[r.id].id, r.id, "row key equals its id");
    return `3 rows, schemaVersion=2, generation set, _v frozen`;
  });
  await run("V2-M02", "cutover", "converting an already-converted business is refused", async () => {
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA", generation: GEN2 });
    eq(res.status, "already_v2", `got ${res.status}`);
    eq((await readNode()).generation, GEN1, "generation untouched");
    return "refused";
  });
  await run("V2-M03", "cutover", "preflight blockers refuse the cutover", async () => {
    await reseed();
    await seedDb().ref(PATH()).set(envelope([{ date: "2026-08-02", sales: 2 }]));
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA", generation: GEN1 });
    eq(res.status, "preflight_blocked", `got ${res.status}`);
    eq(V2.detectStorageMode(await readNode()).mode, "legacy", "still legacy — nothing was written");
    return `refused: ${res.report.blockers.map((b) => b.code).join(",")}`;
  });
  await run("V2-M04", "cutover", "a legacy write that lands mid-cutover is NOT lost — the CAS re-runs on it", async () => {
    await reseed();
    let injected = false;
    const io = legacyIo("manager");
    const racing = {
      ...io,
      transactNode: async (t, key, fn) => io.transactNode(t, key, (cur) => {
        // First callback run only: a legacy writer commits out of band, exactly in the
        // window a read-then-write cutover would lose.
        if (!injected) { injected = true; }
        return fn(cur);
      }),
    };
    // Land the competing legacy write BEFORE the cutover reads, then again after its
    // first attempt, by mutating through a second client between attempts.
    const extra = row(uuid("late"), "2026-08-03", 777);
    await apps["manager#2"].database().ref(PATH()).set(envelope([...LEGACY_ROWS(), extra]));
    const res = await upgradeBusinessToV2(racing, { tenantId: "tenantA", bizId: "bizA", generation: GEN1 });
    eq(res.status, "committed", `cutover ${res.status}`);
    const rows = rowsOf(await readNode());
    eq(rows.length, 4, "the concurrent legacy row is present");
    expect(rows.some((r) => r.id === extra.id), "the late row survived the cutover");
    return "4 rows — concurrent legacy write preserved";
  });
  await run("V2-M05", "cutover", "NEGATIVE CONTROL: a read-then-write cutover loses the same write", async () => {
    await reseed();
    const extra = row(uuid("late2"), "2026-08-03", 888);
    const io = legacyIo("manager");
    const res = await unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL(io, {
      tenantId: "tenantA", bizId: "bizA", generation: GEN1,
      // the legacy writer commits inside the read-to-write window
      pause: async () => { await apps["manager#2"].database().ref(PATH()).set(envelope([...LEGACY_ROWS(), extra])); },
    });
    eq(res.status, "committed", "the naive path still reports success");
    const rows = rowsOf(await readNode());
    eq(rows.length, 3, "and it wrote only what it had read");
    expect(!rows.some((r) => r.id === extra.id), "the concurrent write was LOST — the control can see the bug");
    return "lost update reproduced, as required of a negative control";
  });

  // ══ V2 IDENTITY — enforced by the real Rules engine ══════════════════════
  const rowPath = (id, biz = "bizA") => `${PATH(biz)}/rows/${id}`;
  async function attempt(label, path, value, want, identity = "manager") {
    let actual = "allow", err = "";
    try { await apps[identity].database().ref(path).set(value); }
    catch (e) { actual = denied(e) ? "deny" : "error"; err = (e && e.message) || String(e); }
    if (actual !== want) throw new Error(`${label}: expected ${want}, got ${actual}${err ? " — " + err : ""}`);
  }
  await run("V2-I01", "identity", "a row whose key equals its top-level id is accepted", async () => {
    await reseed(); await seedV2();
    await attempt("valid", rowPath(uuid("new1")), { id: uuid("new1"), gen: GEN1, date: "2026-08-05", sales: 5 }, "allow");
    return "allow";
  });
  await run("V2-I02", "identity", "a top-level id that differs from the child key is denied", async () => {
    await attempt("mismatch", rowPath(uuid("new2")), { id: uuid("other"), gen: GEN1, date: "2026-08-05" }, "deny");
    return "deny";
  });
  await run("V2-I03", "identity", "a nested decoy id cannot satisfy identity", async () => {
    await attempt("meta.id", rowPath(uuid("new3")), { meta: { id: uuid("new3") }, gen: GEN1, date: "2026-08-05" }, "deny");
    await attempt("arbitrary nested id", rowPath(uuid("new4")), { row: { id: uuid("new4") }, gen: GEN1, date: "2026-08-05" }, "deny");
    return "deny, deny";
  });
  await run("V2-I04", "identity", "a malformed top-level id, and a non-canonical child key, are denied", async () => {
    await attempt("bad id", rowPath(uuid("new5")), { id: "not-a-uuid", gen: GEN1, date: "2026-08-05" }, "deny");
    await attempt("bad key", `${PATH()}/rows/row-1`, { id: "row-1", gen: GEN1, date: "2026-08-05" }, "deny");
    return "deny, deny";
  });
  await run("V2-I05", "identity", "duplicate immutable ids are UNREPRESENTABLE, not merely rejected", async () => {
    await reseed(); await seedV2();
    // Two children carrying one id: the second key's id cannot equal its own key.
    await attempt("two rows one id", `${PATH()}/rows`,
      { [uuid("d1")]: { id: uuid("d1"), gen: GEN1, date: "2026-08-01" },
        [uuid("d2")]: { id: uuid("d1"), gen: GEN1, date: "2026-08-02" } }, "deny");
    // And writing the same id twice simply addresses the same node — there is no second row.
    const id = uuid("same");
    await attempt("write id once", rowPath(id), { id, gen: GEN1, date: "2026-08-01", sales: 1 }, "allow");
    await attempt("write id again", rowPath(id), { id, gen: GEN1, date: "2026-08-02", sales: 2 }, "allow");
    const rows = rowsOf(await readNode());
    eq(rows.filter((r) => r.id === id).length, 1, "one id can only ever be one row");
    return "structurally impossible";
  });
  await run("V2-I06", "identity", "duplicate business DATES with distinct ids remain legal", async () => {
    await reseed(); await seedV2();
    const a = uuid("dd1"), b = uuid("dd2");
    await attempt("date twin A", rowPath(a), { id: a, gen: GEN1, date: "2026-09-09", sales: 1 }, "allow");
    await attempt("date twin B", rowPath(b), { id: b, gen: GEN1, date: "2026-09-09", sales: 2 }, "allow");
    eq(rowsOf(await readNode()).filter((r) => r.date === "2026-09-09").length, 2, "both twins stored");
    return "allow, allow";
  });
  await run("V2-I07", "identity", "free text is just text — `},{`, braces, quotes, newlines, Hebrew", async () => {
    await reseed(); await seedV2();
    const id = uuid("txt");
    await attempt("free text", rowPath(id), { id, gen: GEN1, date: "2026-08-07",
      notes: 'סגור },{ פתוח {a} "ציטוט"\nשורה שנייה', exception_note: "},{", weather_impact: "{}" }, "allow");
    const r = rowsOf(await readNode()).find((x) => x.id === id);
    eq(r.exception_note, "},{", "stored verbatim");
    return "allow — the serialization artifact is gone";
  });
  await run("V2-I08", "identity", "the immutable id cannot be changed on an existing row", async () => {
    await reseed(); await seedV2();
    await attempt("rewrite id child", `${rowPath(ID1)}/id`, uuid("hijack"), "deny");
    eq(rowsOf(await readNode()).find((r) => r.id === ID1).id, ID1, "unchanged");
    return "deny";
  });

  // ══ V2 CONCURRENCY ═══════════════════════════════════════════════════════
  await run("V2-C01", "concurrency", "two edits to DIFFERENT rows both commit with no whole-node contention", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    const [ra, rb] = await Promise.all([
      A.mutate(upsert(ID1, { sales: 1111 }, { sales: 101 })),
      B.mutate(upsert(ID3, { sales: 3333 }, { sales: 303 })),
    ]);
    expect(COMMITTED(ra.status) && COMMITTED(rb.status), `${ra.status}/${rb.status}`);
    eq(ra.runs, 1, "A needed no CAS retry"); eq(rb.runs, 1, "B needed no CAS retry");
    const rows = rowsOf(await readNode());
    eq(salesAt(rows, ID1), 1111, "A"); eq(salesAt(rows, ID3), 3333, "B"); eq(rows.length, 3, "history intact");
    return `both committed, ${ra.runs + rb.runs} callback runs for 2 writes — no contention`;
  });
  await run("V2-C02", "concurrency", "concurrent edits to the SAME row obey the stale/conflict contract", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    const r1 = await A.mutate(upsert(ID1, { sales: 5000 }, { sales: 101 }));
    expect(COMMITTED(r1.status), `A ${r1.status}`);
    const r2 = await B.mutate(upsert(ID1, { sales: 6000 }, { sales: 101 }));   // B still based on 101
    eq(r2.status, "conflict", `B ${r2.status}`);
    expect(r2.conflictPaths.includes("sales"), "names the field");
    eq(salesAt(rowsOf(await readNode()), ID1), 5000, "A's value stands");
    return `conflictPaths=${JSON.stringify(r2.conflictPaths)}`;
  });
  await run("V2-C03", "concurrency", "a stale delete is refused — the R10.1 complete-row precondition still holds", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    const seen = rowsOf(await readNode()).find((r) => r.id === ID1);
    const r1 = await A.mutate({ type: "upsert_entry", target: { id: ID1 },
      patch: { maps: { supplier_payments: { sup9: 500 } } }, base: { maps: { supplier_payments: {} } } });
    expect(COMMITTED(r1.status), `supplier write ${r1.status}`);
    const rdel = await B.mutate(buildDelete(seen));
    eq(rdel.status, "conflict", `stale delete ${rdel.status}`);
    expect(rdel.conflictPaths.includes("supplier_payments.sup9"), `names the path, got ${JSON.stringify(rdel.conflictPaths)}`);
    expect(!!rowsOf(await readNode()).find((r) => r.id === ID1), "row survives");
    return "refused";
  });
  await run("V2-C04", "concurrency", "an unrelated row mutation does not falsely block a delete", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    const seen = rowsOf(await readNode()).find((r) => r.id === ID1);
    expect(COMMITTED((await A.mutate(upsert(ID3, { sales: 4242 }, { sales: 303 }))).status), "unrelated edit");
    const rdel = await B.mutate(buildDelete(seen));
    expect(COMMITTED(rdel.status), `delete ${rdel.status} ${JSON.stringify(rdel.conflictPaths || null)}`);
    const rows = rowsOf(await readNode());
    expect(!rows.some((r) => r.id === ID1), "target deleted");
    eq(salesAt(rows, ID3), 4242, "unrelated edit intact");
    return "committed, no false stale";
  });
  await run("V2-C05", "concurrency", "an unchanged row deletes normally, and only that row", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach();
    const seen = rowsOf(await readNode()).find((r) => r.id === ID2);
    expect(COMMITTED((await A.mutate(buildDelete(seen))).status), "delete");
    const rows = rowsOf(await readNode());
    eq(rows.length, 2, "one row removed"); expect(!rows.some((r) => r.id === ID2), "the addressed one");
    expect(rows.some((r) => r.id === ID1 && r.date === "2026-08-01"), "its same-date twin survives");
    return "committed";
  });

  // ══ CLEAR-ALL / GENERATION ═══════════════════════════════════════════════
  const clearAll = (client, next = GEN2) => client.mutate({ type: "clear_all",
    expectedNodeFingerprint: ML.contentFingerprint(client.__seen), nextGeneration: next });
  await run("V2-G01", "generation", "clear-all retires the generation and removes every row", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(); A.__seen = rowsOf(await readNode());
    const res = await clearAll(A);
    eq(res.status, "committed", `clear-all ${res.status} ${res.reason || ""}`);
    const node = await readNode();
    eq(node.generation, GEN2, "generation rotated");
    eq(node.rows, undefined, "no rows remain");
    eq(typeof node._v, "string", "frozen snapshot retained");
    return "rotated";
  });
  await run("V2-G02", "generation", "a client from the retired generation cannot RESURRECT a row", async () => {
    const stale = await v2Client("owner", { generation: GEN1 }).attach();     // never saw the rotation
    const res = await stale.mutate(create(row(ID1, "2026-08-01", 101)));
    expect(res.status !== "committed", `a stale-generation create must not commit, got ${res.status}`);
    eq((await readNode()).rows, undefined, "still empty");
    // …and the Rules engine, not just the client, is what refuses it.
    await attempt("raw stale-generation row", rowPath(ID1), { id: ID1, gen: GEN1, date: "2026-08-01" }, "deny");
    return `client=${res.status}, rules=deny`;
  });
  await run("V2-G03", "generation", "a write in the ACTIVE generation works immediately after a clear-all", async () => {
    const fresh = await v2Client("manager", { generation: GEN2 }).attach();
    const res = await fresh.mutate(create(row(ID1, "2026-08-01", 101)));
    expect(COMMITTED(res.status), `fresh create ${res.status} ${res.reason || ""}`);
    eq(rowsOf(await readNode()).length, 1, "one row");
    return "committed";
  });
  await run("V2-G04", "generation", "clear-all vs a concurrent ordinary edit: deterministic, nothing lost", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    A.__seen = rowsOf(await readNode());
    // B's edit lands first; A's clear-all was confirmed against the pre-edit content.
    expect(COMMITTED((await B.mutate(upsert(ID1, { sales: 7777 }, { sales: 101 }))).status), "B edit");
    const res = await clearAll(A);
    expect(res.status !== "committed", `the clear-all must not silently discard B's edit, got ${res.status}`);
    const rows = rowsOf(await readNode());
    eq(rows.length, 3, "nothing was cleared"); eq(salesAt(rows, ID1), 7777, "B's edit intact");
    return `refused: ${res.status}/${res.reason || ""}`;
  });
  await run("V2-G05", "generation", "clear-all vs a concurrent DELETE of one row is equally deterministic", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    A.__seen = rowsOf(await readNode());
    const seen = A.__seen.find((r) => r.id === ID2);
    expect(COMMITTED((await B.mutate(buildDelete(seen))).status), "B delete");
    const res = await clearAll(A);
    expect(res.status !== "committed", `got ${res.status}`);
    eq(rowsOf(await readNode()).length, 2, "B's delete stands, the rest survive");
    return `refused: ${res.status}`;
  });

  // ══ COMPATIBILITY / CUTOVER SAFETY ═══════════════════════════════════════
  await run("V2-X01", "compatibility", "a legacy `_v` writer after cutover is DENIED and changes nothing", async () => {
    await reseed(); await seedV2();
    const before = JSON.stringify(await readNode());
    await attempt("legacy whole-node write", PATH(), envelope([row(uuid("evil"), "2026-01-01", 1)]), "deny");
    await attempt("legacy _v child write", `${PATH()}/_v`, JSON.stringify([row(uuid("evil2"), "2026-01-01", 1)]), "deny");
    await attempt("schema downgrade", PATH(), { schemaVersion: 1, _v: "[]" }, "deny");
    eq(JSON.stringify(await readNode()), before, "the node is byte-intact");
    return "deny ×3, node unchanged";
  });
  await run("V2-X02", "compatibility", "a malformed V2 node fails CLOSED and never falls back to the frozen `_v`", async () => {
    await reseed();
    // A V2 node whose rows disagree with the generation — the frozen snapshot is still
    // sitting there, and must NOT be used.
    await seedDb().ref(PATH()).set({ schemaVersion: 2, generation: GEN1, _v: JSON.stringify(LEGACY_ROWS()),
      rows: { [ID1]: { id: ID1, gen: uuid("wrong"), date: "2026-08-01", sales: 1 } } });
    const read = V2.readEntriesNode(await readNode());
    expect(!!read.status, "must be a typed failure");
    eq(read.mode, "v2", "and it stays V2 — no legacy fallback");
    eq(read.reason, "row_generation_mismatch", "precise reason");
    expect(read.rows === undefined, "no rows are handed to the app");
    // A V2 node with the schema marker stripped is malformed, not legacy.
    await seedDb().ref(PATH()).set({ generation: GEN1, rows: { [ID1]: { id: ID1, gen: GEN1, date: "2026-08-01" } }, _v: "[]" });
    const r2 = V2.readEntriesNode(await readNode());
    eq(r2.mode, "malformed", "stripped schema marker is malformed");
    eq(r2.reason, "v2_structure_without_schema_version", "precise reason");
    return "fail-closed, twice";
  });
  await run("V2-X03", "compatibility", "the router writes nothing while the storage mode is unknown or malformed", async () => {
    const router = V2.createEntriesStorageRouter({ mode: () => null,
      legacy: { mutate: () => { throw new Error("legacy engine must not run"); } },
      v2: { mutate: () => { throw new Error("v2 engine must not run"); } } });
    const r = await router.mutate({ type: "upsert_entry", target: { id: ID1 } }, { tenantId: "tenantA", bizId: "bizA", gen: 0 });
    eq(r.status, "blocked_unhydrated", `got ${r.status}`);
    const r2 = await V2.createEntriesStorageRouter({ mode: () => ({ mode: "malformed", reason: "x" }),
      legacy: { mutate: () => { throw new Error("no"); } }, v2: { mutate: () => { throw new Error("no"); } } })
      .mutate({ type: "upsert_entry", target: { id: ID1 } }, { tenantId: "tenantA", bizId: "bizA", gen: 0 });
    eq(r2.status, "blocked_unhydrated", `got ${r2.status}`);
    return "blocked_unhydrated ×2";
  });

  // ══ AUTHORIZATION — unchanged ════════════════════════════════════════════
  await run("V2-A01", "authorization", "business isolation and role gating are unchanged for V2 rows", async () => {
    await reseed(); await seedV2();
    await seedDb().ref(PATH("bizB")).set({ schemaVersion: 2, generation: GEN1 });
    const beforeB = JSON.stringify(await readNode("bizB"));
    await attempt("manager -> other business", rowPath(uuid("x"), "bizB"), { id: uuid("x"), gen: GEN1, date: "2026-08-01" }, "deny", "manager");
    await attempt("viewer -> own business", rowPath(uuid("y")), { id: uuid("y"), gen: GEN1, date: "2026-08-01" }, "deny", "viewer");
    await attempt("unauthenticated", rowPath(uuid("z")), { id: uuid("z"), gen: GEN1, date: "2026-08-01" }, "deny", "unauth");
    await attempt("owner -> own business", rowPath(uuid("w")), { id: uuid("w"), gen: GEN1, date: "2026-08-01" }, "allow", "owner");
    eq(JSON.stringify(await readNode("bizB")), beforeB, "the other business is untouched");
    return "deny ×3, allow ×1";
  });

  // ─── report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 8)} ${w("area", 14)} ${w("status", 6)} ${w("ms", 6)} notes`);
  console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 14)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.notes}`);
  const EXPECTED = 32;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED}, ran ${results.length}`); process.exitCode = 3; return; }
  if (failures) {
    console.error("\n=== FAILURES ===");
    for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} [${r.area}] ${r.description}\n    ${r.notes}`);
    process.exitCode = 1; return;
  }
  console.log("\nALL CASES PASSED");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4;
                              await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
