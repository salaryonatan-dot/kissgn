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
// HARDENING R1 (Codex SV2-01…SV2-09): the cutover is irreversible on the server, the
// generation is a strictly monotonic integer epoch that only clear-all advances, an
// intent is bound to the epoch it was formed under, the listener stays authoritative
// after row commits, an absent business initialises straight into V2, the conversion
// preserves every domain field (a legacy `gen` included) and reports its approved
// canonicalization, an exact create retry is idempotent under RTDB normalization, the
// row map cannot be replaced by a scalar, and the legacy engine refuses a V2 node.
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
  entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY,
});
const { upgradeBusinessToV2, unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL } = createStorageV2Upgrader({
  preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST,
});
const GK = V2.ROW_GEN_KEY;
// The real UI row template, so the create-replay case uses production's own shape.
const EMPTY_ENTRY = (() => { const m = html.match(/const EMPTY_ENTRY = \{[\s\S]*?\n\};/); if (!m) fail("EMPTY_ENTRY template missing");
  return vm.runInNewContext("(" + m[0].replace(/^const EMPTY_ENTRY = /, "").replace(/;$/, "") + ")", {}); })();

// ─── deterministic ids ───────────────────────────────────────────────────────
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2"), ID3 = uuid("r3"), GEN1 = 1, GEN2 = 2;
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
  const map = {}; rows.forEach((r) => { map[r.id] = { ...r, [GK]: generation }; });
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
function v2Client(appKey, { tenantId = "tenantA", bizId = "bizA", generation = GEN1, mode = "v2" } = {}) {
  const db = apps[appKey].database();
  const ctrl = ML.createSelectionController(); ctrl.invalidate(tenantId, bizId);
  let gen = generation, liveMode = mode;
  const mutator = V2.createV2EntriesMutator({
    selection: ctrl, mode: () => ({ mode: liveMode, generation: liveMode === "v2" ? gen : null }),
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
  const client = { ctrl, mutator, db, ref, setGeneration: (g) => { gen = g; }, setMode: (m) => { liveMode = m; }, generation: () => gen,
    // Production parity: a live listener on the entries node. It is also what keeps the
    // RTDB client cache warm, so a transaction never runs its first pass against `null`.
    attach() { return new Promise((res) => { let first = true;
      handler = ref.on("value", () => { if (first) { first = false; res(client); } }); }); },
    detach() { if (handler) { ref.off("value", handler); handler = null; } return client; },
    // An intent is bound to the epoch the client held when it was SUBMITTED (the
    // coordinator captures it); `binding` lets a case submit under an older one.
    binding: () => ({ mode: liveMode, generation: liveMode === "v2" ? gen : null }),
    mutate: (i, binding) => mutator.mutate(i, ctrl.capture(), binding || client.binding()) };
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
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "committed", `cutover ${res.status} ${JSON.stringify(res.report || "")}`);
    const node = await readNode();
    eq(node.schemaVersion, 2, "schemaVersion"); eq(node.generation, GEN1, "generation starts at the first epoch");
    eq(typeof node._v, "string", "frozen snapshot retained");
    const rows = rowsOf(node);
    eq(rows.length, 3, "all rows"); eq(salesAt(rows, ID1), 101, "values preserved");
    eq(rows.filter((r) => r.date === "2026-08-01").length, 2, "duplicate business dates preserved");
    for (const r of rows) eq(node.rows[r.id].id, r.id, "row key equals its id");
    return `3 rows, schemaVersion=2, generation set, _v frozen`;
  });
  await run("V2-M02", "cutover", "converting an already-converted business is refused", async () => {
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "already_v2", `got ${res.status}`);
    const chosen = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA", generation: 7 });
    eq(chosen.reason, "generation_not_callable", "the epoch is never a caller input");
    eq((await readNode()).generation, GEN1, "generation untouched");
    return "refused";
  });
  await run("V2-M03", "cutover", "preflight blockers refuse the cutover", async () => {
    await reseed();
    await seedDb().ref(PATH()).set(envelope([{ date: "2026-08-02", sales: 2 }]));
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "preflight_blocked", `got ${res.status}`);
    eq(V2.detectStorageMode(await readNode()).mode, "legacy", "still legacy — nothing was written");
    return `refused: ${res.report.blockers.map((b) => b.code).join(",")}`;
  });
  await run("V2-M04", "cutover", "a legacy write that lands mid-cutover is NOT lost — the CAS re-runs on it", async () => {
    await reseed();
    // A REAL compare-and-swap barrier: the emulator's REST ETag protocol, with a
    // deterministic pause between callback evaluation and the conditional PUT. The
    // competing legacy write lands INSIDE that window through an ordinary manager SDK
    // connection, so the first PUT must fail with 412 and the callback must re-run on
    // the value that includes the late row. (The REST transport uses the emulator's
    // privileged token to study CAS mechanics only; authorization is proven elsewhere.)
    const extra = row(uuid("late"), "2026-08-03", 777);
    let puts = 0, retries = 0, injected = false;
    const restCas = {
      transactNode: async (t, key, fn) => {
        const url = `http://${EMU}/tenants/${t}/${key}.json?ns=${NAMESPACE}`;
        for (let attempt = 0; attempt < 8; attempt++) {
          const got = await fetch(url, { headers: { "X-Firebase-ETag": "true", Authorization: "Bearer owner" } });
          if (!got.ok) throw new Error(`GET ${got.status}`);
          const next = fn(await got.json());
          if (next === undefined) return { committed: false };
          if (!injected) { injected = true; await apps["manager#2"].database().ref(PATH()).set(envelope([...LEGACY_ROWS(), extra])); }
          puts++;
          const put = await fetch(url, { method: "PUT", headers: { "If-Match": got.headers.get("etag"), "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify(next) });
          if (put.status === 412) { retries++; continue; }
          if (put.status !== 200) throw new Error(`PUT ${put.status}: ${await put.text()}`);
          return { committed: true };
        }
        throw new Error("CAS retry bound exhausted");
      },
    };
    const res = await upgradeBusinessToV2(restCas, { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "committed", `cutover ${res.status}`);
    eq(res.runs, 2, "the callback re-ran on the current value"); eq(retries, 1, "exactly one 412 retry"); eq(puts, 2, "two conditional PUTs");
    const rows = rowsOf(await readNode());
    eq(rows.length, 4, "the concurrent legacy row is present");
    expect(rows.some((r) => r.id === extra.id), "the late row survived the cutover");
    return "runs=2, one HTTP 412, 4 rows — concurrent legacy write preserved";
  });
  await run("V2-M05", "cutover", "NEGATIVE CONTROL: a read-then-write cutover loses the same write", async () => {
    await reseed();
    const extra = row(uuid("late2"), "2026-08-03", 888);
    const io = legacyIo("manager");
    const res = await unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL(io, {
      tenantId: "tenantA", bizId: "bizA",
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
    await attempt("valid", rowPath(uuid("new1")), { id: uuid("new1"), [GK]: GEN1, date: "2026-08-05", sales: 5 }, "allow");
    return "allow";
  });
  await run("V2-I02", "identity", "a top-level id that differs from the child key is denied", async () => {
    await attempt("mismatch", rowPath(uuid("new2")), { id: uuid("other"), [GK]: GEN1, date: "2026-08-05" }, "deny");
    return "deny";
  });
  await run("V2-I03", "identity", "a nested decoy id cannot satisfy identity", async () => {
    await attempt("meta.id", rowPath(uuid("new3")), { meta: { id: uuid("new3") }, [GK]: GEN1, date: "2026-08-05" }, "deny");
    await attempt("arbitrary nested id", rowPath(uuid("new4")), { row: { id: uuid("new4") }, [GK]: GEN1, date: "2026-08-05" }, "deny");
    return "deny, deny";
  });
  await run("V2-I04", "identity", "a malformed top-level id, and a non-canonical child key, are denied", async () => {
    await attempt("bad id", rowPath(uuid("new5")), { id: "not-a-uuid", [GK]: GEN1, date: "2026-08-05" }, "deny");
    await attempt("bad key", `${PATH()}/rows/row-1`, { id: "row-1", [GK]: GEN1, date: "2026-08-05" }, "deny");
    return "deny, deny";
  });
  await run("V2-I05", "identity", "duplicate immutable ids are UNREPRESENTABLE, not merely rejected", async () => {
    await reseed(); await seedV2();
    // Two children carrying one id: the second key's id cannot equal its own key.
    await attempt("two rows one id", `${PATH()}/rows`,
      { [uuid("d1")]: { id: uuid("d1"), [GK]: GEN1, date: "2026-08-01" },
        [uuid("d2")]: { id: uuid("d1"), [GK]: GEN1, date: "2026-08-02" } }, "deny");
    // And writing the same id twice simply addresses the same node — there is no second row.
    const id = uuid("same");
    await attempt("write id once", rowPath(id), { id, [GK]: GEN1, date: "2026-08-01", sales: 1 }, "allow");
    await attempt("write id again", rowPath(id), { id, [GK]: GEN1, date: "2026-08-02", sales: 2 }, "allow");
    const rows = rowsOf(await readNode());
    eq(rows.filter((r) => r.id === id).length, 1, "one id can only ever be one row");
    return "structurally impossible";
  });
  await run("V2-I06", "identity", "duplicate business DATES with distinct ids remain legal", async () => {
    await reseed(); await seedV2();
    const a = uuid("dd1"), b = uuid("dd2");
    await attempt("date twin A", rowPath(a), { id: a, [GK]: GEN1, date: "2026-09-09", sales: 1 }, "allow");
    await attempt("date twin B", rowPath(b), { id: b, [GK]: GEN1, date: "2026-09-09", sales: 2 }, "allow");
    eq(rowsOf(await readNode()).filter((r) => r.date === "2026-09-09").length, 2, "both twins stored");
    return "allow, allow";
  });
  await run("V2-I07", "identity", "free text is just text — `},{`, braces, quotes, newlines, Hebrew", async () => {
    await reseed(); await seedV2();
    const id = uuid("txt");
    await attempt("free text", rowPath(id), { id, [GK]: GEN1, date: "2026-08-07",
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
  const clearAll = (client) => client.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint(client.__seen) });
  await run("V2-G01", "generation", "clear-all retires the generation and removes every row", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(); A.__seen = rowsOf(await readNode());
    const res = await clearAll(A);
    eq(res.status, "committed", `clear-all ${res.status} ${res.reason || ""}`);
    const node = await readNode();
    eq(node.generation, GEN2, "generation advanced by exactly one");
    eq(res.generation, GEN2, "typed result names the new epoch"); eq(res.retiredGeneration, GEN1, "and the retired one");
    eq(node.rows, undefined, "no rows remain");
    eq(typeof node._v, "string", "frozen snapshot retained");
    return "advanced 1 -> 2";
  });
  await run("V2-G02", "generation", "a client from the retired generation cannot RESURRECT a row", async () => {
    const stale = await v2Client("owner", { generation: GEN1 }).attach();     // never saw the rotation
    const res = await stale.mutate(create(row(ID1, "2026-08-01", 101)));
    eq(res.status, "blocked", `a stale-generation create must not commit, got ${res.status}`);
    eq(res.reason, "rules_rejected", "the SERVER refused the retired epoch (this client still believed it was live)");
    eq((await readNode()).rows, undefined, "still empty");
    // …and the Rules engine, not just the client, is what refuses it.
    await attempt("raw stale-generation row", rowPath(ID1), { id: ID1, [GK]: GEN1, date: "2026-08-01" }, "deny");
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
      rows: { [ID1]: { id: ID1, [GK]: 99, date: "2026-08-01", sales: 1 } } });
    const read = V2.readEntriesNode(await readNode());
    expect(!!read.status, "must be a typed failure");
    eq(read.mode, "v2", "and it stays V2 — no legacy fallback");
    eq(read.reason, "row_generation_mismatch", "precise reason");
    expect(read.rows === undefined, "no rows are handed to the app");
    // A V2 node with the schema marker stripped is malformed, not legacy.
    await seedDb().ref(PATH()).set({ generation: GEN1, rows: { [ID1]: { id: ID1, [GK]: GEN1, date: "2026-08-01" } }, _v: "[]" });
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
    await attempt("manager -> other business", rowPath(uuid("x"), "bizB"), { id: uuid("x"), [GK]: GEN1, date: "2026-08-01" }, "deny", "manager");
    await attempt("viewer -> own business", rowPath(uuid("y")), { id: uuid("y"), [GK]: GEN1, date: "2026-08-01" }, "deny", "viewer");
    await attempt("unauthenticated", rowPath(uuid("z")), { id: uuid("z"), [GK]: GEN1, date: "2026-08-01" }, "deny", "unauth");
    await attempt("owner -> own business", rowPath(uuid("w")), { id: uuid("w"), [GK]: GEN1, date: "2026-08-01" }, "allow", "owner");
    eq(JSON.stringify(await readNode("bizB")), beforeB, "the other business is untouched");
    return "deny ×3, allow ×1";
  });

  // ══ HARDENING R1 — Codex SV2-01…SV2-09 ═══════════════════════════════════
  // A production-parity client: the REAL coordinator, REAL router, REAL V2 mutator and
  // the same listener → readEntriesNode → mode-ref → onListenerEcho wiring as index.html,
  // over a real SDK connection. Only the transport lambdas are the harness's.
  function parityClient(appKey, { tenantId = "tenantA", bizId = "bizA" } = {}) {
    const db = apps[appKey].database();
    const ctrl = ML.createSelectionController(); ctrl.invalidate(tenantId, bizId);
    const st = { mode: null, displayed: null, echoes: [], rowLane: 0, nodeLane: 0 };
    const v2 = V2.createV2EntriesMutator({ selection: ctrl, mode: () => st.mode,
      transactRow: async (t, key, rowId, fn) => { st.rowLane++; const r = await db.ref(`tenants/${t}/${key}/rows/${rowId}`).transaction(fn, undefined, false); return { committed: r.committed }; },
      transactNode: async (t, key, fn) => { st.nodeLane++; const r = await db.ref(`tenants/${t}/${key}`).transaction(fn, undefined, false); return { committed: r.committed }; } });
    const legacy = { mutate: async () => { throw new Error("legacy engine must not run for a V2/absent destination"); } };
    const router = V2.createEntriesStorageRouter({ mode: () => st.mode, legacy, v2 });
    const coord = ML.createEntriesWriteCoordinator({ selection: ctrl, canonicalize: ME.canonicalizeEntries, entryDateKey: ME.entryDateKey,
      fingerprint: (rows) => JSON.stringify(rows), contentFingerprint: ML.contentFingerprint,
      storageBinding: () => { const m = st.mode; return m ? { mode: m.mode, generation: m.generation === undefined ? null : m.generation } : undefined; },
      applyRows: (rows) => { st.displayed = rows; }, mutate: router.mutate });
    const ref = db.ref(`tenants/${tenantId}/biz:${bizId}:entries`);
    let handler = null;
    const client = { st, ctrl, coord, ref,
      attach() { return new Promise((res) => { let first = true;
        handler = ref.on("value", (snap) => {
          const ctx = ctrl.capture();
          if (!snap.exists()) {
            // index.html: subscribeNode skips a non-existent node; the read-only absent
            // probe then marks the destination absent (mode set only if still unknown).
            if (st.mode === null) st.mode = { mode: "absent", generation: null };
            coord.markHydrated(ctx, []);
          } else {
            const read = V2.readEntriesNode(snap.val());
            if (read.status) { st.mode = { mode: "malformed", reason: read.reason || read.status }; coord.onListenerError(ctx); }
            else { st.mode = { mode: read.mode, generation: read.generation === undefined ? null : read.generation };
                   st.echoes.push(coord.onListenerEcho(read.rows, ctx).status); }
          }
          if (first) { first = false; res(client); }
        }); }); },
      detach() { if (handler) { ref.off("value", handler); handler = null; } return client; },
      displayedSales: (id) => { const r = (st.displayed || []).find((x) => x.id === id); return r ? r.sales : undefined; },
      until: (pred, ms = 3000) => new Promise((res, rej) => { const t0 = Date.now(); (function tick() {
        if (pred()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout waiting for convergence")); setTimeout(tick, 10); })(); }),
    };
    LIVE.push(client);
    return client;
  }

  await run("V2-H01", "cutover-permanence", "once a business is V2 it can never be deleted, downgraded or re-created as legacy (Rules)", async () => {
    await reseed(); await seedV2();
    const before = JSON.stringify(await readNode());
    for (const who of ["manager", "owner"]) {
      await attempt(`${who} whole-node delete`, PATH(), null, "deny", who);
      await attempt(`${who} legacy re-create`, PATH(), envelope([row(uuid("re"), "2026-01-01", 1)]), "deny", who);
      await attempt(`${who} schema marker delete`, `${PATH()}/schemaVersion`, null, "deny", who);
      await attempt(`${who} schema downgrade`, `${PATH()}/schemaVersion`, 1, "deny", who);
      await attempt(`${who} envelope without marker`, PATH(), { generation: GEN1, rows: (await readNode()).rows }, "deny", who);
    }
    let removed = "allow"; try { await apps.owner.database().ref(PATH()).remove(); } catch (e) { removed = denied(e) ? "deny" : "error"; }
    eq(removed, "deny", "SDK remove() is denied too");
    eq(JSON.stringify(await readNode()), before, "the node is byte-intact");
    // The guard is scoped to converted businesses: a legacy node keeps its legacy behaviour.
    await attempt("legacy node delete (pre-cutover behaviour unchanged)", PATH("bizB"), null, "allow", "owner");
    return "deny ×11, legacy scope unchanged";
  });
  await run("V2-H02", "generation", "the epoch is strictly monotonic: +1 only, only when rows are gone, never back (Rules)", async () => {
    await reseed(); await seedV2();
    const v = (await readNode())._v;
    const rowsAt = (g) => { const m = {}; LEGACY_ROWS().forEach((r) => { m[r.id] = { ...r, [GK]: g }; }); return m; };
    await attempt("generation-only advance while rows exist", `${PATH()}/generation`, 2, "deny");
    await attempt("node rotation while rows exist", PATH(), { schemaVersion: 2, generation: 2, rows: rowsAt(2), _v: v }, "deny");
    await attempt("node rotation that re-stamps rows", PATH(), { schemaVersion: 2, generation: 2, rows: rowsAt(1), _v: v }, "deny");
    await attempt("skip an epoch", PATH(), { schemaVersion: 2, generation: 3, _v: v }, "deny");
    await attempt("clear-all shape: rows gone, +1", PATH(), { schemaVersion: 2, generation: 2, _v: v }, "allow");
    await attempt("roll back", PATH(), { schemaVersion: 2, generation: 1, _v: v }, "deny");
    await attempt("roll back the child", `${PATH()}/generation`, 1, "deny");
    await attempt("same epoch is a no-op", `${PATH()}/generation`, 2, "allow");
    await attempt("advance the child on an empty collection", `${PATH()}/generation`, 3, "allow");
    await attempt("a retired-epoch row", rowPath(uuid("old")), { id: uuid("old"), [GK]: 2, date: "2026-08-01" }, "deny");
    await attempt("a live-epoch row", rowPath(uuid("new")), { id: uuid("new"), [GK]: 3, date: "2026-08-01" }, "allow");
    await attempt("a non-integer-looking epoch type", `${PATH()}/generation`, "4", "deny");
    await attempt("initialise a new business at epoch 5", PATH("bizC"), { schemaVersion: 2, generation: 5 }, "deny", "owner");
    await attempt("initialise a new business at the first epoch", PATH("bizC"), { schemaVersion: 2, generation: 1 }, "allow", "owner");
    await seedDb().ref(PATH("bizD")).set(envelope(LEGACY_ROWS()));
    await attempt("convert a legacy business at epoch 2", PATH("bizD"), { schemaVersion: 2, generation: 2, rows: rowsAt(2), _v: v }, "deny", "owner");
    await attempt("convert a legacy business at epoch 1", PATH("bizD"), { schemaVersion: 2, generation: 1, rows: rowsAt(1), _v: v }, "allow", "owner");
    return "deny ×10, allow ×6";
  });
  await run("V2-H03", "rows-map", "the row map cannot be replaced by a scalar (Rules)", async () => {
    await reseed(); await seedV2();
    const before = JSON.stringify((await readNode()).rows);
    await attempt("string rows", `${PATH()}/rows`, "corrupt", "deny");
    await attempt("number rows", `${PATH()}/rows`, 7, "deny");
    await attempt("boolean rows", `${PATH()}/rows`, true, "deny");
    await attempt("node-level scalar rows", PATH(), { schemaVersion: 2, generation: 1, rows: "corrupt", _v: (await readNode())._v }, "deny");
    eq(JSON.stringify((await readNode()).rows), before, "rows untouched");
    return "deny ×4";
  });
  await run("V2-H04", "generation", "clear-all derives the next epoch itself; an empty collection still rotates; no caller value is accepted", async () => {
    await reseed(); await seedV2(GEN1, []);
    const A = await v2Client("manager").attach(); A.__seen = [];
    const chosen = await A.mutate({ type: "clear_all", expectedNodeFingerprint: ML.contentFingerprint([]), nextGeneration: 9 });
    eq(chosen.status, "blocked", "caller-chosen epoch"); eq(chosen.reason, "next_generation_not_callable", "typed refusal");
    eq((await readNode()).generation, GEN1, "nothing changed");
    const res = await clearAll(A);
    eq(res.status, "committed", `empty clear ${res.status}/${res.reason || ""}`);
    eq((await readNode()).generation, GEN2, "an EMPTY clear still retires the epoch");
    // Work prepared under the retired epoch is refused whether or not this client has
    // since observed the rotation.
    const prepared = A.binding();                              // epoch 1, captured before the clear
    A.setGeneration(GEN2);                                     // this client hydrated the rotation
    const seen = await A.mutate(create(row(ID1, "2026-08-01", 101)), prepared);
    eq(seen.status, "blocked", "refused"); eq(seen.reason, "generation_retired", "typed: the epoch it was formed under is gone");
    const B = await v2Client("owner", { generation: GEN1 }).attach();      // never observed the rotation
    const unseen = await B.mutate(create(row(ID1, "2026-08-01", 101)));
    eq(unseen.status, "blocked", "refused"); eq(unseen.reason, "rules_rejected", "by the server");
    eq((await readNode()).rows, undefined, "no row was resurrected");
    return "rotated 1 -> 2 on empty; retired work refused client-side and server-side";
  });
  await run("V2-H05", "generation", "a live listener does NOT restamp an old intent with the new epoch", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach(), B = await v2Client("owner").attach();
    A.__seen = rowsOf(await readNode());
    const formedUnder = B.binding();                           // B's intent is formed under epoch 1
    const staleIntent = create(row(ID1, "2026-08-01", 101));
    eq((await clearAll(A)).status, "committed", "A clears");
    await new Promise((res) => { const h = (snap) => { if (snap.val().generation === GEN2) { B.ref.off("value", h); res(); } }; B.ref.on("value", h); });
    B.setGeneration(GEN2);                                     // B hydrated the rotation (index.html: listener updates the mode ref)
    const res = await B.mutate(staleIntent, formedUnder);
    eq(res.status, "blocked", `old intent ${res.status}`); eq(res.reason, "generation_retired", "bound to the epoch it was formed under");
    eq((await readNode()).rows, undefined, "the cleared row did not come back");
    const fresh = await B.mutate(create(row(ID1, "2026-08-01", 101)));   // a NEW intent under epoch 2 is fine
    eq(fresh.status, "committed", "new work under the live epoch");
    return "old intent refused, new intent accepted";
  });
  await run("V2-H06", "listener-authority", "after a row commit the coordinator converges on the authoritative listener value", async () => {
    await reseed(); await seedV2();
    const A = await parityClient("manager").attach();
    eq(A.displayedSales(ID1), 101, "hydrated");
    const r1 = await A.coord.submitIntent(upsert(ID1, { sales: 555 }, { sales: 101 }));
    eq(r1.status, "committed", `edit ${r1.status}/${r1.reason || ""}`);
    eq((await readNode()).rows[ID1].sales, 555, "database");
    await A.until(() => A.displayedSales(ID1) === 555);
    eq(A.coord._state().deferredPending, false, "no authoritative echo is left parked");
    eq(A.st.rowLane, 1, "row lane"); eq(A.st.nodeLane, 0, "no collection-scoped write");
    // Two queued edits: the echo parked during the first is superseded, never lost.
    const [r2, r3] = await Promise.all([
      A.coord.submitIntent(upsert(ID2, { sales: 2222 }, { sales: 202 })),
      A.coord.submitIntent(upsert(ID3, { sales: 3333 }, { sales: 303 })),
    ]);
    eq(r2.status, "committed", "second"); eq(r3.status, "committed", "third");
    await A.until(() => A.displayedSales(ID2) === 2222 && A.displayedSales(ID3) === 3333);
    // A foreign write during our own write is visible afterwards too.
    const B = await v2Client("owner").attach();
    const [ours, theirs] = await Promise.all([
      A.coord.submitIntent(upsert(ID1, { sales: 556 }, { sales: 555 })),
      B.mutate(upsert(ID2, { sales: 2223 }, { sales: 2222 })),
    ]);
    eq(ours.status, "committed", "ours"); eq(theirs.status, "committed", "theirs");
    await A.until(() => A.displayedSales(ID1) === 556 && A.displayedSales(ID2) === 2223);
    // A delete and a clear-all converge the same way.
    const seen = (A.st.displayed || []).find((r) => r.id === ID3);
    eq((await A.coord.submitIntent(buildDelete(seen))).status, "committed", "delete");
    await A.until(() => A.displayedSales(ID3) === undefined && (A.st.displayed || []).length === 2);
    eq(JSON.stringify(A.coord.rawSnapshot()), JSON.stringify(A.st.displayed), "the raw snapshot the clear-all fingerprints IS what is displayed");
    const rc = await A.coord.submitClearAll({ expectedNodeFingerprint: A.coord.currentFingerprint(), confirmToken: "tok" });
    eq(rc.status, "committed", `clear ${rc.status}/${rc.reason || ""}`); eq(rc.generation, GEN2, "typed epoch");
    await A.until(() => (A.st.displayed || []).length === 0);
    eq(A.st.mode.generation, GEN2, "the mode ref followed the listener");
    return `displayed converged after edit, queued edits, foreign write, delete and clear-all`;
  });
  await run("V2-H07", "bootstrap", "an absent business initialises straight into V2 on its first create, then uses the row lane", async () => {
    await reseed(); await seedDb().ref(PATH()).remove();
    const A = await parityClient("manager").attach();
    eq(A.st.mode.mode, "absent", "absent destination"); expect(A.coord.isReady(), "ready for a create");
    const NEW = uuid("first");
    const r1 = await A.coord.submitIntent(create({ ...EMPTY_ENTRY, id: NEW, date: "2026-09-01", sales: 10 }));
    eq(r1.status, "committed", `first create ${r1.status}/${r1.reason || ""}`); eq(r1.generation, 1, "first epoch");
    const node = await readNode();
    eq(node.schemaVersion, 2, "V2, never legacy"); eq(node.generation, 1, "epoch 1"); eq(node._v, undefined, "no legacy blob was ever written");
    eq(node.rows[NEW][GK], 1, "row stamped"); eq(node.rows[NEW].id, NEW, "row keyed by id");
    await A.until(() => A.st.mode.mode === "v2" && A.displayedSales(NEW) === 10);
    eq(A.st.nodeLane, 1, "one node-level initialisation");
    const NEW2 = uuid("second");
    const r2 = await A.coord.submitIntent(create(row(NEW2, "2026-09-02", 20)));
    eq(r2.status, "committed", "second create"); eq(A.st.rowLane, 1, "…through the row lane");
    await A.until(() => A.displayedSales(NEW2) === 20);
    const again = await A.coord.submitIntent(create({ ...EMPTY_ENTRY, id: NEW, date: "2026-09-01", sales: 10 }));
    eq(again.status, "committed_idempotent", `identical first save repeated: ${again.status}/${again.reason || ""}`); eq(again.reason, "already_created", "typed");
    // Two absent clients racing: exactly one initialises; the other is refused typed and
    // succeeds once it has hydrated the new node.
    await seedDb().ref(PATH("bizB")).remove();
    const X = await parityClient("owner", { bizId: "bizB" }).attach(), Y = await parityClient("owner#2", { bizId: "bizB" }).attach();
    const [rx, ry] = await Promise.all([
      X.coord.submitIntent(create(row(uuid("x"), "2026-09-03", 1))),
      Y.coord.submitIntent(create(row(uuid("y"), "2026-09-03", 2))),
    ]);
    const outcomes = [rx.status, ry.status].sort().join(",");
    expect(outcomes === "committed,committed" || outcomes === "committed,conflict", `race outcomes ${outcomes}`);
    if (outcomes === "committed,conflict") {
      const loser = rx.status === "conflict" ? { c: X, id: uuid("x"), s: 1 } : { c: Y, id: uuid("y"), s: 2 };
      eq((rx.status === "conflict" ? rx : ry).detail, "storage_initialised_concurrently", "typed refusal");
      await loser.c.until(() => loser.c.st.mode.mode === "v2");
      eq((await loser.c.coord.submitIntent(create(row(loser.id, "2026-09-03", loser.s)))).status, "committed", "retry after hydration");
    }
    eq(rowsOf(await readNode("bizB")).length, 2, "both rows exist, one node initialisation");
    eq((await readNode("bizB")).generation, 1, "epoch 1");
    return `initialised V2 directly; race: ${outcomes}`;
  });
  await run("V2-H08", "cutover", "conversion preserves every domain field (a legacy `gen` included) and reports its canonicalization", async () => {
    await reseed();
    const odd = row(ID1, "2026-08-01", 1, { gen: "legacy-domain-value", nullable: null, supplier_payments: {}, hourly_payroll: {}, list: [], notes: "" });
    await seedDb().ref(PATH()).set(envelope([odd, row(ID2, "2026-08-02", 2)]));
    const rep = preflightLegacyNode(await readNode());
    expect(rep.ok, `preflight ${JSON.stringify(rep.blockers)}`);
    eq(rep.normalization.rowsAffected, 1, "one row is canonicalized");
    eq(rep.normalization.rows[0].paths.join(","), "nullable,supplier_payments,hourly_payroll,list", "exactly the values RTDB cannot hold");
    const res = await upgradeBusinessToV2(legacyIo("manager"), { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "committed", `cutover ${res.status}`);
    const node = await readNode(), stored = node.rows[ID1];
    eq(stored.gen, "legacy-domain-value", "the domain field survives under its own name");
    eq(stored[GK], 1, "the epoch stamp lives under the reserved key");
    eq(stored.notes, "", "an empty string is a value, and is kept");
    const sem = rowsOf(node).find((r) => r.id === ID1);
    eq(sem.gen, "legacy-domain-value", "…and is read back"); eq(sem[GK], undefined, "the stamp is stripped from the semantic row");
    eq(sem.nullable, undefined, "canonicalized away, as reported"); eq(sem.supplier_payments, undefined, "canonicalized away, as reported");
    // Representation blockers: nothing unreviewed can pass.
    const blocked = (rows) => preflightLegacyNode(envelope(rows)).blockers.map((b) => b.code).join(",");
    eq(blocked([row(ID1, "2026-08-01", 1, { [GK]: 5 })]), "reserved_field_present", "a row already carrying the reserved key");
    eq(blocked([row(ID1, "2026-08-01", 1, { "a.b": 1 })]), "unrepresentable_field_key", "a key RTDB cannot hold");
    eq(blocked([row(ID1, "2026-08-01", 1, { arr: [1, null, 3] })]), "unrepresentable_value", "a value RTDB would alter");
    return "gen preserved; canonicalization reported; 3 representation blockers";
  });
  await run("V2-H09", "idempotency", "an exact create retry with the real UI template is idempotent; a changed retry is a collision", async () => {
    await reseed(); await seedV2();
    const A = await v2Client("manager").attach();
    const NEW = uuid("tpl");
    const intent = create({ ...EMPTY_ENTRY, id: NEW, date: "2026-08-09", sales: 5 });
    const r1 = await A.mutate(intent);
    eq(r1.status, "committed", `create ${r1.status}/${r1.reason || ""}`);
    eq((await readNode()).rows[NEW].supplier_payments, undefined, "RTDB holds no empty map");
    const r2 = await A.mutate(intent);
    eq(r2.status, "committed_idempotent", `replay ${r2.status}/${r2.reason || ""}`); eq(r2.reason, "already_created", "typed");
    const r3 = await A.mutate(create({ ...EMPTY_ENTRY, id: NEW, date: "2026-08-09", sales: 6 }));
    eq(r3.status, "blocked", "changed replay"); eq(r3.detail, "id_collision", "still a collision");
    eq((await readNode()).rows[NEW].sales, 5, "first value stands");
    return "committed → already_created → id_collision";
  });
  await run("V2-H10", "compatibility", "the legacy engine REFUSES a V2 node — no false success against the frozen `_v`", async () => {
    await reseed(); await seedV2();
    const before = JSON.stringify(await readNode());
    const ctrl = ML.createSelectionController(); ctrl.invalidate("tenantA", "bizA");
    const m = ML.createRemoteEntriesMutator({ selection: ctrl, transact: async (t, k, fn) => {
      const r = await apps.manager.database().ref(`tenants/${t}/${k}`).transaction(fn, undefined, false);
      return { committed: r.committed, snapshot: r.snapshot }; } });
    const lref = apps.manager.database().ref(PATH());
    await new Promise((r) => { let first = true; lref.on("value", () => { if (first) { first = false; r(); } }); });
    const same = await m.mutate(upsert(ID1, { sales: 101 }, { sales: 101 }), ctrl.capture());   // equals the frozen snapshot
    const diff = await m.mutate(upsert(ID1, { sales: 999 }, { sales: 101 }), ctrl.capture());
    lref.off("value");
    eq(same.status, "blocked", `no-op-looking write ${same.status}`); eq(same.reason, "storage_mode_mismatch", "typed refusal, not idempotent success");
    eq(diff.status, "blocked", `changed write ${diff.status}`); eq(diff.reason, "storage_mode_mismatch", "typed refusal");
    eq(JSON.stringify(await readNode()), before, "node untouched");
    return "blocked/storage_mode_mismatch ×2";
  });

  // ─── report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 8)} ${w("area", 14)} ${w("status", 6)} ${w("ms", 6)} notes`);
  console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 14)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.notes}`);
  const EXPECTED = 42;
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
