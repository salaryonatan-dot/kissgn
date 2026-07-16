// PURE biz_access classification model (no Firebase, no network). Mirrors the
// canonical app/users / app/business shapes and lib/bizAccess.js semantics.
//
// app/users:    { _v: "<JSON array>" } | "<JSON array>" | array   -> array of records
//   record:     { firebaseUid|uid, email, role, allowedBizIds?[] }
// app/business: { _v: "<JSON array>" } | "<JSON array>" | array   -> array of {id,name}
//   business id is `item.id` (a string) -- NEVER the array index.
//
// Fail-closed: malformed source data can never be classified READY.

import { makeRedactor } from "./redact.mjs";

export const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
export const VALID_ROLES = new Set(["owner", "super_owner", "manager", "shift_manager", "viewer"]);
export const isImplicitAllRole = (r) => r === "owner" || r === "super_owner";

// Canonical parse: {_v} | string | array -> array. Fail-closed on anything else.
export function parseCanonicalArray(raw) {
  if (raw == null) return { ok: true, list: [] };
  if (Array.isArray(raw)) return { ok: true, list: raw };
  let json = null;
  if (raw && typeof raw === "object" && typeof raw._v === "string") json = raw._v;
  else if (typeof raw === "string") json = raw;
  else return { ok: false, malformed: true, reason: "unexpected shape (not {_v}|string|array)" };
  let parsed;
  try { parsed = JSON.parse(json); } catch { return { ok: false, malformed: true, reason: "_v is not valid JSON" }; }
  if (!Array.isArray(parsed)) return { ok: false, malformed: true, reason: "_v is not a JSON array" };
  return { ok: true, list: parsed };
}

export function parseAppUsers(raw) { return parseCanonicalArray(raw); }

// app/business -> { ok, businesses:Set<id>, duplicates:Set<id>, missingIdCount, malformed }
export function parseAppBusiness(raw) {
  const p = parseCanonicalArray(raw);
  if (!p.ok) return { ok: false, malformed: true, reason: p.reason, businesses: new Set(), duplicates: new Set(), missingIdCount: 0 };
  const businesses = new Set();
  const duplicates = new Set();
  let missingIdCount = 0;
  p.list.forEach((item) => {
    // Reject array indexes as ids: the id MUST come from item.id (a non-empty string).
    const id = item && typeof item === "object" ? item.id : undefined;
    if (typeof id !== "string" || id.trim() === "" || RTDB_FORBIDDEN.test(id)) { missingIdCount++; return; }
    const clean = id.trim();
    if (businesses.has(clean)) duplicates.add(clean);
    businesses.add(clean);
  });
  return { ok: true, businesses, duplicates, missingIdCount, malformed: false };
}

export function normalizeAllowedBizIds(allowed) {
  if (!Array.isArray(allowed)) return { ok: false, reason: "allowedBizIds must be an array" };
  const out = []; const seen = new Set();
  for (const raw of allowed) {
    if (typeof raw !== "string") return { ok: false, reason: "allowedBizIds entries must be strings" };
    const id = raw.trim();
    if (!id) continue;
    if (id.length > 128 || RTDB_FORBIDDEN.test(id)) return { ok: false, reason: "invalid bizId in allowedBizIds" };
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return { ok: true, ids: out };
}

const userUid = (u) => (u && typeof u === "object") ? (u.firebaseUid || u.uid || null) : null;

// input: { tenantId, members:{uid:true}, roles:{uid:role}, bizAccess:{biz:{uid:true}},
//          appUsersRaw, appBusinessRaw, dataKeyBizIds:[], salt }
export function classifyBizAccess(input) {
  const { tenantId, members = {}, roles = {}, bizAccess = {}, appUsersRaw = null, appBusinessRaw = null, dataKeyBizIds = [], salt } = input;
  const redact = makeRedactor(salt);
  const tenantRef = redact("tenant", tenantId);

  const cats = { READY: 0, NEEDS_BACKFILL: 0, AMBIGUOUS_MAPPING: 0, ORPHANED_ACCESS: 0, INVALID_ROLE: 0, UNKNOWN_BUSINESS: 0, MISSING_MEMBERSHIP: 0 };
  const findings = [];
  const proposedGrants = [];
  const add = (category, extra) => { cats[category]++; findings.push({ category, tenantRef, ...extra }); };

  const biz = parseAppBusiness(appBusinessRaw);
  const registry = biz.businesses;
  const businessUniverse = new Set([...registry, ...Object.keys(bizAccess), ...dataKeyBizIds]);
  const inRegistry = (b) => registry.has(b);
  if (!biz.ok) add("AMBIGUOUS_MAPPING", { subject: "app/business", note: "malformed business registry: " + biz.reason, malformed: true });
  for (const d of biz.duplicates) add("AMBIGUOUS_MAPPING", { subject: "app/business", businessRef: redact("biz", d), note: "duplicate business id in registry" });
  if (biz.missingIdCount > 0) add("AMBIGUOUS_MAPPING", { subject: "app/business", note: biz.missingIdCount + " business record(s) with missing/invalid id (array index is NOT an id)" });

  const usersParsed = parseAppUsers(appUsersRaw);
  const appUsersMalformed = !usersParsed.ok;
  const userByUid = new Map();
  const dupUids = new Set();
  if (appUsersMalformed) {
    add("AMBIGUOUS_MAPPING", { subject: "app/users", note: "malformed app/users: " + usersParsed.reason, malformed: true });
  } else {
    usersParsed.list.forEach((rec, index) => {
      const uid = userUid(rec);
      if (!uid) { add("AMBIGUOUS_MAPPING", { subject: "app/users", appUsersIndex: index, note: "user record missing firebaseUid/uid" }); return; }
      if (userByUid.has(uid)) dupUids.add(uid);
      else userByUid.set(uid, { record: rec, index });
    });
    for (const uid of dupUids) add("AMBIGUOUS_MAPPING", { subject: "app/users", userRef: redact("uid", uid), note: "duplicate app/users record for uid" });
  }

  const allUids = new Set([...Object.keys(members), ...Object.keys(roles), ...userByUid.keys()]);

  for (const uid of allUids) {
    const userRef = redact("uid", uid);
    const role = roles[uid];
    const isMember = members[uid] === true;
    const entry = userByUid.get(uid);
    const idx = entry ? entry.index : null;

    if (!VALID_ROLES.has(role)) { add("INVALID_ROLE", { userRef, appUsersIndex: idx, role: role ?? null }); continue; }
    if (!isMember) { add("MISSING_MEMBERSHIP", { userRef, appUsersIndex: idx, role }); continue; }

    if (isImplicitAllRole(role)) {
      // Actual Rules: owner/super_owner have implicit all-business scope and hold
      // NO biz_access entries. Do NOT read allowedBizIds for them.
      add("READY", { userRef, appUsersIndex: idx, role, scope: "implicit-all" });
      continue;
    }

    if (appUsersMalformed || dupUids.has(uid) || !entry) {
      add("AMBIGUOUS_MAPPING", { userRef, appUsersIndex: idx, role, note: !entry ? "scoped member has role but no app/users record (cannot determine allowedBizIds)" : "app/users unusable for this uid" });
      continue;
    }
    const norm = normalizeAllowedBizIds(entry.record.allowedBizIds ?? []);
    if (!norm.ok) { add("AMBIGUOUS_MAPPING", { userRef, appUsersIndex: idx, role, note: "invalid allowedBizIds: " + norm.reason }); continue; }
    if (norm.ids.length === 0) { add("AMBIGUOUS_MAPPING", { userRef, appUsersIndex: idx, role, note: "scoped role with empty allowedBizIds (no business assigned)" }); continue; }
    for (const b of norm.ids) {
      const businessRef = redact("biz", b);
      if (!inRegistry(b)) { add("UNKNOWN_BUSINESS", { userRef, businessRef, appUsersIndex: idx, role, note: "allowedBizId not in business registry" }); continue; }
      const hasGrant = bizAccess[b]?.[uid] === true;
      if (hasGrant) add("READY", { userRef, businessRef, appUsersIndex: idx, role });
      else {
        add("NEEDS_BACKFILL", { userRef, businessRef, appUsersIndex: idx, role, note: "scoped user assigned business but missing biz_access grant" });
        proposedGrants.push({ tenantRef, businessRef, userRef, appUsersIndex: idx, role, grant: true, additiveOnly: true, reason: "member+role with allowedBizId but no biz_access entry" });
      }
    }
  }

  for (const [b, grants] of Object.entries(bizAccess)) {
    for (const [uid, val] of Object.entries(grants || {})) {
      if (val !== true) continue;
      const userRef = redact("uid", uid); const businessRef = redact("biz", b);
      if (!inRegistry(b)) { add("UNKNOWN_BUSINESS", { userRef, businessRef, note: "biz_access grant to business absent from registry" }); continue; }
      if (members[uid] !== true) { add("ORPHANED_ACCESS", { userRef, businessRef, note: "biz_access grant without membership" }); continue; }
      if (isImplicitAllRole(roles[uid])) add("AMBIGUOUS_MAPPING", { userRef, businessRef, role: roles[uid], note: "owner/super_owner has explicit biz_access entry (implicit-all role should have none)" });
    }
  }

  const attention = cats.NEEDS_BACKFILL + cats.AMBIGUOUS_MAPPING + cats.ORPHANED_ACCESS + cats.INVALID_ROLE + cats.UNKNOWN_BUSINESS + cats.MISSING_MEMBERSHIP;
  return {
    tenantRef,
    businessesDiscovered: businessUniverse.size,
    registrySize: registry.size,
    usersDiscovered: allUids.size,
    categories: cats,
    findings,
    proposedGrants,
    malformed: !!(appUsersMalformed || !biz.ok),
    needsAttention: attention > 0,
  };
}
