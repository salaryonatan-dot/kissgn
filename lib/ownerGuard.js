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
// The invariant protects owner-LEVEL principals. super_owner is a top-level admin
// (requireTenantAccess treats it >= owner) and self-service bootstrap creates a
// super_owner, so a tenant with only a super_owner must still count as having an
// owner-level principal. Protected set = { owner, super_owner }; minimum = 1.
export const OWNER_LEVEL_ROLES = new Set(["owner", "super_owner"]);
export function isOwnerLevel(role) { return OWNER_LEVEL_ROLES.has(role); }
export const MIN_OWNERS = 1;
export const ownerGuardPath = (tenantId) => `tenants/${tenantId}/access_meta/owner_guard`;
const OPS_KEEP = 25; // bound the idempotency ledger

/** An operation is owner-affecting iff it adds or removes an owner-level principal. */
export function isOwnerAffecting(prevRole, nextRole) {
  return isOwnerLevel(prevRole) !== isOwnerLevel(nextRole);
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
  if (isOwnerLevel(nextRole)) owners[targetUid] = true;                      // promotion adds owner-level
  if (isOwnerLevel(prevRole) && !isOwnerLevel(nextRole)) delete owners[targetUid]; // removal/downgrade

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
  if (isOwnerLevel(nextRole)) delete owners[targetUid];                     // undo add
  if (isOwnerLevel(prevRole) && !isOwnerLevel(nextRole)) owners[targetUid] = true; // undo removal
  const curVersion = (currentGuard && Number.isInteger(currentGuard.version)) ? currentGuard.version : 0;
  const ops = { ...(currentGuard && currentGuard.ops ? currentGuard.ops : {}) };
  if (opId) delete ops[opId];
  return { version: curVersion + 1, ownerUids: owners, updatedAt: now ?? 0, lastOpId: opId ? `${opId}:compensated` : null, ops, pending: null };
}

/** Owner uids from a trusted roles map (server read). Used for lazy seed + init tooling. */
export function ownersFromRolesMap(rolesMap) {
  const m = (rolesMap && typeof rolesMap === "object") ? rolesMap : {};
  return Object.entries(m).filter(([, r]) => isOwnerLevel(r)).map(([uid]) => uid);
}

// ─────────────────────────────────────────────────────────────────────────────
// DURABLE OWNER-OPERATION STATE MACHINE (shared by handleRoles + handleDeleteUser).
//
// Guard node fields (tenants/{tid}/access_meta/owner_guard):
//   version, ownerUids, updatedAt, lastOpId,
//   ops:     { opId: { sig, v, ts, phase:"mirrored" } }   // idempotency ledger
//   pending: { opId, sig, phase:"prepared", targetOwnerUids, targetVersion, kind, ts } | null
//
// Phases: prepared → mirrored (or → compensated/cleared). `ownerUids` only ADVANCES
// in the MIRROR step, which is ONE atomic root multi-path update that also writes
// roles/members/app_users/biz_access/audit. So a crash between PREPARE and MIRROR
// leaves `ownerUids` unchanged and `pending=prepared` — nothing is half-applied,
// and the same requestId RESUMES the mirror. A prepared op BLOCKS other owner ops.
// ─────────────────────────────────────────────────────────────────────────────

export const OP_PHASES = { PREPARED: "prepared", MIRRORED: "mirrored" };

/** Deterministic operation signature (includes kind so delete vs role-change differ). */
export function opSignatureV2({ kind, targetUid, prevRole, nextRole }) {
  return `${kind || "roles"}|${targetUid}|${prevRole ?? ""}->${nextRole === null ? "null" : nextRole}`;
}

function applyOwnerChange(ownerUids, targetUid, prevRole, nextRole) {
  const owners = { ...(ownerUids || {}) };
  if (isOwnerLevel(nextRole)) owners[targetUid] = true;
  if (isOwnerLevel(prevRole) && !isOwnerLevel(nextRole)) delete owners[targetUid];
  return owners;
}

/**
 * PREPARE transaction body. Returns a decision the caller maps to the RTDB
 * transaction return value:
 *   commit    → return `value` (records prepared pending)
 *   resume    → return undefined/ABORT; caller re-runs the MIRROR (pending matches)
 *   idempotent→ return undefined/ABORT; caller returns success (already mirrored)
 *   reject    → return undefined/ABORT; caller returns the mapped error `code`
 */
export function guardPrepare(currentGuard, op) {
  const g = currentGuard || null;
  const sig = op.sig || opSignatureV2(op);
  const { targetUid, prevRole, nextRole, opId, expectedVersion, seedOwnerUids, now } = op;

  if (g && g.pending) {
    if (g.pending.opId === opId) {
      if (g.pending.sig !== sig) return { decision: "reject", code: "opId_conflict", reason: "requestId reused with a different payload" };
      return { decision: "resume", value: g }; // same prepared op → resume mirror
    }
    return { decision: "reject", code: "owner_op_pending", reason: "another owner operation is in progress" };
  }
  if (opId && g && g.ops && g.ops[opId]) {
    if (g.ops[opId].sig !== sig) return { decision: "reject", code: "opId_conflict", reason: "requestId reused with a different payload" };
    return { decision: "idempotent", value: g };
  }

  const curVersion = (g && Number.isInteger(g.version)) ? g.version : 0;
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== curVersion) {
    return { decision: "reject", code: "stale_version", reason: `expected version ${expectedVersion}, current ${curVersion}` };
  }

  let curOwners;
  if (g && g.ownerUids && typeof g.ownerUids === "object") curOwners = g.ownerUids;
  else { curOwners = {}; for (const u of (seedOwnerUids || [])) curOwners[u] = true; }
  const nextOwners = applyOwnerChange(curOwners, targetUid, prevRole, nextRole);
  if (Object.keys(nextOwners).length < MIN_OWNERS) {
    return { decision: "reject", code: "last_owner", reason: "cannot remove or downgrade the last owner" };
  }

  return {
    decision: "commit",
    value: {
      version: curVersion,                 // NOT bumped until MIRROR finalizes
      ownerUids: curOwners,                // unchanged until MIRROR finalizes
      updatedAt: now ?? 0,
      lastOpId: (g && g.lastOpId) || null,
      ops: (g && g.ops) ? g.ops : {},
      pending: { opId, sig, phase: OP_PHASES.PREPARED, targetOwnerUids: nextOwners, targetVersion: curVersion + 1, kind: op.kind || "roles", ts: now ?? 0 },
    },
  };
}

/**
 * MIRROR finalize fields — child paths under owner_guard, merged into the SAME
 * atomic root multi-path update as roles/members/app_users/biz_access/audit.
 * Advances ownerUids + version, records ops[opId]=mirrored, clears pending, and
 * trims the ops ledger. Requires the guard to be `prepared` for this opId.
 */
export function guardMirrorFields(tenantId, op, preparedGuard) {
  const base = `tenants/${tenantId}/access_meta/owner_guard`;
  const pend = preparedGuard && preparedGuard.pending;
  if (!pend || pend.opId !== op.opId) throw { status: 500, msg: "guard not prepared for this op" };
  const sig = op.sig || opSignatureV2(op);
  const fields = {
    [`${base}/ownerUids`]: pend.targetOwnerUids,
    [`${base}/version`]: pend.targetVersion,
    [`${base}/updatedAt`]: op.now ?? 0,
    [`${base}/lastOpId`]: op.opId,
    [`${base}/ops/${op.opId}`]: { sig, v: pend.targetVersion, ts: op.now ?? 0, phase: OP_PHASES.MIRRORED },
    [`${base}/pending`]: null,
  };
  // Trim the oldest ops beyond the ledger cap (leave room for the new one).
  const ops = (preparedGuard.ops && typeof preparedGuard.ops === "object") ? preparedGuard.ops : {};
  const sorted = Object.entries(ops).sort((a, b) => (a[1].v || 0) - (b[1].v || 0));
  const excess = sorted.length - (OPS_KEEP - 1);
  for (let i = 0; i < excess; i++) fields[`${base}/ops/${sorted[i][0]}`] = null;
  return fields;
}

/** COMPENSATE transaction body — clear a prepared pending we own (ownerUids never advanced, so nothing to restore). */
export function guardCompensateClearPending(currentGuard, op) {
  const g = currentGuard || {};
  if (!g.pending || g.pending.opId !== op.opId) return g === currentGuard ? g : { ...g };
  return { ...g, pending: null, updatedAt: op.now ?? g.updatedAt };
}

/** Inspect an op's durable status: "mirrored" | "prepared" | "none". */
export function inspectOwnerOp(currentGuard, opId) {
  const g = currentGuard || {};
  if (g.pending && g.pending.opId === opId) return "prepared";
  if (g.ops && g.ops[opId]) return "mirrored";
  return "none";
}
