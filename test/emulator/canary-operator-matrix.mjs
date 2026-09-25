// Marjin — P0-DATA-01 CANARY TOOLING, the OPERATOR MATRIX against a REAL local Firebase RTDB emulator.
//
// Every case drives the real CLI (`tools/storage-v2/canary.mjs` `main()` in-process, fresh Admin app per
// call = cold SDK cache every time, exactly as an operator's separate invocations) against the real Rules
// (`database.rules.json`, byte-identical mirror checked at startup), the real policy control plane, the
// UNCHANGED conversion core and the real dashboard blocks of index.html over the real SDK for live writes.
// Admin ("seed") is used only for fixtures and for the explicit out-of-band injections the cases name.
//
// D-CT-1 OPTION B: no mutating legacy write is ever attempted through the tool. CT-E10 drives the tool's
// probe (authenticated read + same-value control PUT) with ordinary and intruder tokens, and — as
// TEST-ONLY Rules evidence, not a tool command — asserts the legacy transport shapes are DENIED under
// quiesced / v2_active via the emulator's Rules-evaluated `?auth=` REST form.
//
// Deliberately NOT named *.test.mjs. Host run: see test/emulator/README.md (`canary-operator-matrix`).

import admin from "firebase-admin";
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";
import { main } from "../../tools/storage-v2/canary.mjs";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import * as T from "../../tools/storage-v2/canary-transport.mjs";
import { createDashboard, makeSdkStorage, loadProductionWindow } from "../support/dashboard-wiring-harness.mjs";
import { row, uuid, asLegacy, asV2, ATTESTATION, LIVE_ROW, APPROVED_RULES_BLOB } from "../support/canary-fixtures.mjs";

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
  const fc = validateFirebaseConfig(process.env.FIREBASE_CONFIG); if (!fc.ok) fail(`FIREBASE_CONFIG rejected: ${fc.reason}`);
  if (process.env.FIREBASE_DATABASE_URL) { const u = String(process.env.FIREBASE_DATABASE_URL); if (!DEMO.has(u) && !isLocal(u)) fail(`FIREBASE_DATABASE_URL is not demo/local: ${u}`); }
  const a = readFileSync(join(DIR, "database.rules.json")), b = readFileSync(join(ROOT, "database.rules.json"));
  if (Buffer.compare(a, b) !== 0) fail("test/emulator/database.rules.json differs from the canonical rules — refresh the copy");
  if (T.gitBlobId(b) !== APPROVED_RULES_BLOB) fail("canonical Rules are not the approved blob");
}

// ─── fixtures ────────────────────────────────────────────────────────────────
const TENANT = "tenantA", BIZ = "bizA", NAME = "Canary Biz";
const PATH = `tenants/${TENANT}/biz:${BIZ}:entries`, CTRL = `storage_v2_control/${TENANT}/${BIZ}`;
const ROWS = () => [row("e1", "2026-09-01", { sales: "100", food_cost: "30" }), row("e2", "2026-09-02", { sales: "250", payroll: "80" }), row("e3", "2026-09-03", { sales: "0", notes: "יום שקט 🙂" })];
const IDS = { owner: { uid: "u_owner", token: { email: "o@demo.example" } }, manager: { uid: "u_manager", token: { email: "m@demo.example" } } };
const apps = {};
function initApps() { apps.__seed = admin.initializeApp({ databaseURL: DB_URL }, "seed"); for (const [k, o] of Object.entries(IDS)) apps[k] = admin.initializeApp({ databaseURL: DB_URL, databaseAuthVariableOverride: o }, `id_${k}`); }
const seedDb = () => apps.__seed.database();
const fixtures = () => ({ tenants: { [TENANT]: {
  members: { u_owner: true, u_manager: true }, roles: { u_owner: "owner", u_manager: "manager" }, biz_access: { [BIZ]: { u_manager: true } },
  [`biz:${BIZ}:entries`]: asLegacy(ROWS()), [`biz:${BIZ}:config`]: { _v: JSON.stringify({ businessName: NAME, lat: 32.1, lon: 34.8 }) }, [`biz:${BIZ}:fixed`]: { _v: "[]" },
  app: { business: { _v: JSON.stringify([{ id: BIZ, name: NAME }]) } },
} } });
const LIVE = [];
function detachAll() { while (LIVE.length) { try { LIVE.pop().detach(); } catch (_) {} } }
async function reseed({ entries, policy, name } = {}) {
  detachAll(); const f = fixtures();
  if (entries !== undefined) { if (entries === null) delete f.tenants[TENANT][`biz:${BIZ}:entries`]; else f.tenants[TENANT][`biz:${BIZ}:entries`] = entries; }
  if (name) f.tenants[TENANT][`biz:${BIZ}:config`] = { _v: JSON.stringify({ businessName: name }) };
  if (policy) f.storage_v2_control = { [TENANT]: { [BIZ]: policy } };
  await seedDb().ref("/").set(f);
}
const readNode = async (p = PATH) => { const s = await seedDb().ref(p).once("value"); return s.exists() ? s.val() : null; };
const POLICY = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const QUIESCED = (over = {}) => POLICY({ phase: "quiesced", policyRevision: 2, operation: { id: "canary-op-1", kind: "cutover", owner: "alice", startedAt: 1 }, ...over });
const ACTIVE = (over = {}) => POLICY({ phase: "v2_active", policyRevision: 4, minStorageProtocol: 2, ...over });

// ─── the CLI, invoked exactly as an operator would (fresh Admin app per call) ──
let appN = 0;
const EV = mkdtempSync(join(tmpdir(), "canary-matrix-")); chmodSync(EV, 0o700);
let evidenceDir = EV;   // one evidence directory PER CASE (set by run) so operation ids never collide across cases
let manifestPath = null, manifest = null;
function writeManifest(over = {}) {
  manifest = { manifestVersion: 1, environment: "emulator", projectId: PROJECT, databaseURL: DB_URL, tenantId: TENANT, bizId: BIZ,
    expectedIdentity: { businessName: NAME, ownerAttestation: { by: "owner@demo", at: "2026-09-25T08:00:00Z", ref: "attest-1" } }, probeBizId: null,
    approved: { repoSha: "5afb27543cb3d81c2ff23905af5b4ceeff706203", rulesBlob: APPROVED_RULES_BLOB },
    operation: { id: "canary-op-1", operator: "alice", observer: "bob", approvalRef: "cto-ok" }, expected: { policyRevisionAtStart: 1, sourceDigest: null, evidenceId: null },
    limits: { maxRows: 500, maxNodeBytes: 1048576 }, timezone: "Asia/Jerusalem", liveWrite: { date: "2026-09-20", plannedRow: LIVE_ROW(), editField: "sales", editValue: "34" }, ...over };
  manifestPath = join(EV, `manifest-${++appN}.json`); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); chmodSync(manifestPath, 0o600);
}
async function cli(command, extra = [], { env = "emulator" } = {}) {
  const out = [], err = []; const L = console.log, Er = console.error;
  console.log = (...a) => out.push(a.join(" ")); console.error = (...a) => err.push(a.join(" "));
  let exitCode;
  try {
    exitCode = await main([command, "--manifest", manifestPath, "--env", env, "--evidence-dir", evidenceDir, ...extra], { processEnv: process.env, adminApps: [],
      adminAppFactory: (e, m) => admin.initializeApp({ databaseURL: e.databaseURL, projectId: e.projectId }, `canary-${m.operation.id}-${++appN}`) });
  } finally { console.log = L; console.error = Er; }
  const parse = (lines) => { const l = lines.filter((x) => x.startsWith("{")).pop(); try { return l ? JSON.parse(l) : null; } catch (_) { return null; } };
  const summary = parse(out), error = parse(err);
  return { exitCode, summary, error, report: summary && summary.report ? JSON.parse(readFileSync(summary.report, "utf8")) : null };
}
const token = (m, command, rev, digest = null) => C.confirmationToken({ manifest: m, command, expectedRevision: rev, sourceDigest: digest });
const jsonFile = (name, obj) => { const p = join(EV, name); writeFileSync(p, JSON.stringify(obj)); chmodSync(p, 0o600); return p; };
let ackN = 0; const ack = (stage, bound) => jsonFile(`ack-${stage}-${++ackN}.json`, { operationId: "canary-op-1", stage, by: "bob", at: "2026-09-25T09:00:00Z", evidenceId: bound, checkpointId: bound });
const attestFile = () => jsonFile("attestation.json", ATTESTATION());
const digestOf = async () => C.digestV1(await readNode());
async function bringToCapture() {
  await reseed({ policy: POLICY() }); writeManifest();
  const q = await cli("quiesce", ["--expected-revision", "1", "--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(q.exitCode, 0, "quiesce " + JSON.stringify(q.error));
  const d = await cli("drain-check", ["--interval", "2", "--writer-bound", "0", "--attest", attestFile()]); eq(d.exitCode, 0, "drain " + JSON.stringify(d.error)); eq(d.report.verdict, "DRAIN_EVIDENCE_COMPLETE", "drain verdict");
  const c = await cli("capture"); eq(c.exitCode, 0, "capture " + JSON.stringify(c.error)); expect(c.report.captured, "captured");
  return c.report;
}
async function bringToActive() {
  const cap = await bringToCapture();
  const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(m.exitCode, 0, "migrate " + JSON.stringify(m.error)); eq(m.report.outcome.status, "MIGRATED_HELD", "held");
  const v = await cli("verify", ["--phase", "post"]); eq(v.exitCode, 0, "verify " + JSON.stringify(v.error));
  const a = await cli("activate", ["--checkpoint", v.report.checkpointId, "--expected-revision", "3", "--execute", "--confirm", token(manifest, "activate", 3, await digestOf()), "--ack", ack("activate", v.report.checkpointId)]); eq(a.exitCode, 0, "activate " + JSON.stringify(a.error));
  return { cap, checkpointId: v.report.checkpointId };
}

// ─── compatible client: the real dashboard blocks over the real SDK ──────────
function dashboard(appKey) {
  const storage = makeSdkStorage(apps[appKey].database(), TENANT);
  const d = createDashboard({ storage, tenantId: TENANT, bizId: BIZ, W: loadProductionWindow() });
  LIVE.push({ detach: () => { try { d.selectBusiness("__detached__"); } catch (_) {} } });
  d.until = (pred, ms = 5000) => new Promise((res, rej) => { const t0 = Date.now(); (function tick() { if (pred()) return res(); if (Date.now() - t0 > ms) return rej(new Error("timeout waiting for dashboard state")); setTimeout(tick, 10); })(); });
  d.select = async () => { d.selectBusiness(BIZ); await d.until(() => d.mode() !== null && d.policyUi() !== null && d.policyUi().state !== "policy_unresolved" && d.policyUi().state !== "storage_unresolved"); };
  return d;
}
const upsert = (id, fields, base) => ({ type: "upsert_entry", target: { id }, patch: { fields }, base: { fields: base } });
const create = (r) => ({ type: "upsert_entry", target: { id: r.id }, createIfMissing: true, newRow: r, patch: {} });

// ─── unsigned JWT for the emulator's Rules-evaluated `?auth=` form (TEST ONLY) ──
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unsignedJwt = (uid, email) => { const now = Math.floor(Date.now() / 1000); return `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: uid, user_id: uid, email, iat: now, exp: now + 3600, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` })}.`; };
const rest = async (path, method, body, tok) => { const r = await fetch(`http://${EMU}/${path}.json?ns=${NAMESPACE}&auth=${tok}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };

// ─── runner ──────────────────────────────────────────────────────────────────
const results = []; let failures = 0;
async function run(id, area, description, fn) {
  const t0 = Date.now(); evidenceDir = join(EV, id);
  try { const n = await fn(); results.push({ id, area, description, status: "PASS", ms: Date.now() - t0, notes: n || "" }); }
  catch (e) { failures++; results.push({ id, area, description, status: "FAIL", ms: Date.now() - t0, notes: (e && e.stack) || String(e) }); }
  finally { detachAll(); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

async function main_() {
  assertSafe(); initApps();

  await run("CT-E01", "identity", "wrong business identity (config name differs) ⇒ every command exits 14, nothing written", async () => {
    await reseed({ policy: POLICY(), name: "Some Other Business" }); writeManifest();
    const before = JSON.stringify(await readNode("/"));
    for (const [cmd, extra] of [["quiesce", ["--expected-revision", "1", "--execute", "--confirm", token(manifest, "quiesce", 1)]], ["capture", []], ["migrate", ["--expected-revision", "1", "--execute", "--confirm", "x"]], ["activate", ["--checkpoint", "x", "--expected-revision", "1", "--execute", "--confirm", "x"]], ["hold", ["--expected-revision", "1"]], ["drain-check", []], ["probe-legacy-denial", ["--expected-revision", "1"]], ["monitor", ["--cycle", "2026-09-02"]]]) {
      const r = await cli(cmd, extra); eq(r.exitCode, 14, cmd); eq(r.error.error, "identity_mismatch", cmd);
    }
    const p = await cli("plan"); eq(p.exitCode, 14, "plan"); eq(p.report.identity.error, "identity_mismatch", "plan report");
    eq(JSON.stringify(await readNode("/")), before, "database unchanged");
    return "8 commands refused + plan reports the mismatch; zero writes";
  });

  await run("CT-E02", "preflight", "plan/preflight on a clean legacy business ⇒ PASS, deployed Rules fingerprint equals the approved blob", async () => {
    await reseed({ policy: POLICY() }); writeManifest();
    const p = await cli("plan"); eq(p.exitCode, 0, JSON.stringify(p.error)); expect(["byte", "structural"].includes(p.report.environment.deployedRulesMatch), "rules match: " + p.report.environment.deployedRulesMatch); eq(p.report.policy.phase, "legacy", "phase");
    eq(p.report.confirmationTokens.quiesce, token(manifest, "quiesce", 1), "token");
    const f = await cli("preflight"); eq(f.exitCode, 0, JSON.stringify(f.error));
    const nonPass = f.report.findings.filter((x) => x.classification !== "PASS").map((x) => x.code);
    expect(nonPass.every((c) => /^tool_/.test(c)), "only tool-identity warnings on a work tree: " + nonPass.join(","));
    expect(f.report.findings.some((x) => x.code === "rules_fingerprint_match"), "fingerprint finding"); eq(f.report.eligibility, nonPass.length ? "ELIGIBLE_WITH_WARNING" : "ELIGIBLE", "eligibility");
    eq(f.report.expectedV2.rowCount, 3, "expected rows");
    return `rules=${p.report.environment.deployedRulesMatch}; aggregate=${f.report.aggregate}`;
  });

  await run("CT-E03", "lifecycle", "enroll (absent) → quiesce → drain-check stable → capture COMPLETE (CT-11)", async () => {
    await reseed({ policy: undefined }); writeManifest();
    const dry = await cli("enroll", ["--expected-revision", "0"]); eq(dry.exitCode, 0, "dry " + JSON.stringify(dry.error)); eq(dry.report.executed, false, "dry-run"); eq(await readNode(CTRL), null, "dry-run wrote nothing");
    const en = await cli("enroll", ["--expected-revision", "0", "--execute", "--confirm", token(manifest, "enroll", 0)]); eq(en.exitCode, 0, JSON.stringify(en.error)); eq((await readNode(CTRL)).phase, "legacy", "legacy record");
    const q = await cli("quiesce", ["--expected-revision", "1", "--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(q.exitCode, 0, JSON.stringify(q.error)); const c1 = await readNode(CTRL); eq(c1.phase, "quiesced", "quiesced"); eq(c1.operation.id, "canary-op-1", "owned");
    const noAtt = await cli("drain-check", ["--interval", "2", "--writer-bound", "0"]); eq(noAtt.exitCode, 11, "no attestation ⇒ operator action"); eq(noAtt.report.verdict, "STABLE_INTERVAL", "vocabulary");
    const d = await cli("drain-check", ["--interval", "2", "--writer-bound", "0", "--attest", attestFile()]); eq(d.exitCode, 0, JSON.stringify(d.error)); eq(d.report.verdict, "DRAIN_EVIDENCE_COMPLETE", "verdict"); eq(d.report.samples.length, 3, "3 samples");
    const c = await cli("capture"); eq(c.exitCode, 0, JSON.stringify(c.error)); expect(c.report.captured, "captured");
    const files = readdirSync(c.report.dir); for (const n of ["COMPLETE.json", "entries.source.json", "entries.raw-v.utf8", "expected-v2.json", "reader-baseline.json", "preflight.json", "source-manifest.json"]) expect(files.includes(n), n);
    eq(readFileSync(join(c.report.dir, "entries.raw-v.utf8"), "utf8"), (await readNode())._v, "raw _v exact");
    return `bundle ${c.report.bundleId}, rows=${c.report.rowCount}`;
  });

  await run("CT-E04", "migrate", "source changes after capture (Admin out-of-band) ⇒ migrate aborts before the core, node preserved (CT-08)", async () => {
    const cap = await bringToCapture();
    const rows = ROWS(); rows[0].sales = "101"; await seedDb().ref(PATH).set(asLegacy(rows)); const drifted = await digestOf();
    const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]);
    eq(m.exitCode, 10, JSON.stringify(m.error)); eq(m.error.error, "drain_evidence_stale", "R1-F3: refused on the drain-bound digest before the warm read");
    eq(await digestOf(), drifted, "node untouched"); expect(!(await readNode(CTRL)).conversionAttempted, "no CAS marker");
    const st = await cli("status"); eq(st.report.reconciliation.state, "HOLD_UNRECOGNISED_STATE", "status"); eq(st.report.reconciliation.automaticTransition, false, "never automatic"); eq((await readNode(CTRL)).phase, "quiesced", "still quiesced");
    return "abort drain_evidence_stale (bound digest); status HOLD (recommendation only)";
  });

  await run("CT-E05", "migrate", "not quiesced ⇒ migrate refused before any write (CT-09); stale revision ⇒ refused (CT-10)", async () => {
    const cap = await bringToCapture();
    const ab = await cli("abort", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "abort", 2)]); eq(ab.exitCode, 0, JSON.stringify(ab.error)); eq((await readNode(CTRL)).phase, "legacy", "back to legacy");
    const before = JSON.stringify(await readNode("/"));
    const m = await cli("migrate", ["--expected-revision", "3", "--execute", "--confirm", token(manifest, "migrate", 3, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(m.exitCode, 10, JSON.stringify(m.error)); eq(m.error.error, "not_quiesced", "code");
    const q = await cli("quiesce", ["--expected-revision", "3", "--execute", "--confirm", token(manifest, "quiesce", 3)]); eq(q.exitCode, 0, "re-quiesce");
    const stale = await cli("migrate", ["--expected-revision", "2", "--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(stale.exitCode, 10, "stale"); eq(stale.error.error, "stale_revision", "stale code");
    const wrongTok = await cli("migrate", ["--expected-revision", "4", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(wrongTok.exitCode, 10, "refused (" + JSON.stringify(wrongTok.error) + ")"); eq(wrongTok.error.error, "drain_evidence_stale", "R1-F3: the drain was bound to the PREVIOUS quiescence (revision 2) — a re-quiesce invalidates it before the token is even examined");
    const staleTokOnly = await cli("abort", ["--expected-revision", "4", "--execute", "--confirm", token(manifest, "abort", 2)]); eq(staleTokOnly.exitCode, 15, "R1-F1: a token minted for revision 2 presented with revision 4 ⇒ confirmation_mismatch"); eq(staleTokOnly.error.error, "confirmation_mismatch", "code");
    const noRev = await cli("migrate", ["--execute", "--confirm", token(manifest, "migrate", 4, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(noRev.exitCode, 10, "no revision"); eq(noRev.error.error, "expected_revision_required", "R1-F1");
    eq(JSON.stringify(await readNode(PATH)), JSON.stringify(JSON.parse(before).tenants[TENANT][`biz:${BIZ}:entries`]), "entries untouched");
    return "not_quiesced, stale_revision, missing revision, stale drain, stale token: all refused, entries untouched";
  });

  await run("CT-E06", "drain", "Admin write mid-interval ⇒ drain-check exit 10 unstable_fingerprint (CT-12)", async () => {
    await reseed({ policy: QUIESCED() }); writeManifest();
    const p = cli("drain-check", ["--interval", "4", "--writer-bound", "0", "--attest", attestFile()]);
    await new Promise((r) => setTimeout(r, 1200)); const rows = ROWS(); rows.push(row("late", "2026-09-04")); await seedDb().ref(PATH + "/_v").set(JSON.stringify(rows));
    const d = await p; eq(d.exitCode, 10, JSON.stringify(d.error)); eq(d.report.stable, false, "unstable"); expect(d.report.findings.some((f) => f.code === "unstable_fingerprint"), "finding"); eq(d.report.proven, false, "not proven");
    return d.report.verdict;
  });

  await run("CT-E07", "migrate", "happy path: MIGRATED_HELD, core exactly once, conversionAttempted, readback digest = expected (CT-13/14/15/17)", async () => {
    const cap = await bringToCapture();
    const dry = await cli("migrate", ["--expected-revision", "2"]); eq(dry.exitCode, 0, "dry " + JSON.stringify(dry.error)); eq(dry.report.executed, false, "dry"); eq((await readNode()).schemaVersion, undefined, "dry-run converted nothing");
    const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]);
    eq(m.exitCode, 0, JSON.stringify(m.error)); eq(m.report.outcome.status, "MIGRATED_HELD", "outcome"); eq(m.report.transactionStats.coreRuns, 1, "core exactly once"); eq(m.report.coreResult.status, "committed", "core");
    eq(m.report.afterDigest, cap.expectedV2Digest, "readback = expected"); const c = await readNode(CTRL); eq(c.phase, "quiesced", "still held"); eq(c.conversionAttempted, true, "marker"); eq(c.policyRevision, 3, "rev");
    const n = await readNode(); eq(n.schemaVersion, 2, "v2"); eq(n.generation, 1, "gen"); eq(Object.keys(n.rows).length, 3, "rows"); eq(n._v, readFileSync(join(cap.dir, "entries.raw-v.utf8"), "utf8"), "frozen _v");
    const again = await cli("migrate", ["--expected-revision", "3", "--execute", "--confirm", token(manifest, "migrate", 3, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(again.exitCode, 13, "second migrate"); eq(again.error.error, "reconcile_required", "no blind retry");
    return `runs=${m.report.transactionStats.runs} coreRuns=1 rev=3`;
  });

  await run("CT-E08", "verify", "verify --phase post PASS; twice ⇒ identical findings (CT-28); readers pre/post equal (CT-16)", async () => {
    const cap = await bringToCapture();
    const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(m.exitCode, 0, "migrate");
    const v1 = await cli("verify", ["--phase", "post"]); eq(v1.exitCode, 0, JSON.stringify(v1.error)); eq(v1.report.classification.level, "OK", JSON.stringify(v1.report.findings));
    for (const code of ["structural_checkpoint", "logical_checkpoint", "reader_parity", "no_v_fallback"]) expect(v1.report.findings.some((f) => f.code === code), code);
    const v2 = await cli("verify", ["--phase", "post"]); eq(JSON.stringify(v2.report.findings), JSON.stringify(v1.report.findings), "repeatable"); eq(v2.report.checkpointId, v1.report.checkpointId, "same checkpoint");
    return `checkpoint ${v1.report.checkpointId}`;
  });

  await run("CT-E09", "activate", "activate refused without post checkpoint (CT-18); with checkpoint ⇒ v2_active, rev+1, protocol 2, flag false", async () => {
    const cap = await bringToCapture();
    await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]);
    const d = await digestOf();
    const no = await cli("activate", ["--expected-revision", "3", "--execute", "--confirm", token(manifest, "activate", 3, d)]); eq(no.exitCode, 10, "no checkpoint"); eq(no.error.error, "checkpoint_required", "code");
    const bad = await cli("activate", ["--checkpoint", "post-doesnotexist", "--expected-revision", "3", "--execute", "--confirm", token(manifest, "activate", 3, d)]); eq(bad.exitCode, 10, "bad checkpoint"); eq(bad.error.error, "checkpoint_invalid", "code");
    const v = await cli("verify", ["--phase", "post"]); eq(v.exitCode, 0, "verify");
    const noAck = await cli("activate", ["--checkpoint", v.report.checkpointId, "--expected-revision", "3", "--execute", "--confirm", token(manifest, "activate", 3, d)]); eq(noAck.exitCode, 15, "ack required");
    const a = await cli("activate", ["--checkpoint", v.report.checkpointId, "--expected-revision", "3", "--execute", "--confirm", token(manifest, "activate", 3, d), "--ack", ack("activate", v.report.checkpointId)]); eq(a.exitCode, 0, JSON.stringify(a.error));
    const c = await readNode(CTRL); eq(c.phase, "v2_active", "active"); eq(c.policyRevision, 4, "rev"); eq(c.minStorageProtocol, 2, "protocol"); eq(c.allowV2Initialization, false, "flag"); expect(!c.operation, "operation closed");
    const va = await cli("verify", ["--phase", "active"]); eq(va.exitCode, 0, JSON.stringify(va.error));
    return "v2_active rev=4 protocol=2 flag=false";
  });

  await run("CT-E10", "old-client", "Option B probe: ordinary token ⇒ read READABLE + control PUT DENIED; intruder ⇒ INCONCLUSIVE; test-only Rules evidence: legacy shapes DENIED under quiesced/v2_active via ?auth= (CT-19/29/30)", async () => {
    await reseed({ entries: asV2(ROWS(), { keepV: true }), policy: ACTIVE() }); writeManifest();
    const owner = unsignedJwt("u_owner", "o@demo.example"), intruder = unsignedJwt("u_intruder", "x@demo.example");
    const dry = await cli("probe-legacy-denial", ["--expected-revision", "4"]); eq(dry.exitCode, 0, "dry " + JSON.stringify(dry.error)); eq(dry.report.option, "B", "option"); eq(dry.report.wouldAttempt.length, 2, "two harmless attempts only");
    const before = JSON.stringify(await readNode("/"));
    writeFileSync(join(EV, "owner.raw"), owner); chmodSync(join(EV, "owner.raw"), 0o600); writeFileSync(join(EV, "intruder.raw"), intruder); chmodSync(join(EV, "intruder.raw"), 0o600);
    const ok = await cli("probe-legacy-denial", ["--expected-revision", "4", "--execute", "--confirm", token(manifest, "probe-legacy-denial", 4), "--token-file", join(EV, "owner.raw")]);
    eq(ok.exitCode, 0, JSON.stringify(ok.error) + JSON.stringify(ok.report && ok.report.findings)); eq(ok.report.transportForm, "query", "emulator form"); eq(ok.report.authenticatedRead.outcome, "READABLE", "read"); eq(ok.report.controlWrite.outcome, "DENIED", "control PUT denied");
    expect(ok.report.findings.some((f) => f.code === "control_record_client_write_denied"), "finding");
    const bad = await cli("probe-legacy-denial", ["--expected-revision", "4", "--execute", "--confirm", token(manifest, "probe-legacy-denial", 4), "--token-file", join(EV, "intruder.raw")]); eq(bad.exitCode, 13, "intruder ⇒ inconclusive"); eq(bad.report.authenticatedRead.outcome, "DENIED", "intruder read denied");
    eq(JSON.stringify(await readNode("/")), before, "probe changed nothing");
    // ── TEST-ONLY Rules evidence (no tool command): legacy shapes denied for the ordinary owner under v2_active, then quiesced; positive control under legacy
    const shapes = [["whole-node {_v}", () => rest(PATH, "PUT", { _v: "[]" }, owner)], ["_v child", () => rest(PATH + "/_v", "PUT", "[]", owner)], ["_v delete", () => rest(PATH + "/_v", "DELETE", undefined, owner)], ["node delete", () => rest(PATH, "DELETE", undefined, owner)]];
    for (const [name, fn] of shapes) { const r = await fn(); eq(r.status, 401, `v2_active ${name}`); }
    await reseed({ entries: asLegacy(ROWS()), policy: QUIESCED() });
    for (const [name, fn] of shapes) { const r = await fn(); eq(r.status, 401, `quiesced ${name}`); }
    const same = await rest(PATH + "/_v", "PUT", (await readNode())._v, owner); eq(same.status, 401, "quiesced: even a same-value _v PUT is denied");
    await reseed({ entries: asLegacy(ROWS()), policy: POLICY() });
    const pos = await rest(PATH, "PUT", asLegacy(ROWS()), owner); eq(pos.status, 200, "positive control: legacy business accepts the owner's legacy write");
    const intr = await rest(PATH, "PUT", asLegacy(ROWS()), intruder); eq(intr.status, 401, "intruder denied on a legacy business (Rules evaluated)");
    eq(JSON.stringify(await readNode()), JSON.stringify(asLegacy(ROWS())), "node as seeded");
    return "probe OK (read READABLE, control DENIED, intruder INCONCLUSIVE); 4 shapes × {v2_active, quiesced} denied; positive + intruder controls";
  });

  await run("CT-E11", "live-write", "live-check create/edit/delete via the REAL dashboard over the SDK reconcile; a clear-all during a check ⇒ STOP (CT-20/21)", async () => {
    await bringToActive();
    const d = dashboard("manager"); await d.select(); eq(d.mode().mode, "v2", "dashboard sees v2");
    const b1 = await cli("live-check", ["--action", "create", "--step", "before"]); eq(b1.exitCode, 0, JSON.stringify(b1.error));
    const newId = uuid("live"); const r = await d.coord().submitIntent(create({ ...LIVE_ROW(), id: newId })); eq(r.status, "committed", "create " + r.status + "/" + (r.reason || ""));
    const a1 = await cli("live-check", ["--action", "create", "--step", "after"]); eq(a1.exitCode, 0, JSON.stringify(a1.error) + JSON.stringify(a1.report && a1.report.findings)); eq(a1.report.liveRowId, newId, "row id"); eq(a1.report.frozenVUnchanged, true, "frozen _v");
    const b2 = await cli("live-check", ["--action", "edit", "--step", "before"]); eq(b2.exitCode, 0, "edit before");
    const e = await d.coord().submitIntent(upsert(newId, { sales: "34" }, { sales: "12" })); eq(e.status, "committed", "edit");
    const a2 = await cli("live-check", ["--action", "edit", "--step", "after"]); eq(a2.exitCode, 0, JSON.stringify(a2.error) + JSON.stringify(a2.report && a2.report.findings)); eq(a2.report.classification.level, "OK", "edit ok");
    const b3 = await cli("live-check", ["--action", "delete", "--step", "before"]); eq(b3.exitCode, 0, "delete before");
    await d.until(() => d.displayed().some((x) => x.id === newId));
    const del = await d.coord().submitIntent(d.ML.buildEntryDeleteIntent(d.displayed().find((x) => x.id === newId), {})); eq(del.status, "committed", "delete");
    const a3 = await cli("live-check", ["--action", "delete", "--step", "after"]); eq(a3.exitCode, 0, JSON.stringify(a3.error) + JSON.stringify(a3.report && a3.report.findings)); eq(a3.report.classification.level, "OK", "delete ok");
    // a clear-all from the dashboard during an observation ⇒ generation change ⇒ STOP, no transition
    const b4 = await cli("live-check", ["--action", "create", "--step", "before"]); eq(b4.exitCode, 0, "before clear");
    await d.until(() => d.displayed().length === 3); const c = await d.clearAll(); eq(c.status, "committed", "clear " + c.status + "/" + (c.reason || ""));
    const a4 = await cli("live-check", ["--action", "create", "--step", "after"]); eq(a4.exitCode, 12, "STOP"); expect(a4.report.findings.some((f) => f.code === "generation_changed_without_clear"), "generation finding"); eq(a4.report.automaticTransition, false, "no transition"); eq((await readNode(CTRL)).phase, "v2_active", "policy untouched");
    return "create/edit/delete OK via index.html blocks; clear-all ⇒ STOP (recommendation only)";
  });

  await run("CT-E12", "malformed", "malformed V2 injected by Admin ⇒ verify/monitor STOP (CT-22); poisoned _v ⇒ readers unchanged", async () => {
    const { cap } = await bringToActive();
    const node = await readNode();
    await seedDb().ref(PATH + "/_v").set("[{\"id\":\"ghost\"}]");
    const v0 = await cli("verify", ["--phase", "active"]); eq(v0.exitCode, 12, "poisoned _v changes the frozen blob ⇒ STOP by structure"); expect(v0.report.findings.some((f) => f.code === "frozen_v_changed"), "frozen finding"); expect(v0.report.findings.some((f) => f.code === "no_v_fallback"), "readers ignore _v");
    await seedDb().ref(PATH).set({ ...node, rows: { ...node.rows, junk: { id: "junk" } } });
    const v = await cli("verify", ["--phase", "active"]); eq(v.exitCode, 12, "STOP"); eq(v.report.recommendation, "RECOVERY_HOLD_RECOMMENDED", "recommendation"); eq(v.report.automaticTransition, false, "no auto");
    const m = await cli("monitor", ["--cycle", "2026-09-02"]); eq(m.exitCode, 12, "monitor STOP"); eq(m.report.record.classification.level, "STOP", "record level"); eq(m.report.record.cycle, "INCOMPLETE", "never COMPLETE");
    eq((await readNode(CTRL)).phase, "v2_active", "never held automatically");
    void cap; return "malformed ⇒ verify+monitor STOP; phase untouched";
  });

  await run("CT-E13", "monitor", "two cycles with seeded derived docs; row-count equation; idempotent re-run; correction record", async () => {
    await bringToActive();
    const cfg = (date) => ({ date, tenantId: TENANT, bizId: BIZ });
    await seedDb().ref(`tenants/${TENANT}/biz:${BIZ}:analytics:daily:2026-09-02`).set(cfg("2026-09-02")); await seedDb().ref(`tenants/${TENANT}/biz:${BIZ}:insights:daily:2026-09-02`).set({ date: "2026-09-02" });
    await seedDb().ref(`tenants/${TENANT}/proactive_digests/${BIZ}/daily/2026-09-03`).set({ date: "2026-09-03" }); await seedDb().ref(`tenants/${TENANT}/proactive_insights/${BIZ}/ins1`).set({ id: "ins1", lastDetectedAt: "2026-09-02T23:30:00Z" });
    const rec = jsonFile("receipts.json", { creates: 0, deletes: 0, edits: 0, ui: { status: "PRESENT", by: "bob" }, snapshotEmail: { messageId: "m1", recipient: "owner@demo.example" }, alerts: { ran: true } });
    const m1 = await cli("monitor", ["--cycle", "2026-09-02", "--receipts", rec]); eq(m1.exitCode, 0, JSON.stringify(m1.error) + JSON.stringify(m1.report && m1.report.record.findings)); eq(m1.report.appended, true, "appended");
    eq(m1.report.record.cycle, "COMPLETE", "complete: " + JSON.stringify(m1.report.record.incompleteReasons) + JSON.stringify(m1.report.record.findings)); eq(m1.report.record.mutations.ok, true, "equation");
    expect(!JSON.stringify(m1.report.record).includes("owner@demo.example"), "recipient hashed");
    const m1b = await cli("monitor", ["--cycle", "2026-09-02", "--receipts", rec]); eq(m1b.report.appended, false, "idempotent");
    const m2 = await cli("monitor", ["--cycle", "2026-09-03", "--receipts", rec]); eq(m2.exitCode, 0, "cycle 2"); eq(m2.report.record.cycle, "INCOMPLETE", "missing derived for 09-03 ⇒ INCOMPLETE");
    const rec2 = jsonFile("receipts2.json", { creates: 1, deletes: 0, edits: 0, ui: { status: "PRESENT" }, snapshotEmail: { messageId: "m2" }, alerts: { ran: true } });
    const m1c = await cli("monitor", ["--cycle", "2026-09-02", "--receipts", rec2]); eq(m1c.report.reason, "correction", "correction"); eq(m1c.report.record.correction, 1, "c1");
    expect(m1c.report.record.findings.some((f) => f.code === "unexplained_row_delta"), "1 create claimed but rows unchanged ⇒ equation fails ⇒ STOP");
    const st = await cli("status"); eq(st.report.window.windowMet, false, "window not met"); eq(st.report.ledgerCycles, 3, "ledger records");
    return "cycle 1 COMPLETE, cycle 2 INCOMPLETE, correction c1";
  });

  await run("CT-E14", "hold", "hold only on explicit command: verify STOP prints the recommendation and does NOT transition (CT-27); hold ⇒ recovery_hold; resume ⇒ v2_active", async () => {
    await bringToActive();
    const node = await readNode(); await seedDb().ref(PATH + "/generation").set(2);
    const v = await cli("verify", ["--phase", "active"]); eq(v.exitCode, 12, "STOP"); eq(v.report.recommendation, "RECOVERY_HOLD_RECOMMENDED", "rec"); expect(v.report.holdCommand.includes("hold --execute"), "hold command printed"); eq((await readNode(CTRL)).phase, "v2_active", "not transitioned");
    const dry = await cli("hold", ["--expected-revision", "4", "--reason", "inc-1"]); eq(dry.exitCode, 0, "dry " + JSON.stringify(dry.error)); eq((await readNode(CTRL)).phase, "v2_active", "dry-run holds nothing");
    const h = await cli("hold", ["--expected-revision", "4", "--execute", "--confirm", token(manifest, "hold", 4), "--reason", "inc-1"]); eq(h.exitCode, 0, JSON.stringify(h.error)); const c = await readNode(CTRL); eq(c.phase, "recovery_hold", "held"); eq(c.operation.kind, "recovery", "recovery op");
    await seedDb().ref(PATH).set(node);
    const r = await cli("resume", ["--expected-revision", "5", "--execute", "--confirm", token(manifest, "resume", 5)]); eq(r.exitCode, 0, JSON.stringify(r.error)); eq((await readNode(CTRL)).phase, "v2_active", "resumed");
    return "STOP ⇒ recommendation; hold/resume explicit (rev 4→5→6)";
  });

  await run("CT-E15", "unknown", "unknown outcome reconciliation: A2 (attempted, source intact) ⇒ migrate refuses reconcile_required; B (converted, held) ⇒ verify post proceeds (CT-32)", async () => {
    const cap = await bringToCapture();
    await seedDb().ref(CTRL + "/conversionAttempted").set(true); await seedDb().ref(CTRL + "/policyRevision").set(3);
    const st = await cli("status"); eq(st.report.reconciliation.state, "A2_SOURCE_INTACT_AFTER_ATTEMPT", "A2"); eq(st.report.reconciliation.level, "OK", "level");
    const m = await cli("migrate", ["--expected-revision", "3", "--execute", "--confirm", token(manifest, "migrate", 3, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]); eq(m.exitCode, 13, "refused"); eq(m.error.error, "reconcile_required", "code");
    const expected = JSON.parse(readFileSync(join(cap.dir, "expected-v2.json"), "utf8")).node; await seedDb().ref(PATH).set(expected);
    const st2 = await cli("status"); eq(st2.report.reconciliation.state, "B_CONVERTED_HELD", "B");
    const v = await cli("verify", ["--phase", "post"]); eq(v.exitCode, 0, JSON.stringify(v.error) + JSON.stringify(v.report && v.report.findings)); expect(v.report.checkpointId, "checkpoint from a reconciled B state");
    return "A2 ⇒ reconcile_required; B ⇒ verify post OK";
  });

  await run("CT-E16", "environment", "emulator run with a production-shaped manifest ⇒ 14 (CT-25); --execute without token ⇒ 15 and zero writes (CT-26)", async () => {
    await reseed({ policy: POLICY() }); writeManifest();
    const before = JSON.stringify(await readNode("/"));
    const prodManifest = { ...manifest, environment: "production", projectId: "example-prod", databaseURL: "https://example-prod-default-rtdb.firebaseio.com", tenantId: "t-example", bizId: "b-example" };
    const pp = join(EV, "manifest-prod.json"); writeFileSync(pp, JSON.stringify(prodManifest)); chmodSync(pp, 0o600);
    const save = manifestPath; manifestPath = pp;
    const r1 = await cli("plan"); eq(r1.exitCode, 14, "prod manifest under --env emulator"); eq(r1.error.error, "environment_mismatch", "code");
    const r2 = await cli("plan", [], { env: "production" }); eq(r2.exitCode, 14, "production requested with emulator host set"); eq(r2.error.error, "emulator_host_set_in_production", "code");
    manifestPath = save;
    const r0 = await cli("quiesce", ["--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(r0.exitCode, 10, "no expected revision"); eq(r0.error.error, "expected_revision_required", "R1-F1");
    const r0b = await cli("quiesce", ["--expected-revision", "1.0", "--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(r0b.error.error, "expected_revision_invalid", "R1-F1 malformed");
    const r0c = await cli("quiesce", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(r0c.error.error, "stale_revision", "R1-F1 stale");
    const r3 = await cli("quiesce", ["--expected-revision", "1", "--execute"]); eq(r3.exitCode, 15, "no token"); eq(r3.error.error, "confirmation_missing", "code");
    const r4 = await cli("quiesce", ["--expected-revision", "1", "--execute", "--confirm", "0123456789abcdef"]); eq(r4.exitCode, 15, "wrong token");
    const r5 = await cli("migrate", ["--expected-revision", "1", "--execute", "--confirm", token(manifest, "migrate", 1, null)]); expect([10, 15].includes(r5.exitCode), "migrate refused: " + r5.exitCode);
    eq(JSON.stringify(await readNode("/")), before, "zero writes");
    return "environment_mismatch, emulator_host_set_in_production, confirmation_missing/mismatch; zero writes";
  });

  await run("CT-E17", "cold-cache", "fresh Admin app per command (cold SDK cache): policy CAS probe and warm entries listener ⇒ conversion exactly once", async () => {
    const cap = await bringToCapture();
    const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cap.sourceDigest), "--ack", ack("migrate", cap.bundleId)]);
    eq(m.exitCode, 0, JSON.stringify(m.error)); eq(m.report.transactionStats.coreRuns, 1, "core once"); eq(m.report.transactionStats.nullRuns, 0, "warm listener ⇒ no null callback"); eq(m.report.transactionStats.drift, false, "no drift");
    eq((await readNode(CTRL)).policyRevision, 3, "one CAS marker");
    return `entries transaction runs=${m.report.transactionStats.runs}, coreRuns=1, nullRuns=0`;
  });

  await run("CT-E18", "drain-bind", "R1-F3: drain bound to state — entries change after drain ⇒ capture DRAIN_EVIDENCE_STALE; restored ⇒ accepted by digest; context change after capture ⇒ migrate refused before the CAS marker", async () => {
    await reseed({ policy: POLICY() }); writeManifest();
    const q = await cli("quiesce", ["--expected-revision", "1", "--execute", "--confirm", token(manifest, "quiesce", 1)]); eq(q.exitCode, 0, "quiesce");
    const d = await cli("drain-check", ["--interval", "2", "--writer-bound", "0", "--attest", attestFile()]); eq(d.exitCode, 0, "drain"); eq(d.report.verdict, "DRAIN_EVIDENCE_COMPLETE", "verdict");
    expect(d.report.bound && d.report.bound.accepted && d.report.bound.start && d.report.bound.mid && d.report.bound.end, "start/mid/end/accepted recorded"); eq(d.report.bound.policyRevision, 2, "policy bound"); eq(d.report.bound.accepted.entries, await digestOf(), "entries digest bound");
    const stateA = await readNode(); const rows = ROWS(); rows[0].sales = "777"; await seedDb().ref(PATH).set(asLegacy(rows));
    const cB = await cli("capture"); eq(cB.exitCode, 11, "stale capture " + JSON.stringify(cB.error)); eq(cB.error.error, "drain_evidence_stale", "typed"); expect(/entries/.test(cB.error.detail), "entries mismatch named");
    await seedDb().ref(PATH).set(stateA);
    const cE = await cli("capture"); eq(cE.exitCode, 0, "restored ⇒ accepted " + JSON.stringify(cE.error)); expect(readdirSync(cE.report.dir).includes("drain.json"), "drain bound into the bundle");
    await seedDb().ref(`tenants/${TENANT}/biz:${BIZ}:fixed`).set({ _v: "[{\"name\":\"rent\",\"amount\":\"1\"}]" });
    const before = JSON.stringify(await readNode(CTRL));
    const m = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cE.report.sourceDigest), "--ack", ack("migrate", cE.report.bundleId)]);
    eq(m.exitCode, 10, "migrate refused " + JSON.stringify(m.error)); eq(m.error.error, "drain_evidence_stale", "typed"); eq(JSON.stringify(await readNode(CTRL)), before, "no CAS marker"); eq((await readNode()).schemaVersion, undefined, "core never ran");
    await seedDb().ref(`tenants/${TENANT}/biz:${BIZ}:fixed`).set({ _v: "[]" });
    const ok = await cli("migrate", ["--expected-revision", "2", "--execute", "--confirm", token(manifest, "migrate", 2, cE.report.sourceDigest), "--ack", ack("migrate", cE.report.bundleId)]); eq(ok.exitCode, 0, "restored ⇒ migrate " + JSON.stringify(ok.error)); eq(ok.report.outcome.status, "MIGRATED_HELD", "held");
    return "stale ⇒ 11 (capture) / 10 (migrate, zero writes); restored ⇒ accepted";
  });

  // ─── report ───────────────────────────────────────────────────────────────
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(""); console.log(`${w("case", 8)} ${w("area", 12)} ${w("status", 6)} ${w("ms", 6)} notes`); console.log("-".repeat(120));
  for (const r of results) console.log(`${w(r.id, 8)} ${w(r.area, 12)} ${w(r.status, 6)} ${w(r.ms, 6)} ${r.status === "PASS" ? r.notes : r.notes.split("\n")[0]}`);
  const EXPECTED = 18;
  console.log("\n=== TOTALS ==="); console.log(`total=${results.length} passed=${results.length - failures} failed=${failures}`);
  console.log(`evidence dir: ${EV}`);
  if (results.length !== EXPECTED) { console.error(`\nINCOMPLETE MATRIX: expected ${EXPECTED}, ran ${results.length}`); process.exitCode = 3; return; }
  if (failures) { console.error("\n=== FAILURES ==="); for (const r of results.filter((x) => x.status === "FAIL")) console.error(`${r.id} [${r.area}] ${r.description}\n    ${r.notes}`); process.exitCode = 1; return; }
  console.log("\nALL CASES PASSED");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main_().then(async () => { await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); })
         .catch(async (e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exitCode = 4; await Promise.all(admin.apps.filter(Boolean).map((a) => a.delete().catch(() => {}))); });
}
