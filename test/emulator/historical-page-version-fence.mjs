// Marjin — P0-DATA-01 VERSION FENCE R1: RENDERED HISTORICAL PAGE PROOF (Gate F) on the REAL emulator.
//
// ONE retained rendered session of the ACTUAL historical page (index.html @ 1038b4cd…, the last
// all-legacy client build) is booted in jsdom through test/historical/historical-page-harness.mjs:
// its real React tree renders, it auto-logs-in from a retained browser session, hydrates a
// legacy business, and every write below is triggered by CLICKING ITS OWN UI (history screen
// "מחק" per-row delete, "clear all") or by calling ITS OWN `window.storage` transport bytes.
// The page is never reloaded or recreated between phases; the operator acts through the
// Admin control plane in the same process, exactly as VF-26 did for the engine-level proof.
//
// Expected server truth: legacy (no record) → the page's write commits; quiesced → DENIED;
// converted + v2_active → the page's legacy write, clear-all and node delete DENIED, authoritative
// V2 rows and the frozen `_v` byte-identical. The page's UI may stay misleading (accepted).
//
// Deps: run test/historical/install-deps.sh once (exit 5 = EVIDENCE_DEPS_MISSING, never a silent skip).
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { createStoragePolicyControl } from "../../tools/storage-v2/policy.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";
import { createLegacyPreflight } from "../../tools/storage-v2/preflight.mjs";
import { loadProductionWindow } from "../support/dashboard-wiring-harness.mjs";
import { gitIn } from "../support/git-context.mjs";
import { authorizedVersionFenceRulesDelta } from "../support/rules-authorized-delta.mjs";
import { bootHistoricalPage, depsStatus, click, textOf, HISTORICAL_SHA } from "../historical/historical-page-harness.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const CORE_SHA = "47f7f8882846b4b0c90fba2947ca3053eb90a9f0";
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
}
const CANONICAL_RULES = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error("rules load failed: " + res.status + " " + (await res.text()));
}

// conversion core (unchanged) wired exactly as the fence matrix does
const W = loadProductionWindow();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
const { preflightLegacyNode } = createLegacyPreflight({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId, isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r), entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS });
const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST });

// ── fixtures: a legacy tenant exactly as the historical page expects it ─────────────
const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid = (seed) => { const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const pad = (n) => String(n).padStart(2, "0");
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // the page computes its month from the local clock
// FIXTURE DATE CONTROL (RC 1.0 release assembly). The page's history screen lists ONLY the
// current month's dates 1…today (one row per date), so the three fixture rows must be three
// distinct current-month dates on or before the PAGE's today. On the 1st/2nd of a month the real
// clock cannot offer three, HP-02 consumed the only row and HP-03/HP-04 found nothing to click.
// The fixture therefore runs the page on ONE test clock shared by both realms: the run date when
// it already offers three dates, otherwise the same local time on day 3 of the same month. The
// page realm gets it through the harness's isolated Date shim (never the machine clock); every
// assertion and the production/historical code are unchanged. HP_FIXTURE_RUN_AT (local
// "YYYY-MM-DDTHH:MM:SS", verification only) simulates the run date the rule is applied to, so the
// month-start behaviour can be proven on any day.
const MIN_ROWS = 3;
function runAtMs(realNow) {
  const v = process.env.HP_FIXTURE_RUN_AT;
  if (!v) return realNow;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) fail(`HP_FIXTURE_RUN_AT must be local YYYY-MM-DDTHH:MM:SS, got ${v}`);
  const t = new Date(v).getTime(); if (!Number.isFinite(t)) fail(`HP_FIXTURE_RUN_AT unparseable: ${v}`);
  return t;
}
function fixtureClockOffsetMs(realNow = Date.now()) {
  const runAt = runAtMs(realNow), d = new Date(runAt);
  const target = d.getDate() >= MIN_ROWS ? runAt : new Date(d.getFullYear(), d.getMonth(), MIN_ROWS, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
  return target - realNow;
}
const CLOCK_OFFSET_MS = fixtureClockOffsetMs();
const fixtureNow = () => new Date(Date.now() + CLOCK_OFFSET_MS);
function thisMonthDates(n) { const out = []; const now = fixtureNow(); for (let i = 0; i < n; i++) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); if (d.getMonth() !== now.getMonth()) break; out.push(localKey(d)); } return out; }
const DATES = thisMonthDates(MIN_ROWS);
if (DATES.length !== MIN_ROWS) fail(`fixture clock offers ${DATES.length} current-month dates, need ${MIN_ROWS}`);
const row = (i, date) => ({ id: uuid("hp" + i), date, sales: 1000 + i, deliveries: 10 + i, other_income: 0, food_cost: 0, payroll: 0, other_expense: 0, notes: "" });
const ROWS = () => DATES.map((d, i) => row(i + 1, d));
const envelope = (rows) => ({ _v: JSON.stringify(rows) });
const PATH = "tenants/tenantA/biz:bizA:entries";
const CTRL = "storage_v2_control/tenantA/bizA";
const USER = { uid: "u_manager", email: "m@demo.example", displayName: "manager1" };
const fixtures = () => ({
  tenants: { tenantA: {
    members: { u_owner: true, u_manager: true }, roles: { u_owner: "owner", u_manager: "manager" }, biz_access: { bizA: { u_manager: true } },
    app: { users: envelope([{ id: 1, username: "manager1", name: "מנהל", email: USER.email, role: "manager", firebaseUid: USER.uid }]),
           business: envelope([{ id: "bizA", name: "סניף בדיקה" }]) },
    "biz:bizA:entries": envelope(ROWS()),
    "biz:bizA:config": envelope({ businessName: "סניף בדיקה", rentPct: 0, royaltyPct: 0, hasRoyalty: false, targets: { salesGrowthPct: 5, foodCostPct: 33, laborCostPct: 27 } }),
  } },
  user_tenants: { u_manager: "tenantA" }, user_active_biz: { u_manager: "bizA" },
  username_index: { manager1: { tenantId: "tenantA", email: USER.email } },
});
const apps = {};
const seedDb = () => apps.seed.database();
const readNode = async () => { const s = await seedDb().ref(PATH).once("value"); return s.exists() ? s.val() : null; };
const snapshot = async () => JSON.stringify(await readNode());
const legacyRows = async () => JSON.parse((await readNode())._v);
const controlIo = {
  readControl: async (t, b) => { const s = await seedDb().ref(`storage_v2_control/${t}/${b}`).once("value"); return s.exists() ? s.val() : null; },
  transactControl: async (t, b, fn) => { const r = await seedDb().ref(`storage_v2_control/${t}/${b}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; },
  readEntriesNode: async (t, b) => { const s = await seedDb().ref(`tenants/${t}/biz:${b}:entries`).once("value"); return s.exists() ? s.val() : null; },
};
const adminEntriesIo = { transactNode: async (t, key, fn) => { const r = await seedDb().ref(`tenants/${t}/${key}`).transaction(fn, undefined, false); return { committed: r.committed, snapshot: r.snapshot }; } };
const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));

// ── runner ──
const results = []; let failures = 0;
async function run(id, description, fn) {
  const t0 = Date.now();
  try { const n = await fn(); results.push({ id, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

// ── page drivers (the page's OWN UI) ──
const deleteButtons = (doc) => Array.from(doc.querySelectorAll("button")).filter((b) => textOf(b) === "מחק");
async function openHistory(page) {
  const card = page.document.querySelector(".kpi-card-link");
  expect(card, "dashboard KPI card (history link) rendered");
  click(card);
  await page.until(() => deleteButtons(page.document).length > 0 || textOf(page.document.body).includes("פדיון יומי"), 8000);
}
async function clickDelete(page, index = 0) {
  const btns = deleteButtons(page.document);
  expect(btns.length > index, `history screen shows ${btns.length} deletable rows, need > ${index}`);
  click(btns[index]);
}
async function clickClearAll(page) {
  const btn = Array.from(page.document.querySelectorAll("button")).find((b) => /למחוק את כל|נקה הכל|מחק הכל/.test(textOf(b)) || textOf(b) === "נקה");
  expect(btn, "history screen clear-all button present");
  click(btn);
}
// the page's own transport bytes (window.storage of index.html@1038b4c), non-UI shapes an old build can emit
async function pageTransportDenied(page, label) {
  const before = await snapshot();
  const attempts = {
    "setFor {_v} whole node": () => page.window.storage.setFor("tenantA", "biz:bizA:entries", "[]", true),
    "set {_v} whole node": () => page.window.storage.set("biz:bizA:entries", "[]", true),
    "delete whole node": () => page.window.storage.delete("biz:bizA:entries", true),
    "mutateFor CAS → {_v}": () => page.window.storage.mutateFor("tenantA", "biz:bizA:entries", () => ({ _v: "[]" })).then((r) => { if (r && r.committed === false) return; throw new Error("committed"); }),
  };
  for (const [name, fn] of Object.entries(attempts)) {
    let err = null; try { await fn(); } catch (e) { err = e; }
    if (!err || !denied(err)) throw new Error(`${label} ${name}: NOT denied (${err ? err.message : "succeeded"})`);
    eq(await snapshot(), before, `${label} ${name}: node changed`);
  }
  return Object.keys(attempts).length;
}

async function main() {
  assertSafe();
  const deps = depsStatus();
  if (!deps.ok) { console.error(`EVIDENCE_DEPS_MISSING: ${deps.missing.join(", ")} — run test/historical/install-deps.sh`); process.exitCode = 5; return; }
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.manager = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: USER.uid, token: { email: USER.email } } }, "manager");
  const coreRules = JSON.parse(gitIn(ROOT, ["show", `${CORE_SHA}:database.rules.json`]).stdout);
  if (authorizedVersionFenceRulesDelta(coreRules, CANONICAL_RULES).ok !== true) fail("live rules are not core + exact fence delta");
  await loadRules(CANONICAL_RULES);
  await seedDb().ref("/").set(fixtures());
  const C = createStoragePolicyControl(controlIo);
  const convert = C.createFencedConversion({ upgradeBusinessToV2, entriesIo: adminEntriesIo });
  let page = null; const deletedIds = [];
  const session = { ["marjin_tid_" + USER.uid]: "tenantA", ["marjin_biz_" + USER.uid]: "bizA" };

  await run("HP-01", `boot the ACTUAL historical page (index.html@${HISTORICAL_SHA.slice(0, 8)}) in jsdom: real React render, retained-session auto-login, legacy business hydrated`, async () => {
    page = await bootHistoricalPage({ adminApp: apps.manager, user: USER, session, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS });
    await page.until(() => page.document.querySelector(".kpi-card-link") !== null, 15000);
    const body = textOf(page.document.body);
    expect(body.includes("סניף בדיקה") || body.length > 500, "dashboard rendered with content");
    expect(page.document.querySelectorAll("*").length > 80, "a real component tree is mounted (" + page.document.querySelectorAll("*").length + " nodes)");
    const fatal = page.console.errors.filter((e) => /ReferenceError|TypeError|is not defined/.test(e));
    expect(fatal.length === 0, "no fatal runtime errors: " + fatal.slice(0, 3).join(" | "));
    const pageToday = localKey(new page.window.Date());
    eq(pageToday, localKey(fixtureNow()), "page realm and fixture share ONE test clock");
    return `${page.document.querySelectorAll("*").length} DOM nodes, ${DATES.length} legacy rows for ${DATES.join(",")}; page today ${pageToday} (clock offset ${CLOCK_OFFSET_MS} ms)`;
  });

  await run("HP-02", "legacy (no control record): a per-row delete clicked in the page's history screen COMMITS through the page's own {_v} CAS transport", async () => {
    await openHistory(page);
    await page.until(() => deleteButtons(page.document).length >= DATES.length, 8000).catch(() => {});
    eq(deleteButtons(page.document).length, DATES.length, "the history screen lists every fixture row as deletable (fixture clock sanity)");
    const before = await legacyRows();
    await clickDelete(page, 0);
    await page.until(async () => false, 0).catch(() => {});
    let after = before; const t0 = Date.now();
    while (JSON.stringify(after) === JSON.stringify(before) && Date.now() - t0 < 6000) { await page.sleep(100); after = await legacyRows(); }
    eq(after.length, before.length - 1, "one row removed on the server");
    const gone = before.find((r) => !after.some((x) => x.id === r.id)); deletedIds.push(gone.id);
    eq(typeof (await readNode())._v, "string", "still a legacy node");
    return `deleted ${gone.date} via UI click; server rows ${before.length}→${after.length}`;
  });

  await run("HP-03", "quiesced (Admin control plane) — SAME open page: per-row delete click, clear-all click and the page's own transport shapes are all DENIED; node byte-identical", async () => {
    await C.initializeLegacy("tenantA", "bizA", { operator: "operator" });
    await C.quiesce("tenantA", "bizA", { expectedRevision: 1, operator: "operator", operationId: "hp-op" });
    const before = await snapshot();
    await clickDelete(page, 0); await page.sleep(1500);
    eq(await snapshot(), before, "delete click under quiesced");
    await clickClearAll(page); await page.sleep(1500);
    eq(await snapshot(), before, "clear-all click under quiesced");
    const n = await pageTransportDenied(page, "quiesced");
    eq(await snapshot(), before, "node byte-identical after all attempts");
    return `UI delete + clear-all + ${n} transport shapes denied`;
  });

  await run("HP-04", "conversion (fenced Admin lane) + v2_active — SAME open page: legacy delete click, clear-all click, `_v`-bearing node overwrite and node delete DENIED; V2 rows and frozen `_v` byte-identical", async () => {
    const conv = await convert("tenantA", "bizA", { expectedRevision: 2, operator: "operator", operationId: "hp-op" });
    eq(conv.result.status, "committed", "conversion");
    await C.activateV2("tenantA", "bizA", { expectedRevision: 3, operator: "operator", operationId: "hp-op" });
    const rec = (await seedDb().ref(CTRL).once("value")).val(); eq(rec.phase, "v2_active", "activated");
    await page.sleep(500);   // the page's live listener receives the V2 node (its generic reader still shows the frozen `_v` — accepted)
    const before = await snapshot(); const node = JSON.parse(before);
    eq(node.schemaVersion, 2, "V2 node"); expect(typeof node._v === "string", "frozen _v present");
    expect(deleteButtons(page.document).length > 0, "the historical UI still offers deletes (misleading, accepted)");
    await clickDelete(page, 0); await page.sleep(1500);
    eq(await snapshot(), before, "delete click under v2_active");
    await clickClearAll(page); await page.sleep(1500);
    eq(await snapshot(), before, "clear-all click under v2_active");
    const n = await pageTransportDenied(page, "v2_active");
    const after = JSON.parse(await snapshot());
    eq(JSON.stringify(after.rows), JSON.stringify(node.rows), "authoritative V2 rows unchanged");
    eq(after._v, node._v, "frozen _v unchanged");
    eq(after.generation, node.generation, "epoch unchanged");
    return `UI delete + clear-all + ${n} transport shapes denied; rows/_v/generation intact`;
  });

  await run("HP-05", "NEGATIVE CONTROL: with the PRE-FENCE core Rules (47f7f888) the same page's delete click under `quiesced` COMMITS — the quiesced denial above is the fence delta", async () => {
    page.detach(); page = null;
    await loadRules(coreRules);
    await seedDb().ref("/").set(fixtures());
    await seedDb().ref(CTRL).set({ contractVersion: 1, phase: "quiesced", policyRevision: 2, allowV2Initialization: false, minStorageProtocol: 1, operation: { id: "hp-op", kind: "cutover", owner: "operator", startedAt: 1 } });
    const p2 = await bootHistoricalPage({ adminApp: apps.manager, user: USER, session, signedIn: true, clockOffsetMs: CLOCK_OFFSET_MS });
    try {
      await p2.until(() => p2.document.querySelector(".kpi-card-link") !== null, 15000);
      await openHistory(p2);
      const before = await legacyRows();
      await clickDelete(p2, 0);
      let after = before; const t0 = Date.now();
      while (JSON.stringify(after) === JSON.stringify(before) && Date.now() - t0 < 6000) { await p2.sleep(100); after = await legacyRows(); }
      eq(after.length, before.length - 1, "pre-fence rules let the old page write under quiesced");
    } finally { p2.detach(); await loadRules(CANONICAL_RULES); }
    return "core rules: quiesced ignored, delete committed (control)";
  });

  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("case", 7)} ${w("status", 6)} ${w("ms", 6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 7)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 5;
  console.log("\n=== TOTALS ===");
  console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  if (page) page.detach();
  if (results.length !== EXPECTED) { console.error(`\nINCOMPLETE: expected ${EXPECTED}, ran ${results.length}`); process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED — server truth held against a retained rendered historical page");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
