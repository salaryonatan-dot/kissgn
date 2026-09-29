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

// ── in-memory window.storage with the production envelope semantics ───────────
function makeStorage(initial = {}) {
  const nodes = new Map(Object.entries(initial)); // key → raw node (e.g. {_v:"…"})
  const writes = [];
  const reads = [];
  let failRead = null;
  return {
    nodes, writes, reads,
    failNextReads(err) { failRead = err; },
    get: async (key, shared = false) => {
      reads.push({ key, shared });
      if (failRead) throw failRead;
      if (!nodes.has(key)) throw new Error("not found");
      const raw = nodes.get(key);
      const value = (raw && typeof raw === "object" && "_v" in raw) ? raw._v : JSON.stringify(raw);
      return { key, value, shared };
    },
    set: async (key, value, shared = false) => {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      writes.push({ key, value: str, shared });
      nodes.set(key, { _v: str });
      return { key, value: str, shared };
    },
    config: (bizId) => { const n = nodes.get(`biz:${bizId}:config`); return n ? JSON.parse(n._v) : undefined; },
  };
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
function makeEditEnv({ storage, bizId, tenantId = "tenantA", businesses, sel = selection(tenantId, bizId) }) {
  const spy = { setBusinessConfig: [], setSuppliers: [], setFixedList: [], setBusinesses: [], setShowSetup: [], setSetupDone: [], alerts: [], errors: [] };
  const window = { storage, MarjinConfigMerge: MERGE || undefined, _currentTenantId: tenantId };
  const sandbox = {
    window, currentBizId: bizId, businesses: businesses || [{ id: bizId, name: "Old name" }],
    setBusinessConfig: (v) => spy.setBusinessConfig.push(JSON.parse(JSON.stringify(v))),
    setSuppliers: (v) => spy.setSuppliers.push(v), setFixedList: (v) => spy.setFixedList.push(v),
    setBusinesses: (v) => spy.setBusinesses.push(v), setShowSetup: (v) => spy.setShowSetup.push(v), setSetupDone: (v) => spy.setSetupDone.push(v),
    captureSelectionCtx: () => sel.capture(), isSelectionLive: (ctx) => sel.isLive(ctx),
    alert: (m) => spy.alerts.push(String(m)),
    console: { error: (...a) => spy.errors.push(a.map(String).join(" ")), log: () => {}, warn: () => {} },
    JSON, Object, Array, Number, String, Error, Promise,
  };
  const onComplete = vm.runInNewContext(`(${SRC.editOnComplete})`, sandbox);
  return { onComplete, spy, sel, window };
}

async function editRoundTrip({ stored, bizId = "biz_1", edits = {}, suppliers = [{ id: "s1", name: "ספק", category: "כללי", days: [] }], fixed = [{ id: "f1", name: "ארנונה", amount: 900 }], tenantId, businesses, sel, storage }) {
  const st = storage || makeStorage(stored === undefined ? {} : { [`biz:${bizId}:config`]: { _v: JSON.stringify(stored) } });
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

test("9c the selection changes while the stored config is being read ⇒ nothing is written", async () => {
  const storage = makeStorage({ "biz:biz_1:config": { _v: JSON.stringify(RICH()) } });
  const sel = selection("tenantA", "biz_1");
  const origGet = storage.get;
  storage.get = async (...a) => { const r = await origGet(...a); sel.switchTo("tenantA", "biz_2"); return r; };
  const [cfg, sups, fx] = await runFinish(wizardStateFrom(RICH(), { bizName: "Q" }), [], []);
  const env = makeEditEnv({ storage, bizId: "biz_1", sel });
  await env.onComplete(cfg, sups, fx);
  assert.deepEqual(storage.writes, []);
  assert.equal(env.spy.setBusinessConfig.length, 0);
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
  assert.deepEqual(storage.reads.map((r) => r.key), [`biz:${tenantId}:config`]);
  assert.ok(storage.writes.some((w) => w.key === `biz:${tenantId}:config`));
  assert.deepEqual(after.employees, before.employees);
  assert.deepEqual(plain(env.spy.setBusinesses.at(-1)), [{ id: tenantId, name: "First" }]);
});

test("owned lists (suppliers, fixed costs) and the business list are still written by the edit", async () => {
  const { storage, env } = await editRoundTrip({ stored: RICH(), edits: { bizName: "L" } });
  const keys = storage.writes.map((w) => w.key);
  assert.deepEqual(keys, ["app-businesses", "biz:biz_1:config", "biz:biz_1:suppliers", "biz:biz_1:fixed"]);
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
