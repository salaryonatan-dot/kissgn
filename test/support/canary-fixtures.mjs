// Marjin — CANARY TOOLING test fixtures: manifests, an in-memory RTDB with listeners and
// transaction hooks, a fake Admin app, a Rules-serving fetch stub and a CLI runner.
// No credentials, no network, no Production identifiers anywhere.
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { main } from "../../tools/storage-v2/canary.mjs";
import { ROOT, row, uuid, asLegacy, asV2 } from "./entries-fixtures.mjs";
import { gitIn } from "./git-context.mjs";
export { ROOT, row, uuid, asLegacy, asV2 };
/** HEAD of THIS checkout (worktree-safe); the approved sha is only a fallback for offline runs. */
export function headSha() { try { const r = gitIn(ROOT, ["rev-parse", "HEAD"]); return r.status === 0 && /^[0-9a-f]{40}/.test(r.stdout.trim()) ? r.stdout.trim() : APPROVED_SHA; } catch (_) { return APPROVED_SHA; } }

export const APPROVED_SHA = "5afb27543cb3d81c2ff23905af5b4ceeff706203";
// F1 R1 (independent core/F1 review, CANARY_FINDINGS.md): the Rules the Storage V2 canary must find
// deployed follow the release Rules. The F1 delta (one scoped cost_history read branch + an explicit
// client-write denial; RULES_DELTA_REVIEW.md, emulator matrix + 6 mutation controls) changes the release
// Rules from the P0 fenced blob 1e5dea2f9b1eac037c766b325b927c20285c0eec to the F1 candidate below.
// CANDIDATE — pending independent Codex review; NOT a publication approval. Kept equal to
// F1_RULES_CANDIDATE_BLOB (test/support/rules-authorized-delta.mjs) by test/finance/f1-r1-review-state.test.mjs.
export const APPROVED_RULES_BLOB = "32ea32bfc9b70c16c06b1acf87d045c5e28ff1d8";
// RF1 (Rules / test-fixture transition T-RF1-GATE; LOCAL candidate, pending independent Codex review): the LOCAL GATE
// EXPECTATION. Every local canary test and the emulator operator matrix check the checked-out Rules against THIS literal —
// the integration Rules of this lineage, i.e. M1_INTEGRATION_RULES_BLOB (test/support/rules-authorized-delta.mjs) = the F1
// candidate above composed with the P1 legacy `biz:*:credits` client-write denial (both deltas independently approved for
// integration: Core/F1 R4 2026-10-04, P1 R3 / R7 2026-10-04 / 06; the composition verified exact and behaviour-narrowing
// on 2026-10-13, RULES_COMPARISON.md + the independent review's three-way check and 420-cell differential probe).
// It is a CANDIDATE EXPECTATION, NOT the release pin: APPROVED_RULES_BLOB above is UNCHANGED and remains the Rules-owner's
// publication record (RELEASE_GATES §1 — moving it is a release-pin transition outside this candidate). The two differ by
// exactly the P1 denial (test/storage-v2/rf1-rules-gate.test.mjs RF-01) and a manifest naming the release pin is refused
// against the checked-out Rules (RF-02: publication pending). Neither value is ever derived from the artifact under test.
export const CANDIDATE_RULES_BLOB = "27887d72da5431bd0b6ee69f53e0dfd10cc44caf";
// RF2 (closes the independent RF1 review's RF1-R-01): the candidate expectation is CONFINED to the exact emulator scope — the demo
// project, the loopback namespace URL, environment "emulator" — and is never caller-selected. Three constructors, no other path:
//   candidateManifest(over)          the enforced candidate-emulator factory (the retired lane's RC-L04 semantics): refuses ANY
//                                    `environment` / `projectId` / `databaseURL` / `approved` override, validates the FINAL object
//                                    after the merge and freezes it
//   manifestFor(over)                the ordinary fixture: emulator (the candidate, exact scope) or `environment: "production"`
//                                    (the release pin, example production project / URL); the same four categories are refused
//                                    except that one production switch; the FINAL object is scope-checked after the merge
//   diagnosticManifest(over, reason) deliberately malformed / stale / mis-shaped manifests for fault injection — explicitly
//                                    diagnostic (a non-empty `reason` is required, the result is registered as diagnostic); any
//                                    override is allowed EXCEPT that the FINAL object may never carry the candidate expectation
//                                    outside its exact scope and the candidate is never selectable through `approved.rulesBlob`
// A diagnostic manifest that needs a pin outside the candidate scope names DIAGNOSTIC_RULES_BLOB — a 40-hex sentinel that is no
// git object, never the candidate, never the release pin, never the P0 fence.
export const DIAGNOSTIC_RULES_BLOB = "d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6d1a6";
export const EMU_NS = "demo-marjin-rules-default-rtdb", EMU_PROJECT = "demo-marjin-rules", EMU_HOST = "127.0.0.1:9000";
export const EMU_URL = `http://${EMU_HOST}?ns=${EMU_NS}`;
export const EMU_ENV = Object.freeze({ FIREBASE_DATABASE_EMULATOR_HOST: EMU_HOST, GCLOUD_PROJECT: EMU_PROJECT, GOOGLE_CLOUD_PROJECT: EMU_PROJECT, PATH: process.env.PATH });
export const PROD_ENV = Object.freeze({ PATH: process.env.PATH });
export const T = "tenantA", B = "bizA", NAME = "Biz bizA";

export const LIVE_ROW = () => { const { id, ...planned } = row("live", "2026-09-20", { sales: "12" }); void id; return planned; };
const SCOPE_KEYS = Object.freeze(["environment", "projectId", "databaseURL", "approved"]);
const scopeError = (code, detail) => { const e = new Error(`${code}: ${detail}`); e.code = code; return e; };
/** The exact candidate-emulator scope: environment "emulator", the demo project, the loopback namespace URL, the candidate pin. */
export function isCandidateScope(m) { return !!m && m.environment === "emulator" && m.projectId === EMU_PROJECT && m.databaseURL === EMU_URL; }
/** Judge a FINAL (post-merge) manifest: the candidate expectation never leaves its exact scope. Throws `candidate_scope_refused`. */
export function assertCandidateScope(m) {
  const pin = m && m.approved && m.approved.rulesBlob;
  if (pin === CANDIDATE_RULES_BLOB && !isCandidateScope(m)) throw scopeError("candidate_scope_refused", `the candidate expectation appears outside the emulator scope (${m.environment} ${m.projectId} ${m.databaseURL})`);
  if (m && m.environment === "production" && pin === CANDIDATE_RULES_BLOB) throw scopeError("candidate_scope_refused", "a production-shaped manifest names the candidate");
  return m;
}
const refuseSelectedCandidatePin = (over) => { if (over && over.approved && typeof over.approved === "object" && over.approved.rulesBlob === CANDIDATE_RULES_BLOB) throw scopeError("candidate_pin_selection_refused", "the candidate expectation is the emulator default, never a caller-selected pin"); };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const DIAGNOSTIC = new WeakSet();
/** True for a manifest built by diagnosticManifest(); such a manifest is fault-injection material, never a gate expectation. */
export const isDiagnosticManifest = (m) => DIAGNOSTIC.has(m);

/** The enforced candidate-emulator factory (RC-L04 semantics restored): no scope override of any kind; the final object is checked and frozen. */
export function candidateManifest(over = {}) {
  for (const k of SCOPE_KEYS) if (Object.hasOwn(over, k)) throw scopeError("candidate_scope_refused", `override of ${k} is not permitted on the candidate manifest`);
  const m = buildManifest(over);
  if (!isCandidateScope(m) || m.approved.rulesBlob !== CANDIDATE_RULES_BLOB) throw scopeError("candidate_scope_refused", "the constructed manifest is not the exact candidate-emulator scope");
  return deepFreeze(assertCandidateScope(m));
}
/** Deliberately malformed / stale / mis-shaped manifests for fault injection: explicitly diagnostic, candidate never carried outside its scope. */
export function diagnosticManifest(over = {}, reason) {
  if (typeof reason !== "string" || !reason.trim()) throw scopeError("diagnostic_reason_required", "a diagnostic manifest must state why it is malformed / stale / mis-shaped");
  refuseSelectedCandidatePin(over);
  const m = assertCandidateScope(buildManifest(over));
  DIAGNOSTIC.add(m);
  return m;
}
/** The ordinary fixture: the exact candidate-emulator scope, or `environment: "production"` → the release pin on the example production shape. */
export function manifestFor(over = {}) {
  for (const k of SCOPE_KEYS) if (Object.hasOwn(over, k) && !(k === "environment" && over.environment === "production")) throw scopeError("candidate_scope_refused", `override of ${k} is not permitted on an ordinary manifest (use diagnosticManifest(over, reason) for fault injection)`);
  return assertCandidateScope(buildManifest(over));
}
function buildManifest(over = {}) {
  const production = over.environment === "production";
  const m = {
    manifestVersion: 1, environment: production ? "production" : "emulator",
    projectId: production ? "example-prod-project" : EMU_PROJECT,
    databaseURL: production ? "https://example-prod-project-default-rtdb.firebaseio.com" : EMU_URL,
    tenantId: production ? "t-example-1" : T, bizId: production ? "b-example-1" : B,
    expectedIdentity: { businessName: NAME, ownerAttestation: { by: "owner@example", at: "2026-09-25T08:00:00Z", ref: "attest-1" } },
    probeBizId: null,
    // RF1: an emulator manifest names the local gate expectation (the checked-out integration Rules); a production-shaped
    // manifest keeps naming the release pin — the two are never conflated in a fixture.
    approved: { repoSha: headSha(), rulesBlob: production ? APPROVED_RULES_BLOB : CANDIDATE_RULES_BLOB },
    operation: { id: "canary-op-1", operator: "alice", observer: "bob", approvalRef: "cto-ok-1" },
    expected: { policyRevisionAtStart: 1, sourceDigest: null, evidenceId: null },
    limits: { maxRows: 500, maxNodeBytes: 1048576 },
    timezone: "Asia/Jerusalem",
    liveWrite: { date: "2026-09-20", plannedRow: LIVE_ROW(), editField: "sales", editValue: "34" },
  };
  return deepMerge(m, over);
}
function deepMerge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v; return o; }

export const LEGACY_ROWS = () => [row("c1", "2026-09-01", { sales: "100", food_cost: "30" }), row("c2", "2026-09-02", { sales: "250", payroll: "80" }), row("c3", "2026-09-03", { sales: "0", notes: "יום שקט 🙂" })];
export const POLICY = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
export const QUIESCED = (over = {}) => POLICY({ phase: "quiesced", policyRevision: 2, operation: { id: "canary-op-1", kind: "cutover", owner: "alice", startedAt: 1 }, ...over });
export const ACTIVE = (over = {}) => POLICY({ phase: "v2_active", policyRevision: 4, minStorageProtocol: 2, ...over });

/** In-memory RTDB with `on/off` listeners and transaction hooks (drift / cold cache / throw-after-commit). */
export function fakeRtdb() {
  const base = makeDb();
  const listeners = [];
  const hooks = { beforeTransaction: null, coldCacheOnce: false, throwAfterCommit: null /* (path) => Error|null */, failReads: null };
  const notify = () => { for (const l of listeners.slice()) base.ref(l.path).once("value").then((s) => l.cb(s)); };
  const wrap = (path, q) => {
    const r = base.ref(path, q);
    return { ...r,
      child: (c) => wrap(path + "/" + c),
      orderByKey: () => wrap(path, { ...(q || {}), order: "key" }), startAt: (k) => wrap(path, { ...(q || {}), startAt: k }), endAt: (k) => wrap(path, { ...(q || {}), endAt: k }), limitToLast: (n) => wrap(path, { ...(q || {}), limitToLast: n }),
      once: async (ev) => { if (hooks.failReads && hooks.failReads(path)) { const e = new Error("PERMISSION_DENIED: Permission denied"); e.code = "PERMISSION_DENIED"; throw e; } return r.once(ev); },
      set: async (v) => { await r.set(v); notify(); }, update: async (v) => { await r.update(v); notify(); }, remove: async () => { await r.remove(); notify(); },
      on: (ev, cb, onErr) => { const l = { path, cb }; listeners.push(l); r.once("value").then((s) => cb(s), (e) => onErr && onErr(e)); return cb; },
      off: (ev, cb) => { const i = listeners.findIndex((l) => l.cb === cb); if (i >= 0) listeners.splice(i, 1); },
      transaction: async (fn) => {
        if (hooks.beforeTransaction) await hooks.beforeTransaction(path);
        if (hooks.coldCacheOnce) { hooks.coldCacheOnce = false; const probe = fn(null); if (probe !== null && probe !== undefined) { const res = await r.transaction(() => probe); notify(); return res; } }
        const res = await r.transaction(fn); if (res.committed) notify();
        if (hooks.throwAfterCommit && res.committed) { const e = hooks.throwAfterCommit(path); if (e) throw e; }
        return res;
      } };
  };
  return { ref: (p, q) => wrap(p, q), seed: base.seed, read: base.read, writes: base.writes, store: base.store, hooks, listeners };
}
export function fakeApp(db, { databaseURL = EMU_URL } = {}) { return { options: { databaseURL }, database: () => ({ ref: db.ref }), delete: async () => {} }; }

export function seedBusiness(db, { tenantId = T, bizId = B, entries = asLegacy(LEGACY_ROWS()), businessName = NAME, control = POLICY(), exceptions = null, config = {}, fixed = [], suppliers = null } = {}) {
  if (entries !== null) db.seed(`tenants/${tenantId}/biz:${bizId}:entries`, entries);
  db.seed(`tenants/${tenantId}/biz:${bizId}:config`, { _v: JSON.stringify({ businessName, lat: 32.1, lon: 34.8, ...config }) });
  db.seed(`tenants/${tenantId}/biz:${bizId}:fixed`, { _v: JSON.stringify(fixed) });
  if (suppliers) db.seed(`tenants/${tenantId}/biz:${bizId}:suppliers`, suppliers);
  if (exceptions) db.seed(`tenants/${tenantId}/entry_exceptions/${bizId}`, exceptions);
  if (control) db.seed(`storage_v2_control/${tenantId}/${bizId}`, control);
  db.seed(`tenants/${tenantId}/app/business`, { _v: JSON.stringify([{ id: bizId, name: businessName }]) });
  return db;
}
export const entriesOf = (db, tenantId = T, bizId = B) => db.read(`tenants/${tenantId}/biz:${bizId}:entries`);
export const controlOf = (db, tenantId = T, bizId = B) => db.read(`storage_v2_control/${tenantId}/${bizId}`);

/** Serve the canonical repo Rules for `/.settings/rules.json`; everything else is offline. Returns restore(). */
export function stubRulesFetch(text = readFileSync(join(ROOT, "database.rules.json"), "utf8")) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url).includes("/.settings/rules.json")) return { ok: true, status: 200, text: async () => text }; throw new Error("offline"); };
  return () => { globalThis.fetch = prev; };
}
export const ATTESTATION = (over = {}) => ({ attestationVersion: 1, operationId: "canary-op-1", by: "alice", at: "2026-09-25T09:00:00Z", items: { controlledClientsInventory: true, oldSessionsClosedOrReplaced: true, pendingSavesReconciled: true, adminWritesFrozen: true, exceptionWritesFrozen: true, configEditsFrozen: true, jobsPaused: { analytics: true, proactive: true, alerts: true, snapshot: true }, unknowns: [] }, ...over });
export function tempEvidenceDir() { const d = mkdtempSync(join(tmpdir(), "canary-ev-")); chmodSync(d, 0o700); return d; }
export function writeJsonFile(dir, name, obj) { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj, null, 2)); chmodSync(p, 0o600); return p; }

/** Run the CLI in-process against a fake app; captures stdout/stderr JSON lines. */
export async function runCli(argv, { db, processEnv = EMU_ENV, app } = {}) {
  const out = [], err = [];
  const L = console.log, Er = console.error;
  console.log = (...a) => out.push(a.join(" ")); console.error = (...a) => err.push(a.join(" "));
  let exitCode;
  try { exitCode = await main(argv, { processEnv, adminAppFactory: () => app || fakeApp(db) }); }
  finally { console.log = L; console.error = Er; }
  const parse = (lines) => { const l = lines.filter((x) => x.startsWith("{")).pop(); try { return l ? JSON.parse(l) : null; } catch (_) { return null; } };
  return { exitCode, out, err, summary: parse(out), error: parse(err) };
}
export const readReport = (file) => JSON.parse(readFileSync(file, "utf8"));
/** Standard argv prefix for a manifest + evidence dir. */
export const args = (command, manifestPath, evidenceDir, env = "emulator", extra = []) => [command, "--manifest", manifestPath, "--env", env, "--evidence-dir", evidenceDir, ...extra];
