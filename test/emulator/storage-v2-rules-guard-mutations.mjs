// Marjin — P0-DATA-01 STORAGE V2 HARDENING R1: RULES-GUARD MUTATION PROBE.
//
// The S0 anti-migration guard (test/finance/vat-invariant.test.mjs, via
// test/support/rules-authorized-delta.mjs) rejects every mutation of the entries Rules
// contract. This probe proves those rejections are MEANINGFUL: for each mutation it
// loads the mutated Rules into the REAL local emulator, shows that a write the shipped
// Rules DENY becomes ALLOWED, restores the shipped Rules and shows the write is denied
// again. So every mutation the guard rejects is a real weakening of enforcement — never
// a theoretical or inert one — and the guard's rejection of it is checked here too.
//
// Rules are loaded through the emulator's own REST settings endpoint with its
// privileged local token; nothing here can reach any non-local database.
//
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md.

import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { gitIn } from "../support/git-context.mjs";
import { authorizedEntriesRulesDelta, authorizedVersionFenceRulesDelta, CUTOVER_GUARD, FENCE_GUARD } from "../support/rules-authorized-delta.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DIR = dirname(fileURLToPath(import.meta.url)), ROOT = join(DIR, "..", "..");
const S0_BASE = "686b4350c6b6186c81d7f821d8c26a960428d30b";
const CORE_SHA = "47f7f8882846b4b0c90fba2947ca3053eb90a9f0";   // Storage V2 core Rules (approved); live = core + exact version-fence delta
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

const canonical = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
const dk = (r) => r.rules.tenants["$tenantId"]["$dataKey"];
const UUID = (seed) => { const hx = (n, l) => (n >>> 0).toString(16).padStart(l, "0").slice(-l);
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const a = hash("a" + seed), b = hash("b" + seed); return `${hx(a,8)}-${hx(b,4)}-4${hx(a,3)}-8${hx(b,3)}-${hx(a,6)}${hx(b,6)}`; };
const ID1 = UUID("r1");
const V2ROW = (id, gen = 1) => ({ id, [ "_gen" ]: gen, date: "2026-08-01", sales: 1 });
const V2NODE = () => ({ schemaVersion: 2, generation: 1, rows: { [ID1]: V2ROW(ID1) }, _v: JSON.stringify([{ id: ID1, date: "2026-08-01", sales: 1 }]) });
const LEGACY = () => ({ _v: JSON.stringify([{ id: ID1, date: "2026-08-01", sales: 1 }]) });
const P = (biz) => `tenants/tenantA/biz:${biz}:entries`;
const POLICY = (phase) => ({ contractVersion: 1, phase, policyRevision: 1, allowV2Initialization: false, minStorageProtocol: phase === "legacy" || phase === "quiesced" ? 1 : 2 });
const CTRL = "root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries',''))";
const CF = (f) => `${CTRL}.child('${f}')`;
const OPF = (f) => `${CTRL}.child('operation').child('${f}')`;
const SAFEINT = (x) => `(${x}.isNumber() && ${x}.val() % 1 === 0 && ${x}.val() >= 1 && ${x}.val() <= 9007199254740991)`;
const OPERATION_CONJUNCT = `(!${CF("operation")}.exists() || (${OPF("id")}.isString() && ${OPF("id")}.val() !== '' && (${OPF("kind")}.val() === 'cutover' || ${OPF("kind")}.val() === 'recovery') && ${OPF("owner")}.isString() && ${OPF("owner")}.val() !== '' && ${SAFEINT(OPF("startedAt"))}))`;
const CONVERSION_CONJUNCT = `(!${CF("conversionAttempted")}.exists() || ${CF("conversionAttempted")}.isBoolean())`;
const FLAG_PHASE_CONJUNCT = ` && (${CF("allowV2Initialization")}.val() !== true || ${CF("phase")}.val() === 'v2_active')`;
const all = (str, a, b) => { if (!str.includes(a)) throw new Error("mutation anchor missing: " + a.slice(0, 80)); return str.split(a).join(b); };

const apps = {};
const seedDb = () => apps.seed.database();
async function loadRules(rules) {
  const res = await fetch(`http://${EMU}/.settings/rules.json?ns=${NAMESPACE}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
  if (!res.ok) throw new Error(`rules load ${res.status}: ${await res.text()}`);
}
async function fixtures() {
  await seedDb().ref("/").set({ tenants: { tenantA: {
    members: { u_owner: true, u_manager: true }, roles: { u_owner: "owner", u_manager: "manager" },
    biz_access: { v2: { u_manager: true }, legacy: { u_manager: true }, empty: { u_manager: true }, none: { u_manager: true }, quiesced: { u_manager: true }, held: { u_manager: true }, broken: { u_manager: true }, pending: { u_manager: true }, fracrev: { u_manager: true }, unsaferev: { u_manager: true }, fracproto: { u_manager: true }, legacyflag: { u_manager: true }, badop: { u_manager: true }, badconv: { u_manager: true } },
    "biz:v2:entries": V2NODE(), "biz:legacy:entries": LEGACY(), "biz:empty:entries": { schemaVersion: 2, generation: 2, _v: "[]" },
    "biz:quiesced:entries": LEGACY(), "biz:held:entries": V2NODE(), "biz:broken:entries": LEGACY(), "biz:pending:entries": LEGACY(),
    "biz:fracrev:entries": LEGACY(), "biz:unsaferev:entries": LEGACY(), "biz:fracproto:entries": LEGACY(), "biz:legacyflag:entries": LEGACY(), "biz:badop:entries": LEGACY(), "biz:badconv:entries": LEGACY(),
  } }, storage_v2_control: { tenantA: { v2: POLICY("v2_active"), empty: POLICY("v2_active"), none: POLICY("v2_active"), quiesced: POLICY("quiesced"), held: POLICY("recovery_hold"), broken: { policyRevision: 7 }, pending: POLICY("v2_active"),
    fracrev: { ...POLICY("legacy"), policyRevision: 1.5 }, unsaferev: { ...POLICY("legacy"), policyRevision: 9007199254740992 }, fracproto: { ...POLICY("legacy"), minStorageProtocol: 1.5 },
    legacyflag: { ...POLICY("legacy"), allowV2Initialization: true }, badop: { ...POLICY("legacy"), operation: { id: "op", kind: "bogus", owner: "x", startedAt: 1 } }, badconv: { ...POLICY("legacy"), conversionAttempted: "true" } } } });
}
const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));
async function attempt(path, value) {
  try { await apps.manager.database().ref(path).set(value); return "allow"; }
  catch (e) { return denied(e) ? "deny" : "error:" + (e && e.message); }
}

// Each mutation: the guard-rejected change, and ONE write the shipped Rules deny that the
// mutation lets through. RTDB evaluates the `.validate` of every ancestor of a written
// path as well (the emulator is the reference engine — see V2-H02/H03 and the probe
// log), so several invariants are enforced twice, by the envelope validator and by a
// child validator. Where a mutation targets such a doubly-held invariant, it loosens
// the invariant in BOTH places (the guard rejects each of them on its own); the probe
// then proves the invariant itself is load-bearing.
const MUTATIONS = [
  { name: "inert row validator wrapper `true || (…)`", mutate: (d) => { d.rows["$rowId"][".validate"] = "true || (" + d.rows["$rowId"][".validate"] + ")"; },
    probe: () => attempt(`${P("v2")}/rows/${UUID("x")}`, { id: UUID("x"), _gen: 1 }), what: "row without a business date" },
  { name: "plain inert row validator `true`", mutate: (d) => { d.rows["$rowId"][".validate"] = "true"; },
    probe: () => attempt(`${P("v2")}/rows/${UUID("x")}`, { sales: 1 }), what: "row with no id/_gen/date at all" },
  { name: "inert envelope validator wrapper", mutate: (d) => { d[".validate"] = "true || (" + d[".validate"] + ")"; },
    probe: () => attempt(P("legacy"), { foo: 1 }), what: "legacy node replaced by a blob-less object" },
  { name: "inert generation validator wrapper", mutate: (d) => { d.generation[".validate"] = "true || (" + d.generation[".validate"] + ")"; },
    probe: () => attempt(`${P("legacy")}/generation`, 1), what: "epoch written under a legacy node (stripped-V2, fail-closed)" },
  { name: "inert _v validator wrapper + fence _v freeze dropped (held twice)", mutate: (d) => { d._v[".validate"] = "true || (" + d._v[".validate"] + ")"; d[".write"] = d[".write"].replace(" && (!data.child('_v').exists() || newData.child('_v').val() === data.child('_v').val())", ""); },
    probe: () => attempt(`${P("v2")}/_v`, "[]"), what: "frozen snapshot rewritten after cutover" },
  { name: "inert schemaVersion + envelope wrappers + fence legacy-shape conjunct (marker invariant held thrice)", mutate: (d) => { d.schemaVersion[".validate"] = "(" + d.schemaVersion[".validate"] + ") || true"; d[".validate"] = "true || (" + d[".validate"] + ")"; d[".write"] = d[".write"].replace(" && !(newData.child('schemaVersion').val() === 2) && !(data.child('schemaVersion').val() === 2))", " && !(data.child('schemaVersion').val() === 2))"); },
    probe: () => attempt(`${P("legacy")}/schemaVersion`, 2), what: "marker-only write onto a legacy node (bricks it fail-closed)" },
  { name: "cutover guard dropped from .write", mutate: (d, base) => { d[".write"] = dk(base)[".write"]; },
    probe: () => attempt(P("v2"), null), what: "whole-node delete of a converted business" },
  { name: "cutover guard weakened to `true` (+ fence, held twice)", mutate: (d) => { d[".write"] = d[".write"].replace(CUTOVER_GUARD, "true").replace(FENCE_GUARD, "true"); },
    probe: () => attempt(P("v2"), null), what: "whole-node delete of a converted business" },
  { name: "rows-must-be-a-map dropped (held twice)", mutate: (d) => { delete d.rows[".validate"]; d[".validate"] = d[".validate"].replace(" && (!newData.child('rows').exists() || newData.child('rows').hasChildren())", ""); },
    probe: () => attempt(`${P("v2")}/rows`, "corrupt"), what: "row map replaced by a scalar" },
  { name: "epoch step loosened to +2 (held twice)", mutate: (d) => { d.generation[".validate"] = d.generation[".validate"].replace("data.val() + 1", "data.val() + 2"); d[".validate"] = d[".validate"].replace("data.child('generation').val() + 1", "data.child('generation').val() + 2"); },
    probe: () => attempt(`${P("empty")}/generation`, 4), what: "epoch skipped on an empty collection" },
  { name: "epoch rollback permitted (held twice)", mutate: (d) => { d.generation[".validate"] = d.generation[".validate"].replace("newData.val() === data.val() ||", "newData.val() <= data.val() ||"); d[".validate"] = d[".validate"].replace("newData.child('generation').val() === data.child('generation').val() ||", "newData.child('generation').val() <= data.child('generation').val() ||"); },
    probe: () => attempt(`${P("empty")}/generation`, 1), what: "epoch rolled back to a retired value" },
  { name: "row stamp renamed away from the reserved key", mutate: (d) => { d.rows["$rowId"][".validate"] = d.rows["$rowId"][".validate"].split("'_gen'").join("'gen'"); },
    probe: () => attempt(`${P("v2")}/rows/${UUID("g")}`, { id: UUID("g"), gen: 1, date: "2026-08-01" }), what: "row stamped under an application field name" },
  // ── VERSION FENCE (P0-DATA-01): each fence conjunct is load-bearing on the emulator ──
  { name: "fence guard dropped from .write (core write restored)", mutate: (d, base, core) => { d[".write"] = dk(core)[".write"]; },
    probe: () => attempt(P("quiesced"), LEGACY()), what: "old-client legacy overwrite of a QUIESCED business" },
  { name: "fence guard weakened to `true`", mutate: (d) => { d[".write"] = d[".write"].replace(FENCE_GUARD, "true"); },
    probe: () => attempt(P("quiesced"), LEGACY()), what: "old-client legacy overwrite of a QUIESCED business" },
  { name: "malformed record fails OPEN (validity predicate replaced by a phase-only check)", mutate: (d) => { d[".write"] = d[".write"].split(FENCE_GUARD).join(FENCE_GUARD.replace(`(!${CTRL}.exists() || (`, `(!${CTRL}.child('phase').exists() || (`)); },
    probe: () => attempt(P("broken"), LEGACY()), what: "legacy write under a MALFORMED existing control record (phase missing)" },
  { name: "recovery_hold admitted as v2_active", mutate: (d) => { d[".write"] = d[".write"].replace(`&& ${CTRL}.child('phase').val() === 'v2_active' && newData`, `&& (${CTRL}.child('phase').val() === 'v2_active' || ${CTRL}.child('phase').val() === 'recovery_hold') && newData`); },
    probe: () => attempt(`${P("held")}/rows/${UUID("h")}`, V2ROW(UUID("h"))), what: "V2 row written while the business is in RECOVERY_HOLD" },
  { name: "initialization flag ignored (absent business may be initialised in v2_active)", mutate: (d) => { d[".write"] = d[".write"].replace(`: ${CTRL}.child('allowV2Initialization').val() === true)`, ": true)"); },
    probe: () => attempt(P("none"), { schemaVersion: 2, generation: 1, rows: { [ID1]: V2ROW(ID1) } }), what: "V2 initialisation with allowV2Initialization=false" },
  { name: "populated-legacy conversion by a client admitted", mutate: (d) => { d[".write"] = d[".write"].replace("(data.exists() ? data.child('schemaVersion').val() === 2 : ", "(data.exists() ? true : "); },
    probe: () => attempt(P("pending"), V2NODE()), what: "client-side conversion of a populated legacy node under v2_active (bypasses the Admin lane)" },
  // ── R1: every numeric / structural conjunct of VALID is load-bearing ──
  { name: "R1 integer check dropped for policyRevision (fractional revision admitted)", mutate: (d) => { d[".write"] = all(d[".write"], `${CF("policyRevision")}.val() % 1 === 0 && `, ""); },
    probe: () => attempt(P("fracrev"), LEGACY()), what: "legacy write under policyRevision 1.5" },
  { name: "R1 safe-integer bound dropped for policyRevision (unsafe revision admitted)", mutate: (d) => { d[".write"] = all(d[".write"], ` && ${CF("policyRevision")}.val() <= 9007199254740991`, ""); },
    probe: () => attempt(P("unsaferev"), LEGACY()), what: "legacy write under policyRevision 2^53" },
  { name: "R1 integer check dropped for minStorageProtocol (fractional protocol admitted)", mutate: (d) => { d[".write"] = all(d[".write"], `${CF("minStorageProtocol")}.val() % 1 === 0 && `, ""); },
    probe: () => attempt(P("fracproto"), LEGACY()), what: "legacy write under minStorageProtocol 1.5" },
  { name: "R1 flag×phase relationship dropped (legacy + allowV2Initialization=true admitted)", mutate: (d) => { d[".write"] = all(d[".write"], FLAG_PHASE_CONJUNCT, ""); },
    probe: () => attempt(P("legacyflag"), LEGACY()), what: "legacy write under a legacy record carrying allowV2Initialization=true" },
  { name: "R1 operation structure check dropped (malformed operation admitted)", mutate: (d) => { d[".write"] = all(d[".write"], " && " + OPERATION_CONJUNCT, ""); },
    probe: () => attempt(P("badop"), LEGACY()), what: "legacy write under a record whose operation.kind is unknown" },
  { name: "R1 conversionAttempted type check dropped (nonboolean admitted)", mutate: (d) => { d[".write"] = all(d[".write"], " && " + CONVERSION_CONJUNCT, ""); },
    probe: () => attempt(P("badconv"), LEGACY()), what: "legacy write under conversionAttempted:'true'" },
  { name: "control record writable by authenticated clients", mutate: (d, base, core, whole) => { whole.rules.storage_v2_control["$tenantId"]["$bizId"][".write"] = "auth !== null"; },
    probe: () => attempt("storage_v2_control/tenantA/quiesced", POLICY("v2_active")), what: "a client flips its own business to v2_active" },
  { name: "control record readable by any authenticated user (scope widened)", mutate: (d, base, core, whole) => { whole.rules.storage_v2_control["$tenantId"]["$bizId"][".read"] = "auth !== null"; },
    probe: async () => { try { await apps.outsider.database().ref("storage_v2_control/tenantA/v2").once("value"); return "allow"; } catch (e) { return denied(e) ? "deny" : "error:" + e.message; } }, what: "an outsider reads another tenant's policy" },
];

const results = []; let failures = 0;
async function main() {
  assertSafe();
  apps.seed = admin.initializeApp({ databaseURL: DB_URL }, "seed");
  apps.manager = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: "u_manager", token: { email: "m@demo.example" } } }, "manager");
  apps.outsider = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: { uid: "u_outsider", token: { email: "x@demo.example" } } }, "outsider");
  const show = gitIn(ROOT, ["show", `${S0_BASE}:database.rules.json`]);
  if (show.status !== 0) throw new Error("cannot read the S0 base rules: " + show.stderr);
  const base = JSON.parse(show.stdout);
  const showCore = gitIn(ROOT, ["show", `${CORE_SHA}:database.rules.json`]);
  if (showCore.status !== 0) throw new Error("cannot read the core rules: " + showCore.stderr);
  const core = JSON.parse(showCore.stdout);
  // Two-layer guard: S0 base → core (entries delta) and core → live (exact version-fence delta).
  const guardOf = (live) => { const a = authorizedEntriesRulesDelta(base, core); if (!a.ok) return a; return authorizedVersionFenceRulesDelta(core, live); };
  const guardOnCanonical = guardOf(canonical);
  if (!guardOnCanonical.ok) throw new Error("the guard rejects the shipped rules: " + guardOnCanonical.reason);
  const apply = (m, x) => m.mutate(dk(x), base, core, x);
  // Each mutation must be a real textual change (a no-op replace would prove nothing).
  for (const m of MUTATIONS) { const x = structuredClone(canonical); apply(m, x); if (JSON.stringify(x) === JSON.stringify(canonical)) throw new Error("mutation is a no-op: " + m.name); }
  for (const m of MUTATIONS) {
    const mutated = structuredClone(canonical); apply(m, mutated);
    const guard = guardOf(mutated);
    const row = { name: m.name, what: m.what, guard: guard.ok ? "ACCEPTED(!)" : "rejected:" + guard.reason };
    try {
      await loadRules(canonical); await fixtures();
      row.shipped = await m.probe();
      await loadRules(mutated); await fixtures();
      row.mutated = await m.probe();
      await loadRules(canonical); await fixtures();
      row.restored = await m.probe();
      row.pass = !guard.ok && row.shipped === "deny" && row.mutated === "allow" && row.restored === "deny";
    } catch (e) { row.pass = false; row.error = (e && e.message) || String(e); }
    if (!row.pass) failures++;
    results.push(row);
  }
  await loadRules(canonical);
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`\n${w("mutation", 48)} ${w("shipped", 8)} ${w("mutated", 8)} ${w("restored", 9)} ${w("guard", 46)} result`);
  console.log("-".repeat(140));
  for (const r of results) console.log(`${w(r.name, 48)} ${w(r.shipped, 8)} ${w(r.mutated, 8)} ${w(r.restored, 9)} ${w(r.guard, 46)} ${r.pass ? "PASS" : "FAIL"}${r.error ? " " + r.error : ""}`);
  console.log("\n=== TOTALS ===");
  console.log(`mutations=${results.length} proven_weakening_and_guard_rejected=${results.length - failures} failed=${failures}`);
  if (results.length !== MUTATIONS.length || failures) { process.exitCode = 1; return; }
  console.log("\nALL MUTATIONS PROVEN: each guard rejection corresponds to a real loss of server enforcement");
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
        .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4;
                              await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
