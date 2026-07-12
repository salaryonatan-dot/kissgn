// ─────────────────────────────────────────────────────────────────────────────
// ownerGuard.js — concurrency-safe owner invariant for handleRoles.
//
// PROTECTED INVARIANT (preserved exactly from the prior implementation):
//   a tenant must always have AT LEAST ONE role === "owner".
//   super_owner is a distinct network-level super-privilege (see lib/helpers.js),
//   is NOT counted here, and cannot be set/removed via handleRoles (VALID_ROLES
//   excludes it) — so it does not participate in this count.
//
// WHY A GUARD NODE: a plain pre-read of `roles` is not concurrency-safe — two
// requests can both read a two-owner state and both remove an owner, leaving
// zero owners. The authoritative owner set lives at
//   tenants/{tid}/access_meta/owner_guard
// and is mutated ONLY inside a Firebase RTDB transaction. RTDB serializes
// transactions per node and RE-RUNS the update function against the latest
// committed value, so the invariant holds across concurrent requests and across
// multiple serverless instances (no process-local lock, no Redis).
//
// This module is PURE (no firebase-admin, no network). api/admin.js runs
// `guardTransition` inside `db.ref(path).transaction(...)`; tests drive it
// directly through a transaction simulator, exercising the REAL logic.
// ─────────────────────────────────────────────────────────────────────────────

export const OWNER_ROLE = "owner";
export const MIN_OWNERS = 1;
export const ownerGuardPath = (tenantId) => `tenants/${tenantId}/access_meta/owner_guard`;
const OPS_KEEP = 25; // bound the idempotency ledger

/** An operation is owner-affecting iff it adds or removes an owner-level principal. */
export function isOwnerAffecting(prevRole, nextRole) {
  return (prevRole === OWNER_ROLE) !== (nextRole === OWNER_ROLE);
}

/** Stable signature of an operation's payload — used to detect requestId reuse with a different payload. */
export function opSignature({ targetUid, prevRole, nextRole }) {
  return `${targetUid}|${prevRole ?? ""}->${nextRole === null ? "null" : nextRole}`;
}

/** Owners in the current guard, or a lazy seed (used ONLY when the guard is uninitialized). */
function ownerUidsFrom(guard, seedOwnerUids) {
  if (guard && guard.ownerUids && typeof guard.ownerUids === "object") return { ...guard.ownerUids };
  const seed = {};
  for (const uid of (seedOwnerUids || [])) seed[uid] = true;
  return seed;
}

function trimOps(ops) {
  const entries = Object.entries(ops);
  if (entries.length <= OPS_KEEP) return ops;
  entries.sort((a, b) => (a[1].v || 0) - (b[1].v || 0));
  return Object.fromEntries(entries.slice(entries.length - OPS_KEEP));
}

/**
 * PURE transaction update for an owner-affecting change.
 * @returns {{commit:boolean, value?:object, code?:string, reason?:string, idempotent?:boolean}}
 *   commit=true  → the caller returns `value` from the RTDB transaction (COMMIT).
 *   commit=false → the caller returns undefined (ABORT); `code`/`reason` explain why.
 *                  idempotent=true means this exact opId was already fully applied.
 */
export function guardTransition(currentGuard, op) {
  const { targetUid, prevRole, nextRole, seedOwnerUids, expectedVersion, opId, now } = op;
  const sig = opSignature({ targetUid, prevRole, nextRole });

  // A pending (un-reconciled) guard blocks further owner mutations.
  if (currentGuard && currentGuard.pending) {
    return { commit: false, code: "owner_guard_pending", reason: "owner guard pending reconciliation" };
  }

  // Idempotency by opId (client requestId). Re-application of the same op is a no-op;
  // reuse of the same opId with a different payload is rejected.
  if (opId && currentGuard && currentGuard.ops && currentGuard.ops[opId]) {
    if (currentGuard.ops[opId].sig !== sig) {
      return { commit: false, code: "opId_conflict", reason: "requestId reused with a different payload" };
    }
    return { commit: false, idempotent: true, code: "idempotent", reason: "already applied" };
  }

  // Optimistic concurrency (CAS) when the caller supplies expectedVersion.
  const curVersion = (currentGuard && Number.isInteger(currentGuard.version)) ? currentGuard.version : 0;
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== curVersion) {
    return { commit: false, code: "stale_version", reason: `expected version ${expectedVersion}, current ${curVersion}` };
  }

  const owners = ownerUidsFrom(currentGuard, seedOwnerUids);
  if (nextRole === OWNER_ROLE) owners[targetUid] = true;                    // promotion adds owner
  if (prevRole === OWNER_ROLE && nextRole !== OWNER_ROLE) delete owners[targetUid]; // removal/downgrade

  if (Object.keys(owners).length < MIN_OWNERS) {
    return { commit: false, code: "last_owner", reason: "cannot remove or downgrade the last owner" };
  }

  const nextVersion = curVersion + 1;
  const ops = trimOps({
    ...(currentGuard && currentGuard.ops ? currentGuard.ops : {}),
    ...(opId ? { [opId]: { sig, v: nextVersion, ts: now ?? 0 } } : {}),
  });
  return {
    commit: true,
    value: { version: nextVersion, ownerUids: owners, updatedAt: now ?? 0, lastOpId: opId ?? null, ops, pending: null },
  };
}

/**
 * PURE compensation — reverse the owner-membership change of a forward op whose
 * mirror write failed, and bump the version. Removes the opId from the ledger so
 * the request can be retried cleanly. Always commits (never aborts).
 */
export function guardCompensate(currentGuard, op) {
  const { targetUid, prevRole, nextRole, opId, now } = op;
  const owners = (currentGuard && currentGuard.ownerUids) ? { ...currentGuard.ownerUids } : {};
  if (nextRole === OWNER_ROLE) delete owners[targetUid];                    // undo add
  if (prevRole === OWNER_ROLE && nextRole !== OWNER_ROLE) owners[targetUid] = true; // undo removal
  const curVersion = (currentGuard && Number.isInteger(currentGuard.version)) ? currentGuard.version : 0;
  const ops = { ...(currentGuard && currentGuard.ops ? currentGuard.ops : {}) };
  if (opId) delete ops[opId];
  return { version: curVersion + 1, ownerUids: owners, updatedAt: now ?? 0, lastOpId: opId ? `${opId}:compensated` : null, ops, pending: null };
}

/** Owner uids from a trusted roles map (server read). Used for lazy seed + init tooling. */
export function ownersFromRolesMap(rolesMap) {
  const m = (rolesMap && typeof rolesMap === "object") ? rolesMap : {};
  return Object.entries(m).filter(([, r]) => r === OWNER_ROLE).map(([uid]) => uid);
}
