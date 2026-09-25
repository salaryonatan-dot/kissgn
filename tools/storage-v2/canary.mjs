#!/usr/bin/env node
// Storage V2 — CANARY TOOLING: the operator CLI (P0-DATA-01, one-business canary).
//
// HARD BOUNDARY — this module:
//   • is INERT on import: nothing runs unless it is the process entry point;
//   • has NO "do everything" command, NO clear-all, NO raw entries write, NO restore, NO
//     automatic retry, NO automatic recovery_hold, NO force flag;
//   • every write command is DRY-RUN unless `--execute` AND the stage confirmation token
//     (`--confirm`, printed by `plan`) are given; `migrate`/`activate` also need `--ack`;
//   • every command binds to ONE business from the validated manifest and fails closed on
//     any environment / identity / phase / revision / evidence mismatch;
//   • writes only machine-readable reports, receipts, evidence bundles and ledger records to
//     the operator's private evidence directory (outside git).

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createStoragePolicyControl } from "./policy.mjs";
import { createStorageV2Upgrader } from "./upgrade.mjs";
import { createLegacyPreflight } from "./preflight.mjs";
import { loadProductionWindow } from "./production-window.mjs";
import { parsePolicyRecord, isStoragePolicyError } from "../../lib/storagePolicy.js";
import * as C from "./canary-contract.mjs";
import * as E from "./canary-evidence.mjs";
import * as T from "./canary-transport.mjs";
import { runReaders } from "./canary-readers.mjs";

const { EXIT, CanaryError } = C;
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const USAGE = `usage: node tools/storage-v2/canary.mjs <command> --manifest <file> --env production|emulator --evidence-dir <dir> [options]
commands (read-only): plan preflight drain-check capture verify live-check status monitor
commands (write; dry-run unless --execute --confirm <token>): enroll quiesce abort migrate activate hold resume probe-legacy-denial
options: --credentials-file <sa.json> (production) --execute --confirm <token|-> --ack <file> --attest <file> --interval <sec> --writer-bound <sec>
         --bundle <id> --phase pre|post|active --checkpoint <id> --action create|edit|delete --step before|after --await <sec> --token-file <file>
         --cycle <YYYY-MM-DD> --receipts <file> --dates <d1,d2,…> --resolved <code,…> --json`;

// ── argv ─────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) out.flags[k] = true; else { out.flags[k] = v; i++; } }
    else out._.push(a);
  }
  return out;
}
const nowIso = () => new Date().toISOString();
const compact = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

// ── context ──────────────────────────────────────────────────────────────────
export async function createContext({ command, flags, processEnv = process.env, adminAppFactory = T.createAdminApp, adminApps }) {
  if (!C.COMMANDS.includes(command)) throw new CanaryError("unknown_command", command, EXIT.USAGE);
  if (!flags.manifest) throw new CanaryError("manifest_required", "--manifest <file>", EXIT.USAGE);
  const manifest = C.assertManifest(JSON.parse(readFileSync(flags.manifest, "utf8")));
  if (!flags["evidence-dir"]) throw new CanaryError("evidence_dir_required", "--evidence-dir <dir>", EXIT.USAGE);
  const evidenceDir = resolve(flags["evidence-dir"]);
  const inTree = spawnSync("git", ["-C", evidenceDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (existsSync(evidenceDir) && inTree.status === 0 && inTree.stdout.trim() === "true") throw new CanaryError("evidence_dir_inside_git", evidenceDir, EXIT.ENV);
  const env = T.resolveEnvironment({ manifest, envFlag: flags.env, credentialsFile: flags["credentials-file"], processEnv, ...(adminApps ? { adminApps } : {}) });
  const isWrite = C.WRITE_COMMANDS.includes(command);
  const execute = isWrite && flags.execute === true;
  const app = adminAppFactory(env, manifest);
  const transport = T.createTransport({ app, manifest, writable: isWrite, dryRun: isWrite && !execute });
  const W = loadProductionWindow(); const H = C.helpersFrom(W);
  const opDir = join(evidenceDir, manifest.operation.id);
  const reportsDir = join(opDir, "reports");
  const ctx = { command, flags, manifest, env, app, transport, H, W, evidenceDir, opDir, reportsDir, execute, isWrite, startedAt: nowIso(), root: ROOT };
  ctx.close = async () => { try { transport.detach(); } catch (_) {} try { await app.delete(); } catch (_) {} };
  return ctx;
}
function writeReport(ctx, name, body) {
  E.ensurePrivateDir(ctx.opDir); E.ensurePrivateDir(ctx.reportsDir);
  const report = { reportVersion: C.CONTRACT_VERSION, command: ctx.command, environment: ctx.env.mode, target: { tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, path: C.derivePaths(ctx.manifest).entries }, operationId: ctx.manifest.operation.id, startedAt: ctx.startedAt, endedAt: nowIso(), executed: !!ctx.execute, transportMode: ctx.isWrite ? (ctx.execute ? "admin-write" : "admin-dry-run") : "admin-read-surface", ...body };
  const file = join(ctx.reportsDir, `${name}-${compact(report.endedAt)}-${report.endedAt.slice(20, 23)}${randomBytes(2).toString("hex")}.json`);
  E.writeExclusive(file, JSON.stringify(report, null, 2) + "\n");
  return { report, file };
}
const receipt = (ctx, extra) => E.appendReceipt(ctx.opDir, { at: nowIso(), command: ctx.command, operationId: ctx.manifest.operation.id, environment: ctx.env.mode, executed: !!ctx.execute, ...extra });
async function must(r, what) { if (!r.ok) throw new CanaryError("read_failed", `${what}: ${r.error}`, EXIT.BLOCKER); return r.value; }
async function readAll(ctx) {
  const t = ctx.transport;
  const [entries, control, exceptions, context] = await Promise.all([t.readEntries(), t.readControl(), t.readExceptions(), t.readContext()]);
  const readErrors = {}; for (const [k, r] of [["entries", entries], ["control", control], ["exceptions", exceptions], ["config", context.config], ["fixed", context.fixed], ["suppliers", context.suppliers]]) if (!r.ok) readErrors[k] = r.error;
  return { raw: entries.ok ? entries.value : undefined, control: control.ok ? control.value : undefined, exceptions: exceptions.ok ? exceptions.value : undefined, context: { config: context.config.ok ? context.config.value : undefined, fixed: context.fixed.ok ? context.fixed.value : undefined, suppliers: context.suppliers.ok ? context.suppliers.value : undefined }, readErrors };
}
async function environmentEvidence(ctx) {
  const repo = T.repoIdentity(ctx.root);
  const rules = await ctx.transport.readRulesText();
  const fp = T.rulesFingerprint({ text: rules.ok ? rules.text : null, approvedBlob: ctx.manifest.approved.rulesBlob, root: ctx.root });
  return { mode: ctx.env.mode, ...repo, deployedRulesMatch: fp.match, deployedRulesBlob: fp.deployedRulesBlob, deployedRulesReason: rules.ok ? null : rules.error, servedRulesSha256: fp.servedSha256 || null, evidenceDir: ctx.evidenceDir };
}
const parsedPolicy = (control) => parsePolicyRecord(control === undefined ? null : control);
function requireIdentity(ctx, data) {
  const cfg = data.context.config; let name = null;
  if (cfg && typeof cfg === "object" && typeof cfg._v === "string") { try { name = JSON.parse(cfg._v).businessName; } catch (_) { name = null; } }
  if (name !== ctx.manifest.expectedIdentity.businessName) throw new CanaryError(name == null ? "identity_unprovable" : "identity_mismatch", `expected ${JSON.stringify(ctx.manifest.expectedIdentity.businessName)} observed ${JSON.stringify(name)}`, EXIT.ENV);
  return name;
}
function requireEnvironmentMatch(ctx, envEv) {
  // production: the tool MUST be the approved commit on a clean tree; emulator: reported by preflight (WARNING)
  if (ctx.env.mode === "production" && envEv.repoSha !== ctx.manifest.approved.repoSha) throw new CanaryError("tool_identity_mismatch", `${envEv.repoSha} ≠ ${ctx.manifest.approved.repoSha}`, EXIT.ENV);
  if (ctx.env.mode === "production" && envEv.treeClean === false) throw new CanaryError("tool_tree_dirty", "commit or discard changes first", EXIT.ENV);
  if (envEv.deployedRulesMatch === "mismatch") throw new CanaryError("rules_fingerprint_mismatch", `${envEv.deployedRulesBlob} ≠ ${ctx.manifest.approved.rulesBlob}`, EXIT.BLOCKER);
}
function latestBundle(ctx, flags) {
  const ids = E.listBundles(ctx.opDir).filter((b) => !b.startsWith("post-"));
  const id = flags.bundle || ids[ids.length - 1];
  if (!id) return null;
  return E.openBundle(join(ctx.opDir, id));
}
function confirmOrDryRun(ctx, expectedRevision, sourceDigest) {
  const token = C.confirmationToken({ manifest: ctx.manifest, command: ctx.command, expectedRevision, sourceDigest });
  if (!ctx.execute) return { executed: false, token };
  let provided = ctx.flags.confirm; if (provided === "-") provided = readFileSync(0, "utf8").trim();
  const chk = C.checkConfirmation({ manifest: ctx.manifest, command: ctx.command, expectedRevision, sourceDigest, provided });
  if (!chk.ok) throw new CanaryError(chk.reason, JSON.stringify(chk.expectedFor || {}), EXIT.CONFIRM);
  return { executed: true, token };
}
function requireAck(ctx, stage, boundId) {
  if (!ctx.execute) return null;
  if (!ctx.flags.ack) throw new CanaryError("observer_ack_required", `--ack <file> for stage ${stage}`, EXIT.CONFIRM);
  const ack = JSON.parse(readFileSync(ctx.flags.ack, "utf8"));
  if (ack.operationId !== ctx.manifest.operation.id || ack.stage !== stage || !ack.by || !ack.at) throw new CanaryError("observer_ack_invalid", "operationId/stage/by/at", EXIT.CONFIRM);
  if (boundId && ack.evidenceId !== boundId && ack.checkpointId !== boundId) throw new CanaryError("observer_ack_wrong_evidence", `ack binds ${ack.evidenceId || ack.checkpointId}, need ${boundId}`, EXIT.CONFIRM);
  return ack;
}
const policyControl = (ctx) => createStoragePolicyControl(ctx.transport.policyIo);
function policyErrorToCanary(e) { if (isStoragePolicyError(e)) return new CanaryError(e.code, e.detail, EXIT.BLOCKER); return e; }

// ── commands ─────────────────────────────────────────────────────────────────
export const commands = {
  async plan(ctx) {
    const data = await readAll(ctx); const envEv = await environmentEvidence(ctx);
    const pp = parsedPolicy(data.control); const rev = pp.status === "valid" ? pp.record.policyRevision : 0;
    const bundle = (() => { try { return latestBundle(ctx, ctx.flags); } catch (_) { return null; } })();
    const sourceDigest = bundle ? bundle.sourceManifest.sourceDigest : null;
    const tokens = {}; for (const c of C.WRITE_COMMANDS) tokens[c] = C.confirmationToken({ manifest: ctx.manifest, command: c, expectedRevision: rev, sourceDigest: ["migrate", "activate"].includes(c) ? sourceDigest : null });
    let identity = null, identityError = null; try { identity = requireIdentity(ctx, data); } catch (e) { identityError = e.code; }
    const mode = ctx.H.detectStorageMode(data.raw === undefined ? null : data.raw);
    const body = { identity: { expected: ctx.manifest.expectedIdentity.businessName, observed: identity, error: identityError }, environment: envEv, policy: pp.status === "valid" ? { phase: pp.record.phase, policyRevision: rev, operation: pp.record.operation, conversionAttempted: pp.record.conversionAttempted } : { status: pp.status, reason: pp.reason || null },
      storage: { mode: mode.mode, reason: mode.reason || null }, latestBundle: bundle ? bundle.complete.bundleId : null, sourceDigest, readErrors: data.readErrors, confirmationTokens: tokens, note: "tokens bind identity + command + current policy revision (+ source digest for migrate/activate); re-run plan after any change" };
    const { report, file } = writeReport(ctx, "plan", body);
    return { exitCode: identityError || envEv.deployedRulesMatch === "mismatch" ? EXIT.ENV : EXIT.OK, report, file };
  },
  async preflight(ctx) {
    const data = await readAll(ctx); const envEv = await environmentEvidence(ctx);
    const pp = parsedPolicy(data.control); const held = pp.status === "valid" && pp.record.phase === "quiesced";
    const drain = held ? latestDrain(ctx) : null;
    const resolved = ctx.flags.resolved ? String(ctx.flags.resolved).split(",") : [];
    const report = C.enhancedPreflight({ raw: data.raw === undefined ? null : data.raw, control: data.control, exceptions: data.exceptions, context: data.context, manifest: ctx.manifest, H: ctx.H, environment: envEv, held, resolvedActions: resolved, drain, readErrors: data.readErrors });
    const again = await ctx.transport.readEntries();
    if (again.ok && data.raw !== undefined && C.digestV1(again.value) !== C.digestV1(data.raw)) report.findings.push({ code: "drift_during_preflight", classification: "WARNING", reason: "the entries node changed while preflight ran — rerun" });
    report.aggregate = C.aggregateClassification(report.findings);
    const out = writeReport(ctx, "preflight", report);
    const exitCode = report.aggregate === "BLOCKER" ? EXIT.BLOCKER : report.aggregate === "OPERATOR_ACTION_REQUIRED" ? EXIT.ACTION : EXIT.OK;
    return { exitCode, report: out.report, file: out.file };
  },
  async enroll(ctx) { return policyTransition(ctx, { stage: "enroll", run: (Cp, rev) => Cp.initializeLegacy(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator }), requirePhase: null, expectAbsent: true }); },
  async quiesce(ctx) { return policyTransition(ctx, { stage: "quiesce", run: (Cp, rev) => Cp.quiesce(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator, operationId: ctx.manifest.operation.id }), requirePhase: "legacy" }); },
  async abort(ctx) { return policyTransition(ctx, { stage: "abort", run: (Cp, rev) => Cp.abortQuiescence(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator, operationId: ctx.manifest.operation.id }), requirePhase: "quiesced", requireOwned: true, requireNoAttempt: true }); },
  async hold(ctx) { return policyTransition(ctx, { stage: "hold", run: (Cp, rev) => Cp.enterRecoveryHold(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator, operationId: `recovery-${ctx.manifest.operation.id}` }), requirePhase: "v2_active", reason: ctx.flags.reason || null }); },
  async resume(ctx) { return policyTransition(ctx, { stage: "resume", run: (Cp, rev) => Cp.resumeV2Active(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator, operationId: `recovery-${ctx.manifest.operation.id}` }), requirePhase: "recovery_hold", requireCheckpoint: true }); },
  async "drain-check"(ctx) {
    const data = await readAll(ctx); requireIdentity(ctx, data);
    const interval = Number(ctx.flags.interval || 120), W = ctx.flags["writer-bound"] !== undefined ? Number(ctx.flags["writer-bound"]) : NaN;
    const sample = async () => { const d = await readAll(ctx); const derived = await ctx.transport.readDerived(new Date().toISOString().slice(0, 10));
      return { at: nowIso(), entries: C.digestV1(d.raw === undefined ? null : d.raw), exceptions: C.digestV1(d.exceptions === undefined ? null : d.exceptions), context: C.digestV1(d.context), control: C.digestV1(d.control === undefined ? null : d.control), derived: C.digestV1({ a: derived.analyticsDaily.ok ? derived.analyticsDaily.value : "ERR", i: derived.insightsDaily.ok ? derived.insightsDaily.value : "ERR", d: derived.proactiveDigest.ok ? derived.proactiveDigest.value : "ERR" }), readErrors: d.readErrors }; };
    const samples = [await sample()];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const half = Math.max(0, Math.floor(interval / 2));
    await sleep(half * 1000); samples.push(await sample()); await sleep((interval - half) * 1000); samples.push(await sample());
    const attestation = ctx.flags.attest ? JSON.parse(readFileSync(ctx.flags.attest, "utf8")) : null;
    const floorSeconds = C.drainFloorSeconds(W, ctx.env.mode);
    const verdict = C.drainVerdict({ samples, attestation, manifest: ctx.manifest, control: data.control, writerBoundSeconds: W, intervalSeconds: interval, floorSeconds });
    const out = writeReport(ctx, "drain", { ...verdict, attestation, floorPolicy: ctx.env.mode === "production" ? "max(120, W+60) seconds" : "emulator: max(1, W+1) seconds (same arithmetic, matrix pace)" });
    const cls = C.classify(verdict.findings, { phase: "quiesced" });
    return { exitCode: verdict.proven ? EXIT.OK : cls.level === "STOP" ? EXIT.BLOCKER : EXIT.ACTION, report: out.report, file: out.file };
  },
  async capture(ctx) {
    const data = await readAll(ctx); requireIdentity(ctx, data); const envEv = await environmentEvidence(ctx); requireEnvironmentMatch(ctx, envEv);
    if (Object.keys(data.readErrors).length) throw new CanaryError("read_failed", JSON.stringify(data.readErrors), EXIT.BLOCKER);
    const pp = parsedPolicy(data.control);
    if (pp.status !== "valid" || pp.record.phase !== "quiesced" || !pp.record.operation || pp.record.operation.id !== ctx.manifest.operation.id) throw new CanaryError("capture_requires_owned_quiesced", pp.status === "valid" ? pp.record.phase : pp.status, EXIT.BLOCKER);
    const drain = latestDrain(ctx);
    const resolved = ctx.flags.resolved ? String(ctx.flags.resolved).split(",") : [];
    const preflight = C.enhancedPreflight({ raw: data.raw, control: data.control, exceptions: data.exceptions, context: data.context, manifest: ctx.manifest, H: ctx.H, environment: envEv, held: true, resolvedActions: resolved, drain, readErrors: data.readErrors });
    if (preflight.aggregate === "BLOCKER") { const out = writeReport(ctx, "capture", { preflight, captured: false }); return { exitCode: EXIT.BLOCKER, report: out.report, file: out.file }; }
    const expected = C.computeExpectedV2(data.raw, ctx.H);
    const H = ctx.H, core = expected.report; const rows = core.rows;
    const ids = C.rowSummaries(rows, H);
    const dates = [...new Set([ids.latestDate, ids.oldestDate, ...(ctx.flags.dates ? String(ctx.flags.dates).split(",") : []), ...(ctx.manifest.liveWrite ? [ctx.manifest.liveWrite.date] : [])].filter(Boolean))];
    const businessName = requireIdentity(ctx, data);
    const baseline = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { entries: data.raw, config: data.context.config, fixed: data.context.fixed, suppliers: data.context.suppliers, exceptions: data.exceptions, businessName }, dates });
    // repeat read: the source must not have moved while we computed
    const again = await ctx.transport.readEntries(); const againDigest = C.digestV1(again.ok ? again.value : "ERR");
    const sourceDigest = C.digestV1(data.raw);
    if (againDigest !== sourceDigest) throw new CanaryError("source_moved_during_capture", `${sourceDigest} → ${againDigest}`, EXIT.BLOCKER);
    const rawV = typeof data.raw._v === "string" ? data.raw._v : null;
    const bundleId = `${compact(nowIso())}-${sourceDigest.slice(0, 8)}`;
    const sourceManifest = { serializer: C.SERIALIZER_VERSION, sourceDigest, rawVSha256: rawV === null ? null : C.rawVSha256(rawV), rawVBytes: rawV === null ? null : C.utf8Bytes(rawV), nodeBytes: preflight.storage.nodeBytes, rowCount: ids.rowCount, orderedIds: ids.orderedIds, sortedIds: ids.sortedIds, sortedIdsDigest: ids.sortedIdsDigest, idDateMultiset: ids.idDateMultiset, dateGroups: ids.dateGroups, duplicateDates: ids.duplicateDates, perRow: ids.perRow, domainGen: ids.domainGen, latestDate: ids.latestDate, oldestDate: ids.oldestDate, normalization: core.normalization, semanticDigest: C.semanticDigest(rows, H), exceptionsDigest: C.digestV1(data.exceptions === undefined ? null : data.exceptions), contextDigest: C.digestV1(data.context), policyRevision: pp.record.policyRevision };
    const financialSummary = summariseFinancials(baseline);
    const files = { "manifest.json": { json: { ...ctx.manifest, bundleId, capturedAt: ctx.startedAt, serializer: C.SERIALIZER_VERSION, expected: { ...ctx.manifest.expected, sourceDigest, evidenceId: bundleId } } }, "environment.json": { json: envEv }, "entries.source.json": JSON.stringify(data.raw), "exceptions.source.json": { json: data.exceptions === undefined ? null : data.exceptions }, "context.source.json": { json: data.context }, "policy.source.json": { json: { raw: data.control, parsed: pp.record } }, "source-manifest.json": { json: sourceManifest }, "expected-v2.json": { json: { node: expected.node, digest: expected.digest, logicalDigest: expected.logicalDigest, rowCount: expected.rowCount } }, "reader-baseline.json": { json: { ...baseline, financialSummary } }, "preflight.json": { json: preflight }, "financial-summary.json": { json: financialSummary } };
    if (rawV !== null) files["entries.raw-v.utf8"] = Buffer.from(rawV, "utf8");
    if (ctx.flags.deployment) files["deployment-evidence.json"] = readFileSync(ctx.flags.deployment);
    const b = E.createBundle({ root: ctx.evidenceDir, operationId: ctx.manifest.operation.id, bundleId, files, observerAck: ctx.flags.ack ? JSON.parse(readFileSync(ctx.flags.ack, "utf8")) : null, now: nowIso() });
    receipt(ctx, { bundleId, sourceDigest, policyRevision: pp.record.policyRevision, result: "captured" });
    const out = writeReport(ctx, "capture", { captured: true, bundleId, dir: b.dir, sourceDigest, rawVSha256: sourceManifest.rawVSha256, rowCount: ids.rowCount, expectedV2Digest: expected.digest, preflightAggregate: preflight.aggregate, eligibility: preflight.eligibility, files: b.files, tokens: { migrate: C.confirmationToken({ manifest: ctx.manifest, command: "migrate", expectedRevision: pp.record.policyRevision, sourceDigest }) } });
    return { exitCode: preflight.aggregate === "OPERATOR_ACTION_REQUIRED" ? EXIT.ACTION : EXIT.OK, report: out.report, file: out.file };
  },
  async migrate(ctx) {
    const data = await readAll(ctx); requireIdentity(ctx, data); const envEv = await environmentEvidence(ctx); requireEnvironmentMatch(ctx, envEv);
    const bundle = latestBundle(ctx, ctx.flags); if (!bundle) throw new CanaryError("evidence_required", "no COMPLETE evidence bundle for this operation", EXIT.BLOCKER);
    if (bundle.preflight.aggregate === "BLOCKER") throw new CanaryError("preflight_blocked_in_evidence", bundle.preflight.aggregate, EXIT.BLOCKER);
    if (bundle.preflight.aggregate === "OPERATOR_ACTION_REQUIRED") throw new CanaryError("operator_actions_unresolved", "resolve then re-capture", EXIT.ACTION);
    const pp = parsedPolicy(data.control);
    if (pp.status !== "valid") throw new CanaryError("policy_invalid", pp.status, EXIT.BLOCKER);
    const rec = pp.record;
    if (rec.phase !== "quiesced") throw new CanaryError("not_quiesced", rec.phase, EXIT.BLOCKER);
    if (!rec.operation || rec.operation.id !== ctx.manifest.operation.id || rec.operation.owner !== ctx.manifest.operation.operator) throw new CanaryError("operation_not_owned", JSON.stringify(rec.operation), EXIT.BLOCKER);
    const mode = ctx.H.detectStorageMode(data.raw);
    if (mode.mode === "v2" || rec.conversionAttempted) throw new CanaryError("reconcile_required", "a conversion was already attempted/committed — run `status`", EXIT.UNKNOWN);
    const expectedRevision = rec.policyRevision, sourceDigest = bundle.sourceManifest.sourceDigest;
    if (ctx.flags["expected-revision"] !== undefined && Number(ctx.flags["expected-revision"]) !== expectedRevision) throw new CanaryError("stale_revision", `expected ${ctx.flags["expected-revision"]}, current ${expectedRevision}`, EXIT.BLOCKER);
    const s0 = await ctx.transport.warmEntries();
    const s0Digest = C.digestV1(s0);
    if (s0Digest !== sourceDigest) throw new CanaryError("source_drift_before_transaction", `${sourceDigest} → ${s0Digest}`, EXIT.BLOCKER);
    const fresh = C.enhancedPreflight({ raw: s0, control: data.control, exceptions: data.exceptions, context: data.context, manifest: ctx.manifest, H: ctx.H, environment: envEv, held: true, resolvedActions: bundle.preflight.findings.filter((f) => f.resolved).map((f) => f.code), drain: latestDrain(ctx), readErrors: data.readErrors });
    if (fresh.aggregate === "BLOCKER") throw new CanaryError("new_blocker_since_capture", JSON.stringify(fresh.findings.filter((f) => f.classification === "BLOCKER").map((f) => f.code)), EXIT.BLOCKER);
    const { executed, token } = confirmOrDryRun(ctx, expectedRevision, sourceDigest);
    const plan = { transaction: "entries node CAS via unchanged upgradeBusinessToV2, source-bound per callback", expectedSourceDigest: sourceDigest, expectedV2Digest: bundle.expectedV2.digest, policyCas: { from: expectedRevision, to: expectedRevision + 1, conversionAttempted: true }, bundleId: bundle.complete.bundleId };
    if (!executed) { const out = writeReport(ctx, "migrate", { executed: false, wouldWrite: plan, confirmationToken: token, note: "NOT EXECUTED — commit outcome unknown by design; CAS conflicts, cold-cache probe and Rules evaluation happen only on --execute" }); return { exitCode: EXIT.OK, report: out.report, file: out.file }; }
    requireAck(ctx, "migrate", bundle.complete.bundleId);
    receipt(ctx, { stage: "migrate", intent: plan, expectedRevision, sourceDigest, confirmToken: token, result: "attempting" });
    const H = ctx.H;
    const pre = createLegacyPreflight({ parseEntriesNode: H.parseEntriesNode, isValidEntryId: H.isValidEntryId, isPlainRow: H.isPlainRow, entryDateKey: H.entryDateKey, detectStorageMode: H.detectStorageMode, rowGenKey: H.ROW_GEN_KEY, mapFields: H.MAP_FIELDS });
    const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode: pre.preflightLegacyNode, isV2Node: H.isV2Node, stampRow: H.stampRow, generationFirst: H.GENERATION_FIRST });
    const bound = ctx.transport.boundTransactNode({ expectedDigest: sourceDigest });
    const conversion = policyControl(ctx).createFencedConversion({ upgradeBusinessToV2, entriesIo: { transactNode: bound.transactNode } });
    let result, error = null;
    try { result = await conversion(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision, operator: ctx.manifest.operation.operator, operationId: ctx.manifest.operation.id }); }
    catch (e) { error = policyErrorToCanary(e); }
    const after = await ctx.transport.readEntries(); const afterDigest = after.ok ? C.digestV1(after.value) : null;
    const controlAfter = await ctx.transport.readControl();
    let outcome;
    if (error) outcome = { status: "UNKNOWN_OR_REFUSED", error: { code: error.code, message: error.message } };
    else if (result.result.status === "committed" && afterDigest === bundle.expectedV2.digest) outcome = { status: "MIGRATED_HELD" };
    else if (result.result.status === "committed") outcome = { status: "COMMITTED_BUT_UNEXPECTED_NODE" };
    else outcome = { status: bound.stats.drift ? "SOURCE_DRIFT" : bound.stats.nullRuns && !bound.stats.coreRuns ? "UNEXPECTED_ABSENT" : "NOT_COMMITTED", core: result.result };
    receipt(ctx, { stage: "migrate", result: outcome.status, coreResult: result ? result.result : null, policyRevision: result ? result.policyRevision : null, stats: bound.stats, afterDigest, error: error ? error.code : null });
    const out = writeReport(ctx, "migrate", { executed: true, outcome, coreResult: result ? result.result : null, policyRevision: result ? result.policyRevision : null, transactionStats: bound.stats, afterDigest, expectedV2Digest: bundle.expectedV2.digest, controlAfter: controlAfter.ok ? controlAfter.value : null, next: outcome.status === "MIGRATED_HELD" ? "verify --phase post" : "status (reconcile); no automatic retry" });
    // definite refusals (policy/canary errors) keep their exit code; ANY other failure is UNKNOWN — reconcile with `status`, never retry blindly
    const exitCode = outcome.status === "MIGRATED_HELD" ? EXIT.OK : error ? (C.isCanaryError(error) && error.code !== "not_committed" ? error.exitCode : EXIT.UNKNOWN) : outcome.status === "COMMITTED_BUT_UNEXPECTED_NODE" ? EXIT.STOP : EXIT.UNKNOWN;
    return { exitCode, report: out.report, file: out.file };
  },
  async verify(ctx) {
    const phase = ctx.flags.phase || "post";
    const data = await readAll(ctx); const businessName = requireIdentity(ctx, data);
    const bundle = latestBundle(ctx, ctx.flags); if (!bundle) throw new CanaryError("evidence_required", "no bundle", EXIT.BLOCKER);
    const H = ctx.H; let findings = [];
    const expectedPhase = phase === "active" ? "v2_active" : "quiesced";
    if (phase === "pre") {
      const d = C.digestV1(data.raw === undefined ? null : data.raw);
      findings.push(d === bundle.sourceManifest.sourceDigest ? { code: "source_matches_evidence", level: "OK" } : { code: "source_digest_changed_unexpectedly", level: "STOP", observed: d, expected: bundle.sourceManifest.sourceDigest });
    } else {
      findings.push(...C.compareStructural({ bundle, actual: data.raw, actualControl: data.control, manifest: ctx.manifest, H, expectedPhase }));
      const srcRows = H.parseEntriesNode(bundle.source).rows || [];
      findings.push(...C.compareLogical({ sourceRows: srcRows, actual: data.raw, H, normalization: bundle.sourceManifest.normalization }));
      const exd = C.digestV1(data.exceptions === undefined ? null : data.exceptions), cxd = C.digestV1(data.context);
      if (exd !== bundle.sourceManifest.exceptionsDigest) findings.push({ code: "exceptions_changed", level: "STOP", observed: exd });
      if (cxd !== bundle.sourceManifest.contextDigest) findings.push({ code: "context_changed", level: "STOP", observed: cxd });
      const post = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { entries: data.raw, config: data.context.config, fixed: data.context.fixed, suppliers: data.context.suppliers, exceptions: data.exceptions, businessName }, dates: bundle.readerBaseline.meta.dates });
      for (const [k, e] of Object.entries(post.errors)) findings.push({ code: /malformed|storage/i.test(String(e.name) + String(e.code)) ? "malformed_v2" : "reader_error", level: "STOP", reader: k, observed: e });
      if (!Object.keys(post.errors).length) findings.push(...C.compareReaders({ baseline: bundle.readerBaseline.outputs, post: post.outputs }));
      // no `_v` fallback: the readers see the SAME outputs with a poisoned `_v`
      if (data.raw && typeof data.raw === "object" && data.raw.schemaVersion === 2) {
        const poisoned = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { entries: { ...data.raw, _v: "[]" }, config: data.context.config, fixed: data.context.fixed, suppliers: data.context.suppliers, exceptions: data.exceptions, businessName }, dates: bundle.readerBaseline.meta.dates });
        const dv = C.deepDiff(post.outputs, poisoned.outputs); if (dv.length) findings.push({ code: "stale_v_fallback", level: "STOP", observed: dv.slice(0, 20) }); else findings.push({ code: "no_v_fallback", level: "OK" });
      }
    }
    const cls = C.classify(findings, { phase: expectedPhase });
    let checkpointId = null;
    if (phase === "post" && cls.level === "OK") {
      const actualDigest = C.digestV1(data.raw); checkpointId = `post-${actualDigest.slice(0, 16)}`;
      const dir = join(ctx.opDir, checkpointId);
      if (!existsSync(dir)) E.createBundle({ root: ctx.evidenceDir, operationId: ctx.manifest.operation.id, bundleId: checkpointId, files: { "entries.actual.json": JSON.stringify(data.raw), "policy.json": { json: data.control }, "checkpoint.json": { json: { checkpointId, actualDigest, sourceBundle: bundle.complete.bundleId, findings, verifiedAt: nowIso() } } }, now: nowIso() });
    }
    const out = writeReport(ctx, `verify-${phase}`, { phase, bundleId: bundle.complete.bundleId, findings, classification: cls, checkpointId, recommendation: cls.recommendation, automaticTransition: false, holdCommand: cls.level === "STOP" && expectedPhase === "v2_active" ? `canary.mjs hold --execute --confirm <token from plan> --reason <ref>` : null });
    return { exitCode: cls.exitCode === EXIT.OK ? EXIT.OK : cls.exitCode, report: out.report, file: out.file };
  },
  async activate(ctx) {
    const data = await readAll(ctx); requireIdentity(ctx, data); const envEv = await environmentEvidence(ctx); requireEnvironmentMatch(ctx, envEv);
    const cp = ctx.flags.checkpoint; if (!cp) throw new CanaryError("checkpoint_required", "--checkpoint <post checkpoint id> (from verify --phase post)", EXIT.BLOCKER);
    const dir = join(ctx.opDir, cp); const v = E.verifyBundle(dir); if (!v.ok) throw new CanaryError("checkpoint_invalid", v.problems.join("; "), EXIT.BLOCKER);
    const checkpoint = E.readJson(join(dir, "checkpoint.json"));
    if (checkpoint.actualDigest !== C.digestV1(data.raw)) throw new CanaryError("node_changed_since_checkpoint", "re-run verify --phase post", EXIT.BLOCKER);
    const pp = parsedPolicy(data.control); if (pp.status !== "valid" || pp.record.phase !== "quiesced") throw new CanaryError("not_quiesced", pp.status === "valid" ? pp.record.phase : pp.status, EXIT.BLOCKER);
    return policyTransition(ctx, { stage: "activate", data, run: (Cp, rev) => Cp.activateV2(ctx.manifest.tenantId, ctx.manifest.bizId, { expectedRevision: rev, operator: ctx.manifest.operation.operator, operationId: ctx.manifest.operation.id, approvedReleaseId: ctx.manifest.approved.repoSha }), requirePhase: "quiesced", requireOwned: true, ackBound: cp, sourceDigest: checkpoint.actualDigest });
  },
  async "probe-legacy-denial"(ctx) {
    // D-CT-1 OPTION B: no mutating legacy write against the real canary; the production evidence is
    // (1) deployed Rules fingerprint, (2) ordinary-token control-record denial (same value, harmless),
    // (3) referenced emulator + historical-page evidence, (4) monitoring for blocked attempts.
    const data = await readAll(ctx); requireIdentity(ctx, data); const envEv = await environmentEvidence(ctx);
    const pp = parsedPolicy(data.control); if (pp.status !== "valid") throw new CanaryError("policy_invalid", pp.status, EXIT.BLOCKER);
    const { executed, token } = confirmOrDryRun(ctx, pp.record.policyRevision, null);
    const evidenceRefs = { rulesBlob: ctx.manifest.approved.rulesBlob, emulator: ["test/emulator/storage-v2-version-fence.mjs VF-03/VF-04/VF-10/VF-18/VF-19/VF-26", "test/emulator/storage-policy-parity.mjs", "test/emulator/storage-v2-rules-guard-mutations.mjs", "test/emulator/historical-page-version-fence.mjs HP-03/HP-04", "test/emulator/canary-operator-matrix.mjs CT-E10"] };
    if (!executed) { const out = writeReport(ctx, "probe", { executed: false, option: "B", wouldAttempt: ["authenticated read of the entries node", "same-value PUT of storage_v2_control/{t}/{b}/phase (expected DENIED; harmless if hypothetically accepted)"], rulesFingerprint: envEv.deployedRulesMatch, evidenceRefs, confirmationToken: token }); return { exitCode: EXIT.OK, report: out.report, file: out.file }; }
    const tokenFile = ctx.flags["token-file"]; const idToken = tokenFile === "-" ? readFileSync(0, "utf8").trim() : readFileSync(tokenFile, "utf8").trim();
    const probe = T.createRestProbe({ manifest: ctx.manifest, token: idToken });
    const before = { entries: C.digestV1(data.raw === undefined ? null : data.raw), control: C.digestV1(data.control === undefined ? null : data.control) };
    const read = await probe.authenticatedRead();
    const write = read.outcome === "READABLE" ? await probe.controlSameValueWrite(pp.record.phase) : { outcome: "INCONCLUSIVE", reason: "token not proven valid (authenticated read failed)" };
    const after = await readAll(ctx); const afterD = { entries: C.digestV1(after.raw === undefined ? null : after.raw), control: C.digestV1(after.control === undefined ? null : after.control) };
    const findings = [];
    if (envEv.deployedRulesMatch === "byte" || envEv.deployedRulesMatch === "structural") findings.push({ code: "rules_fingerprint_match", level: "OK" }); else findings.push({ code: "rules_fingerprint_mismatch", level: "STOP", observed: envEv.deployedRulesMatch });
    if (write.outcome === "DENIED") findings.push({ code: "control_record_client_write_denied", level: "EXPECTED" });
    else if (write.outcome === "ACCEPTED") findings.push({ code: "control_record_client_write_accepted", level: "STOP" });
    else findings.push({ code: "probe_inconclusive", level: "REVIEW_REQUIRED", observed: write });
    if (afterD.entries !== before.entries || afterD.control !== before.control) findings.push({ code: "probe_changed_data", level: "STOP", observed: afterD, expected: before });
    const cls = C.classify(findings, { phase: pp.record.phase });
    receipt(ctx, { stage: "probe", option: "B", read: read.outcome, write: write.outcome, result: cls.level });
    const out = writeReport(ctx, "probe", { executed: true, option: "B", transportForm: probe.form, authenticatedRead: read, controlWrite: write, before, after: afterD, rulesFingerprint: envEv.deployedRulesMatch, evidenceRefs, findings, classification: cls, scope: "proves denial for the shape sent against the DEPLOYED Rules; universal old-shape denial rests on the fingerprint + referenced emulator/historical-page evidence" });
    return { exitCode: cls.level === "STOP" ? EXIT.STOP : write.outcome === "INCONCLUSIVE" ? EXIT.UNKNOWN : EXIT.OK, report: out.report, file: out.file };
  },
  async "live-check"(ctx) {
    const action = ctx.flags.action; if (!["create", "edit", "delete"].includes(action)) throw new CanaryError("action_required", "--action create|edit|delete (clear-all has no command)", EXIT.USAGE);
    const lw = ctx.manifest.liveWrite; if (!lw) throw new CanaryError("live_write_plan_required", "manifest.liveWrite", EXIT.BLOCKER);
    const data = await readAll(ctx); const businessName = requireIdentity(ctx, data);
    const pp = parsedPolicy(data.control); if (pp.status !== "valid" || pp.record.phase !== "v2_active") throw new CanaryError("not_active", pp.status === "valid" ? pp.record.phase : pp.status, EXIT.BLOCKER);
    const H = ctx.H, step = ctx.flags.step || (ctx.flags.await ? "await" : "before");
    // one observation = one numbered before-state; `after` consumes the latest unconsumed one (files are never rewritten)
    const liveDir = join(ctx.opDir, "live"); E.ensurePrivateDir(ctx.opDir); E.ensurePrivateDir(liveDir);
    const seqs = readdirSafe(liveDir).map((f) => { const m = f.match(new RegExp(`^${action}-(\\d+)-before\\.json$`)); return m ? Number(m[1]) : 0; });
    const consumed = new Set(readdirSafe(liveDir).map((f) => { const m = f.match(new RegExp(`^${action}-(\\d+)-after\\.json$`)); return m ? Number(m[1]) : 0; }));
    const open = seqs.filter((n) => n > 0 && !consumed.has(n)).sort((a, b) => a - b);
    const seq = step === "before" ? Math.max(0, ...seqs) + 1 : open[open.length - 1] || 0;
    const stateFile = join(liveDir, `${action}-${seq}-before.json`);
    const snapshotOf = (d) => ({ entries: d.raw, control: d.control, exceptions: d.exceptions, context: d.context });
    if (step === "before") {
      if (action === "create") { const rows = data.raw && data.raw.rows ? Object.values(data.raw.rows) : []; if (rows.some((r) => H.entryDateKey(r.date) === lw.date)) throw new CanaryError("live_date_occupied", lw.date, EXIT.BLOCKER); }
      const before = { at: nowIso(), action, snapshot: snapshotOf(data), digest: C.digestV1(data.raw), liveRowId: ctx.flags["live-row-id"] || readLiveRowId(ctx) };
      if (open.length) throw new CanaryError("before_state_open", `observation ${action} #${open[open.length - 1]} has no --step after yet`, EXIT.ENV);
      E.writeExclusive(stateFile, JSON.stringify(before, null, 2));
      const out = writeReport(ctx, `live-${action}-before`, { action, digest: before.digest, generation: data.raw && data.raw.generation, liveRowId: before.liveRowId, instruction: `perform the ${action} in the owner's current client now, then run live-check --action ${action} --step after` });
      return { exitCode: EXIT.OK, report: out.report, file: out.file };
    }
    let before;
    if (step === "await") {
      before = { at: nowIso(), action, snapshot: snapshotOf(data), digest: C.digestV1(data.raw), liveRowId: readLiveRowId(ctx) };
      const changed = await ctx.transport.awaitEntriesChange(Number(ctx.flags.await || 300) * 1000);
      if (!changed.changed) { const out = writeReport(ctx, `live-${action}`, { action, outcome: "INCONCLUSIVE", reason: "no change observed within the wait" }); return { exitCode: EXIT.UNKNOWN, report: out.report, file: out.file }; }
    } else { if (!seq || !existsSync(stateFile)) throw new CanaryError("before_state_missing", "run --step before first", EXIT.BLOCKER); before = E.readJson(stateFile); }
    const afterData = await readAll(ctx);
    const res = C.liveCheckFindings({ action, before: before.snapshot.entries, after: afterData.raw, plannedRow: lw.plannedRow, editField: lw.editField, editValue: lw.editValue, liveRowId: before.liveRowId, H, policyBefore: before.snapshot.control, policyAfter: afterData.control });
    const liveRowId = action === "create" && res.diff.added.length === 1 ? res.diff.added[0] : before.liveRowId;
    const baseline = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { ...before.snapshot.context, entries: before.snapshot.entries, exceptions: before.snapshot.exceptions, businessName }, dates: [lw.date] });
    const post = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { ...afterData.context, entries: afterData.raw, exceptions: afterData.exceptions, businessName }, dates: [lw.date] });
    const readerDelta = C.deepDiff(baseline.outputs, post.outputs);
    const cls = C.classify(res.findings, { phase: "v2_active" });
    if (step !== "await") E.writeExclusive(join(liveDir, `${action}-${seq}-after.json`), JSON.stringify({ at: nowIso(), digest: C.digestV1(afterData.raw === undefined ? null : afterData.raw), level: cls.level }));
    if (action === "create" && cls.level === "OK" && !existsSync(join(ctx.opDir, "live-row-id.json"))) E.writeExclusive(join(ctx.opDir, "live-row-id.json"), JSON.stringify({ liveRowId, createdAt: nowIso() }));
    receipt(ctx, { stage: `live-${action}`, result: cls.level, diff: res.diff, liveRowId });
    const out = writeReport(ctx, `live-${action}`, { action, before: { at: before.at, digest: before.digest, generation: before.snapshot.entries && before.snapshot.entries.generation }, after: { digest: C.digestV1(afterData.raw), generation: afterData.raw && afterData.raw.generation }, diff: res.diff, liveRowId, findings: res.findings, readerImpact: readerDelta, frozenVUnchanged: res.diff.rawVUnchanged, policy: { before: before.snapshot.control, after: afterData.control }, classification: cls, cleanup: action === "delete" ? "live-write window closed; start the observation window after derived reconciliation" : "pending", automaticTransition: false });
    return { exitCode: cls.exitCode, report: out.report, file: out.file };
  },
  async status(ctx) {
    const data = await readAll(ctx);
    let bundle = null; try { bundle = latestBundle(ctx, ctx.flags); } catch (e) { bundle = null; }
    const rec = C.reconcileStatus({ raw: data.raw, control: data.control, bundle, manifest: ctx.manifest, H: ctx.H });
    const ledger = E.readLedger(ctx.opDir); const receipts = E.readReceipts(ctx.opDir);
    const cleanup = receipts.filter((r) => r.stage === "live-delete" && r.result === "OK").map((r) => r.at).pop() || null;
    const win = C.windowArithmetic({ records: ledger, liveWriteCleanupAt: cleanup, now: nowIso() });
    const evidenceCheck = ctx.flags["verify-evidence"] ? E.verifyBundle(join(ctx.opDir, ctx.flags["verify-evidence"])) : null;
    const out = writeReport(ctx, "status", { reconciliation: rec, bundleId: bundle ? bundle.complete.bundleId : null, evidenceCheck, receipts: receipts.length, ledgerCycles: ledger.length, window: win, readErrors: data.readErrors, advancementBlocked: win.stops.length > 0 && !receipts.some((r) => r.stage === "incident-ack" && r.ref === win.stops[win.stops.length - 1]) });
    return { exitCode: rec.level === "STOP" ? EXIT.STOP : EXIT.OK, report: out.report, file: out.file };
  },
  async monitor(ctx) {
    const cycleId = ctx.flags.cycle; if (!cycleId || !/^\d{4}-\d{2}-\d{2}$/.test(cycleId)) throw new CanaryError("cycle_required", "--cycle YYYY-MM-DD", EXIT.USAGE);
    const data = await readAll(ctx); const businessName = requireIdentity(ctx, data);
    const receipts = ctx.flags.receipts ? JSON.parse(readFileSync(ctx.flags.receipts, "utf8")) : {};
    if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) throw new CanaryError("receipts_invalid", "receipts file must hold a JSON object", EXIT.USAGE);
    const pp = parsedPolicy(data.control); const H = ctx.H;
    const mode = H.detectStorageMode(data.raw === undefined ? null : data.raw);
    const ledger = E.readLedger(ctx.opDir); const prev = ledger.filter((r) => r.cycleId < cycleId).sort((a, b) => (a.cycleId < b.cycleId ? -1 : 1)).pop() || null;
    const rows = data.raw && data.raw.rows ? Object.keys(data.raw.rows).sort() : [];
    const derivedRaw = await ctx.transport.readDerived(cycleId); const nextDay = (() => { const d = new Date(cycleId + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const digestRaw = await ctx.transport.readDerived(nextDay); const insights = await ctx.transport.readProactiveInsightsForDate(cycleId);
    const statusOf = (r) => !r.ok ? { status: "UNKNOWN", reason: r.error } : r.value === null ? { status: "MISSING" } : { status: "PRESENT", digest: C.digestV1(r.value) };
    const derived = { analyticsDaily: statusOf(derivedRaw.analyticsDaily), insightsDaily: statusOf(derivedRaw.insightsDaily), proactiveDigest: statusOf(digestRaw.proactiveDigest), proactiveInsights: statusOf(insights),
      snapshotEmail: receipts.snapshotEmail ? { status: receipts.snapshotEmail.messageId ? "PRESENT" : "MISSING", ...receipts.snapshotEmail, ...(receipts.snapshotEmail.recipient ? { recipient: C.sha256Hex(String(receipts.snapshotEmail.recipient)).slice(0, 12) } : {}) } : { status: "UNKNOWN", reason: "no receipt" },
      alerts: receipts.alerts ? { status: "PRESENT", ...receipts.alerts } : { status: "UNKNOWN", reason: "no receipt" } };
    const readers = await runReaders({ tenantId: ctx.manifest.tenantId, bizId: ctx.manifest.bizId, snapshot: { entries: data.raw, config: data.context.config, fixed: data.context.fixed, suppliers: data.context.suppliers, exceptions: data.exceptions, businessName }, dates: [cycleId] });
    const drift = [];
    if (derived.analyticsDaily.status === "PRESENT" && readers.outputs.dailyBuilder && readers.outputs.dailyBuilder[cycleId] && !readers.outputs.dailyBuilder[cycleId].error) {
      const doc = derivedRaw.analyticsDaily.value, mine = readers.outputs.dailyBuilder[cycleId].doc;
      for (const k of ["revenue", "labor", "purchases", "ratios"]) if (doc && mine && doc[k] !== undefined && mine[k] !== undefined) { const d = C.deepDiff(mine[k], doc[k]); if (d.length) drift.push({ section: k, diffs: d.slice(0, 20) }); }
    }
    if (receipts.ownerTotals && readers.outputs.daily && !readers.outputs.daily.error) { for (const [date, exp] of Object.entries(receipts.ownerTotals)) { const rec = readers.outputs.daily.find((x) => x.date === date); if (!rec) drift.push({ section: "owner_totals", date, reason: "no daily record" }); else for (const [k, v] of Object.entries(exp)) if (!Object.is(Number(rec[k]), Number(v))) drift.push({ section: "owner_totals", date, field: k, observed: rec[k], expected: v }); } }
    const record = C.buildCycleRecord({ cycleId, anchorDate: cycleId, manifest: ctx.manifest, now: nowIso(),
      versions: { repoSha: ctx.manifest.approved.repoSha, policy: pp.status === "valid" ? { phase: pp.record.phase, policyRevision: pp.record.policyRevision, operation: pp.record.operation } : { status: pp.status }, schemaVersion: data.raw && data.raw.schemaVersion !== undefined ? data.raw.schemaVersion : null, generation: data.raw && data.raw.generation !== undefined ? data.raw.generation : null, generationPrev: prev ? prev.versions.generation : null, storageMode: mode.mode },
      source: { startDigest: C.digestV1(data.raw === undefined ? null : data.raw), previousDigest: prev ? prev.source.startDigest : null, rawVSha: data.raw && typeof data.raw._v === "string" ? C.rawVSha256(data.raw._v) : null, rawVShaPrev: prev ? prev.source.rawVSha : null, rowCount: rows.length, sortedIdsDigest: C.digestV1(rows), exceptionsDigest: C.digestV1(data.exceptions === undefined ? null : data.exceptions), contextDigest: C.digestV1(data.context), latestDate: readers.outputs.latestDate && !readers.outputs.latestDate.error ? readers.outputs.latestDate : null },
      mutations: { rowsStart: prev ? prev.source.rowCount : rows.length, creates: Number(receipts.creates || 0), deletes: Number(receipts.deletes || 0), edits: Number(receipts.edits || 0), rowsEnd: rows.length },
      ui: receipts.ui || { status: "UNKNOWN" }, counters: { ...(receipts.counters || {}), malformedV2: { value: Object.keys(readers.errors).length, source: "readers" }, storageModeMismatch: { value: mode.mode === "v2" ? 0 : 1, source: "detectStorageMode" } },
      derived, reconciliation: { daily: readers.outputs.daily && !readers.outputs.daily.error ? readers.outputs.daily.filter((x) => x.date === cycleId) : null, latestDate: readers.outputs.latestDate, drift }, incidents: receipts.incidents || [], receipts: { supplied: Object.keys(receipts) } });
    const app = E.appendLedger(ctx.opDir, record);
    const win = C.windowArithmetic({ records: E.readLedger(ctx.opDir), liveWriteCleanupAt: receipts.liveWriteCleanupAt || null, now: nowIso() });
    const out = writeReport(ctx, `monitor-${cycleId}`, { cycleId, appended: app.appended, reason: app.reason, record: app.record, window: win, holdCommand: record.classification.level === "STOP" ? "canary.mjs hold --execute --confirm <token from plan> --reason <ref>" : null, automaticTransition: false });
    return { exitCode: record.classification.exitCode, report: out.report, file: out.file };
  },
};
function latestDrain(ctx) {
  if (!existsSync(ctx.reportsDir)) return null;
  const files = readdirSafe(ctx.reportsDir).filter((f) => f.startsWith("drain-")).sort();
  if (!files.length) return null;
  const r = E.readJson(join(ctx.reportsDir, files[files.length - 1])); return { verdict: r.verdict, at: r.endedAt, file: files[files.length - 1] };
}
function readdirSafe(dir) { try { return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : []; } catch (_) { return []; } }
function readLiveRowId(ctx) { const p = join(ctx.opDir, "live-row-id.json"); return existsSync(p) ? E.readJson(p).liveRowId : null; }
/** Shared policy transition path: identity → phase/ownership → dry-run or confirm → CAS → readback → receipt. */
async function policyTransition(ctx, { stage, run, requirePhase, requireOwned = false, requireNoAttempt = false, expectAbsent = false, ackBound = null, sourceDigest = null, data = null, reason = null }) {
  data = data || await readAll(ctx); requireIdentity(ctx, data);
  const pp = parsedPolicy(data.control);
  if (expectAbsent) { if (pp.status !== "absent") throw new CanaryError("policy_already_exists", pp.status, EXIT.BLOCKER); }
  else { if (pp.status !== "valid") throw new CanaryError("policy_invalid", pp.status + (pp.reason ? ":" + pp.reason : ""), EXIT.BLOCKER); if (requirePhase && pp.record.phase !== requirePhase) throw new CanaryError("wrong_phase", `${pp.record.phase} (need ${requirePhase})`, EXIT.BLOCKER); }
  const rec = pp.status === "valid" ? pp.record : null;
  if (requireOwned && (!rec.operation || rec.operation.id !== ctx.manifest.operation.id || rec.operation.owner !== ctx.manifest.operation.operator)) throw new CanaryError("operation_not_owned", JSON.stringify(rec.operation), EXIT.BLOCKER);
  if (requireNoAttempt && rec.conversionAttempted) throw new CanaryError("transition_not_allowed", "conversion already attempted — abort is impossible by design", EXIT.BLOCKER);
  const expectedRevision = rec ? rec.policyRevision : 0;
  if (ctx.flags["expected-revision"] !== undefined && Number(ctx.flags["expected-revision"]) !== expectedRevision) throw new CanaryError("stale_revision", `expected ${ctx.flags["expected-revision"]}, current ${expectedRevision}`, EXIT.BLOCKER);
  const { executed, token } = confirmOrDryRun(ctx, expectedRevision, sourceDigest);
  if (!executed) { const out = writeReport(ctx, stage, { executed: false, stage, currentPhase: rec ? rec.phase : "absent", expectedRevision, wouldWrite: `policy CAS ${expectedRevision} → ${expectedRevision + 1} (${stage})`, confirmationToken: token, reason }); return { exitCode: EXIT.OK, report: out.report, file: out.file }; }
  if (stage === "activate") requireAck(ctx, "activate", ackBound);
  receipt(ctx, { stage, expectedRevision, confirmToken: token, result: "attempting", reason });
  let res; try { res = await run(policyControl(ctx), expectedRevision); } catch (e) { const ce = policyErrorToCanary(e); receipt(ctx, { stage, expectedRevision, result: "refused", error: ce.code }); throw ce; }
  const back = await ctx.transport.readControl(); const pb = parsedPolicy(back.ok ? back.value : undefined);
  const ok = pb.status === "valid" && pb.record.policyRevision === expectedRevision + 1;
  receipt(ctx, { stage, expectedRevision, result: ok ? "committed" : "readback_mismatch", observedRevision: pb.status === "valid" ? pb.record.policyRevision : null, phase: pb.status === "valid" ? pb.record.phase : null });
  const out = writeReport(ctx, stage, { executed: true, stage, result: res.record, readback: pb.status === "valid" ? pb.record : { status: pb.status }, ok, reason });
  return { exitCode: ok ? EXIT.OK : EXIT.UNKNOWN, report: out.report, file: out.file };
}
function summariseFinancials(baseline) {
  const daily = baseline.outputs.daily && !baseline.outputs.daily.error ? baseline.outputs.daily : [];
  const sum = (k) => daily.reduce((a, r) => a + (Number.isFinite(Number(r[k])) ? Number(r[k]) : 0), 0);
  return { days: daily.length, latestDate: baseline.outputs.latestDate && !baseline.outputs.latestDate.error ? baseline.outputs.latestDate : null, revenueSum: sum("revenue"), laborCostSum: sum("laborCost"), foodCostSum: sum("foodCost"), note: "sums are an operator summary over the reader output; parity is asserted per record at full precision" };
}

// ── entry point ──────────────────────────────────────────────────────────────
/** `adminAppFactory` / `adminApps` are TEST SEAMS (in-memory database, emulator matrix in one process); the CLI entry point never sets them. */
export async function main(argv = process.argv.slice(2), { processEnv = process.env, adminAppFactory, adminApps } = {}) {
  const { _: [command], flags } = parseArgs(argv);
  if (!command || flags.help) { console.log(USAGE); return EXIT.USAGE; }
  let ctx = null;
  try {
    ctx = await createContext({ command, flags, processEnv, adminAppFactory, adminApps });
    const r = await commands[command](ctx);
    const summary = { command, exitCode: r.exitCode, report: r.file, executed: !!ctx.execute };
    console.log(flags.json ? JSON.stringify({ ...summary, body: r.report }, null, 2) : JSON.stringify(summary));
    return r.exitCode;
  } catch (e) {
    const code = C.isCanaryError(e) ? e.code : isStoragePolicyError(e) ? e.code : "error";
    const exitCode = C.isCanaryError(e) ? e.exitCode : isStoragePolicyError(e) ? EXIT.BLOCKER : EXIT.BLOCKER;
    console.error(JSON.stringify({ command, error: code, detail: C.isCanaryError(e) ? (e.detail === undefined ? null : e.detail) : (e && e.message), exitCode }));
    return exitCode;
  } finally { if (ctx) await ctx.close(); }
}
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().then((code) => { process.exitCode = code; });
