// ─────────────────────────────────────────────────────────────────────────────
// biz_access — server-managed per-business authorization index.
//
// Canonical path:  tenants/{tenantId}/biz_access/{bizId}/{uid} = true
//
//   true    → the scoped user may access that biz inside the tenant
//   absent  → no access (fail-closed)
//   owner / super_owner → implicit ALL-business; they get NO entries
//   manager / shift_manager / viewer → explicit entries per allowedBizIds
//   role controls capability; biz_access controls WHICH business.
//
// This module is PURE: it computes RTDB multi-path update fragments and never
// imports firebase-admin or touches the network. The trusted Admin SDK server
// flows in api/admin.js merge these fragments into their existing atomic
// `db.ref().update(updates)` batches. Clients must NEVER write biz_access
// (enforced by database.rules.json `.write: false`); the Admin SDK bypasses
// Rules and is the only normal writer.
// ─────────────────────────────────────────────────────────────────────────────

// RTDB-forbidden characters in a key segment.
export const RTDB_FORBIDDEN = /[.#$\[\]\/]/;

export function isImplicitAllRole(role) {
  return role === "owner" || role === "super_owner";
}

/**
 * Normalize a scoped allowedBizIds list into a clean, unique, validated array.
 * Rejects malformed input (fail-closed) rather than silently guessing.
 * @throws {{status:number,msg:string}}
 */
export function normalizeAllowedBizIds(allowed) {
  if (!Array.isArray(allowed)) throw { status: 400, msg: "allowedBizIds must be an array" };
  const out = [];
  const seen = new Set();
  for (const raw of allowed) {
    if (typeof raw !== "string") throw { status: 400, msg: "allowedBizIds entries must be strings" };
    const id = raw.trim();
    if (!id) continue; // skip blank entries
    if (id.length > 128 || RTDB_FORBIDDEN.test(id)) throw { status: 400, msg: "invalid bizId in allowedBizIds" };
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/** Build `= true` set updates for a scoped user across bizIds. */
export function bizAccessSetUpdates(tenantId, uid, bizIds) {
  const u = {};
  for (const bizId of bizIds) u[`tenants/${tenantId}/biz_access/${bizId}/${uid}`] = true;
  return u;
}

/** Diff prev→next: additions → true, removals → null. Unchanged → no key. */
export function bizAccessDiffUpdates(tenantId, uid, prevBizIds, nextBizIds) {
  const prev = new Set(prevBizIds || []);
  const next = new Set(nextBizIds || []);
  const u = {};
  for (const id of next) if (!prev.has(id)) u[`tenants/${tenantId}/biz_access/${id}/${uid}`] = true;
  for (const id of prev) if (!next.has(id)) u[`tenants/${tenantId}/biz_access/${id}/${uid}`] = null;
  return u;
}

/** Clear (null) all provided bizIds for a uid. */
export function bizAccessClearUpdates(tenantId, uid, bizIds) {
  const u = {};
  for (const bizId of bizIds) u[`tenants/${tenantId}/biz_access/${bizId}/${uid}`] = null;
  return u;
}

/**
 * Given a full `tenants/{tid}/biz_access` snapshot value, return the bizIds
 * where `uid` currently has an entry. Used to clear-all on delete / promotion.
 */
export function bizIdsForUid(bizAccessTree, uid) {
  const ids = [];
  if (bizAccessTree && typeof bizAccessTree === "object") {
    for (const [bizId, membersObj] of Object.entries(bizAccessTree)) {
      if (membersObj && typeof membersObj === "object" &&
          Object.prototype.hasOwnProperty.call(membersObj, uid) &&
          membersObj[uid] === true) {
        ids.push(bizId);
      }
    }
  }
  return ids;
}

/**
 * Parse a tenants/{tid}/app/users snapshot value into an array, using the SAME
 * canonical semantics as the server ({_v:"<json>"} | "<json>" | array).
 * @throws {{status:number,msg:string,malformed:true}} on malformed data — the
 *   caller must STOP rather than guess.
 */
export function parseAppUsers(raw) {
  if (raw == null) return [];
  let listJson = null;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && typeof raw._v === "string") listJson = raw._v;
  else if (typeof raw === "string") listJson = raw;
  else throw { status: 422, msg: "app/users has unexpected shape", malformed: true };
  let parsed;
  try { parsed = JSON.parse(listJson); }
  catch { throw { status: 422, msg: "app/users _v is not valid JSON", malformed: true }; }
  if (!Array.isArray(parsed)) throw { status: 422, msg: "app/users _v is not a JSON array", malformed: true };
  return parsed;
}
