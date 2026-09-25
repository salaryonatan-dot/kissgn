// Marjin — P0-DATA-01 VERSION FENCE, proven against a REAL local Firebase RTDB emulator.
//
// The fence is server truth: a per-business, server-owned policy record at
// /storage_v2_control/{tenantId}/{bizId} (never client-writable) composed into the
// entries `.write` granting branch (FENCE_GUARD). Old clients — every pre-V2 build,
// whose entries lane can only produce a legacy `{_v}` result — are denied on quiesced,
// held and V2 businesses because they cannot produce a V2-shaped result; a compatible
// client succeeds under v2_active; no client can initialise V2 without explicit
// activation; a malformed present record denies everything; the frozen `_v` cannot be
// changed or deleted; nothing here trusts a version label.
//
// Actors: ordinary-auth SDK apps (owner / manager / viewer / outsider). Admin ("seed")
// only for fixtures and as the explicit control-plane / bypass negative control.
// Old client = the legacy transport shapes of every pre-V2 build: whole-node
// `set({_v})`, node CAS returning `{_v}` (the production legacy engine
// `createRemoteEntriesMutator`, unchanged since R10), child set/remove, multipath update.
// Compatible client = the ACTUAL dashboard blocks of index.html over the real SDK
// (test/support/dashboard-wiring-harness.mjs).
//
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { createLegacyPreflight } from "../../tools/storage-v2/preflight.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";
import { createStoragePolicyControl } from "../../tools/storage-v2/policy.mjs";
import { createDashboard, makeSdkStorage, loadProductionWindow } from "../support/dashboard-wiring-harness.mjs";
import { gitIn } from "../support/git-context.mjs";
import { authorizedVersionFenceRulesDelta } from "../support/rules-authorized-delta.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const CORE_SHA = "47f7f8882846b4b0c90fba2947ca3053eb90a9f0";   // parent of the fence candidate (pre-fence Rules for negative controls)
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
  if (process.env.FIREBASE_DATABASE_URL) { const u = String(process.env.FIREBASE_DATABASE_URL); if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`); }
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
  const rules = JSON.parse(b.toString());
  if (!rules?.rules?.storage_v2_control) fail("rules have no storage_v2_control root — the contract under test is absent");
}
const CANONICAL_RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed: " + res.status + " " + (await res.text()));
}

// ─── production client contract (vm) + conversion core + control plane ───────
const W = loadProductionWindow();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2, SP = W.MarjinStoragePolicy;
const { preflightLegacyNode } = createLegacyPreflight({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId, isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r), entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS });
const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST });
const GK = V2.ROW_GEN_KEY;

// ─── ids / fixtures ──────────────────────────────────────────────────────────
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = uuid("r1"), ID2 = uuid("r2"), ID3 = uuid("r3");
const row = (id, date, sales, extra = {}) => ({ id, date, sales, deliveries: 0, other_income: 0, ...extra });
const LEGACY_ROWS = () => [row(ID1, "2026-08-01", 101), row(ID2, "2026-08-02", 202)];
const envelope = (rows) => ({ _v: JSON.stringify(rows) });
const v2node = (gen, rows, withV = true) => { const m = {}; rows.forEach((r) => { m[r.id] = { ...r, [GK]: gen }; }); const n = { schemaVersion: 2, generation: gen }; if (rows.length) n.rows = m; if (withV) n._v = JSON.stringify(rows); return n; };
const PATH = (biz = "bizA", tenant = "tenantA") => `tenants/${tenant}/biz:${biz}:entries`;
const CTRL = (biz = "bizA", tenant = "tenantA") => `storage_v2_control/${tenant}/${biz}`;
const POL = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const ACTIVE = (over = {}) => POL({ phase: "v2_active", minStorageProtocol: 2, ...over });
const QUIESCED = (over = {}) => POL({ phase: "quiesced", operation: { id: "op-1", kind: "cutover", owner: "operator", startedAt: 1 }, ...over });
const HOLD = (over = {}) => POL({ phase: "recovery_hold", minStorageProtocol: 2, operation: { id: "rec-1", kind: "recovery", owner: "operator", startedAt: 1 }, ...over });

const IDS = { owner: { uid: "u_owner", token: { email: "o@demo.example" } }, manager: { uid: "u_manager", token: { email: "m@demo.example" } },
              viewer: { uid: "u_viewer", token: { email: "v@demo.example" } }, outsider: { uid: "u_outsider", token: { email: "x@demo.example" } }, unauth: null };
const apps = {};
function initApps() {
  apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  for (const [k, o] of Object.entries(IDS)) apps[k] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: o }, `id_${k}`);
}
const seedDb = () => apps.__seed.database();
const fixtures = () => ({ tenants: { tenantA: {
  members: { u_owner: true, u_manager: true, u_viewer: true }, roles: { u_owner: "owner", u_manager: "manager", u_viewer: "viewer" },
  biz_access: { bizA: { u_manager: true, u_viewer: true }, bizB: { u_manager: true, u_viewer: true } },
  "biz:bizA:entries": envelope(LEGACY_ROWS()), "biz:bizB:entries": envelope([row(uuid("b1"), "2026-03-01", 9)]),
}, tenantB: { members: { u_outsider: true }, roles: { u_outsider: "owner" }, "biz:bizA:entries": envelope([row(uuid("t2"), "2026-01-01", 1)]) } } });
const LIVE = [];
function detachAll() { while (LIVE.length) { try { LIVE.pop().detach(); } catch (_) {} } }
async function reseed({ entries, policy } = {}) {
  detachAll();
  const f = fixtures();
  if (entries !== undefined) { if (entries === null) delete f.tenants.tenantA["biz:bizA:entries"]; else f.tenants.tenantA["biz:bizA:entries"] = entries; }
  if (policy) f.storage_v2_control = { tenantA: { bizA: policy } };
  await seedDb().ref("/").set(f);
}
const setPolicy = (rec, biz = "bizA") => seedDb().ref(CTRL(biz)).set(rec);
const readNode = async (biz = "bizA", tenant = "tenantA") => { const s = await seedDb().ref(PATH(biz, tenant)).once("value"); return s.exists() ? s.val() : null; };
const snapshot = async (biz = "bizA") => JSON.stringify(await readNode(biz));
const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));
// the legacy engine surfaces a server denial as {status:"failed", error:"PERMISSION_DENIED…"}; on a V2 node
// the CURRENT build's legacy engine refuses locally (storage_mode_mismatch) — the raw shapes below are the
// genuine pre-V2 transport and are what the old-client proofs rely on.
const engineDenied = (r) => r && r.status === "failed" && /permission/i.test(String(r.error || ""));
const engineRefused = (r) => engineDenied(r) || (r && r.status === "blocked" && r.reason === "storage_mode_mismatch");
const dbOf = (k) => apps[k].database();

// ─── old client: the legacy transport shapes ─────────────────────────────────
// (a) production legacy engine — node CAS returning `{_v}` (R10 build shape, unchanged code)
// An old page always holds a live `value` listener on its business node (that is how it
// hydrates), so the legacy engine's transaction runs against a warm cache — as in production.
async function oldEngine(appKey) {
  const ctrl = ML.createSelectionController(); ctrl.invalidate("tenantA", "bizA");
  const lref = dbOf(appKey).ref(PATH());
  await new Promise((res) => { const h = lref.on("value", () => res()); LIVE.push({ detach: () => lref.off("value", h) }); });
  const m = ML.createRemoteEntriesMutator({ selection: ctrl, transact: async (t, k, fn) => { const r = await dbOf(appKey).ref(`tenants/${t}/${k}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; } });
  return { edit: (id, sales, base) => m.mutate({ type: "upsert_entry", target: { id }, patch: { fields: { sales } }, base: { fields: { sales: base } } }, ctrl.capture()) };
}
// (b) raw legacy writes of even older builds and of direct authorized callers
const oldWrites = (appKey, biz = "bizA") => {
  const r = dbOf(appKey).ref(PATH(biz));
  return {
    "whole-node set {_v}": () => r.set(envelope([row(ID1, "2026-08-01", 999)])),
    "node CAS returning {_v}": () => r.transaction((cur) => envelope([row(ID1, "2026-08-01", 998)]), undefined, false),
    "child set _v": () => r.child("_v").set(JSON.stringify([row(ID1, "2026-08-01", 997)])),
    "child remove _v": () => r.child("_v").remove(),
    "whole-node remove": () => r.remove(),
    "multipath update": () => dbOf(appKey).ref("/").update({ [`${PATH(biz)}/_v`]: JSON.stringify([row(ID1, "2026-08-01", 996)]) }),
  };
};
// each attempt must be DENIED and the node must be byte-identical afterwards
async function expectAllDenied(attempts, biz = "bizA", label = "") {
  const before = await snapshot(biz);
  const outcome = [];
  for (const [name, fn] of Object.entries(attempts)) {
    let res = null, err = null;
    try { res = await fn(); } catch (e) { err = e; }
    if (res && typeof res === "object" && res.committed === false) { outcome.push(`${name}:aborted`); }
    else if (err && denied(err)) outcome.push(`${name}:denied`);
    else throw new Error(`${label} ${name}: NOT denied (${err ? err.message : JSON.stringify(res && res.status || res)})`);
    const after = await snapshot(biz);
    if (after !== before) throw new Error(`${label} ${name}: node mutated`);
  }
  return outcome.join(", ");
}

// ─── compatible client: the real dashboard blocks over the real SDK ──────────
function dashboard(appKey, { bizId = "bizA" } = {}) {
  const storage = makeSdkStorage(dbOf(appKey), "tenantA");
  const d = createDashboard({ storage, tenantId: "tenantA", bizId, W: loadProductionWindow() });
  LIVE.push({ detach: () => { try { d.selectBusiness("__detached__"); } catch (_) {} } });
  d.until = (pred, ms = 4000) => new Promise((res, rej) => { const t0 = Date.now(); (function tick() { if (pred()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout waiting for dashboard state")); setTimeout(tick, 10); })(); });
  d.select = async (b) => { d.selectBusiness(b); await d.until(() => d.mode() !== null && d.policyUi() !== null && d.policyUi().state !== "policy_unresolved" && d.policyUi().state !== "storage_unresolved"); };
  return d;
}
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });

// control plane over the Admin SDK (the ONLY writer of the control record)
const controlIo = {
  readControl: async (t, b) => { const s = await seedDb().ref(CTRL(b, t)).once("value"); return s.exists() ? s.val() : null; },
  transactControl: async (t, b, fn) => { const r = await seedDb().ref(CTRL(b, t)).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; },
  readEntriesNode: (t, b) => readNode(b, t),
};
const adminEntriesIo = { transactNode: async (t, key, fn) => { const r = await seedDb().ref(`tenants/${t}/${key}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; } };

// ─── runner ──────────────────────────────────────────────────────────────────
const results = []; let failures = 0;
async function run(id, area, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, area, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, area, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
  finally { detachAll(); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const rejectsDenied = async (fn, m) => { let e = null; try { await fn(); } catch (x) { e = x; } if (!e || !denied(e)) throw new Error(m + ": not denied" + (e ? " (" + e.message + ")" : " (succeeded)")); };

async function main() {
  assertSafe(); initApps();
  const coreRules = JSON.parse(gitIn(ROOT, ["show", `${CORE_SHA}:database.rules.json`]).stdout);
  if (authorizedVersionFenceRulesDelta(coreRules, CANONICAL_RULES).ok !== true) fail("live rules are not core + exact fence delta");

  // ══ VF-01 / VF-02 — legacy businesses keep working (no record; explicit legacy record) ══
  await run("VF-01", "legacy", "old client → business with NO control record: legacy CAS write allowed (and again under an explicit valid legacy record)", async () => {
    await reseed();
    let res = await (await oldEngine("manager")).edit(ID1, 555, 101); eq(res.status, "committed", "no record: " + res.status + "/" + (res.reason || ""));
    eq(JSON.parse((await readNode())._v).find((r) => r.id === ID1).sales, 555, "applied");
    await setPolicy(POL()); res = await (await oldEngine("owner")).edit(ID1, 556, 555); eq(res.status, "committed", "legacy record: " + res.status);
    const v = await (await oldEngine("viewer")).edit(ID1, 1, 556); expect(engineDenied(v), "viewer still cannot write (roles unchanged): " + v.status);
    eq(JSON.parse((await readNode())._v).find((r) => r.id === ID1).sales, 556, "viewer attempt changed nothing");
    return "manager + owner legacy CAS committed; viewer denied";
  });
  await run("VF-02", "legacy", "compatible client → legacy business (no record): legacy engine, write allowed, no banner", async () => {
    await reseed();
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.mode().mode, "legacy", "mode"); eq(d.policyUi().state, "legacy", "policy state"); eq(SP.describePolicyState(d.policyUi()), null, "no banner");
    const r = await d.coord().submitIntent(upsert(ID1, { sales: 777 }, { sales: 101 })); eq(r.status, "committed", "legacy write " + r.status);
    eq(JSON.parse((await readNode())._v).find((x) => x.id === ID1).sales, 777, "applied");
    return "legacy engine committed under the fence";
  });

  // ══ VF-03 — quiesced denies every old-client shape ═══════════════════════════
  await run("VF-03", "quiesced", "old client → quiesced: whole-node set/CAS, child set/remove, whole-node remove, multipath — ALL denied, node byte-identical", async () => {
    await reseed({ policy: QUIESCED() });
    const eng = await (await oldEngine("owner")).edit(ID1, 1, 101); expect(engineDenied(eng), "legacy engine denied by the server: " + eng.status + "/" + (eng.error || ""));
    const notes = await expectAllDenied(oldWrites("owner"), "bizA", "quiesced/owner");
    await expectAllDenied(oldWrites("manager"), "bizA", "quiesced/manager");
    return notes;
  });

  // ══ VF-04 — v2_active denies every old-client shape incl. frozen _v delete ══
  await run("VF-04", "v2-old-client", "old client → v2_active business: legacy overwrite, _v change/delete, whole-node delete, multipath — ALL denied", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE() });
    const eng = await (await oldEngine("owner")).edit(ID1, 1, 101); expect(engineRefused(eng), "legacy engine refused: " + eng.status + "/" + (eng.reason || eng.error || ""));
    const notes = await expectAllDenied(oldWrites("owner"), "bizA", "active/owner");
    const nv = await readNode(); eq(typeof nv._v, "string", "frozen _v survives");
    return notes;
  });

  // ══ VF-05 — compatible client on v2_active: create / edit / delete / clear ══
  await run("VF-05", "v2-current", "compatible client → v2_active: create, edit, delete, clear-all commit through the REAL wiring; frozen _v survives; epoch rotates", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE() });
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.mode().mode, "v2", "mode"); eq(d.policyUi().state, "v2", "state");
    eq((await d.coord().submitIntent(create(row(ID3, "2026-08-03", 303)))).status, "committed", "create");
    eq((await d.coord().submitIntent(upsert(ID1, { sales: 111 }, { sales: 101 }))).status, "committed", "edit");
    eq((await d.coord().submitIntent(d.ML.buildEntryDeleteIntent(d.displayed().find((x) => x.id === ID2), {}))).status, "committed", "delete");
    let n = await readNode(); eq(n.rows[ID1].sales, 111, "edit applied"); eq(n.rows[ID3].sales, 303, "create applied"); eq(n.rows[ID2], undefined, "delete applied"); eq(typeof n._v, "string", "frozen _v kept");
    await d.until(() => d.displayed().length === 2);
    const c = await d.clearAll(); eq(c.status, "committed", "clear " + c.status + "/" + (c.reason || ""));
    n = await readNode(); eq(n.generation, 2, "epoch rotated"); eq(n.rows, undefined, "rows gone"); eq(typeof n._v, "string", "frozen _v kept through clear");
    return "create/edit/delete/clear committed; gen 2; _v frozen";
  });

  // ══ VF-06 — spoofed metadata cannot bypass ══════════════════════════════════
  await run("VF-06", "spoof", "spoofed version/protocol/release metadata cannot authorize: V2 shape on legacy phase denied, on quiesced denied; positive twin under v2_active allowed", async () => {
    await reseed();   // no record → legacy phase
    const spoofNode = { ...v2node(1, LEGACY_ROWS()), clientVersion: "9.9.9", storageProtocol: 2, releaseId: "spoof", capability: "v2" };
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(spoofNode), "V2-shaped result with spoof metadata on a legacy business (populated legacy → V2 conversion by a client)");
    await reseed({ entries: null });
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(spoofNode), "V2 initialization on an absent business without activation, spoof metadata");
    await reseed({ entries: null, policy: QUIESCED() });
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(spoofNode), "quiesced");
    // positive twin: the SAME V2 write on an activated absent business is allowed — shape × phase decide, not labels
    await reseed({ entries: null, policy: ACTIVE({ allowV2Initialization: true }) });
    await dbOf("owner").ref(PATH()).set(v2node(1, LEGACY_ROWS(), false));
    eq((await readNode()).schemaVersion, 2, "positive twin committed");
    return "spoof denied ×3; identical V2 write allowed only under v2_active+init";
  });

  // ══ VF-07 — stale generation + capable client ═══════════════════════════════
  await run("VF-07", "generation", "retired generation with an otherwise capable client: client refuses before any transaction; forced raw row write with the old epoch is denied by Rules", async () => {
    await reseed({ entries: v2node(2, LEGACY_ROWS()), policy: ACTIVE() });
    const d = dashboard("manager"); await d.select("bizA");
    const stale = { mode: "v2", generation: 1, policyRevision: 1 };
    const r = await d.refs.router.current.mutate(upsert(ID1, { sales: 5 }, { sales: 101 }), d.ctx(), stale);
    eq(r.status, "blocked", "engine"); eq(r.reason, "generation_retired", "reason");
    await rejectsDenied(() => dbOf("manager").ref(PATH() + "/rows/" + ID1).set({ ...row(ID1, "2026-08-01", 5), [GK]: 1 }), "row with _gen 1 under generation 2");
    return "generation_retired before transaction; raw old-epoch row denied";
  });

  // ══ VF-08 — business switch isolation ═══════════════════════════════════════
  await run("VF-08", "switch", "business switch: A v2_active / B quiesced — B refuses with its own state; A's later policy change never touches B; A's binding is stale for B", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE({ policyRevision: 9 }) });
    await seedDb().ref(CTRL("bizB")).set(QUIESCED({ policyRevision: 4 }));
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.policyUi().state, "v2", "A"); eq(d.policy().revision(), 9, "A rev");
    const ctxA = d.ctx(), bindingA = { mode: "v2", generation: 1, policyRevision: 9 };
    await d.select("bizB");
    eq(d.policyUi().state, "maintenance_read_only", "B"); eq(d.policy().revision(), 4, "B rev");
    const rb = await d.coord().submitIntent(upsert(uuid("b1"), { sales: 1 }, { sales: 9 })); eq(rb.status, "blocked_policy", "B blocked"); eq(rb.reason, "maintenance_read_only", "B reason");
    await setPolicy(ACTIVE({ policyRevision: 10 })); await new Promise((r) => setTimeout(r, 150));
    eq(d.policyUi().state, "maintenance_read_only", "A's change did not leak into B"); eq(d.policy().revision(), 4, "B rev unchanged");
    const g = await d.refs.router.current.mutate(upsert(ID1, { sales: 1 }, { sales: 101 }), ctxA, bindingA); eq(g.status, "stale", "A selection/binding stale under B: " + g.status);
    return "B isolated; late A callback discarded; stale binding refused";
  });

  // ══ VF-09 — two clients: old + current on one business through the phases ═══
  await run("VF-09", "two-clients", "old legacy client + compatible client on the same business: legacy → both write; quiesced → both denied; v2_active → old denied, current succeeds", async () => {
    await reseed({ policy: POL() });
    const old = await oldEngine("owner");
    const d = dashboard("manager"); await d.select("bizA");
    eq((await old.edit(ID1, 201, 101)).status, "committed", "old on legacy");
    await d.until(() => d.salesOf(ID1) === 201);
    eq((await d.coord().submitIntent(upsert(ID1, { sales: 202 }, { sales: 201 }))).status, "committed", "current on legacy");
    await setPolicy(QUIESCED({ policyRevision: 2 })); await new Promise((r) => setTimeout(r, 150));
    { const r = await old.edit(ID1, 1, 202); expect(engineDenied(r), "old on quiesced: " + r.status); }
    const q = await d.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 202 })); eq(q.status, "blocked_policy", "current on quiesced (client gate)");
    // Admin conversion under quiescence, then activation (the control plane)
    const C = createStoragePolicyControl(controlIo);
    const conv = await C.createFencedConversion({ upgradeBusinessToV2, entriesIo: adminEntriesIo })("tenantA", "bizA", { expectedRevision: 2, operator: "operator", operationId: "op-1" });
    eq(conv.result.status, "committed", "conversion");
    await C.activateV2("tenantA", "bizA", { expectedRevision: 3, operator: "operator", operationId: "op-1" });
    await d.until(() => d.mode().mode === "v2" && d.policyUi().state === "v2");
    { const r = await old.edit(ID1, 1, 202); expect(engineRefused(r), "old on v2_active: " + r.status); }
    await expectAllDenied(oldWrites("owner"), "bizA", "old raw writes on v2_active");
    eq((await d.coord().submitIntent(upsert(ID1, { sales: 303 }, { sales: 202 }))).status, "committed", "current on v2_active");
    eq((await readNode()).rows[ID1].sales, 303, "applied");
    return "legacy: both ok; quiesced: both denied; active: old denied, current ok";
  });

  // ══ VF-10 — control record is never client-writable; scoped read ════════════
  await run("VF-10", "control-write", "every ordinary role (owner/manager/viewer/outsider/unauth) is denied create/update/delete of the control record, its ancestors and a combined control+entries multipath; scoped read works", async () => {
    await reseed({ policy: POL() });
    const before = JSON.stringify((await seedDb().ref(CTRL()).once("value")).val());
    for (const k of ["owner", "manager", "viewer", "outsider", "unauth"]) {
      const db = dbOf(k);
      await rejectsDenied(() => db.ref(CTRL()).set(ACTIVE({ allowV2Initialization: true })), k + " set control");
      await rejectsDenied(() => db.ref(CTRL()).child("phase").set("v2_active"), k + " set phase");
      await rejectsDenied(() => db.ref(CTRL()).child("policyRevision").set(99), k + " bump revision");
      await rejectsDenied(() => db.ref(CTRL()).remove(), k + " remove control");
      await rejectsDenied(() => db.ref("storage_v2_control/tenantA").set({ bizA: POL() }), k + " tenant-level control");
      await rejectsDenied(() => db.ref("storage_v2_control").set({}), k + " root control");
      await rejectsDenied(() => db.ref("/").update({ [CTRL() + "/phase"]: "v2_active", [PATH() + "/_v"]: JSON.stringify([row(ID1, "2026-08-01", 1)]) }), k + " combined control+entries multipath");
      await rejectsDenied(() => db.ref(CTRL()).transaction((cur) => ACTIVE(), undefined, false).then((r) => { if (r.committed) throw new Error("committed"); throw Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }); }), k + " CAS control");
    }
    eq(JSON.stringify((await seedDb().ref(CTRL()).once("value")).val()), before, "control untouched");
    eq(JSON.stringify(JSON.parse((await readNode())._v)), JSON.stringify(LEGACY_ROWS()), "entries untouched by the combined update");
    // scoped read: members with access read their business's record; outsider / unauth / cross-business cannot
    for (const k of ["owner", "manager", "viewer"]) { const s = await dbOf(k).ref(CTRL()).once("value"); eq(s.val().phase, "legacy", k + " reads policy"); }
    await rejectsDenied(() => dbOf("outsider").ref(CTRL()).once("value"), "outsider read");
    await rejectsDenied(() => dbOf("unauth").ref(CTRL()).once("value"), "unauth read");
    await rejectsDenied(() => dbOf("viewer").ref("storage_v2_control/tenantA").once("value"), "tenant-level listing");
    return "5 roles × 8 write shapes denied; scoped reads correct";
  });

  // ══ VF-11 — no V2→legacy downgrade (tooling + Rules) ═══════════════════════
  await run("VF-11", "downgrade", "v2_active → legacy is impossible through tooling; a WRONG Admin legacy record over a V2 node still denies legacy writes (existing V2 never becomes legacy-writable)", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE({ policyRevision: 5 }) });
    const C = createStoragePolicyControl(controlIo);
    let err = null; try { await C.abortQuiescence("tenantA", "bizA", { expectedRevision: 5, operator: "operator", operationId: "x" }); } catch (e) { err = e; }
    expect(err && /no_operation_in_progress|transition_not_allowed/.test(err.code), "tool refuses " + (err && err.code));
    err = null; try { await C.quiesce("tenantA", "bizA", { expectedRevision: 5, operator: "operator", operationId: "x" }); } catch (e) { err = e; }
    eq(err && err.code, "transition_not_allowed", "v2_active → quiesced not in P0");
    await setPolicy(POL({ policyRevision: 6 }));   // a bad privileged write, bypassing the tool
    await expectAllDenied(oldWrites("owner"), "bizA", "legacy record over V2 node");
    const d = dashboard("manager"); await d.select("bizA"); eq(d.policyUi().state, "v2_without_policy", "compatible client also blocks");
    eq((await d.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }))).status, "blocked_policy", "client gate");
    return "tool refuses; wrong legacy record cannot open a V2 node";
  });

  // ══ VF-12 — typed states rendered for the compatible client ═════════════════
  await run("VF-12", "client-states", "compatible client receives typed quiesced / recovery_hold / update-required / malformed states over the REAL SDK, with no transaction attempted", async () => {
    const cases = [[QUIESCED(), "maintenance_read_only"], [HOLD(), "maintenance_read_only"], [ACTIVE({ minStorageProtocol: 3 }), "update_required"], [{ policyRevision: 7 }, "policy_malformed"], [POL({ phase: 7 }), "policy_malformed"], [POL({ contractVersion: 2, phase: "v2_active" }), "update_required"]];
    for (const [policy, state] of cases) {
      await reseed({ policy });
      const d = dashboard("manager"); await d.select("bizA");
      eq(d.policyUi().state, state, JSON.stringify(policy)); eq(d.policyUi().writable, false, "not writable");
      const surface = SP.describePolicyState(d.policyUi()); expect(surface && surface.text, "banner text");
      const before = await snapshot();
      const r = await d.coord().submitIntent(upsert(ID1, { sales: 5 }, { sales: 101 })); eq(r.status, "blocked_policy", state);
      eq(await snapshot(), before, "node untouched");
      detachAll();
    }
    return `${cases.length} states typed, no writes`;
  });

  // ══ VF-13 — activation of A leaves B alone ══════════════════════════════════
  await run("VF-13", "isolation", "policy change for business A (quiesced then v2_active) does not affect legacy business B (no record) or another tenant", async () => {
    await reseed({ policy: QUIESCED() });
    const oldB = await oldEngine("manager"); // engine bound to bizA; use raw for B
    await dbOf("manager").ref(PATH("bizB")).transaction((cur) => envelope([row(uuid("b1"), "2026-03-01", 10)]), undefined, false);
    eq(JSON.parse((await readNode("bizB"))._v)[0].sales, 10, "B legacy write allowed while A quiesced");
    await dbOf("outsider").ref(PATH("bizA", "tenantB")).set(envelope([row(uuid("t2"), "2026-01-01", 2)]));
    eq(JSON.parse((await readNode("bizA", "tenantB"))._v)[0].sales, 2, "other tenant unaffected");
    await setPolicy(ACTIVE()); await seedDb().ref(PATH()).set(v2node(1, LEGACY_ROWS()));
    await dbOf("manager").ref(PATH("bizB")).set(envelope([row(uuid("b1"), "2026-03-01", 11)]));
    eq(JSON.parse((await readNode("bizB"))._v)[0].sales, 11, "B still legacy-writable while A is v2_active");
    { const r = await oldB.edit(ID1, 1, 101); expect(engineRefused(r), "A refused to the old client: " + r.status); }
    await expectAllDenied(oldWrites("manager"), "bizA", "A raw old shapes");
    return "B and tenantB unaffected";
  });

  // ══ VF-14 / 15 / 16 — absent business initialization ═══════════════════════
  await run("VF-14", "absent", "absent business + NO policy: V2 initialization denied for the compatible client (client gate) AND for a raw V2 write AND for the unfenced core adapter; legacy creation by an old client still allowed", async () => {
    await reseed({ entries: null });
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.mode().mode, "absent", "mode"); eq(d.policyUi().state, "initialization_not_enabled", "state");
    eq((await d.coord().submitIntent(create(row(ID3, "2026-08-03", 1)))).status, "blocked_policy", "client gate"); eq(await readNode(), null, "nothing created");
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, [row(ID3, "2026-08-03", 1)], false)), "raw V2 init");
    // the approved core's V2 engine (no policy awareness) initialising directly — Rules deny it
    const ctrl = ML.createSelectionController(); ctrl.invalidate("tenantA", "bizA");
    const core = V2.createV2EntriesMutator({ selection: ctrl, mode: () => ({ mode: "absent", generation: null }),
      transactRow: async (t, k, id, fn) => { const r = await dbOf("owner").ref(`tenants/${t}/${k}/rows/${id}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; },
      transactNode: async (t, k, fn) => { const r = await dbOf("owner").ref(`tenants/${t}/${k}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; } });
    const cr = await core.mutate(create(row(ID3, "2026-08-03", 1)), ctrl.capture(), { mode: "absent", generation: null });
    eq(cr.status, "blocked", "unfenced core adapter " + cr.status); eq(cr.reason, "rules_rejected", "denied by Rules"); eq(await readNode(), null, "nothing created");
    // legacy compatibility: an OLD client may still create the first legacy node
    await dbOf("owner").ref(PATH()).set(envelope([row(ID3, "2026-08-03", 1)]));
    eq(JSON.parse((await readNode())._v)[0].sales, 1, "legacy creation allowed");
    return "V2 init denied (client, raw, unfenced core); legacy create allowed";
  });
  await run("VF-15", "absent", "absent business + v2_active + allowV2Initialization=false → V2 initialization denied (client gate + Rules)", async () => {
    await reseed({ entries: null, policy: ACTIVE({ allowV2Initialization: false }) });
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.policyUi().state, "initialization_not_enabled", "state");
    eq((await d.coord().submitIntent(create(row(ID3, "2026-08-03", 1)))).status, "blocked_policy", "client gate");
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, [row(ID3, "2026-08-03", 1)], false)), "raw V2 init with flag=false");
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(envelope([row(ID3, "2026-08-03", 1)])), "legacy creation under v2_active (result must be V2)");
    eq(await readNode(), null, "nothing created");
    return "denied";
  });
  await run("VF-16", "absent", "absent business + v2_active + allowV2Initialization=true → first create initialises V2 at epoch 1 through the REAL wiring; a revoked flag before commit denies", async () => {
    await reseed({ entries: null, policy: ACTIVE({ allowV2Initialization: true }) });
    const d = dashboard("manager"); await d.select("bizA");
    eq(d.policyUi().state, "v2", "state"); eq(d.policyUi().initialization, true, "init");
    const r = await d.coord().submitIntent(create(row(ID3, "2026-08-03", 1))); eq(r.status, "committed", "init " + r.status + "/" + (r.reason || ""));
    const n = await readNode(); eq(n.schemaVersion, 2, "V2"); eq(n.generation, 1, "epoch 1"); eq(n.rows[ID3][GK], 1, "stamped"); eq(n._v, undefined, "native: no _v");
    // revoked flag before the commit: Rules evaluate the policy at commit time
    await reseed({ entries: null, policy: ACTIVE({ allowV2Initialization: true }) });
    await setPolicy(ACTIVE({ allowV2Initialization: false, policyRevision: 2 }));
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, [row(ID3, "2026-08-03", 1)], false)), "flag revoked");
    return "native V2 initialised at gen 1; revoked flag denies";
  });

  // ══ VF-17 — populated legacy → V2 by a client: denied in every phase ═════════
  await run("VF-17", "conversion", "populated legacy business: a client's direct V2 conversion is denied under no record, legacy, quiesced, v2_active AND v2_active+init=true; only the Admin control plane converts (under quiesced)", async () => {
    for (const policy of [undefined, POL(), QUIESCED(), ACTIVE(), ACTIVE({ allowV2Initialization: true })]) {
      await reseed({ policy });
      const before = await snapshot();
      await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, LEGACY_ROWS())), "set V2 over legacy: " + JSON.stringify(policy && policy.phase));
      await rejectsDenied(() => dbOf("owner").ref(PATH()).transaction((cur) => v2node(1, LEGACY_ROWS()), undefined, false).then((r) => { if (r.committed) throw new Error("committed"); throw Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }); }), "CAS V2 over legacy");
      eq(await snapshot(), before, "untouched");
    }
    // the conversion core with an ORDINARY-auth transport is now denied too (it used to be allowed)
    await reseed({ policy: QUIESCED() });
    const ordinaryIo = { transactNode: async (t, key, fn) => { const r = await dbOf("owner").ref(`tenants/${t}/${key}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; } };
    const res = await upgradeBusinessToV2(ordinaryIo, { tenantId: "tenantA", bizId: "bizA" });
    eq(res.status, "failed", "core through ordinary auth: " + res.status); expect(/permission/i.test(res.error || ""), "denied");
    const C = createStoragePolicyControl(controlIo);
    const conv = await C.createFencedConversion({ upgradeBusinessToV2, entriesIo: adminEntriesIo })("tenantA", "bizA", { expectedRevision: 1, operator: "operator", operationId: "op-1" });
    eq(conv.result.status, "committed", "Admin control plane converts under quiesced");
    return "client conversion denied in 5 phases; ordinary-auth core denied; Admin lane converts";
  });

  // ══ VF-18 — frozen _v on a V2 business ══════════════════════════════════════
  await run("VF-18", "frozen-v", "V2 business: frozen _v change / delete / re-set denied for every client shape; the PRE-FENCE Rules allowed the delete (negative control)", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE() });
    const r = dbOf("owner").ref(PATH());
    await expectAllDenied({ "set _v": () => r.child("_v").set("[]"), "remove _v": () => r.child("_v").remove(), "update _v": () => r.update({ _v: "[]" }), "multipath remove _v": () => dbOf("owner").ref("/").update({ [PATH() + "/_v"]: null }) }, "bizA", "frozen _v");
    // a compatible client's clear-all keeps _v byte-identical (VF-05) — and a row write never touches it
    await dbOf("owner").ref(PATH() + "/rows/" + ID1).transaction((cur) => ({ ...cur, sales: 5 }), undefined, false);
    eq((await readNode())._v, JSON.stringify(LEGACY_ROWS()), "_v byte-identical after a row write");
    // NEGATIVE CONTROL: core (pre-fence) rules
    await loadRules(coreRules); await reseed({ entries: v2node(1, LEGACY_ROWS()) });
    await dbOf("owner").ref(PATH() + "/_v").remove();
    eq((await readNode())._v, undefined, "pre-fence rules allowed the frozen _v deletion");
    await loadRules(CANONICAL_RULES);
    return "denied ×4; pre-fence allowed (control)";
  });

  // ══ VF-19 / VF-20 — malformed present record denies everything ═════════════
  await run("VF-19", "malformed", "malformed EXISTING control record (scalar, wrong contract, bad revision, bad flag, unknown phase, missing fields): ALL entries mutations denied for old and current clients", async () => {
    const bad = { scalar: 7, string: "legacy", contract0: POL({ contractVersion: 0 }), contractStr: POL({ contractVersion: "1" }), revision0: POL({ policyRevision: 0 }), revisionNeg: POL({ policyRevision: -1 }), revisionStr: POL({ policyRevision: "1" }),
      flagStr: POL({ allowV2Initialization: "false" }), flagMissing: (() => { const p = POL(); delete p.allowV2Initialization; return p; })(), minMissing: (() => { const p = POL(); delete p.minStorageProtocol; return p; })(), min0: POL({ minStorageProtocol: 0 }),
      phaseUnknown: POL({ phase: "active" }), phaseNumber: POL({ phase: 7 }), onlyRevision: { policyRevision: 7 }, onlyPhaseActive: { phase: "v2_active" } };
    const names = [];
    for (const [name, policy] of Object.entries(bad)) {
      await reseed({ policy });
      const eng = await (await oldEngine("owner")).edit(ID1, 1, 101); expect(engineDenied(eng), name + " engine " + eng.status + "/" + (eng.error || ""));
      await expectAllDenied(oldWrites("owner"), "bizA", "malformed:" + name);
      names.push(name);
    }
    // malformed record over an ABSENT node: neither legacy creation nor V2 initialization
    await reseed({ entries: null, policy: { policyRevision: 7 } });
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(envelope([row(ID3, "2026-08-03", 1)])), "legacy create under malformed record");
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, [row(ID3, "2026-08-03", 1)], false)), "V2 init under malformed record");
    return names.length + " malformed shapes deny everything";
  });
  await run("VF-20", "malformed", "existing record with the phase MISSING is denied — never treated as legacy; whole-record absence still permits legacy", async () => {
    await reseed({ policy: { contractVersion: 1, policyRevision: 2, allowV2Initialization: false, minStorageProtocol: 1 } });
    await expectAllDenied(oldWrites("owner"), "bizA", "phase missing");
    const d = dashboard("manager"); await d.select("bizA"); eq(d.policyUi().state, "policy_malformed", "client");
    detachAll();
    await seedDb().ref(CTRL()).remove();
    const res = await (await oldEngine("owner")).edit(ID1, 12, 101); eq(res.status, "committed", "absence ⇒ legacy allowed");
    return "missing phase denied; absence legacy";
  });

  // ══ VF-21 / VF-22 / VF-23 — control plane over the real Admin SDK ══════════
  await run("VF-21", "control-plane", "policyRevision rollback / reuse / stale expected revision rejected by the tooling over the real CAS; nothing written", async () => {
    await reseed({ entries: envelope(LEGACY_ROWS()) });
    const C = createStoragePolicyControl(controlIo);
    await C.initializeLegacy("tenantA", "bizA", { operator: "operator" });
    const before = JSON.stringify((await seedDb().ref(CTRL()).once("value")).val());
    for (const [rev, code] of [[0, "stale_revision"], [2, "stale_revision"], [99, "stale_revision"]]) {
      let err = null; try { await C.quiesce("tenantA", "bizA", { expectedRevision: rev, operator: "operator", operationId: "op" }); } catch (e) { err = e; }
      eq(err && err.code, code, "expectedRevision " + rev);
    }
    eq(JSON.stringify((await seedDb().ref(CTRL()).once("value")).val()), before, "untouched");
    let err = null; try { await C.initializeLegacy("tenantA", "bizA", { operator: "operator" }); } catch (e) { err = e; } eq(err && err.code, "stale_revision", "reuse of revision 0");
    return "stale/rollback/reuse rejected";
  });
  await run("VF-22", "control-plane", "concurrent transitions on the real record: two operators quiesce from the same revision — exactly one wins; the loser is stale; ownership blocks the loser's convert/abort/activate", async () => {
    await reseed({ entries: envelope(LEGACY_ROWS()) });
    const C = createStoragePolicyControl(controlIo);
    await C.initializeLegacy("tenantA", "bizA", { operator: "operator" });
    const attempts = await Promise.allSettled([
      C.quiesce("tenantA", "bizA", { expectedRevision: 1, operator: "alice", operationId: "alice-op" }),
      C.quiesce("tenantA", "bizA", { expectedRevision: 1, operator: "bob", operationId: "bob-op" }),
    ]);
    const won = attempts.filter((a) => a.status === "fulfilled"), lost = attempts.filter((a) => a.status === "rejected");
    eq(won.length, 1, "exactly one winner"); eq(lost.length, 1, "one loser"); eq(lost[0].reason.code, "stale_revision", "loser typed");
    const rec = (await seedDb().ref(CTRL()).once("value")).val(); eq(rec.policyRevision, 2, "one bump"); const owner = rec.operation.owner, other = owner === "alice" ? "bob" : "alice";
    let err = null; try { await C.abortQuiescence("tenantA", "bizA", { expectedRevision: 2, operator: other, operationId: other + "-op" }); } catch (e) { err = e; } eq(err && err.code, "operation_not_owned", "loser cannot abort");
    err = null; try { await C.createFencedConversion({ upgradeBusinessToV2, entriesIo: adminEntriesIo })("tenantA", "bizA", { expectedRevision: 2, operator: other, operationId: rec.operation.id }); } catch (e) { err = e; } eq(err && err.code, "operation_not_owned", "loser cannot convert");
    eq((await readNode()).schemaVersion, undefined, "no conversion");
    return `winner=${owner}; loser stale; ownership enforced`;
  });
  await run("VF-23", "control-plane", "the conversion wrapper refuses outside quiesced (no record / legacy / v2_active / recovery_hold) BEFORE invoking the unchanged core; inside quiesced it converts once and abort is impossible afterwards", async () => {
    let calls = 0; const spy = async (io, a) => { calls++; return upgradeBusinessToV2(io, a); };
    const C = createStoragePolicyControl(controlIo);
    const run1 = C.createFencedConversion({ upgradeBusinessToV2: spy, entriesIo: adminEntriesIo });
    const attempt = async (rev) => { let err = null; try { await run1("tenantA", "bizA", { expectedRevision: rev, operator: "operator", operationId: "op-1" }); } catch (e) { err = e; } return err && err.code; };
    await reseed(); eq(await attempt(0), "policy_required", "no record");
    await reseed({ policy: POL() }); eq(await attempt(1), "conversion_requires_quiesced", "legacy");
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE() }); eq(await attempt(1), "conversion_requires_quiesced", "v2_active");
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: HOLD() }); eq(await attempt(1), "conversion_requires_quiesced", "recovery_hold");
    eq(calls, 0, "core never invoked");
    await reseed({ policy: QUIESCED() });
    const ok = await run1("tenantA", "bizA", { expectedRevision: 1, operator: "operator", operationId: "op-1" }); eq(ok.result.status, "committed", "converted"); eq(calls, 1, "one invocation"); eq(ok.policyRevision, 2, "attempt recorded first");
    eq((await readNode()).schemaVersion, 2, "node V2");
    let err = null; try { await C.abortQuiescence("tenantA", "bizA", { expectedRevision: 2, operator: "operator", operationId: "op-1" }); } catch (e) { err = e; } eq(err && err.code, "transition_not_allowed", "abort after attempt");
    const act = await C.activateV2("tenantA", "bizA", { expectedRevision: 2, operator: "operator", operationId: "op-1" }); eq(act.record.phase, "v2_active", "activated"); eq(act.record.minStorageProtocol, 2, "floor 2");
    return "refused ×4 before core; converted once; abort impossible; activated";
  });

  // ══ VF-24 / VF-25 — recovery_hold ═══════════════════════════════════════════
  await run("VF-24", "recovery-hold", "recovery_hold on a V2 business: old and current clients denied for every shape; native init denied; resume → v2_active by the owner restores writes", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: HOLD() });
    await expectAllDenied(oldWrites("owner"), "bizA", "hold/old");
    const d = dashboard("manager"); await d.select("bizA"); eq(d.policyUi().state, "maintenance_read_only", "client"); eq(d.policyUi().reason, "recovery_hold", "reason");
    eq((await d.coord().submitIntent(upsert(ID1, { sales: 1 }, { sales: 101 }))).status, "blocked_policy", "client gate");
    await rejectsDenied(() => dbOf("owner").ref(PATH() + "/rows/" + ID1).transaction((cur) => ({ ...cur, sales: 5 }), undefined, false).then((r) => { if (r.committed) throw new Error("committed"); throw Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }); }), "raw V2 row CAS under hold");
    await reseed({ entries: null, policy: HOLD() });
    await rejectsDenied(() => dbOf("owner").ref(PATH()).set(v2node(1, [row(ID3, "2026-08-03", 1)], false)), "native init under hold");
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: HOLD() });
    const C = createStoragePolicyControl(controlIo);
    await C.resumeV2Active("tenantA", "bizA", { expectedRevision: 1, operator: "operator", operationId: "rec-1" });
    const d2 = dashboard("manager"); await d2.select("bizA"); eq(d2.policyUi().state, "v2", "resumed");
    eq((await d2.coord().submitIntent(upsert(ID1, { sales: 7 }, { sales: 101 }))).status, "committed", "writes restored");
    return "hold denies all; resume restores";
  });
  await run("VF-25", "recovery-hold", "recovery_hold → legacy is impossible through tooling (and would not open legacy writes on a V2 node anyway)", async () => {
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: HOLD() });
    const C = createStoragePolicyControl(controlIo);
    for (const op of [(o) => C.abortQuiescence("tenantA", "bizA", o), (o) => C.initializeLegacy("tenantA", "bizA", o), (o) => C.quiesce("tenantA", "bizA", o)]) {
      let err = null; try { await op({ expectedRevision: 1, operator: "operator", operationId: "rec-1" }); } catch (e) { err = e; }
      expect(err && /transition_not_allowed|operation_kind_mismatch|policy_already_exists|stale_revision|operation_in_progress/.test(err.code), "refused: " + (err && err.code));
    }
    eq((await seedDb().ref(CTRL()).once("value")).val().phase, "recovery_hold", "still held");
    await setPolicy(POL({ policyRevision: 9 }));   // even a wrong privileged downgrade
    await expectAllDenied(oldWrites("owner"), "bizA", "legacy record over V2 (hold aftermath)");
    return "no legacy path from hold";
  });

  // ══ VF-26 — old open tab through the phases (server safety) ═════════════════
  await run("VF-26", "old-open-tab", "an OLD page opened BEFORE activation (live legacy listener, hydrated legacy array) keeps its session; policy → quiesced: its legacy write DENIED; conversion + v2_active: its legacy write and _v delete DENIED; the local false-success branch is the accepted residual (negative control)", async () => {
    await reseed();   // no record: the old page opens on a legacy business
    const oldDb = dbOf("owner");
    const lref = oldDb.ref(PATH());
    let latest = null; const handler = lref.on("value", (s) => { latest = s.val(); });
    LIVE.push({ detach: () => lref.off("value", handler) });
    await new Promise((r) => { const t = setInterval(() => { if (latest) { clearInterval(t); r(); } }, 10); });
    const old = await oldEngine("owner");
    eq((await old.edit(ID1, 150, 101)).status, "committed", "old page writes before any policy");
    // operator quiesces (Admin lane) — the old page's listener still holds a legacy array
    const C = createStoragePolicyControl(controlIo);
    await C.initializeLegacy("tenantA", "bizA", { operator: "operator" });
    await C.quiesce("tenantA", "bizA", { expectedRevision: 1, operator: "operator", operationId: "op-1" });
    const q = await old.edit(ID1, 160, 150); expect(engineDenied(q), "old page under quiesced — server denial: " + q.status + "/" + (q.error || ""));
    await expectAllDenied(oldWrites("owner"), "bizA", "old raw shapes under quiesced");
    eq(JSON.parse((await readNode())._v).find((r) => r.id === ID1).sales, 150, "server still holds 150");
    // conversion + activation while the old tab stays open
    const conv = await C.createFencedConversion({ upgradeBusinessToV2, entriesIo: adminEntriesIo })("tenantA", "bizA", { expectedRevision: 2, operator: "operator", operationId: "op-1" }); eq(conv.result.status, "committed", "conversion");
    await C.activateV2("tenantA", "bizA", { expectedRevision: 3, operator: "operator", operationId: "op-1" });
    await new Promise((r) => setTimeout(r, 150));
    expect(latest && latest.schemaVersion === 2, "the old page's listener now sees a V2 node its generic reader would misread (frozen _v) — display-only residual");
    const a = await old.edit(ID1, 170, 150); expect(engineRefused(a), "old page under v2_active: " + a.status);
    await expectAllDenied(oldWrites("owner"), "bizA", "old raw shapes under v2_active");
    const n = await readNode(); eq(n.rows[ID1].sales, 150, "authoritative V2 row unchanged"); eq(typeof n._v, "string", "frozen _v intact");
    // NEGATIVE CONTROL (accepted, documented residual): the old page's DISPLAY is not
    // protected — its listener now holds a node its generic reader misreads — but every
    // write it can emit was denied above and the authoritative row is unchanged.
    eq(latest.rows[ID1].sales, 150, "old page's listener sees the authoritative V2 row");
    return "before: ok; quiesced: denied; v2_active: denied; server truth intact";
  });

  // ══ VF-27 (R1) — revision domain boundary on the real record ═══════════════
  await run("VF-27", "control-plane", "revision boundary on the real record: MAX_SAFE_INTEGER is VALID for Rules; at MAX every transition (quiesce/native/hold; abort/conversion/activate from a quiesced record) is revision_exhausted BEFORE any write; 2^53 is parser-invalid and denies everything", async () => {
    const MAXR = Number.MAX_SAFE_INTEGER;
    await reseed({ policy: POL({ policyRevision: MAXR }) });
    eq((await (await oldEngine("owner")).edit(ID1, 5, 101)).status, "committed", "Rules accept policyRevision === MAX_SAFE_INTEGER (legacy write allowed)");
    const C = createStoragePolicyControl(controlIo);
    let calls = 0; const conv = C.createFencedConversion({ upgradeBusinessToV2: async (...a) => { calls++; return upgradeBusinessToV2(...a); }, entriesIo: adminEntriesIo });
    const refuse = async (name, op) => { let err = null; try { await op(); } catch (e) { err = e; } eq(err && err.code, "revision_exhausted", name + " at MAX"); };
    let before = JSON.stringify((await seedDb().ref(CTRL()).once("value")).val());
    await refuse("quiesce", () => C.quiesce("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "op-max" }));
    eq(JSON.stringify((await seedDb().ref(CTRL()).once("value")).val()), before, "legacy record byte-identical");
    await reseed({ policy: QUIESCED({ policyRevision: MAXR }) });
    before = JSON.stringify((await seedDb().ref(CTRL()).once("value")).val());
    await refuse("abort", () => C.abortQuiescence("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "op-1" }));
    await refuse("conversion", () => conv("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "op-1" }));
    eq(calls, 0, "conversion core never invoked");
    eq(JSON.stringify((await seedDb().ref(CTRL()).once("value")).val()), before, "quiesced record byte-identical");
    eq(typeof (await readNode())._v, "string", "entries untouched (not converted)");
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: QUIESCED({ policyRevision: MAXR, conversionAttempted: true }) });
    await refuse("activate", () => C.activateV2("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "op-1" }));
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: ACTIVE({ policyRevision: MAXR, allowV2Initialization: true }) });
    await refuse("enterRecoveryHold", () => C.enterRecoveryHold("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "rec" }));
    await refuse("closeInitialization", () => C.closeInitialization("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator" }));
    await reseed({ entries: v2node(1, LEGACY_ROWS()), policy: HOLD({ policyRevision: MAXR }) });
    await refuse("resume", () => C.resumeV2Active("tenantA", "bizA", { expectedRevision: MAXR, operator: "operator", operationId: "rec-1" }));
    await reseed({ policy: POL({ policyRevision: MAXR + 1 }) });
    await expectAllDenied(oldWrites("owner"), "bizA", "policyRevision 2^53 (parser-invalid) denies everything");
    let err = null; try { await C.quiesce("tenantA", "bizA", { expectedRevision: MAXR + 1, operator: "operator", operationId: "x" }); } catch (e) { err = e; }
    eq(err && err.code, "current_policy_malformed", "tooling refuses a 2^53 record as malformed");
    return "MAX valid; quiesce/abort/conversion/activate/hold/close/resume exhausted at MAX; 2^53 denied + malformed";
  });

  // ─── report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("");
  console.log(`${w("case", 8)} ${w("area", 16)} ${w("status", 6)} ${w("ms", 6)} notes`);
  console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 16)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 27;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (results.length !== EXPECTED) { console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED}, ran ${results.length}`); process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} [${r.area}] ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
