// Storage V2 — CANARY TOOLING: the PURE contract (P0-DATA-01 canary tooling).
//
// HARD BOUNDARY — this module:
//   • performs NO I/O of any kind: no filesystem, no network, no Firebase, no environment,
//     no clock (every timestamp is an argument);
//   • re-implements NO invariant that already has an owner: preflight blockers come from
//     tools/storage-v2/preflight.mjs, the V2 shape from the production `stampRow`,
//     phase/revision semantics from lib/storagePolicy.js — this module only composes,
//     classifies and fingerprints;
//   • grants no authorization: every decision it returns is advice for canary.mjs, which
//     still requires the environment gate, the confirmation token and the operator.

import { createHash } from "node:crypto";
import { createLegacyPreflight } from "./preflight.mjs";
import { parsePolicyRecord } from "../../lib/storagePolicy.js";

export const CONTRACT_VERSION = 1;
export const SERIALIZER_VERSION = "digestV1";
export const EXIT = Object.freeze({ OK: 0, USAGE: 2, BLOCKER: 10, ACTION: 11, STOP: 12, UNKNOWN: 13, ENV: 14, CONFIRM: 15 });
export const CLASSIFICATIONS = Object.freeze(["PASS", "WARNING", "OPERATOR_ACTION_REQUIRED", "BLOCKER"]);
export const LEVELS = Object.freeze(["OK", "EXPECTED", "WARNING", "REVIEW_REQUIRED", "RECOVERY_HOLD_RECOMMENDED", "STOP"]);
export const WRITE_COMMANDS = Object.freeze(["enroll", "quiesce", "abort", "migrate", "activate", "hold", "resume", "probe-legacy-denial"]);
export const READ_COMMANDS = Object.freeze(["plan", "preflight", "drain-check", "capture", "verify", "live-check", "status", "monitor"]);
export const COMMANDS = Object.freeze([...READ_COMMANDS, ...WRITE_COMMANDS]);
export const DEFAULT_LIMITS = Object.freeze({ maxRows: 500, maxNodeBytes: 1048576, maxRawVBytes: 1048576 });
const ID_RE = /^[^.#$/\[\]*\x00-\x1f\x7f]+$/;   // RTDB key charset, and never a wildcard
const FORBIDDEN_PROD_IDS = new Set(["*", "default", "test", "demo", "tenantA", "bizA"]);

export class CanaryError extends Error {
  constructor(code, detail, exitCode = EXIT.BLOCKER) { super(detail ? `${code}: ${detail}` : code); this.name = "CanaryError"; this.code = code; this.detail = detail; this.exitCode = exitCode; }
}
export const isCanaryError = (e) => !!e && e.name === "CanaryError";

// ── fingerprints ─────────────────────────────────────────────────────────────
export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
/** Versioned, type-tagged, sorted-key, lossless serialisation. Rejects anything RTDB cannot hold. */
export function serializeV1(v, path = "$") {
  if (v === null) return "z";
  if (typeof v === "string") return "s" + JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new CanaryError("unsupported_value", `${path}: non-finite number`); return "n" + String(v); }
  if (typeof v === "boolean") return v ? "t" : "f";
  if (Array.isArray(v)) return "a[" + v.map((x, i) => serializeV1(x, `${path}[${i}]`)).join(",") + "]";
  if (typeof v === "object") return "o{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + serializeV1(v[k], `${path}.${k}`)).join(",") + "}";
  throw new CanaryError("unsupported_value", `${path}: ${typeof v}`);
}
export const digestV1 = (v) => sha256Hex(serializeV1(v));
export const utf8Bytes = (s) => Buffer.byteLength(String(s), "utf8");
export const rawVSha256 = (s) => sha256Hex(Buffer.from(String(s), "utf8"));

// ── manifest ─────────────────────────────────────────────────────────────────
const isStr = (v) => typeof v === "string" && v.trim().length > 0 && v === v.trim();
export function validateManifest(m) {
  const errors = [];
  const bad = (f, why) => errors.push({ field: f, reason: why });
  if (!m || typeof m !== "object" || Array.isArray(m)) return { ok: false, errors: [{ field: "$", reason: "not_an_object" }] };
  if (m.manifestVersion !== 1) bad("manifestVersion", "must be 1");
  if (m.environment !== "production" && m.environment !== "emulator") bad("environment", "must be production|emulator");
  for (const f of ["projectId", "databaseURL", "tenantId", "bizId"]) if (!isStr(m[f])) bad(f, "required non-empty string, no surrounding whitespace");
  for (const f of ["tenantId", "bizId"]) if (isStr(m[f]) && !ID_RE.test(m[f])) bad(f, "contains characters RTDB keys cannot hold");
  if (m.environment === "production") {
    for (const f of ["tenantId", "bizId"]) if (isStr(m[f]) && FORBIDDEN_PROD_IDS.has(m[f])) bad(f, "placeholder identifier in production");
    if (isStr(m.databaseURL) && !/^https:\/\/[^/]+\.(firebasedatabase\.app|firebaseio\.com)\/?$/.test(m.databaseURL)) bad("databaseURL", "production must be an https Firebase RTDB URL");
    if (isStr(m.databaseURL) && /localhost|127\.0\.0\.1/.test(m.databaseURL)) bad("databaseURL", "production URL cannot be local");
    if (isStr(m.projectId) && /^demo-/.test(m.projectId)) bad("projectId", "demo project cannot be production");
  } else if (m.environment === "emulator") {
    if (isStr(m.databaseURL) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\?ns=demo-[a-z0-9-]+$/.test(m.databaseURL)) bad("databaseURL", "emulator must be http://127.0.0.1:<port>?ns=demo-…");
    if (isStr(m.projectId) && !/^demo-/.test(m.projectId)) bad("projectId", "emulator project must start with demo-");
  }
  const id = m.expectedIdentity;
  if (!id || typeof id !== "object" || !isStr(id.businessName)) bad("expectedIdentity.businessName", "required exact business name");
  if (!id || !id.ownerAttestation || !isStr(id.ownerAttestation.by) || !isStr(id.ownerAttestation.at) || !isStr(id.ownerAttestation.ref)) bad("expectedIdentity.ownerAttestation", "by/at/ref required");
  const op = m.operation;
  if (!op || !isStr(op.id) || !isStr(op.operator) || !isStr(op.observer) || !isStr(op.approvalRef)) bad("operation", "id/operator/observer/approvalRef required");
  else if (op.observer === op.operator) bad("operation.observer", "observer must be a different person from the operator (four-eyes)");
  if (m.probeBizId !== undefined && m.probeBizId !== null) { if (!isStr(m.probeBizId) || !ID_RE.test(m.probeBizId)) bad("probeBizId", "invalid id"); else if (m.probeBizId === m.bizId) bad("probeBizId", "must differ from bizId"); }
  const ap = m.approved;
  if (!ap || !isStr(ap.repoSha) || !/^[0-9a-f]{40}$/.test(ap.repoSha)) bad("approved.repoSha", "40-hex git sha required");
  if (!ap || !isStr(ap.rulesBlob) || !/^[0-9a-f]{40}$/.test(ap.rulesBlob)) bad("approved.rulesBlob", "40-hex git blob required");
  const ex = m.expected;
  if (!ex || !Number.isSafeInteger(ex.policyRevisionAtStart) || ex.policyRevisionAtStart < 0) bad("expected.policyRevisionAtStart", "safe integer ≥ 0 required");
  if (m.limits !== undefined) { const l = m.limits; if (!l || !Number.isSafeInteger(l.maxRows) || l.maxRows < 1 || !Number.isSafeInteger(l.maxNodeBytes) || l.maxNodeBytes < 1) bad("limits", "maxRows/maxNodeBytes positive integers"); }
  if (!isStr(m.timezone)) bad("timezone", "IANA timezone required");
  if (m.liveWrite !== undefined && m.liveWrite !== null) { const lw = m.liveWrite; if (!lw || !isStr(lw.date) || !/^\d{4}-\d{2}-\d{2}$/.test(lw.date) || !lw.plannedRow || typeof lw.plannedRow !== "object") bad("liveWrite", "date + plannedRow required"); }
  return { ok: errors.length === 0, errors };
}
export function assertManifest(m) { const v = validateManifest(m); if (!v.ok) throw new CanaryError("manifest_invalid", v.errors.map((e) => `${e.field}: ${e.reason}`).join("; "), EXIT.ENV); return m; }
export const limitsOf = (m) => ({ ...DEFAULT_LIMITS, ...(m.limits || {}) });

/** Exact derived paths — never searched, never listed. */
export function derivePaths(m) {
  const t = m.tenantId, b = m.bizId;
  return Object.freeze({
    entries: `tenants/${t}/biz:${b}:entries`, control: `storage_v2_control/${t}/${b}`, exceptions: `tenants/${t}/entry_exceptions/${b}`,
    config: `tenants/${t}/biz:${b}:config`, fixed: `tenants/${t}/biz:${b}:fixed`, suppliers: `tenants/${t}/biz:${b}:suppliers`,
    analyticsDaily: (d) => `tenants/${t}/biz:${b}:analytics:daily:${d}`, insightsDaily: (d) => `tenants/${t}/biz:${b}:insights:daily:${d}`,
    proactiveInsights: `tenants/${t}/proactive_insights/${b}`, proactiveDigest: (d) => `tenants/${t}/proactive_digests/${b}/daily/${d}`,
  });
}
/** Identity digest binds tokens to project/database/tenant/business/operation — the parts that select a target. */
export const identityDigest = (m) => digestV1({ environment: m.environment, projectId: m.projectId, databaseURL: m.databaseURL, tenantId: m.tenantId, bizId: m.bizId, operationId: m.operation.id });
export function confirmationToken({ manifest, command, expectedRevision, sourceDigest }) {
  if (!WRITE_COMMANDS.includes(command)) throw new CanaryError("not_a_write_command", command, EXIT.USAGE);
  return sha256Hex(`${identityDigest(manifest)}:${command}:${expectedRevision === undefined || expectedRevision === null ? "-" : expectedRevision}:${sourceDigest || "-"}:${manifest.operation.id}`).slice(0, 16);
}
export function checkConfirmation({ manifest, command, expectedRevision, sourceDigest, provided }) {
  if (!provided) return { ok: false, reason: "confirmation_missing" };
  const expected = confirmationToken({ manifest, command, expectedRevision, sourceDigest });
  if (provided === expected) return { ok: true };
  return { ok: false, reason: "confirmation_mismatch", expectedFor: { command, expectedRevision, sourceDigest: sourceDigest || null }, hint: "re-run `plan`: a stale plan, a different command, a changed policy revision or a changed source digest invalidates the token" };
}

// ── production helpers ───────────────────────────────────────────────────────
export function helpersFrom(W) {
  const V2 = W && W.MarjinStorageV2, ML = W && W.MarjinSaveLifecycle, ME = W && W.MarjinEntries;
  for (const [name, ok] of [["MarjinStorageV2", !!V2], ["MarjinSaveLifecycle", !!ML], ["MarjinEntries", !!ME]]) if (!ok) throw new CanaryError("production_window_incomplete", name, EXIT.ENV);
  const isPlainRow = (r) => !!r && typeof r === "object" && !Array.isArray(r);
  const preflight = createLegacyPreflight({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId, isPlainRow, entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS });
  return Object.freeze({ V2, ML, ME, isPlainRow, preflightLegacyNode: preflight.preflightLegacyNode,
    detectStorageMode: V2.detectStorageMode, parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId, entryDateKey: ME.entryDateKey,
    stampRow: V2.stampRow, canonicalRowValue: V2.canonicalRowValue, canonicalMapField: V2.canonicalMapField, isV2Node: V2.isV2Node, readV2Rows: V2.readV2Rows,
    GENERATION_FIRST: V2.GENERATION_FIRST, ROW_GEN_KEY: V2.ROW_GEN_KEY, MAP_FIELDS: V2.MAP_FIELDS });
}

// ── expected V2 and semantic projection ──────────────────────────────────────
export function computeExpectedV2(raw, H) {
  const report = H.preflightLegacyNode(raw);
  if (!report.ok) return { ok: false, report };
  const rows = {};
  report.rows.forEach((r) => { rows[r.id] = H.stampRow(r, H.GENERATION_FIRST); });
  const node = { schemaVersion: 2, generation: H.GENERATION_FIRST };
  if (report.rows.length) node.rows = rows;
  if (raw && typeof raw._v === "string") node._v = raw._v;
  return { ok: true, report, node, digest: digestV1(node), logicalDigest: logicalRowsDigest(node, H), rowCount: report.rows.length };
}
export const stripGen = (row, H) => { const c = { ...row }; delete c[H.ROW_GEN_KEY]; return c; };
/** Rows of a V2 node minus `_gen`, canonicalised, sorted by id. */
export function logicalRowsDigest(node, H) {
  const rows = node && node.rows ? Object.keys(node.rows).sort().map((k) => ({ key: k, row: H.canonicalRowValue(stripGen(node.rows[k], H)) || {} })) : [];
  return digestV1(rows);
}
export function semanticDigest(rowsArray, H) {
  const rows = rowsArray.map((r) => ({ key: String(r.id), row: H.canonicalRowValue(r) || {} })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return digestV1(rows);
}
export function rowSummaries(rowsArray, H) {
  const orderedIds = rowsArray.map((r) => String(r.id));
  const sortedIds = orderedIds.slice().sort();
  const idDate = rowsArray.map((r) => ({ id: String(r.id), date: H.entryDateKey(r.date) || String(r.date) })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = new Map(); idDate.forEach(({ id, date }) => { if (!byDate.has(date)) byDate.set(date, []); byDate.get(date).push(id); });
  const dateGroups = [...byDate.entries()].map(([date, ids]) => ({ date, ids: ids.slice().sort() })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const duplicateDates = dateGroups.filter((g) => g.ids.length > 1);
  const perRow = rowsArray.map((r, i) => ({ index: i, id: String(r.id), semantic: digestV1(H.canonicalRowValue(r) || {}), full: digestV1(r) }));
  const domainGen = rowsArray.map((r, i) => (Object.prototype.hasOwnProperty.call(r, "gen") ? { index: i, id: String(r.id), type: typeof r.gen, fingerprint: digestV1(r.gen) } : null)).filter(Boolean);
  const latestDate = dateGroups.length ? dateGroups[dateGroups.length - 1].date : null, oldestDate = dateGroups.length ? dateGroups[0].date : null;
  return { rowCount: rowsArray.length, orderedIds, sortedIds, idDateMultiset: idDate, dateGroups, duplicateDates, perRow, domainGen, latestDate, oldestDate, sortedIdsDigest: digestV1(sortedIds) };
}

// ── enhanced preflight (pure) ────────────────────────────────────────────────
const F = (code, classification, extra = {}) => ({ code, classification, ...extra });
const nonFinite = (v) => (typeof v === "number" && !Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) && !Number.isFinite(Number(v)));
const CONSUMER_NUMERIC_FIELDS = ["sales", "deliveries", "other_income", "food_cost", "payroll", "other_expense"];
export function aggregateClassification(findings) {
  let agg = "PASS";
  for (const f of findings) { if (f.classification === "BLOCKER") return "BLOCKER"; if (f.classification === "OPERATOR_ACTION_REQUIRED" && !f.resolved) agg = "OPERATOR_ACTION_REQUIRED"; else if (f.classification === "WARNING" && agg === "PASS") agg = "WARNING"; }
  return agg;
}
/**
 * Compose the enhanced report around the unchanged core validator.
 * inputs: { raw, control, exceptions, context:{config,fixed,suppliers}, manifest, H, environment, held, resolvedActions:[codes] , now }
 */
export function enhancedPreflight({ raw, control, exceptions, context, manifest, H, environment = null, held = false, resolvedActions = [], drain = null, readErrors = {} }) {
  const findings = [], limits = limitsOf(manifest), paths = derivePaths(manifest);
  const resolved = new Set(resolvedActions);
  // identity
  let businessName = null;
  const cfg = context && context.config;
  if (readErrors.config) findings.push(F("read_failed", "BLOCKER", { path: paths.config, reason: readErrors.config }));
  else if (cfg && typeof cfg === "object" && typeof cfg._v === "string") { try { businessName = JSON.parse(cfg._v).businessName; } catch (_) { businessName = null; } }
  if (businessName === manifest.expectedIdentity.businessName) findings.push(F("identity_match", "PASS", { path: paths.config, observed: businessName }));
  else if (businessName === null || businessName === undefined) findings.push(F("identity_unprovable", "BLOCKER", { path: paths.config, expected: manifest.expectedIdentity.businessName, reason: "business config has no businessName — identity cannot be proven; no listing is ever performed" }));
  else findings.push(F("identity_mismatch", "BLOCKER", { path: paths.config, observed: businessName, expected: manifest.expectedIdentity.businessName }));
  for (const [k, p] of [["entries", paths.entries], ["control", paths.control], ["exceptions", paths.exceptions], ["fixed", paths.fixed], ["suppliers", paths.suppliers]]) if (readErrors[k]) findings.push(F("read_failed", "BLOCKER", { path: p, reason: readErrors[k], nextAction: "never interpret a failed read as absent" }));
  // environment
  if (environment) {
    // tool identity is a BLOCKER in production; in the emulator it is reported (the matrix runs on a work tree)
    const toolLevel = environment.mode === "emulator" ? "WARNING" : "BLOCKER";
    if (environment.repoSha !== manifest.approved.repoSha) findings.push(F("tool_identity_mismatch", toolLevel, { observed: environment.repoSha, expected: manifest.approved.repoSha }));
    if (environment.treeClean === false) findings.push(F("tool_tree_dirty", toolLevel, { reason: "working tree has uncommitted changes" }));
    if (environment.deployedRulesBlob === undefined || environment.deployedRulesBlob === null) findings.push(F("rules_fingerprint_unknown", "OPERATOR_ACTION_REQUIRED", { reason: environment.deployedRulesReason || "deployed Rules not readable", resolved: resolved.has("rules_fingerprint_unknown") }));
    else if (environment.deployedRulesBlob !== manifest.approved.rulesBlob) findings.push(F("rules_fingerprint_mismatch", "BLOCKER", { observed: environment.deployedRulesBlob, expected: manifest.approved.rulesBlob }));
    else findings.push(F("rules_fingerprint_match", "PASS", { observed: environment.deployedRulesBlob }));
  }
  // policy
  const parsedPolicy = parsePolicyRecord(control === undefined ? null : control);
  const policy = { status: parsedPolicy.status, phase: parsedPolicy.record ? parsedPolicy.record.phase : null, policyRevision: parsedPolicy.record ? parsedPolicy.record.policyRevision : null, operation: parsedPolicy.record ? parsedPolicy.record.operation : null, conversionAttempted: parsedPolicy.record ? parsedPolicy.record.conversionAttempted : null, reason: parsedPolicy.reason || null };
  if (parsedPolicy.status === "absent") findings.push(F("policy_absent", "OPERATOR_ACTION_REQUIRED", { path: paths.control, nextAction: "enroll (initializeLegacy) through the approved control plane before quiescence", resolved: resolved.has("policy_absent") }));
  else if (parsedPolicy.status === "malformed") findings.push(F("policy_malformed", "BLOCKER", { path: paths.control, reason: parsedPolicy.reason }));
  else if (parsedPolicy.status === "unsupported_contract") findings.push(F("policy_unsupported_contract", "BLOCKER", { path: paths.control, observed: parsedPolicy.contractVersion }));
  else {
    const rec = parsedPolicy.record;
    if (rec.phase === "legacy") findings.push(F("policy_legacy", "PASS", { observed: rec.policyRevision }));
    else if (rec.phase === "quiesced") {
      const mine = rec.operation && rec.operation.id === manifest.operation.id && rec.operation.owner === manifest.operation.operator;
      findings.push(mine ? F("policy_quiesced_owned", "PASS", { observed: rec.policyRevision }) : F("policy_quiesced_foreign_operation", "BLOCKER", { observed: rec.operation }));
    } else findings.push(F("policy_phase_not_migratable", "BLOCKER", { observed: rec.phase, reason: "first canary requires legacy (before quiesce) or quiesced (held)" }));
  }
  // storage
  const mode = H.detectStorageMode(raw);
  const nodeBytes = raw === null || raw === undefined ? 0 : utf8Bytes(JSON.stringify(raw));
  const storage = { mode: mode.mode, reason: mode.reason || null, schemaVersion: raw && typeof raw === "object" ? (raw.schemaVersion ?? null) : null, generation: raw && typeof raw === "object" ? (raw.generation ?? null) : null,
    rawVPresent: !!(raw && typeof raw === "object" && typeof raw._v === "string"), rawVType: raw && typeof raw === "object" && raw._v !== undefined ? typeof raw._v : null,
    rawVBytes: raw && typeof raw === "object" && typeof raw._v === "string" ? utf8Bytes(raw._v) : null, rawVSha256: raw && typeof raw === "object" && typeof raw._v === "string" ? rawVSha256(raw._v) : null,
    nodeBytes, envelopeKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw).sort() : null, sourceDigest: raw === undefined ? null : digestV1(raw === undefined ? null : raw) };
  let legacy = null, ids = null, expectedV2 = null, core = null;
  if (mode.mode === "absent") {
    findings.push(F("storage_absent", "PASS", { path: paths.entries }));
    findings.push(F("absent_not_first_canary", "OPERATOR_ACTION_REQUIRED", { reason: "absent business is a native-initialisation workflow, NOT_ELIGIBLE as first historical migration", resolved: false }));
  } else if (mode.mode === "v2") {
    findings.push(F("already_v2", "BLOCKER", { path: paths.entries, observed: { schemaVersion: storage.schemaVersion, generation: storage.generation }, nextAction: "route to V2 audit; never remigrate" }));
  } else if (mode.mode === "malformed") {
    findings.push(F("malformed_node", "BLOCKER", { path: paths.entries, reason: mode.reason }));
  } else {
    if (storage.envelopeKeys.some((k) => k !== "_v")) findings.push(F("unexpected_envelope_siblings", "BLOCKER", { path: paths.entries, observed: storage.envelopeKeys.filter((k) => k !== "_v"), reason: "the approved converter retains only `_v`; unknown envelope metadata would be dropped" }));
    core = H.preflightLegacyNode(raw);
    for (const b of core.blockers) findings.push(F(b.code, "BLOCKER", { path: paths.entries, detail: b, remedy: b.remedy || null }));
    const rowsArr = core.ok ? core.rows : (() => { const p = H.parseEntriesNode(raw); return p && Array.isArray(p.rows) ? p.rows : []; })();
    ids = rowSummaries(rowsArr.filter((r) => H.isPlainRow(r)), H);
    legacy = { valid: core.ok || core.blockers.every((b) => b.code !== "malformed_node" && b.code !== "not_an_array"), rowCount: rowsArr.length, latestDate: ids.latestDate, oldestDate: ids.oldestDate };
    if (legacy.valid) findings.push(F("legacy_parse", "PASS", { observed: { rowCount: rowsArr.length, rawVBytes: storage.rawVBytes } }));
    if (ids.duplicateDates.length) {
      findings.push(F("duplicate_dates", "WARNING", { observed: ids.duplicateDates }));
      findings.push(F("duplicate_dates_acceptance", "OPERATOR_ACTION_REQUIRED", { observed: ids.duplicateDates.map((d) => d.date), nextAction: "owner acceptance + consumer-window review; no deduplication", resolved: resolved.has("duplicate_dates_acceptance") }));
    }
    if (ids.domainGen.length) findings.push(F("domain_gen_present", "PASS", { observed: ids.domainGen, reason: "ordinary domain field, not the storage epoch; preserved unchanged" }));
    const norm = core.normalization || { rows: [], numericKeyMaps: { rows: [] } };
    if (norm.rows && norm.rows.length) findings.push(F("approved_canonicalization", "WARNING", { observed: norm.rows, reason: "null/empty values are absent after the approved canonicalization" }));
    if (norm.numericKeyMaps && norm.numericKeyMaps.rows && norm.numericKeyMaps.rows.length) findings.push(F("numeric_key_maps", "WARNING", { observed: norm.numericKeyMaps.rows, reason: "map fields read back as arrays; canonical map equality applies" }));
    const nf = []; rowsArr.forEach((r, i) => { if (!H.isPlainRow(r)) return; CONSUMER_NUMERIC_FIELDS.forEach((f) => { if (nonFinite(r[f])) nf.push({ index: i, id: r.id, field: f, observed: r[f] }); }); });
    if (nf.length) findings.push(F("non_finite_numeric", "BLOCKER", { observed: nf }));
    if (rowsArr.length > limits.maxRows) findings.push(F("above_rehearsed_cap", "OPERATOR_ACTION_REQUIRED", { observed: rowsArr.length, expected: limits.maxRows, resolved: resolved.has("above_rehearsed_cap") }));
    if (nodeBytes > limits.maxNodeBytes) findings.push(F("above_rehearsed_cap", "OPERATOR_ACTION_REQUIRED", { observed: nodeBytes, expected: limits.maxNodeBytes, resolved: resolved.has("above_rehearsed_cap") }));
    if (storage.rawVBytes !== null && storage.rawVBytes > limits.maxRawVBytes) findings.push(F("raw_v_over_platform_limit", "BLOCKER", { observed: storage.rawVBytes, expected: limits.maxRawVBytes }));
    if (core.ok) {
      try { expectedV2 = computeExpectedV2(raw, H); findings.push(F("representable", "PASS", { observed: { expectedV2Digest: expectedV2.digest, rowCount: expectedV2.rowCount } })); }
      catch (e) { findings.push(F("representation_failed", "BLOCKER", { reason: e.message })); }
    }
  }
  // exceptions
  const exc = analyseExceptions(exceptions);
  if (exc.malformed.length) findings.push(F("exceptions_malformed", "BLOCKER", { path: paths.exceptions, observed: exc.malformed }));
  else findings.push(F("exceptions_shape", "PASS", { observed: { dates: exc.dates.length, active: exc.active.length, cleared: exc.cleared.length } }));
  if (ids && ids.duplicateDates.length && exc.active.some((d) => ids.duplicateDates.some((g) => g.date === d))) findings.push(F("duplicate_date_with_exception", "OPERATOR_ACTION_REQUIRED", { observed: exc.active.filter((d) => ids.duplicateDates.some((g) => g.date === d)), resolved: resolved.has("duplicate_date_with_exception") }));
  // final held preflight
  if (held) {
    const okHeld = policy.phase === "quiesced" && policy.operation && policy.operation.id === manifest.operation.id && drain && drain.verdict === "DRAIN_EVIDENCE_COMPLETE";
    findings.push(okHeld ? F("final_held_conditions", "PASS", {}) : F("final_preflight_conditions", "OPERATOR_ACTION_REQUIRED", { observed: { phase: policy.phase, drain: drain ? drain.verdict : null }, resolved: false }));
  }
  const aggregate = aggregateClassification(findings);
  const eligibility = mode.mode !== "legacy" ? "NOT_ELIGIBLE" : aggregate === "BLOCKER" || aggregate === "OPERATOR_ACTION_REQUIRED" ? "NOT_ELIGIBLE" : aggregate === "WARNING" ? "ELIGIBLE_WITH_WARNING" : "ELIGIBLE";
  return { reportVersion: CONTRACT_VERSION, serializer: SERIALIZER_VERSION, target: { tenantId: manifest.tenantId, bizId: manifest.bizId, paths: { entries: paths.entries, control: paths.control, exceptions: paths.exceptions, config: paths.config } },
    identity: { expected: manifest.expectedIdentity.businessName, observed: businessName }, environment, storage, policy, legacy, ids, expectedV2: expectedV2 ? { digest: expectedV2.digest, logicalDigest: expectedV2.logicalDigest, rowCount: expectedV2.rowCount } : null,
    normalization: core ? core.normalization : null, exceptions: exc, findings, aggregate, eligibility };
}
export function analyseExceptions(exceptions) {
  const out = { dates: [], active: [], cleared: [], malformed: [] };
  if (exceptions === null || exceptions === undefined) return out;
  if (typeof exceptions !== "object" || Array.isArray(exceptions)) { out.malformed.push({ path: "$", reason: "not_a_map" }); return out; }
  for (const d of Object.keys(exceptions).sort()) {
    const n = exceptions[d];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { out.malformed.push({ path: d, reason: "not_a_business_date" }); continue; }
    if (!n || typeof n !== "object") { out.malformed.push({ path: d, reason: "not_an_object" }); continue; }
    out.dates.push(d);
    const st = n.state;
    if (st === undefined) continue;
    if (!st || typeof st !== "object" || (st.status !== "active" && st.status !== "cleared")) { out.malformed.push({ path: d + "/state", reason: "invalid_status" }); continue; }
    (st.status === "active" ? out.active : out.cleared).push(d);
  }
  return out;
}

// ── comparisons (verify) ─────────────────────────────────────────────────────
const L = (code, level, extra = {}) => ({ code, level, ...extra });
export function compareStructural({ bundle, actual, actualControl, manifest, H, expectedPhase = "quiesced" }) {
  const f = [];
  const src = bundle.sourceManifest, exp = bundle.expectedV2;
  if (!actual || typeof actual !== "object") { f.push(L("malformed_v2", "STOP", { observed: actual === null ? "absent" : typeof actual })); return f; }
  if (actual.schemaVersion !== 2) f.push(L("schema_version", "STOP", { observed: actual.schemaVersion, expected: 2 }));
  if (actual.generation !== H.GENERATION_FIRST) f.push(L("generation_unexpected", "STOP", { observed: actual.generation, expected: H.GENERATION_FIRST }));
  const rows = actual.rows && typeof actual.rows === "object" ? actual.rows : {};
  const keys = Object.keys(rows).sort();
  if (keys.length !== src.rowCount) f.push(L(keys.length < src.rowCount ? "row_loss" : "unexplained_new_row", "STOP", { observed: keys.length, expected: src.rowCount }));
  if (src.rowCount > 0 && !actual.rows) f.push(L("rows_map_missing", "STOP", {}));
  const missing = src.sortedIds.filter((id) => !(id in rows)), extra = keys.filter((k) => !src.sortedIds.includes(k));
  if (missing.length) f.push(L("id_loss", "STOP", { observed: missing }));
  if (extra.length) f.push(L("unexplained_new_id", "STOP", { observed: extra }));
  for (const k of keys) { const r = rows[k]; if (!r || r.id !== k) f.push(L("row_key_id_mismatch", "STOP", { path: k, observed: r && r.id })); if (!r || r[H.ROW_GEN_KEY] !== H.GENERATION_FIRST) f.push(L("row_gen_mismatch", "STOP", { path: k, observed: r && r[H.ROW_GEN_KEY] })); }
  const actualDates = [...new Map(keys.map((k) => [k, H.entryDateKey(rows[k] && rows[k].date) || String(rows[k] && rows[k].date)])).entries()].reduce((m, [id, d]) => { (m[d] ||= []).push(id); return m; }, {});
  for (const g of src.dateGroups) { const got = (actualDates[g.date] || []).slice().sort(); if (JSON.stringify(got) !== JSON.stringify(g.ids)) f.push(L("date_group_changed", "STOP", { path: g.date, observed: got, expected: g.ids })); }
  if (bundle.rawV.present) { if (typeof actual._v !== "string") f.push(L("frozen_v_missing", "STOP", {})); else if (rawVSha256(actual._v) !== bundle.rawV.sha256 || utf8Bytes(actual._v) !== bundle.rawV.bytes) f.push(L("frozen_v_changed", "STOP", { observed: rawVSha256(actual._v), expected: bundle.rawV.sha256 })); }
  else if (actual._v !== undefined) f.push(L("frozen_v_unexpected", "STOP", {}));
  const actualDigest = digestV1(actual);
  if (actualDigest !== exp.digest) f.push(L("expected_node_digest_mismatch", "STOP", { observed: actualDigest, expected: exp.digest }));
  const pp = parsePolicyRecord(actualControl === undefined ? null : actualControl);
  if (pp.status !== "valid") f.push(L("policy_malformed_live", "STOP", { observed: pp.status, reason: pp.reason || null }));
  else {
    const rec = pp.record;
    if (rec.phase !== expectedPhase) f.push(L("unexpected_policy_change", "STOP", { observed: rec.phase, expected: expectedPhase }));
    if (expectedPhase === "quiesced" && (!rec.operation || rec.operation.id !== manifest.operation.id || rec.operation.owner !== manifest.operation.operator)) f.push(L("operation_ownership_lost", "STOP", { observed: rec.operation }));
    if (expectedPhase === "quiesced" && rec.conversionAttempted !== true) f.push(L("conversion_marker_missing", "STOP", {}));
    if (expectedPhase === "v2_active" && (rec.minStorageProtocol < 2 || rec.allowV2Initialization !== false)) f.push(L("active_policy_shape", "STOP", { observed: { minStorageProtocol: rec.minStorageProtocol, allowV2Initialization: rec.allowV2Initialization } }));
  }
  if (!f.length) f.push(L("structural_checkpoint", "OK", { observed: { rowCount: keys.length, digest: actualDigest } }));
  return f;
}
export function compareLogical({ sourceRows, actual, H, normalization }) {
  const f = [];
  const rows = actual && actual.rows ? actual.rows : {};
  const reported = new Set((normalization && normalization.rows || []).flatMap((r) => r.paths.map((p) => `${r.index}:${p}`)));
  sourceRows.forEach((s, i) => {
    const a = rows[s.id];
    if (!a) { f.push(L("row_missing", "STOP", { rowId: s.id })); return; }
    const cs = H.canonicalRowValue(s) || {}, ca = H.canonicalRowValue(stripGen(a, H)) || {};
    const ds = digestV1(cs), da = digestV1(ca);
    if (ds !== da) {
      const fields = [...new Set([...Object.keys(cs), ...Object.keys(ca)])].filter((k) => JSON.stringify(cs[k]) !== JSON.stringify(ca[k]));
      f.push(L("row_content_changed", "STOP", { rowId: s.id, index: i, fields }));
    }
    // every raw→canonical difference must be a reported normalisation path
    const dropped = Object.keys(s).filter((k) => !(k in cs) && k !== H.ROW_GEN_KEY);
    for (const k of dropped) if (!reported.has(`${i}:${k}`)) f.push(L("unreported_normalization", "STOP", { rowId: s.id, path: k }));
    for (const k of Object.keys(cs)) if (typeof cs[k] === "string" && cs[k] !== ca[k]) f.push(L("text_altered", "STOP", { rowId: s.id, path: k }));
  });
  if (!f.length) f.push(L("logical_checkpoint", "OK", { observed: { rows: sourceRows.length } }));
  return f;
}
/** Deep equality with full-precision numbers (Object.is) and typed diff paths. */
const shown = (v) => (v === undefined ? "<absent>" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v);   // diff output must itself be digestable
export function deepDiff(a, b, path = "$", out = []) {
  if (typeof a === "number" && typeof b === "number") { if (!Object.is(a, b)) out.push({ path, a: shown(a), b: shown(b) }); return out; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") { if (a !== b) out.push({ path, a: shown(a), b: shown(b) }); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path, a: Array.isArray(a) ? "array" : "object", b: Array.isArray(b) ? "array" : "object" }); return out; }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) deepDiff(a[k], b[k], `${path}.${k}`, out);
  return out;
}
export function compareReaders({ baseline, post, allowedDeltas = null }) {
  const f = [];
  for (const k of Object.keys(baseline)) {
    if (k === "meta") continue;
    const diffs = deepDiff(baseline[k], post[k]);
    const real = allowedDeltas ? diffs.filter((d) => !allowedDeltas.some((re) => re.test(d.path))) : diffs;
    if (real.length) f.push(L("financial_drift", "STOP", { reader: k, observed: real.slice(0, 50), count: real.length }));
  }
  for (const k of Object.keys(post)) if (!(k in baseline) && k !== "meta") f.push(L("reader_output_unexpected", "REVIEW_REQUIRED", { reader: k }));
  if (!f.length) f.push(L("reader_parity", "OK", { observed: Object.keys(baseline).filter((k) => k !== "meta") }));
  return f;
}

// ── stop / hold classification ───────────────────────────────────────────────
export function classify(findings, { phase = null } = {}) {
  let idx = 0;
  for (const f of findings) { const i = LEVELS.indexOf(f.level); if (i > idx) idx = i; }
  const level = LEVELS[idx];
  let recommendation = "NONE";
  if (level === "STOP" || level === "RECOVERY_HOLD_RECOMMENDED") recommendation = phase === "v2_active" ? "RECOVERY_HOLD_RECOMMENDED" : phase === "quiesced" ? "REMAIN_QUIESCED" : "STOP_AND_ESCALATE";
  else if (level === "REVIEW_REQUIRED") recommendation = "INVESTIGATE_BEFORE_NEXT_BUSINESS";
  const exitCode = level === "STOP" || level === "RECOVERY_HOLD_RECOMMENDED" ? EXIT.STOP : EXIT.OK;
  return { level, recommendation, exitCode, automaticTransition: false };
}

// ── live-check row diffs ─────────────────────────────────────────────────────
export function diffRows(before, after, H) {
  const rb = before && before.rows ? before.rows : {}, ra = after && after.rows ? after.rows : {};
  const added = Object.keys(ra).filter((k) => !(k in rb)).sort(), removed = Object.keys(rb).filter((k) => !(k in ra)).sort();
  const changed = Object.keys(ra).filter((k) => k in rb && digestV1(ra[k]) !== digestV1(rb[k])).sort().map((k) => ({ id: k, fields: deepDiff(rb[k], ra[k]).map((d) => d.path.slice(2)) }));
  return { added, removed, changed, unchanged: Object.keys(ra).filter((k) => k in rb && digestV1(ra[k]) === digestV1(rb[k])).length,
    generationBefore: before ? before.generation : null, generationAfter: after ? after.generation : null,
    rawVUnchanged: (before && before._v) === (after && after._v) };
}
export function liveCheckFindings({ action, before, after, plannedRow, editField, editValue, liveRowId, H, policyBefore, policyAfter }) {
  const f = [], d = diffRows(before, after, H);
  if (d.generationBefore !== d.generationAfter) f.push(L("generation_changed_without_clear", "STOP", { observed: d.generationAfter, expected: d.generationBefore }));
  if (!d.rawVUnchanged) f.push(L("frozen_v_changed", "STOP", {}));
  if (digestV1(policyBefore === undefined ? null : policyBefore) !== digestV1(policyAfter === undefined ? null : policyAfter)) f.push(L("unexpected_policy_change", "STOP", {}));
  if (action === "create") {
    if (d.added.length !== 1 || d.removed.length || d.changed.length) f.push(L("create_diff_unexpected", "STOP", { observed: d }));
    else { const id = d.added[0], row = after.rows[id]; const want = H.canonicalRowValue({ ...plannedRow, id }) || {}, got = H.canonicalRowValue(stripGen(row, H)) || {};
      if (row.id !== id || row[H.ROW_GEN_KEY] !== after.generation) f.push(L("create_row_shape", "STOP", { observed: { id: row.id, gen: row[H.ROW_GEN_KEY] } }));
      if (digestV1(want) !== digestV1(got)) f.push(L("create_content_unexpected", "STOP", { observed: deepDiff(want, got) })); }
  } else if (action === "edit") {
    if (d.added.length || d.removed.length || d.changed.length !== 1 || d.changed[0].id !== liveRowId) f.push(L("edit_diff_unexpected", "STOP", { observed: d }));
    else { const fields = d.changed[0].fields.map((p) => p.split(".")[0]); if (fields.some((x) => x !== editField)) f.push(L("edit_fields_unexpected", "STOP", { observed: fields, expected: [editField] }));
      const got = H.canonicalRowValue(stripGen(after.rows[liveRowId], H)) || {}; const want = H.MAP_FIELDS.includes(editField) ? H.canonicalMapField(editValue) : editValue;
      if (digestV1(got[editField] === undefined ? null : got[editField]) !== digestV1(want === undefined ? null : want)) f.push(L("edit_value_unexpected", "STOP", { observed: got[editField], expected: want })); }
  } else if (action === "delete") {
    if (d.removed.length !== 1 || d.removed[0] !== liveRowId || d.added.length || d.changed.length) f.push(L("delete_diff_unexpected", "STOP", { observed: d }));
  } else f.push(L("unknown_action", "STOP", { observed: action }));
  if (!f.length) f.push(L(`live_${action}_ok`, "OK", { observed: d }));
  return { findings: f, diff: d };
}

// ── status reconciliation (unknown migration outcome) ────────────────────────
export function reconcileStatus({ raw, control, bundle, manifest, H }) {
  const pp = parsePolicyRecord(control === undefined ? null : control);
  const rec = pp.status === "valid" ? pp.record : null;
  const nodeDigest = digestV1(raw === undefined ? null : raw);
  const mode = H.detectStorageMode(raw);
  let state, explanation;
  if (!bundle) { state = rec ? (rec.phase === "quiesced" ? (rec.conversionAttempted ? "A2_ATTEMPTED_NO_EVIDENCE" : "A1_HELD_NO_ATTEMPT") : rec.phase.toUpperCase()) : "NO_POLICY"; explanation = "no evidence bundle supplied"; }
  else if (nodeDigest === bundle.sourceManifest.sourceDigest) { state = rec && rec.conversionAttempted ? "A2_SOURCE_INTACT_AFTER_ATTEMPT" : "A1_SOURCE_INTACT"; explanation = "node equals the captured source exactly"; }
  else if (nodeDigest === bundle.expectedV2.digest) { state = rec && rec.phase === "v2_active" ? "C_ACTIVE_EXPECTED_V2" : "B_CONVERTED_HELD"; explanation = "node equals the expected V2 node exactly"; }
  else { state = "HOLD_UNRECOGNISED_STATE"; explanation = "node matches neither the captured source nor the expected V2 node"; }
  const level = state.startsWith("HOLD") ? "STOP" : "OK";
  return { state, explanation, mode: mode.mode, nodeDigest, policy: rec ? { phase: rec.phase, policyRevision: rec.policyRevision, operation: rec.operation, conversionAttempted: rec.conversionAttempted } : { status: pp.status },
    recommendation: level === "STOP" ? (rec && rec.phase === "v2_active" ? "RECOVERY_HOLD_RECOMMENDED" : "REMAIN_QUIESCED_AND_ESCALATE") : "NONE", level, automaticTransition: false };
}

// ── monitoring ledger ────────────────────────────────────────────────────────
export function rowCountEquation({ rowsStart, creates, deletes, rowsEnd }) {
  const expected = rowsStart + creates - deletes;
  return { rowsStart, creates, deletes, rowsEnd, expected, ok: expected === rowsEnd };
}
export function slotMapping(anchorDate, timezone) {
  const slots = [["analytics", `${anchorDate}T23:00:00Z`], ["proactive", nextDayUtc(anchorDate, "03:00")], ["alerts", nextDayUtc(anchorDate, "04:00")], ["snapshot", nextDayUtc(anchorDate, "04:05")], ["deadline", nextDayUtc(anchorDate, "06:00")]];
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
  return Object.fromEntries(slots.map(([name, utc]) => [name, { utc, local: fmt.format(new Date(utc)) }]));
}
function nextDayUtc(anchorDate, hm) { const d = new Date(anchorDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) + "T" + hm + ":00Z"; }
export function buildCycleRecord(input) {
  const { cycleId, anchorDate, manifest, now, versions, source, mutations, ui, counters, derived, reconciliation, incidents = [], receipts = {} } = input;
  const findings = [];
  const eq = mutations ? rowCountEquation(mutations) : null;
  if (eq && !eq.ok) findings.push(L("unexplained_row_delta", "STOP", { observed: eq }));
  if (source && source.previousDigest && source.previousDigest !== source.startDigest && !(mutations && (mutations.creates || mutations.deletes || mutations.edits))) findings.push(L("source_digest_changed_unexpectedly", "STOP", { observed: source.startDigest, expected: source.previousDigest }));
  if (source && source.rawVShaPrev && source.rawVSha !== source.rawVShaPrev) findings.push(L("frozen_v_changed", "STOP", {}));
  if (versions && versions.policy && versions.policy.phase !== "v2_active" && versions.policy.phase !== "recovery_hold") findings.push(L("unexpected_policy_change", "STOP", { observed: versions.policy.phase }));
  if (versions && versions.generation != null && versions.generationPrev != null && versions.generation !== versions.generationPrev) findings.push(L("generation_changed_without_clear", "STOP", { observed: versions.generation, expected: versions.generationPrev }));
  if (versions && versions.storageMode && versions.storageMode !== "v2") findings.push(L("malformed_v2", "STOP", { observed: versions.storageMode }));
  const incomplete = [];
  for (const [k, v] of Object.entries(derived || {})) { if (v.status === "UNKNOWN" || v.status === "MISSING" || v.status === "STALE") incomplete.push(k); if (v.status === "MISSING" || v.status === "STALE") findings.push(L("derived_output_missing_or_stale", "REVIEW_REQUIRED", { output: k, observed: v })); if (v.status === "UNKNOWN") findings.push(L("derived_output_unknown", "REVIEW_REQUIRED", { output: k, reason: v.reason || "no evidence supplied" })); }
  if (reconciliation && reconciliation.drift && reconciliation.drift.length) findings.push(L("financial_drift", "STOP", { observed: reconciliation.drift }));
  for (const [k, v] of Object.entries(counters || {})) { if (v && v.value === "UNKNOWN") findings.push(L("counter_unknown", "REVIEW_REQUIRED", { counter: k })); }
  if (counters && counters.malformedV2 && counters.malformedV2.value > 0) findings.push(L("malformed_v2", "STOP", { observed: counters.malformedV2 }));
  if (counters && counters.storageModeMismatch && counters.storageModeMismatch.value > 0) findings.push(L("storage_mode_mismatch", "STOP", { observed: counters.storageModeMismatch }));
  if (counters && counters.oldClientWriteSucceeded && counters.oldClientWriteSucceeded.value > 0) findings.push(L("old_client_write_succeeded", "STOP", { observed: counters.oldClientWriteSucceeded }));
  if (counters && counters.consecutiveFailedSaves && counters.consecutiveFailedSaves.value >= 3) findings.push(L("conflict_threshold", "REVIEW_REQUIRED", { observed: counters.consecutiveFailedSaves }));
  for (const inc of incidents) findings.push(L("operator_incident", inc.level || "REVIEW_REQUIRED", { observed: inc }));
  const cls = classify(findings, { phase: versions && versions.policy ? versions.policy.phase : null });
  const cycle = incomplete.length || cls.level === "STOP" || cls.level === "RECOVERY_HOLD_RECOMMENDED" || cls.level === "REVIEW_REQUIRED" ? "INCOMPLETE" : "COMPLETE";
  const body = { recordVersion: CONTRACT_VERSION, cycleId, anchorDate, slots: slotMapping(anchorDate, manifest.timezone), identity: { projectId: manifest.projectId, tenantId: manifest.tenantId, bizId: manifest.bizId, path: derivePaths(manifest).entries, operator: manifest.operation.operator, observer: manifest.operation.observer },
    versions, source, mutations: eq, ui, counters, derived, reconciliation, incidents, receipts, findings, classification: cls, cycle, incompleteReasons: incomplete };
  return { ...body, recordedAt: now, bodyDigest: digestV1(body) };
}
export function windowArithmetic({ records, liveWriteCleanupAt, now, requiredHours = 168, requiredCycles = 7 }) {
  const byCycle = new Map();
  for (const r of records) byCycle.set(r.cycleId, r);   // last record (correction) wins
  const ordered = [...byCycle.values()].sort((a, b) => (a.anchorDate < b.anchorDate ? -1 : 1));
  let streak = 0;
  for (const r of ordered) { if (r.cycle === "COMPLETE" && ["OK", "EXPECTED", "WARNING"].includes(r.classification.level)) streak++; else streak = 0; }
  const elapsedHours = liveWriteCleanupAt ? Math.max(0, (Date.parse(now) - Date.parse(liveWriteCleanupAt)) / 3600000) : 0;
  const stops = ordered.filter((r) => r.classification.level === "STOP" || r.classification.level === "RECOVERY_HOLD_RECOMMENDED").map((r) => r.cycleId);
  return { cycles: ordered.length, cleanStreak: streak, elapsedHours, requiredHours, requiredCycles, stops, windowMet: elapsedHours >= requiredHours && streak >= requiredCycles && !(stops.length && stops[stops.length - 1] === ordered[ordered.length - 1]?.cycleId) };
}

// ── drain ─────────────────────────────────────────────────────────────────────
export const drainFloorSeconds = (writerBoundSeconds, environment = "production") => environment === "emulator"
  ? Math.max(1, (Number.isFinite(writerBoundSeconds) ? writerBoundSeconds : Infinity) + 1)      // matrix runs: seconds, same arithmetic
  : Math.max(120, (Number.isFinite(writerBoundSeconds) ? writerBoundSeconds : Infinity) + 60);  // production floor: max(120, W+60)
export function drainVerdict({ samples, attestation, manifest, control, writerBoundSeconds, intervalSeconds, floorSeconds }) {
  const f = [];
  const pp = parsePolicyRecord(control === undefined ? null : control);
  const rec = pp.status === "valid" ? pp.record : null;
  if (!rec || rec.phase !== "quiesced") f.push(L("not_quiesced", "STOP", { observed: rec ? rec.phase : pp.status }));
  else if (!rec.operation || rec.operation.id !== manifest.operation.id || rec.operation.owner !== manifest.operation.operator || rec.operation.kind !== "cutover") f.push(L("operation_ownership_mismatch", "STOP", { observed: rec.operation }));
  const digests = samples.map((s) => ({ at: s.at, entries: s.entries, exceptions: s.exceptions, context: s.context, control: s.control, derived: s.derived }));
  const unstable = [];
  for (const k of ["entries", "exceptions", "context", "control", "derived"]) { const set = new Set(digests.map((d) => d[k])); if (set.size > 1) unstable.push({ key: k, observed: digests.map((d) => ({ at: d.at, digest: d[k] })) }); }
  const stable = samples.length >= 3 && unstable.length === 0;
  if (!stable) f.push(L("unstable_fingerprint", "STOP", { observed: unstable, samples: samples.length }));
  const floor = Number.isFinite(floorSeconds) ? floorSeconds : drainFloorSeconds(writerBoundSeconds, manifest.environment);
  if (!Number.isFinite(writerBoundSeconds)) f.push(L("writer_bound_unknown", "REVIEW_REQUIRED", { reason: "W not supplied — waiting longer proves nothing", classification: "OPERATOR_ACTION_REQUIRED" }));
  else if (intervalSeconds < floor) f.push(L("interval_below_floor", "REVIEW_REQUIRED", { observed: intervalSeconds, expected: floor, classification: "OPERATOR_ACTION_REQUIRED" }));
  const REQUIRED = ["controlledClientsInventory", "oldSessionsClosedOrReplaced", "pendingSavesReconciled", "adminWritesFrozen", "exceptionWritesFrozen", "configEditsFrozen"];
  const JOBS = ["analytics", "proactive", "alerts", "snapshot"];
  let attested = false;
  if (!attestation) f.push(L("attestation_missing", "REVIEW_REQUIRED", { classification: "OPERATOR_ACTION_REQUIRED" }));
  else {
    const it = attestation.items || {};
    const missing = REQUIRED.filter((k) => it[k] !== true), jobsMissing = JOBS.filter((k) => !(it.jobsPaused && it.jobsPaused[k] === true));
    const unknowns = Array.isArray(it.unknowns) ? it.unknowns : ["unknowns_not_declared"];
    if (attestation.operationId !== manifest.operation.id) f.push(L("attestation_wrong_operation", "STOP", { observed: attestation.operationId }));
    if (missing.length || jobsMissing.length || unknowns.length) f.push(L("attestation_incomplete", "REVIEW_REQUIRED", { observed: { missing, jobsMissing, unknowns }, classification: "OPERATOR_ACTION_REQUIRED" }));
    else attested = true;
  }
  const fatal = f.some((x) => x.level === "STOP");
  const verdict = fatal ? "INCOMPLETE" : stable && attested && f.every((x) => x.level === "OK") ? "DRAIN_EVIDENCE_COMPLETE" : stable ? (attested ? "STABLE_INTERVAL_AND_ATTESTED_WITH_FINDINGS" : "STABLE_INTERVAL") : attested ? "ATTESTED" : "INCOMPLETE";
  return { verdict, stable, attested, floorSeconds: Number.isFinite(floor) ? floor : null, intervalSeconds, samples: digests, findings: f, proven: verdict === "DRAIN_EVIDENCE_COMPLETE",
    honesty: "equal fingerprints across the interval do not exclude a write-and-revert inside it; migration is additionally bound to the evidence digest on every transaction callback" };
}
