#!/usr/bin/env node
// EV-1 COLLECTOR (EV1_COLLECTOR/1) — the single operator entrypoint for the pre-B1 EV-1 census.
//
// ONE invocation ⇒ ONE private evidence bundle:
//   PRE_FLIGHT.md · EV1_REPORT.json · EV1_SUMMARY.md · COMPLETE.json (written LAST, binds the
//   other three by sha256).
//
// Layers (each independently testable; the transport is injected):
//   1. preflight      — ./ev1-preflight.mjs: environment / identity / credential file / output dir,
//                       all BEFORE any network activity;
//   2. transport      — ./ev1-transport.mjs: GET-only RTDB reads (REST), typed outcomes;
//   3. scope discovery— tenants (shallow `tenants`) × businesses (registry `app/business` ∪ every
//                       stored `biz:<id>:*` key) — see artifacts/.../01_SCOPE_ENUMERATION_CONTRACT.md;
//   4. raw-node validation — the shared server reader `lib/analytics/entriesReader.js`
//                       (`readEntriesNode`: legacy `_v` array VERBATIM, V2 rows fail-closed);
//   5. classification — the approved EV1/3 classifier (`classifyBusiness`, unchanged), once per
//                       business, on the complete decoded logical array;
//   6. reconciliation — `evaluateReport`: every invariant is recomputed from the report JSON alone
//                       (also by `--verify`), `evidenceComplete` is their conjunction;
//   7. safe output    — counts, categories, technical tenant/business ids only. No row ids, no row
//                       content, no amounts, no names/emails/notes, no credential/token material.
//
// READ-ONLY: this module performs no database request itself; the transport exposes GET reads
// only. Local writes are limited to the new private output directory.
//
//   node tools/finance-core/ev1-collector.mjs --env production --project kissgn-1227b \
//        --database-url https://kissgn-1227b-default-rtdb.firebaseio.com \
//        --credentials-file <approved-read-only-sa.json> --as-of <YYYY-MM-DD> \
//        --expected-commit <approved 40-hex sha> --out-dir <new dir outside git>
//   node tools/finance-core/ev1-collector.mjs --fixture <tree.json> --as-of <YYYY-MM-DD> --out-dir <dir>   # offline
//   node tools/finance-core/ev1-collector.mjs --verify <bundle dir>                                       # post-run check
import { readFileSync, mkdirSync, writeFileSync, chmodSync, lstatSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { classifyBusiness, EV1_CLASSIFIER_VERSION } from "./ev1-classifier.mjs";
import { readEntriesNode } from "../../lib/analytics/entriesReader.js";
import * as P from "./ev1-preflight.mjs";
import { createRestTransport, createFixtureTransport } from "./ev1-transport.mjs";

export const EV1_COLLECTOR_SCHEMA = "EV1_COLLECTOR/1";
export const REQUIRED_CLASSIFIER_VERSION = "EV1/3";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOURCE_FILES = Object.freeze([
  "tools/finance-core/ev1-collector.mjs",
  "tools/finance-core/ev1-transport.mjs",
  "tools/finance-core/ev1-preflight.mjs",
  "tools/finance-core/ev1-classifier.mjs",
  "lib/analytics/entriesReader.js",
]);
export const BUNDLE_FILES = Object.freeze(["PRE_FLIGHT.md", "EV1_REPORT.json", "EV1_SUMMARY.md"]);
/**
 * R1 (Codex P2): the CLOSED bundle. A completed bundle directory contains EXACTLY these regular
 * files — the three digest-bound evidence files plus COMPLETE.json — and nothing else: no hidden
 * file, no symlink, no sub-directory, no other entry of any kind. No filesystem metadata entry is
 * allowed (e.g. a Finder `.DS_Store` makes the bundle fail verification).
 */
export const BUNDLE_MANIFEST = Object.freeze(["COMPLETE.json", "EV1_REPORT.json", "EV1_SUMMARY.md", "PRE_FLIGHT.md"]);
export const EXIT = Object.freeze({ COMPLETE: 0, REFUSED: 2, TRANSPORT_REFUSED: 3, OUTPUT_FAILED: 4, INCOMPLETE: 10 });
export const USAGE = `usage:
  node tools/finance-core/ev1-collector.mjs --env production --project <id> --database-url <https url> --credentials-file <ro-sa.json> --as-of <YYYY-MM-DD> --expected-commit <sha> --out-dir <new dir outside git>
  node tools/finance-core/ev1-collector.mjs --fixture <tree.json> --as-of <YYYY-MM-DD> --out-dir <new dir outside git>
  node tools/finance-core/ev1-collector.mjs --verify <bundle dir>`;

// Read-only git identity commands (fixed argv; `--no-optional-locks` so no index refresh write).
const GIT_HEAD = Object.freeze(["--no-optional-locks", "rev-parse", "HEAD"]);
const GIT_STATUS = Object.freeze(["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const RTDB_FORBIDDEN = /[.#$[\]/\u0000-\u001f\u007f]/;
/** A business/tenant id that can be addressed as a single RTDB path segment and a `biz:<id>:` key. */
export const addressableId = (v) => typeof v === "string" && v.length >= 1 && v.length <= 256 && v === v.trim() && !RTDB_FORBIDDEN.test(v) && !v.includes(":");
// Same explicit-negative-flag predicate as server discovery (src/analytics/dailyBuilder.ts).
const INACTIVE_STATUSES = new Set(["inactive", "disabled", "deleted", "archived"]);
const explicitlyInactive = (v) => v.active === false || v.inactive === true || v.disabled === true || v.deleted === true || v.archived === true
  || (typeof v.status === "string" && INACTIVE_STATUSES.has(v.status.trim().toLowerCase()));

export function repoIdentity(root = ROOT) {
  const head = spawnSync("git", GIT_HEAD, { cwd: root, encoding: "utf8" });
  const status = spawnSync("git", GIT_STATUS, { cwd: root, encoding: "utf8" });
  return { headSha: head.status === 0 ? head.stdout.trim() : null, treeClean: status.status === 0 ? status.stdout.trim() === "" : null };
}
export function sourceDigests(root = ROOT) {
  return Object.fromEntries(SOURCE_FILES.map((f) => [f, sha256(readFileSync(join(root, f)))]));
}

// ── discovery decoders (pure; a malformed shape is a FAILURE, never an empty set) ─────────────
/** Shallow REST value → sorted child keys. null ⇒ zero children (successful). */
export function decodeShallow(value) {
  if (value === null) return { ok: true, keys: [] };
  if (!isPlain(value)) return { ok: false };
  return { ok: true, keys: Object.keys(value).sort() };
}
/**
 * Business registry `tenants/<t>/app/business` (client key "app-businesses"; admin create-client /
 * edit-client; read by every server discovery). Accepted shapes = those the product writes/reads:
 * absent (null), `{ _v: "<JSON array>" }`, a JSON-array string, or an array.
 */
export function decodeRegistry(value, tenantId) {
  if (value === null) return { ok: true, state: "absent", entries: [], malformedEntries: 0, duplicates: 0 };
  let arr;
  if (Array.isArray(value)) arr = value;
  else {
    const text = typeof value === "string" ? value : isPlain(value) && typeof value._v === "string" ? value._v : null;
    if (text === null) return { ok: false, reason: "registry_shape" };
    try { arr = JSON.parse(text); } catch { return { ok: false, reason: "registry_json" }; }
    if (!Array.isArray(arr)) return { ok: false, reason: "registry_not_array" };
  }
  const byId = new Map();
  let malformedEntries = 0, duplicates = 0;
  for (const e of arr) {
    if (!isPlain(e) || !addressableId(e.id)) { malformedEntries += 1; continue; }
    const prev = byId.get(e.id);
    if (prev) { duplicates += 1; prev.duplicateRegistration = true; prev.explicitlyInactive = prev.explicitlyInactive && explicitlyInactive(e); continue; }
    byId.set(e.id, { bizId: e.id, selfId: e.id === tenantId, explicitlyInactive: explicitlyInactive(e), duplicateRegistration: false });
  }
  return { ok: true, state: "present", entries: [...byId.values()].sort((a, b) => (a.bizId < b.bizId ? -1 : 1)), malformedEntries, duplicates };
}
/** Stored per-business keys under a tenant: `biz:<id>:<suffix>` ⇒ id. A `biz:` key that cannot be attributed is a failure. */
export function storedBusinessKeys(keys) {
  const ids = new Map();
  let unparseable = 0;
  const legacyTenantRoot = { entries: keys.includes("entries") };
  for (const k of keys) {
    if (!k.startsWith("biz:")) continue;
    const m = /^biz:([^:]+):(.+)$/.exec(k);
    if (!m || !addressableId(m[1])) { unparseable += 1; continue; }
    const cur = ids.get(m[1]) || { entriesKey: false, kinds: 0 };
    cur.kinds += 1;
    if (m[2] === "entries") cur.entriesKey = true;
    ids.set(m[1], cur);
  }
  return { ids, unparseable, legacyTenantRoot };
}

// ── classifier output sanitation (counts only) ──────────────────────────────────────────────
const ROW_ID_FIELDS = [["identity", "duplicateIds"], ["vd16", "rowIds"]];
/** Remove the classifier's capped row-id lists (EV-1 evidence is aggregate); refuse any other non-count leaf. */
export function sanitizeClassification(res) {
  const out = JSON.parse(JSON.stringify(res));
  for (const [a, b] of ROW_ID_FIELDS) if (out[a]) delete out[a][b];
  const bad = [];
  const walk = (v, path) => {
    if (typeof v === "number") { if (!Number.isInteger(v) || v < 0) bad.push(path); return; }
    if (isPlain(v)) { for (const [k, x] of Object.entries(v)) walk(x, path ? path + "." + k : k); return; }
    if (path === "classifier" && typeof v === "string") return;
    bad.push(path);
  };
  walk(out, "");
  if (bad.length) return { ok: false, bad };
  return { ok: true, value: out };
}
function addCounts(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (k === "classifier") continue;
    if (typeof v === "number") target[k] = (target[k] || 0) + v;
    else if (isPlain(v)) addCounts((target[k] = target[k] || {}), v);
  }
  return target;
}

// ── collection ──────────────────────────────────────────────────────────────────────────────
/**
 * Enumerate scope, read every business entries node exactly once, classify, and assemble the
 * report. Never throws for data/transport problems: each becomes a typed failure that makes
 * `evidenceComplete` false. `classify` is injectable ONLY so tests can prove classifier failures
 * are fail-closed; the default is the approved EV1/3 `classifyBusiness`.
 */
export async function collect({ transport, asOfBusinessDate, classify = classifyBusiness }) {
  const failures = [];
  const fail = (f) => failures.push(f);

  // 1) tenants
  const tl = await transport.listTenants();
  let tenantIds = [];
  const tenantEnumeration = { source: "GET tenants?shallow=true", ok: false, code: null, status: null, discovered: [] };
  if (!tl.ok) { tenantEnumeration.code = tl.code; tenantEnumeration.status = tl.status ?? null; fail({ scope: "tenant_list", code: tl.code, status: tl.status ?? null }); }
  else {
    const d = decodeShallow(tl.value);
    if (!d.ok) { tenantEnumeration.code = "tenant_list_malformed"; fail({ scope: "tenant_list", code: "tenant_list_malformed" }); }
    else {
      const bad = d.keys.filter((t) => !addressableId(t));
      for (const t of bad) fail({ scope: "tenant_list", code: "tenant_id_unaddressable", tenantId: t });
      tenantIds = d.keys.filter((t) => addressableId(t));
      tenantEnumeration.ok = bad.length === 0;
      if (bad.length) tenantEnumeration.code = "tenant_id_unaddressable";
    }
  }
  tenantEnumeration.discovered = tenantIds.slice();

  // 2) businesses per tenant (registry ∪ stored keys)
  const tenants = [];
  const businesses = [];
  for (const t of tenantIds) {
    const tenant = { tenantId: t, attempted: true, keysRead: null, registryRead: null, registry: null, storedKeys: null, enumerationComplete: false, businessIds: [] };
    const keys = await transport.listTenantKeys(t);
    let stored = { ids: new Map(), unparseable: 0, legacyTenantRoot: { entries: false } };
    let keysOk = false;
    if (!keys.ok) { tenant.keysRead = { ok: false, code: keys.code, status: keys.status ?? null }; fail({ scope: "tenant_keys", tenantId: t, code: keys.code, status: keys.status ?? null }); }
    else {
      const d = decodeShallow(keys.value);
      if (!d.ok) { tenant.keysRead = { ok: false, code: "tenant_keys_malformed" }; fail({ scope: "tenant_keys", tenantId: t, code: "tenant_keys_malformed" }); }
      else {
        stored = storedBusinessKeys(d.keys);
        keysOk = stored.unparseable === 0;
        tenant.keysRead = { ok: true };
        if (stored.unparseable) fail({ scope: "tenant_keys", tenantId: t, code: "stored_business_key_unattributable", count: stored.unparseable });
      }
    }
    tenant.storedKeys = { businesses: stored.ids.size, unattributableKeys: stored.unparseable, legacyTenantRootEntriesKey: stored.legacyTenantRoot.entries };

    const reg = await transport.readRegistry(t);
    let registry = { ok: false, entries: [], malformedEntries: 0, duplicates: 0, state: "unread" };
    if (!reg.ok) { tenant.registryRead = { ok: false, code: reg.code, status: reg.status ?? null }; fail({ scope: "business_registry", tenantId: t, code: reg.code, status: reg.status ?? null }); }
    else {
      const d = decodeRegistry(reg.value, t);
      if (!d.ok) { tenant.registryRead = { ok: false, code: d.reason }; fail({ scope: "business_registry", tenantId: t, code: d.reason }); }
      else {
        registry = d;
        tenant.registryRead = { ok: true };
        if (d.malformedEntries) fail({ scope: "business_registry", tenantId: t, code: "registry_entry_unidentifiable", count: d.malformedEntries });
      }
    }
    tenant.registry = { state: registry.state, registered: registry.entries.length, malformedEntries: registry.malformedEntries, duplicateRegistrations: registry.duplicates };

    const union = new Map();
    for (const e of registry.entries) union.set(e.bizId, { registered: true, storedData: false, entriesKeyListed: false, selfId: e.selfId, explicitlyInactive: e.explicitlyInactive, duplicateRegistration: e.duplicateRegistration });
    for (const [b, s] of stored.ids) {
      const cur = union.get(b) || { registered: false, storedData: false, entriesKeyListed: false, selfId: b === t, explicitlyInactive: false, duplicateRegistration: false };
      cur.storedData = true;
      cur.entriesKeyListed = s.entriesKey;
      union.set(b, cur);
    }
    tenant.businessIds = [...union.keys()].sort();
    tenant.enumerationComplete = keysOk && tenant.registryRead.ok === true && registry.malformedEntries === 0;
    tenants.push(tenant);
    for (const b of tenant.businessIds) {
      const u = union.get(b);
      businesses.push({
        tenantId: t, bizId: b,
        discovery: { registered: u.registered, storedData: u.storedData, entriesKeyListed: u.entriesKeyListed, keysListingAvailable: tenant.keysRead.ok === true },
        flags: { selfId: u.selfId, explicitlyInactive: u.explicitlyInactive, duplicateRegistration: u.duplicateRegistration },
        read: { state: "NOT_ATTEMPTED" }, rows: null, classification: { state: "NOT_CLASSIFIED" },
      });
    }
  }

  // 3) entries read + raw-node validation + classification — exactly once per discovered business
  for (const biz of businesses) {
    const { tenantId: t, bizId: b } = biz;
    const r = await transport.readEntries(t, b);
    if (!r.ok) {
      biz.read = { state: "READ_FAILED", code: r.code, status: r.status ?? null };
      fail({ scope: "entries", tenantId: t, bizId: b, code: r.code, status: r.status ?? null });
      continue;
    }
    const node = readEntriesNode(r.value);
    if (!node.ok) {
      biz.read = { state: "STRUCTURE_BLOCKED", code: "entries_node_malformed", reason: node.reason, storageStatus: node.status };
      fail({ scope: "entries", tenantId: t, bizId: b, code: "entries_node_malformed", reason: node.reason });
      continue;
    }
    // listing ↔ value consistency (a concurrent change or a discovery gap must not pass silently)
    if (biz.discovery.keysListingAvailable && biz.discovery.entriesKeyListed !== (r.value !== null)) {
      biz.read = { state: "STRUCTURE_BLOCKED", code: biz.discovery.entriesKeyListed ? "entries_listed_but_absent" : "entries_present_but_unlisted" };
      fail({ scope: "entries", tenantId: t, bizId: b, code: biz.read.code });
      continue;
    }
    const rows = node.rows;
    biz.read = { state: rows.length === 0 ? "READ_OK_EMPTY" : "READ_OK", storageMode: node.mode };
    let res;
    try {
      res = classify(rows, asOfBusinessDate);
    } catch (e) {
      biz.classification = { state: "CLASSIFIER_FAILED", code: e && typeof e.code === "string" ? e.code : "classifier_exception" };
      biz.rows = { observed: rows.length, classified: 0, unclassifiable: 0 };
      fail({ scope: "classifier", tenantId: t, bizId: b, code: biz.classification.code });
      continue;
    }
    const s = res && typeof res === "object" ? sanitizeClassification(res) : { ok: false, bad: ["<not an object>"] };
    if (!s.ok || s.value.classifier !== REQUIRED_CLASSIFIER_VERSION || typeof s.value.rowsTotal !== "number" || typeof s.value.malformedRows !== "number") {
      biz.classification = { state: "CLASSIFIER_FAILED", code: "classifier_output_invalid" };
      biz.rows = { observed: rows.length, classified: 0, unclassifiable: 0 };
      fail({ scope: "classifier", tenantId: t, bizId: b, code: "classifier_output_invalid" });
      continue;
    }
    biz.rows = { observed: rows.length, classified: s.value.rowsTotal - s.value.malformedRows, unclassifiable: s.value.malformedRows };
    biz.classification = { state: "CLASSIFIED", counts: s.value };
    // R1 (Codex P1): a row the classifier cannot classify is unexamined evidence. It stays
    // counted (safe aggregate, no row content) and blocks completeness — never discarded.
    if (s.value.malformedRows !== 0) fail({ scope: "classifier", tenantId: t, bizId: b, code: "rows_unclassifiable", count: s.value.malformedRows });
  }

  return { tenantEnumeration, tenants, businesses, failures };
}

// ── report assembly + reconciliation (recomputable from the JSON alone) ─────────────────────
export function computeCounters(report) {
  const T = report.scope.tenants, B = report.scope.businesses;
  const readOk = B.filter((b) => b.read.state === "READ_OK" || b.read.state === "READ_OK_EMPTY");
  const classified = B.filter((b) => b.classification.state === "CLASSIFIED");
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  return {
    tenants: {
      discovered: report.scope.tenantEnumeration.discovered.length,
      attempted: T.filter((t) => t.attempted === true).length,
      succeeded: T.filter((t) => t.enumerationComplete === true).length,
      failed: T.filter((t) => t.enumerationComplete !== true).length,
      withoutBusinesses: T.filter((t) => t.businessIds.length === 0).length,
      withLegacyRootEntriesKey: T.filter((t) => t.storedKeys && t.storedKeys.legacyTenantRootEntriesKey === true).length,
    },
    businesses: {
      discovered: sum(T, (t) => t.businessIds.length),
      attempted: B.filter((b) => b.read.state !== "NOT_ATTEMPTED").length,
      readOk: readOk.length,
      readFailed: B.filter((b) => b.read.state === "READ_FAILED" || b.read.state === "STRUCTURE_BLOCKED").length,
      readFailedTransport: B.filter((b) => b.read.state === "READ_FAILED").length,
      structureBlocked: B.filter((b) => b.read.state === "STRUCTURE_BLOCKED").length,
      empty: B.filter((b) => b.read.state === "READ_OK_EMPTY").length,
      classified: classified.length,
      classifierFailed: B.filter((b) => b.classification.state === "CLASSIFIER_FAILED").length,
      registered: B.filter((b) => b.discovery.registered).length,
      registeredWithoutStoredData: B.filter((b) => b.discovery.registered && !b.discovery.storedData).length,
      storedDataUnregistered: B.filter((b) => !b.discovery.registered && b.discovery.storedData).length,
      selfIdBusinesses: B.filter((b) => b.flags.selfId).length,
      explicitlyInactive: B.filter((b) => b.flags.explicitlyInactive).length,
      duplicateRegistrations: sum(T, (t) => (t.registry ? t.registry.duplicateRegistrations : 0)),
      storageLegacy: B.filter((b) => b.read.storageMode === "legacy").length,
      storageV2: B.filter((b) => b.read.storageMode === "v2").length,
      storageAbsent: B.filter((b) => b.read.storageMode === "absent").length,
    },
    rows: {
      observed: sum(B, (b) => (b.rows ? b.rows.observed : 0)),
      classified: sum(B, (b) => (b.rows ? b.rows.classified : 0)),
      unclassifiable: sum(B, (b) => (b.rows ? b.rows.unclassifiable : 0)),
    },
    failures: report.failures.length,
  };
}
export function aggregateClassification(report) {
  const agg = {};
  for (const b of report.scope.businesses) if (b.classification.state === "CLASSIFIED") addCounts(agg, b.classification.counts);
  return agg;
}
const n = (v) => (typeof v === "number" ? v : 0);
/** B1-relevant legacy/quality signals derived from the aggregate (counts only). */
export function b1Signals(agg, counters) {
  const g = (p) => p.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : 0), agg);
  return {
    identity: { validIdRows: g("identity.validIds"), missingIdRows: g("identity.missingIds"), malformedIdRows: g("identity.malformedIds"), duplicateIdRows: g("identity.duplicateIdRows"), duplicateIdValues: g("identity.duplicateIdValues") },
    dates: { badShapeDateRows: g("dates.badShapeDateRows"), impossibleDateRows: g("dates.impossibleDateRows"), futureRows: g("dates.futureRows"), duplicateDateDates: g("dates.duplicateDateDates") },
    purchases: {
      supplierRecordedRows: g("supplier.rowsWithSupplierRecorded"), supplierExplicitZeroRows: g("supplier.rowsWithExplicitZeroCell"), supplierSkipRows: g("supplier.rowsWithSkipCell"),
      supplierInvalidRows: g("supplier.rowsWithInvalidCell"), supplierInvalidMapShapeRows: g("supplier.invalidMapShapeRows"), supplierNegativeRows: g("supplier.rowsWithNegativeCell"),
      legacyFoodPresentRows: g("legacyFood.presentPositiveRows") + g("legacyFood.presentNegativeRows") + g("legacyFood.presentZeroRows"),
      legacyFoodZeroRows: g("legacyFood.presentZeroRows"), legacyFoodInvalidRows: g("legacyFood.invalidRows"), legacyFoodOnlyRows: g("legacyFood.legacyOnlyRows"),
      supplierAndLegacyFoodCollisionRows: g("vd16.supplierRecordedAndLegacyFoodRecorded"), collisionSelectionChanges: g("vd16.ofWhichSelectionChanges"),
    },
    labor: { payrollPresentRows: g("labor.rowsWithLaborPresent"), legacyHourlyPayrollRows: g("legacyHourlyPayroll.rowsWithHourlyPayrollRecorded"), payrollAndHourlyPayrollRows: g("legacyHourlyPayroll.rowsWithHourlyPayrollAndPayroll") },
    rowQuality: {
      malformedRows: g("malformedRows"), noFinancialValueRows: g("presence.noFinancialValueRows"), notesOnlyRows: g("presence.notesOnlyRows"), emptyRows: g("presence.emptyRows"),
      invalidOnlyRows: g("presence.invalidOnlyRows"), rowsWithInvalidFinancialCell: g("presence.rowsWithInvalidFinancialCell"), zeroOnlyRows: g("vd23.rowsZeroOnlyPresent"), includeVatTrueRows: g("includeVatTrueRows"),
    },
    scope: { emptyBusinesses: counters.businesses.empty, selfIdBusinesses: counters.businesses.selfIdBusinesses, explicitlyInactive: counters.businesses.explicitlyInactive, storedDataUnregistered: counters.businesses.storedDataUnregistered, storageV2: counters.businesses.storageV2, tenantsWithLegacyRootEntriesKey: counters.tenants.withLegacyRootEntriesKey },
  };
}

/** Per-business exclusive equations of EV1/3 (see artifacts 02 §row equations). */
export function businessEquations(b) {
  if (b.classification.state !== "CLASSIFIED") return [];
  const c = b.classification.counts;
  const obj = c.rowsTotal - c.malformedRows;
  return [
    ["rowsTotal == rows.observed", c.rowsTotal === b.rows.observed],
    ["rows.observed == rows.classified + rows.unclassifiable", b.rows.observed === b.rows.classified + b.rows.unclassifiable],
    ["rows.unclassifiable == malformedRows", b.rows.unclassifiable === n(c.malformedRows)],
    ["rows.classified == rowsTotal - malformedRows", b.rows.classified === c.rowsTotal - n(c.malformedRows)],
    ["objectRows == validIds + missingIds + malformedIds", obj === n(c.identity.validIds) + n(c.identity.missingIds) + n(c.identity.malformedIds)],
    ["objectRows == validDate + badShape + impossibleDate", obj === n(c.dates.validDateRows) + n(c.dates.badShapeDateRows) + n(c.dates.impossibleDateRows)],
    ["validDateRows == futureRows + actualWindowRows", n(c.dates.validDateRows) === n(c.dates.futureRows) + n(c.dates.actualWindowRows)],
    ["noFinancialValueRows == legacyHourlyOnly + notesOnly + empty + invalidOnly", n(c.presence.noFinancialValueRows) === n(c.presence.legacyHourlyOnlyRows) + n(c.presence.notesOnlyRows) + n(c.presence.emptyRows) + n(c.presence.invalidOnlyRows)],
    ["READ_OK_EMPTY ⇔ zero rows", (b.read.state === "READ_OK_EMPTY") === (b.rows.observed === 0)],
  ];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Digest of the enumerated scope: sorted tenants and (tenant, business) pairs. */
export function scopeDigest(report) {
  return sha256(JSON.stringify({ tenants: report.scope.tenantEnumeration.discovered, businesses: report.scope.tenants.flatMap((t) => t.businessIds.map((b) => [t.tenantId, b])) }));
}
/**
 * Every invariant of the fail-closed contract, computed from the report JSON alone.
 * evidenceComplete ⇔ every invariant holds (which includes "failures is empty").
 */
export function evaluateReport(report) {
  const inv = [];
  const add = (id, holds, detail) => inv.push({ id, holds: holds === true, ...(detail !== undefined && holds !== true ? { detail } : {}) });
  const c = computeCounters(report);
  const T = report.scope.tenants, B = report.scope.businesses;
  const disc = report.scope.tenantEnumeration.discovered;

  add("I01_tenant_enumeration_ok", report.scope.tenantEnumeration.ok === true);
  add("I02_tenants_attempted_eq_discovered", c.tenants.attempted === c.tenants.discovered && same(T.map((t) => t.tenantId), disc) && new Set(disc).size === disc.length, { attempted: c.tenants.attempted, discovered: c.tenants.discovered });
  add("I03_tenants_succeeded_plus_failed_eq_attempted", c.tenants.succeeded + c.tenants.failed === c.tenants.attempted);
  add("I04_no_tenant_failed", c.tenants.failed === 0, { failed: c.tenants.failed });
  const expectedBiz = T.flatMap((t) => t.businessIds.map((b) => t.tenantId + "\u0000" + b));
  const seenBiz = B.map((b) => b.tenantId + "\u0000" + b.bizId);
  add("I05_one_business_record_per_discovered_business", same(seenBiz, expectedBiz) && new Set(seenBiz).size === seenBiz.length, { discovered: expectedBiz.length, records: seenBiz.length });
  add("I06_businesses_attempted_eq_discovered", c.businesses.attempted === c.businesses.discovered, { attempted: c.businesses.attempted, discovered: c.businesses.discovered });
  add("I07_businesses_readOk_plus_readFailed_eq_attempted", c.businesses.readOk + c.businesses.readFailed === c.businesses.attempted);
  add("I08_no_business_read_failed", c.businesses.readFailed === 0, { readFailed: c.businesses.readFailed });
  add("I09_classified_plus_classifierFailed_eq_readOk", c.businesses.classified + c.businesses.classifierFailed === c.businesses.readOk);
  add("I10_no_classifier_failure", c.businesses.classifierFailed === 0, { classifierFailed: c.businesses.classifierFailed });
  add("I11_rows_observed_eq_classified_plus_unclassifiable", c.rows.observed === c.rows.classified + c.rows.unclassifiable);
  const eqFailures = [];
  for (const b of B) for (const [name, ok] of businessEquations(b)) if (!ok) eqFailures.push(`${b.tenantId}/${b.bizId}: ${name}`);
  add("I12_per_business_exclusive_equations", eqFailures.length === 0, eqFailures.slice(0, 20));
  add("I13_counters_match_recomputation", same(report.counters, c));
  add("I14_aggregate_matches_recomputation", same(report.classification.aggregate, aggregateClassification(report)));
  add("I15_no_failures", report.failures.length === 0, { failures: report.failures.length });
  const id = report.environmentIdentity || {};
  const tool = report.tool || {};
  const identityOk = report.schemaVersion === EV1_COLLECTOR_SCHEMA && report.classifierVersion === REQUIRED_CLASSIFIER_VERSION
    && P.isRealDate(id.asOfBusinessDate) && typeof report.runId === "string"
    && (id.mode === "fixture"
      || (id.mode === "production" && id.project === P.EXPECTED_PRODUCTION.project && id.databaseUrl === P.EXPECTED_PRODUCTION.databaseUrl
        && tool.repoSha === tool.expectedCommit && tool.treeClean === true));
  add("I16_run_identity_consistent", identityOk);
  const rq = report.reads && Array.isArray(report.reads.requests) ? report.reads.requests : null;
  const rtdbKinds = new Set(["tenant_list", "tenant_keys", "business_registry", "entries"]);
  const readOnly = !!rq && rq.every((r) => (rtdbKinds.has(r.kind) && r.method === "GET") || (!rtdbKinds.has(r.kind) && r.method === "POST" && (r.kind === "oauth_token" || r.kind === "iam_test_permissions")));
  add("I17_transport_read_only", readOnly);
  const entriesReads = rq ? rq.filter((r) => r.kind === "entries").length : -1;
  add("I18_exactly_one_entries_read_per_business", entriesReads === c.businesses.attempted, { entriesReads, attempted: c.businesses.attempted });
  add("I19_scope_digest_matches", report.scope.scopeDigest === scopeDigest(report));
  // R1 (Codex P1): complete evidence requires ZERO unclassifiable rows, recomputed from the
  // per-business partitions AND from the classifier's own malformed-row counts (never from a
  // stored counter or boolean).
  const partitionUnclassifiable = B.reduce((a, b) => a + (b.rows ? n(b.rows.unclassifiable) : 0), 0);
  const classifierMalformed = B.reduce((a, b) => a + (b.classification.state === "CLASSIFIED" && b.classification.counts ? n(b.classification.counts.malformedRows) : 0), 0);
  add("I20_no_unclassifiable_rows", c.rows.unclassifiable === 0 && partitionUnclassifiable === 0 && classifierMalformed === 0, { unclassifiable: partitionUnclassifiable, classifierMalformedRows: classifierMalformed });
  return { invariants: inv, evidenceComplete: inv.every((i) => i.holds) };
}

export function summarizeRequests(requests) {
  const byKind = {};
  for (const r of requests) {
    const k = `${r.method} ${r.kind}`;
    byKind[k] = (byKind[k] || 0) + 1;
  }
  return { total: requests.length, byKind, requests: requests.map((r) => ({ method: r.method, kind: r.kind, status: r.status })) };
}

/** Assemble the report object for one run (then evaluated). */
export function buildReport({ runId, startedAt, completedAt, identity, tool, collected, requests }) {
  const report = {
    schemaVersion: EV1_COLLECTOR_SCHEMA,
    classifierVersion: EV1_CLASSIFIER_VERSION,
    runId, startedAt, completedAt,
    environmentIdentity: identity,
    tool,
    scope: { tenantEnumeration: collected.tenantEnumeration, businessEnumeration: { sources: ["tenants/<t>/app/business (registry)", "tenants/<t> shallow keys biz:<id>:*"], rule: "union per tenant; every member receives exactly one entries read" }, tenants: collected.tenants, businesses: collected.businesses },
    reads: summarizeRequests(requests),
    counters: null,
    classification: { overlapNote: "EV1/3 counter groups overlap unless marked exclusive; row-id lists are omitted (counts only)", aggregate: null, b1Signals: null },
    failures: collected.failures,
    invariants: null,
    evidenceComplete: false,
  };
  report.scope.scopeDigest = scopeDigest(report);
  report.counters = computeCounters(report);
  report.classification.aggregate = aggregateClassification(report);
  report.classification.b1Signals = b1Signals(report.classification.aggregate, report.counters);
  const ev = evaluateReport(report);
  report.invariants = ev.invariants;
  report.evidenceComplete = ev.evidenceComplete;
  return report;
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────
export function renderPreflight(report) {
  const id = report.environmentIdentity, t = report.tool;
  return [
    `# EV-1 collector — PRE_FLIGHT (${report.runId})`, "",
    `| item | value |`, `|---|---|`,
    `| mode | ${id.mode} |`, `| project | ${id.project} |`, `| database | ${id.databaseUrl || "fixture"} |`, `| as-of (Israel business date) | ${id.asOfBusinessDate} |`,
    `| credential | ${id.credential ? `service_account, project ${id.credential.projectId}, client-email sha256 prefix ${id.credential.clientEmailSha256Prefix}` : "none (fixture)"} |`,
    `| granted database permissions | ${(id.grantedPermissions || []).join(", ") || "n/a"} |`,
    `| checkout HEAD | ${t.repoSha} (clean: ${t.treeClean}) |`, `| approved commit | ${t.expectedCommit || "n/a (fixture)"} |`,
    `| classifier | ${report.classifierVersion} |`, "",
    "Source digests:", ...Object.entries(t.sourceDigests || {}).map(([f, d]) => `- \`${f}\` ${d}`), "",
    "Checks passed before any network activity: environment variables, project/database identity, credential file (regular, non-symlink, 0600, project-bound), as-of date, approved commit + clean tree (production), output directory (new, outside git).",
  ].join("\n");
}
export function renderSummary(report) {
  const c = report.counters, s = report.classification.b1Signals;
  const yes = (v) => (v ? "YES" : "NO");
  const lines = [
    `# EV-1 census summary (${report.runId})`, "",
    `**evidenceComplete: ${report.evidenceComplete}** · mode ${report.environmentIdentity.mode} · as-of ${report.environmentIdentity.asOfBusinessDate}`, "",
    "| question | answer |", "|---|---|",
    `| Did we inspect every registered business? | ${yes(c.businesses.attempted === c.businesses.discovered && c.tenants.failed === 0)} — ${c.businesses.attempted}/${c.businesses.discovered} discovered businesses attempted across ${c.tenants.attempted}/${c.tenants.discovered} tenants (${c.businesses.registered} registered, ${c.businesses.storedDataUnregistered} with stored data but unregistered) |`,
    `| Were all reads successful? | ${yes(c.businesses.readFailed === 0 && c.tenants.failed === 0 && report.scope.tenantEnumeration.ok)} — business read failures ${c.businesses.readFailed} (transport ${c.businesses.readFailedTransport}, structure ${c.businesses.structureBlocked}); tenant failures ${c.tenants.failed} |`,
    `| How many businesses were empty? | ${c.businesses.empty} (successful empty reads) |`,
    `| How many rows were observed? | ${c.rows.observed} |`,
    `| How many rows were classified? | ${c.rows.classified} |`,
    `| Did any rows remain unclassifiable? | ${c.rows.unclassifiable} (non-object rows, EV1/3 malformedRows) |`,
    `| Classifier failures | ${c.businesses.classifierFailed} |`, "",
    "## Legacy conditions B1 needs to know about (counts)", "",
    "| signal | value |", "|---|---|",
    ...Object.entries(s).flatMap(([grp, o]) => Object.entries(o).map(([k, v]) => `| ${grp}.${k} | ${v} |`)), "",
    "## Invariants", "",
    "| invariant | holds |", "|---|---|",
    ...report.invariants.map((i) => `| ${i.id} | ${i.holds ? "yes" : "**NO**"} |`), "",
    "## Failures", "",
    report.failures.length ? report.failures.map((f) => `- ${[f.scope, f.code, f.tenantId, f.bizId, f.status, f.reason, f.count].filter((x) => x !== undefined && x !== null).join(" · ")}`).join("\n") : "none", "",
    "PRODUCTION_WRITES: 0 · row contents, amounts, dates, names, notes and row ids are never recorded.",
  ];
  return lines.join("\n");
}

// ── bundle (private, exclusive, COMPLETE.json last) ─────────────────────────────────────────
export function secretScan(text, secrets = []) {
  const needles = ["private_key", "PRIVATE KEY", "access_token", "Authorization", "Bearer ", "client_email", ...secrets.filter((s) => typeof s === "string" && s.length >= 8)];
  return needles.filter((x) => text.includes(x));
}
export function writeBundle(outDir, report, { secrets = [] } = {}) {
  mkdirSync(outDir, { mode: 0o700 });
  chmodSync(outDir, 0o700);
  const texts = {
    "PRE_FLIGHT.md": renderPreflight(report) + "\n",
    "EV1_REPORT.json": JSON.stringify(report, null, 2) + "\n",
    "EV1_SUMMARY.md": renderSummary(report) + "\n",
  };
  const digests = {};
  for (const f of BUNDLE_FILES) {
    const leak = secretScan(texts[f], secrets);
    if (leak.length) throw Object.assign(new Error("report_would_leak_secret"), { code: "report_would_leak_secret", detail: f });
    const p = join(outDir, f);
    writeFileSync(p, texts[f], { flag: "wx", mode: 0o600 });
    chmodSync(p, 0o600);
    digests[f] = sha256(texts[f]);
  }
  const complete = {
    schemaVersion: EV1_COLLECTOR_SCHEMA, runId: report.runId, mode: report.environmentIdentity.mode, project: report.environmentIdentity.project,
    asOfBusinessDate: report.environmentIdentity.asOfBusinessDate, classifierVersion: report.classifierVersion, repoSha: report.tool.repoSha,
    sourceDigests: report.tool.sourceDigests, scopeDigest: report.scope.scopeDigest, evidenceComplete: report.evidenceComplete, files: digests,
    bundleManifest: BUNDLE_MANIFEST, writtenAt: new Date().toISOString(),
  };
  const cp = join(outDir, "COMPLETE.json");
  writeFileSync(cp, JSON.stringify(complete, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  chmodSync(cp, 0o600);
  return { outDir, files: [...BUNDLE_FILES, "COMPLETE.json"] };
}

/** A printable, bounded form of an unexpected directory-entry name (never its content). */
const entryLabel = (name) => JSON.stringify(name.replace(/[^\x21-\x7e]/g, "?").slice(0, 64)) + ` (length ${name.length})`;

/**
 * Post-run verification of a bundle. The bundle is CLOSED (R1, Codex P2): the directory must
 * be a real directory whose entries are exactly BUNDLE_MANIFEST, each a regular file (no
 * symlink/dir/other), COMPLETE.json must bind exactly BUNDLE_FILES by digest and declare the
 * same manifest, every file is secret-scanned, and completeness is RECOMPUTED from the report
 * (a stored `evidenceComplete` is never trusted).
 */
export function verifyBundle(dir, { platform = process.platform } = {}) {
  const problems = [];
  const fail = (p) => ({ ok: false, evidenceComplete: false, problems: [...problems, p] });
  let dst;
  try { dst = lstatSync(dir); } catch (e) { return fail("bundle directory missing or unreadable"); }
  if (dst.isSymbolicLink() || !dst.isDirectory()) return fail("bundle path is not a real directory");
  if (platform !== "win32" && (dst.mode & 0o777) !== 0o700) problems.push("bundle directory mode is not 0700");
  let entries;
  try { entries = readdirSync(dir); } catch (e) { return fail("bundle directory cannot be listed"); }
  // closure: actual entries == expected entries (exact byte-for-byte names, hidden entries included)
  if (new Set(entries).size !== entries.length) problems.push("ambiguous bundle listing (duplicate entry names)");
  const fold = (x) => x.normalize("NFKC").toLowerCase();
  for (const e of entries) {
    if (BUNDLE_MANIFEST.includes(e)) continue;
    problems.push(`unexpected bundle entry: ${entryLabel(e)}`);
    if (BUNDLE_MANIFEST.some((m) => fold(m) === fold(e))) problems.push(`ambiguous bundle entry resembles an expected file: ${entryLabel(e)}`);
  }
  const regular = new Set();
  for (const f of BUNDLE_MANIFEST) {
    if (!entries.includes(f)) { problems.push(`${f} missing`); continue; }
    let st;
    try { st = lstatSync(join(dir, f)); } catch (e) { problems.push(`${f} unreadable`); continue; }
    if (st.isSymbolicLink()) { problems.push(`${f} is a symlink`); continue; }
    if (!st.isFile()) { problems.push(`${f} is not a regular file`); continue; }
    if (platform !== "win32" && (st.mode & 0o777) !== 0o600) problems.push(`${f} mode is not 0600`);
    regular.add(f);
  }
  if (!regular.has("COMPLETE.json")) return fail("COMPLETE.json missing or not a regular file");
  const text = {};
  for (const f of regular) text[f] = readFileSync(join(dir, f));
  let complete, report;
  try { complete = JSON.parse(text["COMPLETE.json"].toString("utf8")); } catch (e) { return fail("COMPLETE.json unparseable"); }
  if (!isPlain(complete)) return fail("COMPLETE.json is not an object");
  if (!same(complete.bundleManifest, BUNDLE_MANIFEST)) problems.push("COMPLETE.json bundleManifest differs from the closed bundle manifest");
  const bound = isPlain(complete.files) ? Object.keys(complete.files).sort() : null;
  if (!same(bound, [...BUNDLE_FILES].sort())) problems.push("COMPLETE.json does not bind exactly the bundle files");
  for (const f of regular) {
    if (f !== "COMPLETE.json" && (!isPlain(complete.files) || complete.files[f] !== sha256(text[f]))) problems.push(`${f} digest mismatch`);
    if (secretScan(text[f].toString("utf8")).length) problems.push(`${f} contains secret-like text`);
  }
  if (regular.has("EV1_REPORT.json")) {
    try { report = JSON.parse(text["EV1_REPORT.json"].toString("utf8")); } catch (e) { problems.push("EV1_REPORT.json unparseable"); }
  }
  let evidenceComplete = false;
  if (isPlain(report)) {
    if (report.runId !== complete.runId) problems.push("runId mismatch between COMPLETE.json and EV1_REPORT.json");
    if (report.evidenceComplete !== complete.evidenceComplete) problems.push("evidenceComplete mismatch between COMPLETE.json and EV1_REPORT.json");
    for (const [k, a, b] of [["mode", complete.mode, report.environmentIdentity && report.environmentIdentity.mode], ["project", complete.project, report.environmentIdentity && report.environmentIdentity.project], ["asOfBusinessDate", complete.asOfBusinessDate, report.environmentIdentity && report.environmentIdentity.asOfBusinessDate], ["classifierVersion", complete.classifierVersion, report.classifierVersion], ["repoSha", complete.repoSha, report.tool && report.tool.repoSha], ["scopeDigest", complete.scopeDigest, report.scope && report.scope.scopeDigest]]) if (!same(a, b)) problems.push(`${k} mismatch between COMPLETE.json and EV1_REPORT.json`);
    if (!same(complete.sourceDigests, report.tool && report.tool.sourceDigests)) problems.push("sourceDigests mismatch between COMPLETE.json and EV1_REPORT.json");
    let ev = null;
    try { ev = evaluateReport(report); } catch (e) { problems.push("EV1_REPORT.json cannot be re-evaluated"); }
    if (ev) {
      if (!same(ev.invariants, report.invariants)) problems.push("recomputed invariants differ from the recorded invariants");
      if (report.evidenceComplete !== ev.evidenceComplete) problems.push("recorded evidenceComplete conflicts with the recomputed value");
      if (complete.evidenceComplete !== ev.evidenceComplete) problems.push("COMPLETE.json evidenceComplete conflicts with the recomputed value");
      evidenceComplete = ev.evidenceComplete;
    }
  } else if (report !== undefined) problems.push("EV1_REPORT.json is not an object");
  return { ok: problems.length === 0, evidenceComplete: problems.length === 0 && evidenceComplete, problems };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { flags._unexpected = a; continue; }
    const k = a.slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) flags[k] = true;
    else { flags[k] = v; i++; }
  }
  return flags;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { processEnv = process.env, fetchImpl = globalThis.fetch, nowMs = Date.now(), repoIdentityImpl = repoIdentity, platform = process.platform, log = (s) => console.log(s), logErr = (s) => console.error(s), classify } = deps;
  const flags = parseArgs(argv);
  if (flags.help || flags._unexpected || argv.length === 0) { log(USAGE); return EXIT.REFUSED; }
  if (typeof flags.verify === "string") {
    const v = verifyBundle(flags.verify, { platform });
    log(JSON.stringify({ status: v.ok && v.evidenceComplete ? "EV1_BUNDLE_VERIFIED_COMPLETE" : v.ok ? "EV1_BUNDLE_VERIFIED_INCOMPLETE" : "EV1_BUNDLE_INVALID", evidenceComplete: v.evidenceComplete, problems: v.problems }));
    return v.ok && v.evidenceComplete ? EXIT.COMPLETE : EXIT.INCOMPLETE;
  }
  const startedAt = new Date(nowMs).toISOString();
  const repo = repoIdentityImpl(ROOT);
  let pre;
  try {
    pre = flags.fixture !== undefined ? P.preflightFixture(flags, { processEnv, nowMs }) : P.preflightProduction(flags, { processEnv, repo, nowMs, platform });
  } catch (e) {
    logErr(JSON.stringify({ status: "EV1_PREFLIGHT_REFUSED", code: e && e.code ? e.code : "preflight_error", detail: e && e.detail !== undefined ? String(e.detail) : undefined }));
    return EXIT.REFUSED;
  }
  let transport, fixtureDigest = null;
  try {
    if (pre.mode === "fixture") {
      const text = readFileSync(flags.fixture, "utf8");
      fixtureDigest = sha256(text);
      const fx = JSON.parse(text);
      transport = createFixtureTransport(fx.tree || fx, fx.faults || {});
    } else {
      transport = await createRestTransport({ sa: pre.credential.sa, project: pre.project, databaseUrl: pre.databaseUrl, fetchImpl, nowMs });
    }
  } catch (e) {
    logErr(JSON.stringify({ status: e && e.code === "CREDENTIAL_SCOPE_TOO_BROAD" ? "CREDENTIAL_SCOPE_TOO_BROAD" : "EV1_TRANSPORT_REFUSED", code: e && e.code ? e.code : "transport_error", detail: e && e.detail !== undefined ? String(e.detail) : undefined }));
    return EXIT.TRANSPORT_REFUSED;
  }
  const collected = await collect({ transport, asOfBusinessDate: pre.asOfBusinessDate, ...(classify ? { classify } : {}) });
  const identity = {
    mode: pre.mode, project: pre.project, databaseUrl: pre.databaseUrl, databaseHost: pre.databaseHost, asOfBusinessDate: pre.asOfBusinessDate,
    credential: pre.credential ? pre.credential.safeIdentity : null, grantedPermissions: transport.identity.grantedPermissions, fixtureSha256: fixtureDigest,
  };
  const tool = { repoSha: repo.headSha, treeClean: repo.treeClean, expectedCommit: pre.expectedCommit, nodeVersion: process.version, sourceDigests: sourceDigests(ROOT) };
  const report = buildReport({ runId: randomUUID(), startedAt, completedAt: new Date().toISOString(), identity, tool, collected, requests: transport.requests });
  try {
    const secrets = pre.credential ? [pre.credential.sa.client_email, pre.credential.sa.private_key_id, pre.credential.sa.private_key] : [];
    writeBundle(pre.outDir, report, { secrets });
  } catch (e) {
    logErr(JSON.stringify({ status: "EV1_OUTPUT_FAILED", code: e && e.code ? e.code : "output_error", detail: e && e.detail !== undefined ? String(e.detail) : undefined }));
    return EXIT.OUTPUT_FAILED;
  }
  log(JSON.stringify({ status: report.evidenceComplete ? "EV1_EVIDENCE_COMPLETE" : "EV1_EVIDENCE_INCOMPLETE", evidenceComplete: report.evidenceComplete, runId: report.runId, mode: pre.mode, outDir: pre.outDir, counters: report.counters, failures: report.failures.length, productionWrites: 0 }));
  return report.evidenceComplete ? EXIT.COMPLETE : EXIT.INCOMPLETE;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().then((code) => { process.exitCode = code; });
