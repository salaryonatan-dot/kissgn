// HF-1 — SETUP WIZARD CONFIG PRESERVATION (P0 data-loss regression suite).
//
// Editing a business in the Setup Wizard must merge the keys the wizard owns into
// the CURRENT stored `biz:{bizId}:config` and preserve every other key
// (employees, pettyCashCategories, legacy region/checklist settings, unknown future
// keys). A stored config that cannot be decoded, or that cannot be read, must never
// be replaced.
//
// The code under test is the PRODUCTION text of index.html, never a copy:
//   • the Setup Wizard `finish` handler (builds the wizard cfg),
//   • the edit-mode `onComplete` handler of <SetupWizard> (reads + writes storage),
//   • the Employees screen `saveEmp` / `removeEmp` and petty-cash `saveCats`
//     (the other config writers),
//   • the helper block `window.MarjinConfigMerge` (HF-1).
// Each is located by a unique production anchor, extracted by brace matching and
// evaluated in a `node:vm` sandbox whose globals are the closure dependencies the
// real component provides. Storage is an in-memory model of `window.storage`
// with the production envelope semantics (`{_v: string}`; get throws "not found").
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

// ── production source extraction ──────────────────────────────────────────────
function unique(anchor, label) {
  const at = HTML.indexOf(anchor);
  assert.notEqual(at, -1, `[hf1] production anchor missing for ${label}: ${JSON.stringify(anchor.slice(0, 70))}`);
  assert.equal(HTML.indexOf(anchor, at + 1), -1, `[hf1] production anchor for ${label} is not unique`);
  return at;
}
/** Brace-matched block starting at the first "{" at/after `from` (string/comment aware). */
function braceFrom(from, label) {
  let i = HTML.indexOf("{", from);
  assert.notEqual(i, -1, `[hf1] no block for ${label}`);
  let depth = 0, str = null, esc = false, line = false, block = false;
  for (; i < HTML.length; i++) {
    const c = HTML[i], n = HTML[i + 1];
    if (line) { if (c === "\n") line = false; continue; }
    if (block) { if (c === "*" && n === "/") { block = false; i++; } continue; }
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === str) str = null; continue; }
    if (c === "/" && n === "/") { line = true; i++; continue; }
    if (c === "/" && n === "*") { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error(`[hf1] unbalanced block for ${label}`);
}
/** `const name = async (…) => { … }` / `const name = (…) => …;` declaration text. */
function declaration(anchor, label) {
  const at = unique(anchor, label);
  const end = braceFrom(at, label);
  return HTML.slice(at, end) + ";";
}
/** The edit-mode <SetupWizard onComplete={…}> expression (the one owning the EDIT marker). */
function editOnCompleteExpression() {
  const marker = unique("// EDIT existing business — do NOT create new bizId", "edit onComplete marker");
  const attr = HTML.lastIndexOf("onComplete={", marker);
  assert.ok(attr !== -1 && marker - attr < 400, "[hf1] the EDIT marker must sit inside the edit-mode onComplete handler");
  const open = attr + "onComplete=".length;
  const end = braceFrom(open, "edit onComplete");
  return HTML.slice(open + 1, end - 1); // strip the JSX braces → arrow-function expression
}

const SRC = {
  finish: declaration("const finish = async () => {", "SetupWizard finish"),
  editOnComplete: editOnCompleteExpression(),
  saveEmp: declaration("const saveEmp = () => {", "EmployeesScreen saveEmp"),
  removeEmp: (() => { const at = unique("const removeEmp = id => saveBusinessConfig(", "removeEmp"); return HTML.slice(at, HTML.indexOf("\n", at)); })(),
  saveCats: declaration("const saveCats = async () => {", "PettyCash saveCats"),
  saveBusinessConfig: declaration("const saveBusinessConfig = async (cfg) => {", "saveBusinessConfig"),
};

// The HF-1 helper block (absent before the fix ⇒ the helper tests fail, by design).
function loadConfigMerge() {
  const start = HTML.indexOf("// ── HF-1: Setup Wizard config preservation");
  if (start === -1) return null;
  const endNeedle = "window.MarjinConfigMerge = Object.freeze(";
  const f = HTML.indexOf(endNeedle, start);
  if (f === -1) return null;
  const src = HTML.slice(start, HTML.indexOf(");", f) + 2);
  const sandbox = { window: {}, Object, Array, JSON, Error };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.MarjinConfigMerge;
}
const MERGE = loadConfigMerge();
const requireMerge = () => { assert.ok(MERGE, "[hf1] window.MarjinConfigMerge helper block is missing from index.html"); return MERGE; };

// ── in-memory window.storage with the production envelope + transport semantics ─
// Nodes are held per tenant (`tenants/{tenantId}/{key}`); `nodes` is the default
// tenant's map. `get`/`set` are the MUTABLE-tenant legacy transport (used by the
// other config writers); `setFor` / `mutateFor` are the EXPLICIT-tenant transports.
// `mutateFor` models RTDB `runTransaction` compare-and-swap: the callback receives the
// current raw node (null when absent); if the node changed between the callback and
// the commit (an `interfere` hook), the callback is RE-RUN against the fresh value
// (bounded at 25 attempts like Firebase JS 10.7.1 ⇒ "maxretry"); returning
// `undefined` aborts with `committed:false`. `pause(key)` holds a dispatched write
// pending until released; `failOn(key, err)` rejects it.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function makeStorage(initial = {}, defaultTenant = "tenantA") {
  const tenants = new Map([[defaultTenant, new Map(Object.entries(initial))]]);
  const nodesOf = (t) => { if (!tenants.has(t)) tenants.set(t, new Map()); return tenants.get(t); };
  const nodes = nodesOf(defaultTenant);
  const writes = [];     // applied remote writes, in order
  const reads = [];      // legacy get() calls
  const dispatched = []; // every remote write dispatch (explicit transports), in order
  const txnInputs = [];  // every raw value handed to a transaction callback
  const pauses = new Map(), failures = new Map();
  const log = [];        // interleaved "dispatch:<key>" / "settle:<key>" events (+ "live" from the env)
  let failRead = null, interfere = null, maxRetry = 25, forceUncommitted = false;
  const hold = async (key) => { const p = pauses.get(key); if (p) { pauses.delete(key); p.hit(); await p.gate; } };
  const storage = {
    tenants, nodes, writes, reads, dispatched, txnInputs, log,
    failNextReads(err) { failRead = err; },
    interfereWith(fn) { interfere = fn; },
    setMaxRetry(n) { maxRetry = n; },
    forceUncommitted() { forceUncommitted = true; },
    pause(key) { let hit; const reached = new Promise((r) => { hit = r; }); let release; const gate = new Promise((r) => { release = r; }); pauses.set(key, { hit, gate }); return { reached, release: () => release() }; },
    failOn(key, err) { failures.set(key, err); },
    get: async (key, shared = false) => {
      reads.push({ key, shared });
      if (failRead) throw failRead;
      if (!nodes.has(key)) throw new Error("not found");
      const raw = nodes.get(key);
      const value = (raw && typeof raw === "object" && "_v" in raw) ? raw._v : JSON.stringify(raw);
      return { key, value, shared };
    },
    set: async (key, value, shared = false) => {
      // legacy blind whole-node write (mutable tenant). It honours the same pending /
      // concurrent-writer hooks, so the pre-R1 handler is exercised by the SAME
      // adversarial scenarios (negative control): a concurrent change landing between
      // its read and this set is simply overwritten.
      const str = typeof value === "string" ? value : JSON.stringify(value);
      dispatched.push({ op: "set", tenantId: defaultTenant, key }); log.push("dispatch:" + key);
      await hold(key);
      if (failures.has(key)) { const e = failures.get(key); failures.delete(key); log.push("settle:" + key); throw e; }
      if (interfere && key.endsWith(":config")) await interfere({ attempt: 1, tenantId: defaultTenant, key, map: nodes });
      writes.push({ op: "set", tenantId: defaultTenant, key, value: str, shared });
      nodes.set(key, { _v: str });
      log.push("settle:" + key);
      return { key, value: str, shared };
    },
    setFor: async (tenantId, key, value, shared = false) => {
      if (!tenantId) throw new Error("explicit tenant required");
      const str = typeof value === "string" ? value : JSON.stringify(value);
      dispatched.push({ op: "setFor", tenantId, key }); log.push("dispatch:" + key);
      await hold(key);
      if (failures.has(key)) { const e = failures.get(key); failures.delete(key); log.push("settle:" + key); throw e; }
      writes.push({ op: "setFor", tenantId, key, value: str, shared });
      nodesOf(tenantId).set(key, { _v: str });
      log.push("settle:" + key);
      return { key, value: str, shared };
    },
    mutateFor: async (tenantId, key, fn) => {
      if (!tenantId) throw new Error("explicit tenant required");
      dispatched.push({ op: "mutateFor", tenantId, key }); log.push("dispatch:" + key);
      await hold(key);
      if (failRead) { const e = failRead; failRead = null; log.push("settle:" + key); throw e; }
      if (failures.has(key)) { const e = failures.get(key); failures.delete(key); log.push("settle:" + key); throw e; }
      const map = nodesOf(tenantId);
      for (let attempt = 1; attempt <= maxRetry; attempt++) {
        const cur = map.has(key) ? clone(map.get(key)) : null;
        txnInputs.push(clone(cur));
        const next = fn(clone(cur));
        if (next === undefined || forceUncommitted) { forceUncommitted = false; log.push("settle:" + key); return { committed: false, snapshot: { val: () => (map.has(key) ? clone(map.get(key)) : null) } }; }
        if (interfere) await interfere({ attempt, tenantId, key, map });
        const now = map.has(key) ? map.get(key) : null;
        if (JSON.stringify(now) !== JSON.stringify(cur)) continue; // compare-and-swap conflict ⇒ rerun on the fresh value
        const stored = clone(next);
        map.set(key, stored);
        writes.push({ op: "txn", tenantId, key, value: stored._v, attempt });
        log.push("settle:" + key);
        return { committed: true, snapshot: { val: () => clone(stored) } };
      }
      log.push("settle:" + key);
      throw new Error("maxretry");
    },
    config: (bizId, tenantId = defaultTenant) => { const n = nodesOf(tenantId).get(`biz:${bizId}:config`); return n ? JSON.parse(n._v) : undefined; },
  };
  return storage;
}

function selection(tenantId, bizId) {
  let cur = { gen: 1, tenantId, bizId };
  return {
    capture: () => ({ ...cur }),
    isLive: (ctx) => !!ctx && ctx.gen === cur.gen && ctx.tenantId === cur.tenantId && ctx.bizId === cur.bizId,
    switchTo: (t, b) => { cur = { gen: cur.gen + 1, tenantId: t, bizId: b }; },
  };
}

/** Wizard state as the user leaves it: initialised from the stored config, then edited. */
function wizardStateFrom(cfg, edits = {}) {
  const t = (cfg && cfg.targets) || {};
  return {
    bizName: cfg.businessName || "", rentType: cfg.rentType || "pct", rentPct: cfg.rentPct || "", rentFixed: cfg.rentFixed || "",
    hasRoyalty: cfg.hasRoyalty || false, royaltyPct: cfg.royaltyPct || "",
    tFood: t.foodCostPct || 33, tLabor: t.laborCostPct || 27, tGrowth: t.salesGrowthPct || 5,
    bizLat: cfg.lat || null, bizLon: cfg.lon || null, bizRegionIds: cfg.region_ids || [], bizSubregionIds: cfg.subregion_ids || [],
    ...edits,
  };
}

/** Runs the REAL wizard `finish` in edit mode and returns the args handed to onComplete. */
async function runFinish(state, suppliers, fixedList) {
  let captured = null;
  const sandbox = {
    ...state, isFirstSetup: false, suppliers, fixedList,
    ownerName: "", ownerUsername: "", ownerEmail: "", ownerPassword: "", ownerPass2: "",
    setOwnerErr: () => {}, onComplete: (...a) => { captured = a; },
    Number, String, Object, Array, JSON, Math,
  };
  const fn = vm.runInNewContext(`(() => { ${SRC.finish} return finish; })()`, sandbox);
  await fn();
  assert.ok(captured, "[hf1] finish did not call onComplete");
  return captured;
}

/** Builds the REAL edit-mode onComplete bound to a sandboxed App closure. */
function makeEditEnv({ storage, bizId, tenantId = "tenantA", businesses, sel = selection(tenantId, bizId), currentBizId = bizId, opRef = { current: null } }) {
  const spy = { setBusinessConfig: [], setSuppliers: [], setFixedList: [], setBusinesses: [], setShowSetup: [], setSetupDone: [], alerts: [], errors: [], liveChecks: 0 };
  const window = { storage, MarjinConfigMerge: MERGE || undefined, _currentTenantId: tenantId };
  const sandbox = {
    window, currentBizId, businesses: businesses || [{ id: bizId, name: "Old name" }], setupEditOpRef: opRef,
    setBusinessConfig: (v) => spy.setBusinessConfig.push(JSON.parse(JSON.stringify(v))),
    setSuppliers: (v) => spy.setSuppliers.push(v), setFixedList: (v) => spy.setFixedList.push(v),
    setBusinesses: (v) => spy.setBusinesses.push(v), setShowSetup: (v) => spy.setShowSetup.push(v), setSetupDone: (v) => spy.setSetupDone.push(v),
    captureSelectionCtx: () => sel.capture(), isSelectionLive: (ctx) => { spy.liveChecks++; if (storage.log) storage.log.push("live"); return sel.isLive(ctx); },
    alert: (m) => spy.alerts.push(String(m)),
    console: { error: (...a) => spy.errors.push(a.map(String).join(" ")), log: () => {}, warn: () => {} },
    JSON, Object, Array, Number, String, Error, Promise,
  };
  const onComplete = vm.runInNewContext(`(${SRC.editOnComplete})`, sandbox);
  return { onComplete, spy, sel, window, opRef };
}

async function editRoundTrip({ stored, bizId = "biz_1", edits = {}, suppliers = [{ id: "s1", name: "ספק", category: "כללי", days: [] }], fixed = [{ id: "f1", name: "ארנונה", amount: 900 }], tenantId, businesses, sel, storage }) {
  const st = storage || makeStorage(stored === undefined ? {} : { [`biz:${bizId}:config`]: { _v: JSON.stringify(stored) } }, tenantId || "tenantA");
  const current = st.config(bizId) || {};
  const [cfg, sups, fx] = await runFinish(wizardStateFrom(current, edits), suppliers, fixed);
  const env = makeEditEnv({ storage: st, bizId, tenantId, businesses, sel });
  await env.onComplete(cfg, sups, fx);
  return { storage: st, env, cfg, after: st.config(bizId) };
}

// A realistic stored config written by the product's several config writers.
const RICH = () => ({
  businessName: "מסעדת הים", rentType: "fixed", rentPct: 0, rentFixed: 18000, hasRoyalty: true, royaltyPct: 4,
  targets: { salesGrowthPct: 7, foodCostPct: 29, laborCostPct: 24, owner_note: "future target key" },
  lat: 32.43, lon: 34.92, region_ids: ["hasharon"], subregion_ids: ["hadera"],
  employees: [
    { id: 1714000000001, name: "דנה", role: "מנהלת", type: "global", monthlySalary: "14500" },
    { id: 1714000000002, name: "יוסי", role: "טבח", type: "global", monthlySalary: "11800" },
  ],
  pettyCashCategories: ["ניקיון", "משרד", "תחזוקה"],
  oref_areas: ["חדרה"], custom_oref_areas: ["גבעת אולגה"],
  shiftChecklists: { opening: [{ id: "c1", label: "פתיחת קופה", critical: true }], closing: [] },
  futureModule: { enabled: true, nested: { level: 3, list: [1, 2, { deep: "x" }] } },
});
const NON_OWNED = ["employees", "pettyCashCategories", "oref_areas", "custom_oref_areas", "shiftChecklists", "futureModule"];
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm-realm objects → this realm
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

// ── 1–3: owned edits preserve everything else (production round trip) ────────
test("1 editing the business name preserves employees (and every non-owned key)", async () => {
  const before = RICH();
  const { after, env } = await editRoundTrip({ stored: before, edits: { bizName: "מסעדת הים החדשה" } });
  assert.equal(after.businessName, "מסעדת הים החדשה");
  assert.deepEqual(after.employees, before.employees, "employees must survive a wizard edit");
  assert.deepEqual(pick(after, NON_OWNED), pick(before, NON_OWNED));
  assert.deepEqual(env.spy.setBusinessConfig.at(-1), after, "React state equals what was stored");
  assert.deepEqual(env.spy.alerts, []);
});

test("2 editing business metadata (rent/royalty) preserves petty-cash categories", async () => {
  const before = RICH();
  const { after } = await editRoundTrip({ stored: before, edits: { rentType: "pct", rentPct: "8", hasRoyalty: false } });
  assert.equal(after.rentType, "pct");
  assert.equal(after.rentPct, 8);
  assert.equal(after.rentFixed, 0, "owned field explicitly set by the wizard (rentType pct ⇒ rentFixed 0)");
  assert.equal(after.hasRoyalty, false);
  assert.deepEqual(after.pettyCashCategories, before.pettyCashCategories);
  assert.deepEqual(pick(after, NON_OWNED), pick(before, NON_OWNED));
});

test("3 editing targets preserves employees; unknown target sub-keys survive", async () => {
  const before = RICH();
  const { after } = await editRoundTrip({ stored: before, edits: { tFood: "31", tLabor: "26", tGrowth: "4" } });
  assert.deepEqual(after.targets, { salesGrowthPct: 4, foodCostPct: 31, laborCostPct: 26, owner_note: "future target key" });
  assert.deepEqual(after.employees, before.employees);
});

// ── 4: the other config writers keep preserving unrelated settings ────────────
test("4 editing employees (and petty-cash categories) after a wizard edit preserves unrelated settings", async () => {
  const before = RICH();
  const { env, storage } = await editRoundTrip({ stored: before, edits: { bizName: "X" } });
  let businessConfig = env.spy.setBusinessConfig.at(-1);
  const saved = [];
  const base = {
    JSON, Object, Array, Number, String, Date: { now: () => 1714000000099 },
    window: { storage }, currentBizId: "biz_1",
    setBusinessConfig: (v) => { businessConfig = JSON.parse(JSON.stringify(v)); saved.push(businessConfig); },
  };
  const saveBusinessConfig = vm.runInNewContext(`(() => { ${SRC.saveBusinessConfig} return saveBusinessConfig; })()`, base);
  // add an employee through the REAL saveEmp
  const empEnv = { ...base, saveBusinessConfig, get businessConfig() { return businessConfig; }, employees: businessConfig.employees, editId: null,
    form: { name: "רוני", role: "מלצר", type: "global", monthlySalary: "9000" }, setAdding: () => {}, setEditId: () => {}, setForm: () => {} };
  const saveEmp = vm.runInNewContext(`(() => { ${SRC.saveEmp} return saveEmp; })()`, empEnv);
  saveEmp();
  await Promise.resolve(); await Promise.resolve();
  const afterEmp = storage.config("biz_1");
  assert.equal(afterEmp.employees.length, 3);
  assert.equal(afterEmp.businessName, "X");
  assert.deepEqual(pick(afterEmp, ["pettyCashCategories", "shiftChecklists", "futureModule", "targets"]), pick({ ...before, targets: afterEmp.targets }, ["pettyCashCategories", "shiftChecklists", "futureModule", "targets"]));
  // remove one through the REAL removeEmp
  const rmEnv = { ...base, saveBusinessConfig, businessConfig, employees: businessConfig.employees };
  const removeEmp = vm.runInNewContext(`(() => { ${SRC.removeEmp}; return removeEmp; })()`, rmEnv);
  await removeEmp(1714000000002);
  assert.deepEqual(storage.config("biz_1").employees.map((e) => e.name), ["דנה", "רוני"]);
  assert.deepEqual(storage.config("biz_1").futureModule, before.futureModule);
  // petty-cash categories through the REAL saveCats
  const catEnv = { ...base, saveBusinessConfig, businessConfig, catDraft: ["ניקיון", "שליחויות"], setEditingCats: () => {} };
  const saveCats = vm.runInNewContext(`(() => { ${SRC.saveCats} return saveCats; })()`, catEnv);
  await saveCats();
  const afterCats = storage.config("biz_1");
  assert.deepEqual(afterCats.pettyCashCategories, ["ניקיון", "שליחויות"]);
  assert.ok(Array.isArray(afterCats.employees) && afterCats.employees.length >= 2, "employees survive a petty-cash edit");
});

// ── 5–8: absence, deletion, unknown and nested keys ───────────────────────────
test("5 absent optional fields stay absent (no location / employees / categories invented)", async () => {
  const before = { businessName: "חדש", rentType: "pct", rentPct: 5, rentFixed: 0, hasRoyalty: false, royaltyPct: 0, targets: { salesGrowthPct: 5, foodCostPct: 33, laborCostPct: 27 } };
  const { after } = await editRoundTrip({ stored: before, edits: { bizName: "חדש 2" } });
  for (const k of ["lat", "lon", "region_ids", "subregion_ids", "employees", "pettyCashCategories"]) assert.equal(k in after, false, k + " must remain absent");
  assert.equal(after.businessName, "חדש 2");
});

test("6 no key is ever deleted by a wizard edit; only owned keys change, by explicit value", async () => {
  const before = RICH();
  const { after } = await editRoundTrip({ stored: before, edits: { bizName: "Y", bizRegionIds: [], bizSubregionIds: [] } });
  for (const k of Object.keys(before)) assert.ok(k in after, `key ${k} was deleted`);
  const M = requireMerge();
  const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  for (const k of changed) assert.ok(M.SETUP_WIZARD_OWNED_KEYS.includes(k), `non-owned key ${k} changed`);
  assert.deepEqual(after.region_ids, [], "an owned list explicitly cleared by the user is written as cleared");
});

test("7 unknown / future config keys survive an edit", async () => {
  const before = { ...RICH(), aNewFeatureFlag: true, integrations: { shiftOrganizer: { linked: false } }, "ключ": "unicode key" };
  const { after } = await editRoundTrip({ stored: before, edits: { bizName: "Z" } });
  assert.equal(after.aNewFeatureFlag, true);
  assert.deepEqual(after.integrations, before.integrations);
  assert.equal(after["ключ"], "unicode key");
});

test("8 nested unrelated objects survive byte-for-byte", async () => {
  const before = RICH();
  const { after } = await editRoundTrip({ stored: before, edits: { bizName: "N" } });
  assert.equal(JSON.stringify(after.shiftChecklists), JSON.stringify(before.shiftChecklists));
  assert.equal(JSON.stringify(after.futureModule), JSON.stringify(before.futureModule));
  assert.equal(JSON.stringify(after.employees), JSON.stringify(before.employees));
});

// ── 9: malformed / unreadable stored config fails safely ─────────────────────
for (const [name, raw] of [
  ["unparseable _v", { _v: "{not json" }],
  ["_v is an array", { _v: JSON.stringify([1, 2]) }],
  ["_v is JSON null", { _v: "null" }],
  ["_v is a number", { _v: 42 }],
  ["_v is a JSON string", { _v: JSON.stringify("text") }],
]) {
  test(`9 malformed stored config (${name}) ⇒ nothing is written, the user is told, the wizard stays open`, async () => {
    const storage = makeStorage({ "biz:biz_1:config": raw, "biz:biz_1:suppliers": { _v: "[]" } });
    const [cfg, sups, fx] = await runFinish(wizardStateFrom({ businessName: "whatever" }), [{ id: "s1", name: "ספק", category: "כללי", days: [] }], []);
    const env = makeEditEnv({ storage, bizId: "biz_1" });
    await env.onComplete(cfg, sups, fx);
    assert.deepEqual(storage.writes, [], "no write of any kind");
    assert.deepEqual(storage.nodes.get("biz:biz_1:config"), raw, "the stored node is untouched");
    assert.equal(env.spy.setBusinessConfig.length, 0);
    assert.equal(env.spy.setShowSetup.length, 0, "the wizard is not closed");
    assert.equal(env.spy.alerts.length, 1);
  });
}

test("9b a failed read (e.g. permission / network) is not treated as 'absent' ⇒ nothing is written", async () => {
  const storage = makeStorage({ "biz:biz_1:config": { _v: JSON.stringify(RICH()) } });
  const err = new Error("PERMISSION_DENIED: Permission denied");
  storage.failNextReads(err);
  const [cfg, sups, fx] = await runFinish(wizardStateFrom(RICH(), { bizName: "Q" }), [], []);
  const env = makeEditEnv({ storage, bizId: "biz_1" });
  await env.onComplete(cfg, sups, fx);
  assert.deepEqual(storage.writes, []);
  assert.equal(env.spy.alerts.length, 1);
  assert.equal(env.spy.setShowSetup.length, 0);
});

test("9c the selection changes while the stored config is being read (in the config transaction) ⇒ only that in-flight config write settles, at the captured business; nothing else is written", async () => {
  // HF-1 R1: the read is now INSIDE the atomic config transaction, so the in-flight
  // transaction may settle — only at the captured tenant/business — and every later
  // write and all UI state are skipped (remediation contract 02, scenario 17).
  const storage = makeStorage({ "biz:biz_1:config": { _v: JSON.stringify(RICH()) } });
  const sel = selection("tenantA", "biz_1");
  storage.interfereWith(async ({ attempt }) => { if (attempt === 1) sel.switchTo("tenantA", "biz_2"); });
  const [cfg, sups, fx] = await runFinish(wizardStateFrom(RICH(), { bizName: "Q" }), [], []);
  const env = makeEditEnv({ storage, bizId: "biz_1", sel });
  await env.onComplete(cfg, sups, fx);
  assert.deepEqual(storage.writes.map((w) => [w.tenantId, w.key]), [["tenantA", "biz:biz_1:config"]]);
  assert.deepEqual(storage.config("biz_1").employees, RICH().employees);
  assert.equal(env.spy.setBusinessConfig.length, 0);
  assert.equal(env.spy.setShowSetup.length, 0);
});

// ── 10–12 ─────────────────────────────────────────────────────────────────────
test("10 a repeated identical edit is idempotent (byte-identical stored config)", async () => {
  const storage = makeStorage({ "biz:biz_1:config": { _v: JSON.stringify(RICH()) } });
  await editRoundTrip({ storage, bizId: "biz_1", edits: { bizName: "Twice" } });
  const first = storage.nodes.get("biz:biz_1:config")._v;
  await editRoundTrip({ storage, bizId: "biz_1", edits: { bizName: "Twice" } });
  assert.equal(storage.nodes.get("biz:biz_1:config")._v, first);
});

test("11 create-new-business path is unchanged: completeSetup writes the wizard cfg for a fresh business id", () => {
  const at = unique("const completeSetup = async (cfg, sups, fixed, firstOwner) => {", "completeSetup");
  const body = HTML.slice(at, braceFrom(at, "completeSetup"));
  assert.match(body, /const bizId\s+= `biz_\$\{Date\.now\(\)\}`;/, "a new business always gets a new id (nothing stored to preserve)");
  assert.match(body, /window\.storage\.set\(`biz:\$\{bizId\}:config`, JSON\.stringify\(cfg\), true\)/);
  assert.doesNotMatch(body, /MarjinConfigMerge/, "create path does not merge (no existing config for a fresh id)");
  // and the new-business <SetupWizard> still routes to completeSetup
  assert.match(HTML, /onComplete=\{\(cfg, sups, fixed\) => \{ completeSetup\(cfg, sups, fixed, null\); \}\}/);
});

test("11b edit of a business whose config was never stored writes the wizard fields only", async () => {
  const { after, env } = await editRoundTrip({ stored: undefined, bizId: "biz_2", edits: { bizName: "Fresh" } });
  assert.equal(after.businessName, "Fresh");
  assert.equal("employees" in after, false);
  assert.deepEqual(env.spy.alerts, []);
});

test("12 the first business (bizId === tenantId) is edited in place under its own key", async () => {
  const tenantId = "t_1714000000000";
  const before = RICH();
  const { after, storage, env } = await editRoundTrip({ stored: before, bizId: tenantId, tenantId, edits: { bizName: "First" } });
  // HF-1 R1: no separate read — the config is merged inside the transaction at the captured node
  assert.deepEqual(storage.reads, []);
  assert.deepEqual(storage.dispatched.filter((d) => d.op === "mutateFor").map((d) => [d.tenantId, d.key]), [[tenantId, `biz:${tenantId}:config`]]);
  assert.ok(storage.writes.some((w) => w.key === `biz:${tenantId}:config` && w.tenantId === tenantId));
  assert.deepEqual(after.employees, before.employees);
  assert.deepEqual(plain(env.spy.setBusinesses.at(-1)), [{ id: tenantId, name: "First" }]);
});

test("owned lists (suppliers, fixed costs) and the business list are still written by the edit", async () => {
  const { storage, env } = await editRoundTrip({ stored: RICH(), edits: { bizName: "L" } });
  const keys = storage.writes.map((w) => w.key);
  // HF-1 R1: the atomic config transaction is FIRST, then the business list, suppliers, fixed
  assert.deepEqual(keys, ["biz:biz_1:config", "app-businesses", "biz:biz_1:suppliers", "biz:biz_1:fixed"]);
  assert.deepEqual(storage.writes.map((w) => w.op), ["txn", "setFor", "setFor", "setFor"]);
  assert.deepEqual(env.spy.setShowSetup, [false]);
  assert.deepEqual(env.spy.setSetupDone, [true]);
});

// ── helper contract (pure) ────────────────────────────────────────────────────
test("helper: ownership list is exactly the keys the wizard's cfg literal writes", async () => {
  const M = requireMerge();
  const [cfg] = await runFinish(wizardStateFrom(RICH()), [], []);
  assert.deepEqual([...M.SETUP_WIZARD_OWNED_KEYS].sort(), Object.keys(cfg).sort());
  assert.deepEqual([...M.SETUP_WIZARD_TARGET_KEYS].sort(), Object.keys(cfg.targets).sort());
});

test("helper: merge is pure, ignores non-owned keys offered by the caller, and never deletes", () => {
  const M = requireMerge();
  const existing = RICH();
  const snapshot = JSON.stringify(existing);
  const next = M.mergeSetupWizardConfig(existing, { businessName: "P", employees: [], pettyCashCategories: null, targets: { foodCostPct: 30, bogus: 1 } });
  assert.equal(JSON.stringify(existing), snapshot, "input not mutated");
  assert.deepEqual(plain(next.employees), existing.employees, "a non-owned key offered by the caller is ignored");
  assert.deepEqual(plain(next.pettyCashCategories), existing.pettyCashCategories);
  assert.deepEqual(plain(next.targets), { ...existing.targets, foodCostPct: 30 }, "only owned target keys are taken");
  assert.equal(next.businessName, "P");
  assert.throws(() => M.mergeSetupWizardConfig([1], { businessName: "x" }));
  assert.throws(() => M.mergeSetupWizardConfig("str", { businessName: "x" }));
  assert.deepEqual(plain(M.mergeSetupWizardConfig(null, { businessName: "x", lat: null, region_ids: [] })), { businessName: "x" });
});

test("helper: stored-config decoding distinguishes absent, valid and malformed", () => {
  const M = requireMerge();
  assert.deepEqual(plain(M.parseStoredBusinessConfig(null)), { ok: true, config: null });
  assert.deepEqual(plain(M.parseStoredBusinessConfig('{"a":1}')), { ok: true, config: { a: 1 } });
  for (const bad of ["{x", "[1]", "null", "3", '"s"', 42, {}, true]) assert.equal(M.parseStoredBusinessConfig(bad).ok, false, JSON.stringify(bad));
});

// ══ HF-1 R1 — ADVERSARIAL ACCEPTANCE MATRIX (remediation contract 05, scenarios 1–28) ══
// Every scenario runs the REAL `finish` + the REAL edit-mode `onComplete` (production
// text) against the transaction-faithful storage model above, with deferred writes
// (`pause`) and concurrent remote writers (`interfereWith`) that genuinely change the
// node between the callback and the commit, so the callback really re-runs.
const CFG_KEY = "biz:biz_1:config", SUP_KEY = "biz:biz_1:suppliers", FIX_KEY = "biz:biz_1:fixed";
const SUPS = [{ id: "s1", name: "ספק", category: "כללי", days: [] }];
const FIXED = [{ id: "f1", name: "ארנונה", amount: 900 }];
const stored = (st) => JSON.parse(st.nodes.get(CFG_KEY)._v);
/** Concurrent writer: mutate the decoded config at the node (keeps the envelope). */
const concurrently = (map, fn) => { const raw = map.get(CFG_KEY); const c = JSON.parse(raw._v); fn(c); map.set(CFG_KEY, { ...raw, _v: JSON.stringify(c) }); };
async function prepared({ config = RICH(), raw, edits = { bizName: "Wizard name" }, tenantId = "tenantA", bizId = "biz_1", fixed = FIXED, sel, opRef, storage } = {}) {
  const st = storage || makeStorage(raw !== undefined ? (raw === null ? {} : { [CFG_KEY]: raw }) : { [CFG_KEY]: { _v: JSON.stringify(config) } }, tenantId);
  const s2 = sel || selection(tenantId, bizId);
  const [cfg, sups, fx] = await runFinish(wizardStateFrom(raw !== undefined ? {} : config, edits), SUPS, fixed);
  const env = makeEditEnv({ storage: st, bizId, tenantId, sel: s2, opRef });
  return { st, env, sel: s2, args: [cfg, sups, fx], run: () => env.onComplete(cfg, sups, fx) };
}
const noUi = (env) => { assert.equal(env.spy.setBusinessConfig.length, 0, "no config state"); assert.equal(env.spy.setBusinesses.length, 0); assert.equal(env.spy.setShowSetup.length, 0, "wizard not closed"); assert.equal(env.spy.setSetupDone.length, 0); };
const successUi = (env) => { assert.deepEqual(env.spy.setShowSetup, [false]); assert.deepEqual(env.spy.setSetupDone, [true]); assert.equal(env.spy.alerts.length, 0); };
const keysWritten = (st) => st.writes.map((w) => w.key);

test("R1-01 an employee added between the initial UI state and the commit survives; the wizard edit commits", async () => {
  const p = await prepared();
  p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => c.employees.push({ id: 1714000000003, name: "נועה", type: "global", monthlySalary: "9900" })); });
  await p.run();
  const after = stored(p.st);
  assert.deepEqual(after.employees.map((e) => e.name), ["דנה", "יוסי", "נועה"]);
  assert.equal(after.businessName, "Wizard name");
  assert.deepEqual(p.st.writes.filter((w) => w.op === "txn").map((w) => w.attempt), [2], "the callback re-ran on the fresh value");
  assert.deepEqual(p.env.spy.setBusinessConfig.at(-1), after, "React state = the committed snapshot");
  successUi(p.env);
});

test("R1-02 petty-cash categories changed concurrently survive", async () => {
  const p = await prepared();
  p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => { c.pettyCashCategories = ["ניקיון", "דלק", "שליחויות"]; }); });
  await p.run();
  assert.deepEqual(stored(p.st).pettyCashCategories, ["ניקיון", "דלק", "שליחויות"]);
});

test("R1-03 an unknown / future top-level key changed concurrently survives byte-for-value", async () => {
  const p = await prepared();
  const value = { v: 2, list: [1, "two", { three: 3 }], "מפתח": null };
  p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => { c.futureFlag = value; }); });
  await p.run();
  assert.equal(JSON.stringify(stored(p.st).futureFlag), JSON.stringify(value));
});

test("R1-04 an unknown nested object changed concurrently keeps its latest nested value", async () => {
  const p = await prepared();
  p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => { c.futureModule.nested.level = 4; c.futureModule.revision = 2; }); });
  await p.run();
  assert.equal(stored(p.st).futureModule.nested.level, 4); assert.equal(stored(p.st).futureModule.revision, 2);
});

test("R1-05 an unknown targets sub-key changed concurrently survives; the owned target edits apply", async () => {
  const p = await prepared({ edits: { tFood: "30", tLabor: "25", tGrowth: "6" } });
  p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => { c.targets.owner_note = "changed concurrently"; c.targets.newSub = 9; }); });
  await p.run();
  assert.deepEqual(stored(p.st).targets, { salesGrowthPct: 6, foodCostPct: 30, laborCostPct: 25, owner_note: "changed concurrently", newSub: 9 });
});

test("R1-06 the same wizard-owned key changed concurrently ⇒ the wizard's submitted value deterministically wins at its commit", async () => {
  for (let i = 0; i < 3; i++) {
    const p = await prepared({ edits: { bizName: "Mine", rentType: "pct", rentPct: "7" } });
    p.st.interfereWith(async ({ attempt, map }) => { if (attempt === 1) concurrently(map, (c) => { c.businessName = "Theirs"; c.rentPct = 99; c.employees.push({ id: 9, name: "x" }); }); });
    await p.run();
    const after = stored(p.st);
    assert.equal(after.businessName, "Mine"); assert.equal(after.rentPct, 7); assert.equal(after.employees.length, 3, "their non-owned change still survives");
  }
});

test("R1-07 two compare-and-swap conflicts with cumulative unrelated edits ⇒ every edit survives; the intent commits once", async () => {
  const p = await prepared();
  p.st.interfereWith(async ({ attempt, map }) => {
    if (attempt === 1) concurrently(map, (c) => { c.employees.push({ id: 11, name: "A" }); });
    if (attempt === 2) concurrently(map, (c) => { c.employees.push({ id: 12, name: "B" }); c.pettyCashCategories.push("חדש"); c.futureModule.revision = 7; });
  });
  await p.run();
  const after = stored(p.st);
  assert.deepEqual(after.employees.map((e) => e.name), ["דנה", "יוסי", "A", "B"]);
  assert.ok(after.pettyCashCategories.includes("חדש")); assert.equal(after.futureModule.revision, 7); assert.equal(after.businessName, "Wizard name");
  const txns = p.st.writes.filter((w) => w.op === "txn");
  assert.equal(txns.length, 1); assert.equal(txns[0].attempt, 3); assert.equal(p.st.txnInputs.length, 3);
});

test("R1-08 the transaction callback is pure and re-entrant: same input ⇒ same output, no I/O / UI / clock / randomness, input never mutated", async () => {
  const M = requireMerge();
  const [cfg] = await runFinish(wizardStateFrom(RICH(), { bizName: "Pure" }), [], []);
  const fn = M.makeSetupWizardConfigTxn(cfg);
  const raw = { _v: JSON.stringify(RICH()), meta: { rev: 1 } };
  const snapshot = JSON.stringify(raw);
  const a = fn(clone(raw)), b = fn(clone(raw));
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.notEqual(a, undefined);
  fn(raw); assert.equal(JSON.stringify(raw), snapshot, "input not mutated");
  // the helper runs in a sandbox WITHOUT Date / Math / console / timers / storage
  const sandbox = { window: {}, Object, Array, JSON, Error };
  const src = HTML.slice(HTML.indexOf("// ── HF-1: Setup Wizard config preservation"), HTML.indexOf(");", HTML.indexOf("window.MarjinConfigMerge = Object.freeze(")) + 2);
  vm.runInNewContext(src, sandbox);
  const isolated = sandbox.window.MarjinConfigMerge.makeSetupWizardConfigTxn(cfg);
  assert.equal(JSON.stringify(isolated(clone(raw))), JSON.stringify(a), "same output with no ambient capability available");
  const body = src.slice(src.indexOf("function makeSetupWizardConfigTxn"), src.indexOf("const setupSaveErrorReason"));
  assert.doesNotMatch(body, /Date|Math\.|random|console|alert|window|await|storage|setTimeout/);
  // the production path hands the callback the raw node and stores exactly its output
  const p = await prepared({ edits: { bizName: "Pure" } });
  await p.run();
  assert.equal(p.st.nodes.get(CFG_KEY)._v, fn(p.st.txnInputs[0])._v);
});

test("R1-09 a CONFIRMED-absent config node ⇒ a valid `_v` envelope is created (absent ≠ unreadable)", async () => {
  const p = await prepared({ raw: null, edits: { bizName: "Fresh" } });
  await p.run();
  assert.deepEqual(p.st.txnInputs, [null]);
  const node = p.st.nodes.get(CFG_KEY);
  assert.deepEqual(Object.keys(node), ["_v"]); assert.equal(JSON.parse(node._v).businessName, "Fresh");
  assert.equal("employees" in JSON.parse(node._v), false);
  successUi(p.env);
});

test("R1-10 a legacy direct-object config (no `_v`) keeps every property and is normalised to the `_v` envelope", async () => {
  const legacy = RICH();
  const p = await prepared({ raw: legacy, edits: { bizName: "Legacy edit" } });
  await p.run();
  const node = p.st.nodes.get(CFG_KEY);
  assert.deepEqual(Object.keys(node), ["_v"]);
  const after = JSON.parse(node._v);
  assert.equal(after.businessName, "Legacy edit");
  assert.deepEqual(pick(after, NON_OWNED), pick(legacy, NON_OWNED));
});

test("R1-11 unknown sibling nodes of the envelope survive while `_v` changes", async () => {
  const p = await prepared({ raw: { _v: JSON.stringify(RICH()), meta: { rev: 3, by: "other-writer" }, extra: "sibling" }, edits: { bizName: "Sib" } });
  await p.run();
  const node = p.st.nodes.get(CFG_KEY);
  assert.deepEqual(node.meta, { rev: 3, by: "other-writer" }); assert.equal(node.extra, "sibling");
  assert.equal(JSON.parse(node._v).businessName, "Sib");
});

test("R1-12 `_v` is invalid JSON ⇒ the transaction aborts; zero later writes; wizard stays open; visible error", async () => {
  const raw = { _v: "{not json" };
  const p = await prepared({ raw });
  await p.run();
  assert.deepEqual(p.st.writes, []); assert.deepEqual(p.st.dispatched.map((d) => d.op), ["mutateFor"]);
  assert.deepEqual(p.st.nodes.get(CFG_KEY), raw);
  noUi(p.env); assert.equal(p.env.spy.alerts.length, 1); assert.match(p.env.spy.alerts[0], /פגומות/);
  assert.match(p.env.spy.errors.join(" "), /malformed_config/); assert.doesNotMatch(p.env.spy.errors.join(" "), /not json/, "no raw config content logged");
});

test("R1-13 `_v` parsing to null / array / primitive, a non-string `_v`, or a non-object node ⇒ each aborts with no write", async () => {
  for (const raw of [{ _v: "null" }, { _v: "[1,2]" }, { _v: "42" }, { _v: JSON.stringify("text") }, { _v: true }, { _v: 42 }, { _v: { a: 1 } }]) {
    const p = await prepared({ raw });
    await p.run();
    assert.deepEqual(p.st.writes, [], JSON.stringify(raw)); assert.deepEqual(p.st.nodes.get(CFG_KEY), raw); noUi(p.env); assert.equal(p.env.spy.alerts.length, 1);
  }
  const M = requireMerge();
  for (const bad of [[1], "str", 7, true]) assert.equal(M.decodeRawBusinessConfigNode(bad).ok, false, JSON.stringify(bad));
  assert.equal(M.makeSetupWizardConfigTxn({ businessName: "x" })([1, 2]), undefined);
});

test("R1-14 the transaction rejects (permission / network / read failure) ⇒ zero later writes, no success UI, typed failure", async () => {
  for (const [err, reason] of [[new Error("PERMISSION_DENIED: Permission denied"), "permission_denied"], [new Error("Client is offline"), "write_failed"]]) {
    const p = await prepared();
    p.st.failOn(CFG_KEY, err);
    await p.run();
    assert.deepEqual(p.st.writes, []); assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY]);
    noUi(p.env); assert.equal(p.env.spy.alerts.length, 1); assert.match(p.env.spy.errors.join(" "), new RegExp(reason));
  }
});

test("R1-15 SDK retry exhaustion and `committed:false` are failures: no outer blind retry, no later writes", async () => {
  const p = await prepared();
  p.st.setMaxRetry(3);
  p.st.interfereWith(async ({ map }) => concurrently(map, (c) => { c.tick = (c.tick || 0) + 1; }));
  await p.run();
  assert.equal(p.st.dispatched.length, 1, "exactly one transaction dispatch (no outer retry)");
  assert.equal(p.st.writes.length, 0); noUi(p.env); assert.match(p.env.spy.errors.join(" "), /retry_exhausted/);
  const q = await prepared();
  q.st.forceUncommitted();
  await q.run();
  assert.deepEqual(q.st.writes, []); assert.equal(q.st.dispatched.length, 1); noUi(q.env); assert.match(q.env.spy.errors.join(" "), /not_committed/);
});

test("R1-16 a selection that is already stale before the first dispatch ⇒ zero writes and zero state changes", async () => {
  const sel = selection("tenantA", "biz_1");
  const p = await prepared({ sel });
  // the production helper with a context that is no longer live dispatches nothing
  const helperIo = (liveFn) => ({ selection: { isLive: liveFn }, isCurrentOp: () => true, mutateFor: p.st.mutateFor, setFor: p.st.setFor });
  const M = requireMerge();
  const res = await M.runSetupWizardEditSave(helperIo(() => false), { ctx: { tenantId: "tenantA", bizId: "biz_1", gen: 1 }, token: {}, wizardCfg: p.args[0], suppliers: SUPS, fixed: FIXED, businesses: [] });
  assert.equal(res.status, "stale"); assert.deepEqual(p.st.dispatched, []);
  // at the call site: the wizard's business no longer matches the live selection
  const mismatch = makeEditEnv({ storage: p.st, bizId: "biz_1", sel, currentBizId: "biz_9" });
  await mismatch.onComplete(...p.args);
  assert.deepEqual(p.st.dispatched, []); noUi(mismatch);
  const missing = await M.runSetupWizardEditSave(helperIo(() => true), { ctx: { tenantId: null, bizId: "biz_1", gen: 1 }, token: {}, wizardCfg: p.args[0] });
  assert.deepEqual([missing.status, missing.reason], ["failed", "missing_identity"]); assert.deepEqual(p.st.dispatched, []);
});

test("R1-17 selection changes while the config transaction is pending ⇒ only it settles, at the captured tenant/business; no later writes or UI", async () => {
  const p = await prepared();
  const gate = p.st.pause(CFG_KEY);
  const run = p.run();
  await gate.reached; p.sel.switchTo("tenantB", "biz_7"); gate.release(); await run;
  assert.deepEqual(p.st.writes.map((w) => [w.tenantId, w.key]), [["tenantA", CFG_KEY]]);
  assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY]); noUi(p.env); assert.equal(p.env.spy.alerts.length, 0);
});

/** Makes the selection stale right AFTER the write to `key` settles (before the next dispatch). */
function staleAfter(p, key) {
  for (const t of ["setFor", "mutateFor"]) {
    const orig = p.st[t];
    p.st[t] = async (...a) => { const r = await orig(...a); if (a[1] === key) p.sel.switchTo("tenantA", "biz_2"); return r; };
  }
  p.env.window.storage = p.st;
}
async function pendingThenStale(p, key) { const gate = p.st.pause(key); const run = p.run(); await gate.reached; p.sel.switchTo("tenantA", "biz_2"); gate.release(); await run; }

test("R1-18 selection changes after config settles, before the app-businesses dispatch ⇒ no app-businesses / supplier / fixed write, no success UI", async () => {
  const p = await prepared();
  staleAfter(p, CFG_KEY);
  await p.run();
  assert.deepEqual(keysWritten(p.st), [CFG_KEY]); assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY]); noUi(p.env);
});

test("R1-19 selection changes while the app-businesses write is pending ⇒ it stays on the captured tenant; suppliers / fixed never dispatch", async () => {
  const p = await prepared();
  await pendingThenStale(p, "app-businesses");
  assert.deepEqual(p.st.writes.map((w) => [w.tenantId, w.key]), [["tenantA", CFG_KEY], ["tenantA", "app-businesses"]]);
  assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY, "app-businesses"]); noUi(p.env);
});

test("R1-20 selection changes before the supplier dispatch ⇒ suppliers / fixed never dispatch; no success UI", async () => {
  const p = await prepared();
  staleAfter(p, "app-businesses");
  await p.run();
  assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY, "app-businesses"]); noUi(p.env);
});

test("R1-21 selection changes while the supplier write is pending ⇒ it stays on the captured tenant/business; fixed never dispatches", async () => {
  const p = await prepared();
  await pendingThenStale(p, SUP_KEY);
  assert.deepEqual(p.st.writes.map((w) => [w.tenantId, w.key]), [["tenantA", CFG_KEY], ["tenantA", "app-businesses"], ["tenantA", SUP_KEY]]);
  assert.ok(!p.st.dispatched.some((d) => d.key === FIX_KEY)); noUi(p.env);
});

test("R1-22 selection changes before the fixed-cost dispatch ⇒ fixed never dispatches; no success UI", async () => {
  const p = await prepared();
  staleAfter(p, SUP_KEY);
  await p.run();
  assert.deepEqual(p.st.dispatched.map((d) => d.key), [CFG_KEY, "app-businesses", SUP_KEY]); noUi(p.env);
});

test("R1-23 selection changes while the fixed-cost write is pending ⇒ it stays captured; the stale completion cannot close the wizard or touch the new selection", async () => {
  const p = await prepared();
  await pendingThenStale(p, FIX_KEY);
  assert.deepEqual(p.st.writes.map((w) => [w.tenantId, w.key]), [["tenantA", CFG_KEY], ["tenantA", "app-businesses"], ["tenantA", SUP_KEY], ["tenantA", FIX_KEY]]);
  noUi(p.env); assert.equal(p.env.spy.setSuppliers.length, 0); assert.equal(p.env.spy.setFixedList.length, 0);
});

test("R1-24 the same bizId under a different tenant / generation ⇒ no cross-tenant write; every path uses the captured tenant", async () => {
  const p = await prepared();
  p.st.tenants.set("tenantB", new Map([[CFG_KEY, { _v: JSON.stringify({ businessName: "B's business" }) }]]));
  const gate = p.st.pause("app-businesses");
  const run = p.run();
  await gate.reached; p.sel.switchTo("tenantB", "biz_1"); gate.release(); await run;
  assert.ok(p.st.writes.every((w) => w.tenantId === "tenantA"));
  assert.deepEqual(JSON.parse(p.st.tenants.get("tenantB").get(CFG_KEY)._v), { businessName: "B's business" });
  assert.equal(p.st.tenants.get("tenantB").size, 1, "tenant B received nothing");
  noUi(p.env);
  // a bumped generation for the SAME tenant/business is also a different context
  const q = await prepared();
  q.st.mutateFor = (orig => async (...a) => { const r = await orig(...a); q.sel.switchTo("tenantA", "biz_1"); return r; })(q.st.mutateFor);
  q.env.window.storage = q.st;
  await q.run();
  assert.deepEqual(q.st.dispatched.map((d) => d.key), [CFG_KEY]); noUi(q.env);
});

test("R1-25 app-businesses / supplier / fixed failures, each injected separately ⇒ stop at the first failure, visible, wizard open, no rollback; a retry converges", async () => {
  const reference = await prepared({ edits: { bizName: "Retry" } });
  await reference.run();
  for (const key of ["app-businesses", SUP_KEY, FIX_KEY]) {
    const p = await prepared({ edits: { bizName: "Retry" } });
    p.st.failOn(key, new Error("network error"));
    await p.run();
    const order = [CFG_KEY, "app-businesses", SUP_KEY, FIX_KEY];
    assert.deepEqual(p.st.dispatched.map((d) => d.key), order.slice(0, order.indexOf(key) + 1), key + ": stopped at the first failure");
    assert.equal(stored(p.st).businessName, "Retry", "the committed config is NOT rolled back");
    assert.deepEqual(stored(p.st).employees, RICH().employees);
    noUi(p.env); assert.equal(p.env.spy.alerts.length, 1); assert.match(p.env.spy.alerts[0], /לא הושלמה/);
    await p.run(); // user retries with the same frozen intent
    for (const k of order) assert.deepEqual(p.st.nodes.get(k), reference.st.nodes.get(k), key + " retry converges on " + k);
    assert.deepEqual(p.env.spy.setShowSetup, [false], "the successful retry closes the wizard once"); assert.deepEqual(p.env.spy.setSetupDone, [true]);
  }
});

test("R1-26 duplicate click / an older submission completing after a newer token ⇒ only the current operation owns later writes and UI", async () => {
  const opRef = { current: null };
  const sel = selection("tenantA", "biz_1");
  const st = makeStorage({ [CFG_KEY]: { _v: JSON.stringify(RICH()) } });
  const older = await prepared({ storage: st, sel, opRef, edits: { bizName: "Same" } });
  const newer = await prepared({ storage: st, sel, opRef, edits: { bizName: "Same" } });
  const gate = st.pause(CFG_KEY);
  const first = older.run();
  await gate.reached;
  await newer.run();            // the newer click takes ownership and completes the full sequence
  gate.release(); await first;  // the older in-flight transaction settles, then stops
  const dispatchedKeys = st.dispatched.map((d) => d.key);
  assert.equal(dispatchedKeys.filter((k) => k === CFG_KEY).length, 2);
  assert.equal(dispatchedKeys.filter((k) => k === "app-businesses").length, 1, "only the owning operation dispatches later writes");
  assert.equal(dispatchedKeys.filter((k) => k === SUP_KEY).length, 1);
  noUi(older.env); successUi(newer.env);
  assert.equal(stored(st).businessName, "Same"); assert.deepEqual(stored(st).employees, RICH().employees);
});

test("R1-27 create-new-business and first-business paths keep their behaviour and write set (completeSetup byte-identical)", async () => {
  const { gitIn } = await import("../support/git-context.mjs");
  const orig = gitIn(ROOT, ["show", "95d20d8646736fe1c80c949924fa7875fbda90d2:index.html"]);
  assert.equal(orig.status, 0, orig.stderr);
  const block = (html, anchor) => { const at = html.indexOf(anchor); assert.notEqual(at, -1, anchor); let d = 0, i = html.indexOf("{", at); for (; i < html.length; i++) { if (html[i] === "{") d++; else if (html[i] === "}" && --d === 0) break; } return html.slice(at, i + 1); };
  const cs = "const completeSetup = async (cfg, sups, fixed, firstOwner) => {";
  assert.equal(block(HTML, cs), block(orig.stdout, cs), "completeSetup is byte-identical to the HF-1 candidate");
  const nb = "// Add new business -- show setup whenever showSetup=true and logged in";
  const slice = (h) => h.slice(h.indexOf(nb), h.indexOf("isFirstSetup={false}", h.indexOf(nb)));
  assert.equal(slice(HTML), slice(orig.stdout), "the new-business <SetupWizard> call site is byte-identical");
  assert.match(HTML, /onComplete=\{\(cfg, sups, fixed\) => \{ completeSetup\(cfg, sups, fixed, null\); \}\}/);
  // first business (bizId === tenantId): edited in place, through the captured tenant, full write set
  const tid = "t_1714000000000";
  const st = makeStorage({ [`biz:${tid}:config`]: { _v: JSON.stringify(RICH()) } }, tid);
  const p = await prepared({ storage: st, tenantId: tid, bizId: tid, edits: { bizName: "First" } });
  await p.run();
  assert.deepEqual(st.writes.map((w) => [w.tenantId, w.key]), [[tid, `biz:${tid}:config`], [tid, "app-businesses"], [tid, `biz:${tid}:suppliers`], [tid, `biz:${tid}:fixed`]]);
});

test("R1-28 repeated edits + combined employee / petty-cash / unknown interleavings ⇒ idempotent final values, no unrelated-key loss; the wiring contract holds", async () => {
  const st = makeStorage({ [CFG_KEY]: { _v: JSON.stringify(RICH()) } });
  let round = 0;
  st.interfereWith(async ({ attempt, map }) => {
    if (attempt !== 1) return;
    round++;
    concurrently(map, (c) => { c.employees.push({ id: 100 + round, name: "E" + round }); c.pettyCashCategories.push("C" + round); c.futureModule.revision = round; });
  });
  for (let i = 0; i < 2; i++) { const p = await prepared({ storage: st, edits: { bizName: "Stable", tFood: "30" } }); await p.run(); successUi(p.env); }
  const after = stored(st);
  assert.deepEqual(after.employees.map((e) => e.name), ["דנה", "יוסי", "E1", "E2"]);
  assert.deepEqual(after.pettyCashCategories.slice(-2), ["C1", "C2"]); assert.equal(after.futureModule.revision, 2);
  assert.equal(after.businessName, "Stable"); assert.equal(after.targets.foodCostPct, 30); assert.equal(after.targets.owner_note, "future target key");
  st.interfereWith(null);
  const snapshot = st.nodes.get(CFG_KEY)._v;
  const again = await prepared({ storage: st, edits: { bizName: "Stable", tFood: "30" } }); await again.run();
  assert.equal(st.nodes.get(CFG_KEY)._v, snapshot, "a repeated identical edit is byte-identical");
  // wiring: transaction for config, explicit-tenant writes after it, a liveness check right before
  // every dispatch and right after every settle, no legacy get/set on the edit path
  assert.deepEqual(st.reads, []); assert.ok(st.writes.every((w) => w.op === "txn" || w.op === "setFor"));
  const log = st.log.slice(st.log.lastIndexOf("dispatch:" + CFG_KEY) - 1);
  log.forEach((e, i) => { if (e.startsWith("dispatch:")) assert.equal(log[i - 1], "live", "live check before " + e); if (e.startsWith("settle:")) assert.equal(log[i + 1], "live", "live check after " + e); });
  assert.deepEqual(log.filter((e) => e.startsWith("dispatch:")), ["dispatch:" + CFG_KEY, "dispatch:app-businesses", "dispatch:" + SUP_KEY, "dispatch:" + FIX_KEY]);
  assert.doesNotMatch(SRC.editOnComplete, /window\.storage\.(get|set)\(/, "no mutable-tenant get/set on the edit path");
  assert.match(SRC.editOnComplete, /window\.storage\.mutateFor\(/); assert.match(SRC.editOnComplete, /window\.storage\.setFor\(/);
  assert.doesNotMatch(SRC.editOnComplete, /currentBizId\}:|`biz:\$\{bizId\}/, "no destination rebuilt from mutable state");
});
