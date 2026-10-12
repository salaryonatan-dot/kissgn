// Marjin business registry — THE target-scoped membership predicate (M1 R1, pending independent review).
//
// One rule, shared by every server consumer that authorizes a request for ONE business of a tenant:
//   * Core cost history (lib/finance/costHistoryWriter.js requireBusinessInTenant: activation, edits, reads,
//     recovery, owner decisions, reconciliation — and therefore api/cost-history.js);
//   * P1 supplier credits (api/admin.js scRequireRegisteredBusiness: list, create, void, replace, decide,
//     reconcile).
// Tenant membership, role and biz_access are checked separately by each consumer; this predicate only answers
// "is THIS business registered in THIS tenant", from tenants/{t}/app/business. It never widens authority: it can
// only refuse.
//
// Runtime representation (every runtime writer — admin create-client / bootstrap, the page setup writer through
// window.storage, the canary seeding — writes this and only this): the RTDB node `{ _v: "<JSON array>" }`, each
// element a record `{ id: "<business id>", name, … }`. The business id is `record.id`, a STRING, never an array
// index and never a coerced number / null / undefined.
//
// Classification for the requested business `bizId` (the caller has already validated the request ids):
//   registered      exactly ONE record whose `id` is the string `bizId` (strict equality), and no OTHER element
//                   whose identity collides with `bizId` (below).
//   not_registered  no element denotes `bizId` at all — a definitive "business not in tenant".
//   ambiguous       the registry cannot establish the requested business's identity uniquely: the canonical
//                   record is duplicated, OR some non-canonical element collides with `bizId` — a RECORD whose id is
//                   a non-string / null / missing value whose String() coercion (the coercion both previous runtime
//                   validators applied to record ids) equals `bizId`, a bare string / number / boolean whose String()
//                   equals `bizId`, or a string id that equals `bizId` only after trimming (the canonical audit model
//                   trims). Fail closed, NOT definitive.
//                   A bare `null` element (and an array element) carries NO identity: it is not a record, and no
//                   previous validator ever read an identity from it (Core required a record; P1 refused the whole
//                   registry). It is an unrelated defect for EVERY requested id — including the literal id "null":
//                   `[{id:"null"}, null]` is registered, `[{id:"null"}, {id:null}]` is ambiguous (M1 R2, review P3).
//   unreadable      the registry container itself cannot be interpreted: absent node, not `{ _v: string }`,
//                   invalid JSON, or not a JSON array. Fail closed, NOT definitive.
//   unavailable     the registry read itself failed (transport / permission). Fail closed, NOT definitive.
// A defect confined to an UNRELATED element — a malformed, unsafe, non-addressable or duplicated record whose
// identity does not collide with `bizId` — does not affect the requested business: it is counted in
// `unrelatedDefects` (diagnostic only) and never makes a uniquely registered business unavailable. The same
// per-element tolerance is what server discovery already applies (src/snapshot/snapshotBuilder.ts,
// src/analytics/dailyBuilder.ts skip malformed app/business entries without hiding valid businesses).
//
// The requested id must be addressable in BOTH per-business keys (`biz:{b}:cost_history`,
// `biz:{b}:supplier_credits`): a valid RTDB id that contains no ":" — the P1 rule, now shared, so a business is
// either servable by both consumers or by neither.

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
// D-CTRL (owner decision 2026-10-09; M1 D-CTRL shared-predicate layer): U+0000–U+001F and U+007F are refused by the shared
// business predicate exactly as by lib/securityContext.js isValidId — refused, never trimmed, replaced or aliased.
const RTDB_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_ID_LEN = 128;

/** A requested business id that both per-business node keys can address. */
export function isRegistryBizId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN && !RTDB_FORBIDDEN.test(v) && !v.includes(":") && !RTDB_CONTROL_CHARS.test(v);
}

const isRecord = (e) => e !== null && typeof e === "object" && !Array.isArray(e);

/** Decode the runtime registry node into its element array (or the reason it cannot be interpreted). */
export function decodeRegistryNode(raw) {
  if (raw === null || raw === undefined) return { ok: false, reason: "registry_absent" };
  if (!isRecord(raw) || typeof raw._v !== "string") return { ok: false, reason: "registry_shape" };
  let list;
  try { list = JSON.parse(raw._v); } catch { return { ok: false, reason: "registry_json" }; }
  if (!Array.isArray(list)) return { ok: false, reason: "registry_not_array" };
  return { ok: true, list };
}

/** Pure classification of the requested business against a raw registry node value. */
export function classifyRegistryTarget(raw, bizId) {
  if (!isRegistryBizId(bizId)) return { state: "invalid_request" };
  const d = decodeRegistryNode(raw);
  if (!d.ok) return { state: "unreadable", reason: d.reason };
  let canonical = 0, collisions = 0, unrelatedDefects = 0;
  const seen = new Set();
  for (const e of d.list) {
    const id = isRecord(e) ? e.id : (typeof e === "string" || typeof e === "number" || typeof e === "boolean") ? e : undefined;
    const identifiable = isRecord(e) || id !== undefined;
    if (isRecord(e) && typeof id === "string" && id === bizId) { canonical += 1; continue; }
    if (identifiable && String(id).trim() === bizId.trim()) { collisions += 1; continue; }
    // an element that cannot denote the requested business: count its defects, never act on them
    if (!isRecord(e) || !isRegistryBizId(id) || seen.has(id)) unrelatedDefects += 1;
    if (typeof id === "string") seen.add(id);
  }
  if (canonical > 1) return { state: "ambiguous", reason: "duplicate_target", unrelatedDefects };
  if (collisions > 0) return { state: "ambiguous", reason: "noncanonical_target_identity", unrelatedDefects };
  if (canonical === 1) return { state: "registered", unrelatedDefects };
  return { state: "not_registered", unrelatedDefects };
}

/**
 * M1 R2 — the classification plus, ONLY when the requested business is registered, its one record. For any other state
 * `record` is null: a consumer that needs the business's settings (e.g. the analytics rebuild's inactive flag) never picks
 * a first match among duplicates, and never reads settings from a registry that cannot establish the identity.
 */
export function resolveRegistryTarget(raw, bizId) {
  const c = classifyRegistryTarget(raw, bizId);
  if (c.state !== "registered") return { ...c, record: null };
  const records = decodeRegistryNode(raw).list.filter((e) => isRecord(e) && e.id === bizId);
  return { ...c, record: records.length === 1 ? records[0] : null };
}

/** D-CTRL (I4): the tenant key carries a control character as the path template would interpolate it (arrays: their elements). */
function tenantKeyCarriesControlChar(v) {
  if (typeof v === "string") return RTDB_CONTROL_CHARS.test(v);
  if (v === null || typeof v !== "object") return false;
  try { return RTDB_CONTROL_CHARS.test(String(v)); } catch { return false; }
}

/** Read tenants/{tenantId}/app/business through `db` (Admin SDK shape: ref(path).get() → snapshot.val()) and classify. */
export async function readRegistryTarget(db, tenantId, bizId) {
  if (!isRegistryBizId(bizId)) return { state: "invalid_request" };
  // D-CTRL (I4): a tenant key carrying a control character is an invalid request — refused before any reference, never reported
  // as an availability failure. Only these characters: every other tenant value keeps its classification (the tenant slot's
  // own rule, which permits ":", is the caller's isValidId).
  if (tenantKeyCarriesControlChar(tenantId)) return { state: "invalid_request" };
  let raw;
  try { raw = (await db.ref(`tenants/${tenantId}/app/business`).get()).val(); }
  catch { return { state: "unavailable", reason: "read_failed" }; }
  return classifyRegistryTarget(raw, bizId);
}
