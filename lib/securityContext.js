// lib/securityContext.js — shared request security primitives (PR #2A).
//
// Design notes:
//   • TOP-LEVEL imports are firebase-free (only ./bizAccess.js pure helpers and
//     node:crypto), so this module can be imported in unit tests WITHOUT
//     firebase-admin installed. The real firebase-backed primitives
//     (requireAuth / requireTenantAccess / getAdminDb) are pulled via LAZY
//     dynamic import only on the production path; tests inject fakes via `deps`.
//   • Every failure throws { status, msg }. Nothing returns a partial context.
//   • The Admin SDK is used deliberately for biz_access (RTDB Rules are
//     bypassed), so these server checks ARE the authorization boundary.

import { isImplicitAllRole, RTDB_FORBIDDEN } from "./bizAccess.js";
import { timingSafeEqual } from "node:crypto";

// ── Explicit endpoint role policy (PR #2A req #4) — do NOT rely on a generic
//    minRole hierarchy alone; the final decision uses these exact sets. ──
// PRIVATE role sets — used for has() checks only; never exported (a Set is
// mutable even when frozen: Object.freeze does not stop Set.add/delete). External
// code must not be able to add/remove/clear an allowed role.
const READ_ROLE_SET  = new Set(["viewer", "shift_manager", "manager", "owner", "super_owner"]);
const WRITE_ROLE_SET = new Set(["manager", "owner", "super_owner"]);
// Public, IMMUTABLE views (frozen arrays — push/splice/index-assign throw in the
// module's strict-mode context). For assertions/introspection only.
export const READ_ROLES  = Object.freeze([...READ_ROLE_SET]);
export const WRITE_ROLES = Object.freeze([...WRITE_ROLE_SET]);
// Primitive floor handed to requireTenantAccess (membership + hierarchy); the
// explicit set above is still the authoritative gate afterwards.
const TENANT_FLOOR = Object.freeze({ read: "viewer", write: "manager" });

const MAX_ID_LEN = 128;
export function isValidId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN && !RTDB_FORBIDDEN.test(v);
}

function headerValue(req, name) {
  const h = req && req.headers;
  if (!h) return undefined;
  if (typeof h.get === "function") return h.get(name) ?? undefined;
  return h[name] ?? h[name.toLowerCase?.() ?? name] ?? undefined;
}

// Constant-time string compare with a length guard (never throws on mismatch).
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * requireCron — authorize a cron invocation.
 * Accepts ONLY `Authorization: Bearer ${CRON_SECRET}`.
 *   • fail-closed when CRON_SECRET is missing/empty;
 *   • x-vercel-cron is NOT accepted as authorization (ignored entirely);
 *   • a Firebase user token is rejected (it never equals CRON_SECRET);
 *   • constant-time secret comparison; deterministic 401 on any failure.
 * @param {{headers:unknown}} req
 * @param {{cronSecret?:string}} [opts] test seam; defaults to process.env.CRON_SECRET
 * @returns {true}
 * @throws {{status:number,msg:string}} 401 on any failure
 */
export function requireCron(req, opts = {}) {
  const secret = Object.prototype.hasOwnProperty.call(opts, "cronSecret")
    ? opts.cronSecret
    : process.env.CRON_SECRET;
  if (typeof secret !== "string" || secret.length === 0) throw { status: 401, msg: "unauthorized" };
  const auth = headerValue(req, "authorization");
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) throw { status: 401, msg: "unauthorized" };
  if (!safeEqual(auth.slice(7), secret)) throw { status: 401, msg: "unauthorized" };
  return true;
}

/**
 * Fail-closed business-access check (Admin SDK; RTDB Rules bypassed).
 * owner/super_owner ⇒ implicit all-business; otherwise an explicit
 * tenants/{tid}/biz_access/{bizId}/{uid} === true grant is required.
 * @throws {{status:number,msg:string}} 403 denied, 503 on lookup error
 */
export async function requireBizAccess(db, tenantId, bizId, uid, role) {
  if (isImplicitAllRole(role)) return true;
  let val;
  try {
    const snap = await db.ref(`tenants/${tenantId}/biz_access/${bizId}/${uid}`).get();
    val = snap.val();
  } catch (e) {
    console.error("[securityContext] biz_access lookup failed:", e?.message ?? "unknown");
    throw { status: 503, msg: "authorization check unavailable" };
  }
  if (val === true) return true;
  throw { status: 403, msg: "business_access_denied" };
}

// Lazy production deps (only loaded when no test fake is injected).
async function realRequireAuth(req) { const m = await import("./verifyToken.js"); return m.requireAuth(req); }
async function realRequireTenantAccess(uid, tenantId, minRole) { const m = await import("./helpers.js"); return m.requireTenantAccess(uid, tenantId, minRole); }
async function realGetDb() { const m = await import("./adminSdk.js"); return m.getAdminDb(); }

/**
 * requireBizContext — fail-closed authenticated, tenant- and business-scoped
 * context. Layers, in order: verified identity → id validation → tenant
 * membership+role → EXPLICIT allowed-role check → business access. Business
 * repositories must not run before this resolves.
 *
 * @param {{headers:unknown}} req
 * @param {{tenantId:string,bizId:string,mode:"read"|"write"}} opts
 * @param {{requireAuth?:Function,requireTenantAccess?:Function,getDb?:Function}} [deps] test seam
 * @returns {Promise<{uid:string,email:string|null,tenantId:string,bizId:string,role:string,db:unknown}>}
 * @throws {{status:number,msg:string}}
 */
export async function requireBizContext(req, opts, deps = {}) {
  const { tenantId, bizId, mode } = opts || {};
  if (mode !== "read" && mode !== "write") throw { status: 400, msg: "invalid mode" };
  const allowedRoles = mode === "write" ? WRITE_ROLE_SET : READ_ROLE_SET;
  const floor = TENANT_FLOOR[mode];

  const requireAuthFn = deps.requireAuth || realRequireAuth;
  const requireTenantAccessFn = deps.requireTenantAccess || realRequireTenantAccess;
  const getDbFn = deps.getDb || realGetDb;

  // 1) Authenticated Firebase identity (verified token, checkRevoked).
  let user;
  try {
    user = await requireAuthFn(req);
  } catch (e) {
    throw { status: 401, msg: "unauthorized" };
  }
  if (!user || typeof user.uid !== "string") throw { status: 401, msg: "unauthorized" };

  // 2) Validate UNTRUSTED ids before any DB path construction.
  if (!isValidId(tenantId)) throw { status: 400, msg: "invalid tenantId" };
  if (!isValidId(bizId))    throw { status: 400, msg: "invalid bizId" };

  // 3) Tenant membership + role (primitive floor), then EXPLICIT allowed-role
  //    decision. Unknown/disallowed roles fail closed.
  const role = await requireTenantAccessFn(user.uid, tenantId, floor);
  if (typeof role !== "string" || !allowedRoles.has(role)) throw { status: 403, msg: "role_not_allowed" };

  // 4) Business access (fail-closed; Admin SDK, Rules bypassed).
  const db = await getDbFn();
  await requireBizAccess(db, tenantId, bizId, user.uid, role);

  return { uid: user.uid, email: user.email ?? null, tenantId, bizId, role, db };
}
