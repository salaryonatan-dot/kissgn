// lib/apiScope.js — pure request-scope extraction & dispatch (PR #2A).
//
// No firebase, no DB, no network. Deterministic input validation and branch
// classification so handlers fail closed BEFORE any repository/runner/DB call.
// Imports only pure helpers, so it is freely unit-testable.

import { RTDB_FORBIDDEN } from "./bizAccess.js";

const MAX_ID_LEN = 128;
export const ALLOWED_TIMEZONE = "Asia/Jerusalem";

// Scoped keys that identify tenant/business/dispatch — they must appear ONLY in
// the permitted request source (query XOR body), never the other.
const SCOPED_KEYS = ["tenantId", "bizId", "action", "config"];

export function validId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN && !RTDB_FORBIDDEN.test(v);
}

function container(req, which) {
  return (which === "query" ? req && req.query : req && req.body) || {};
}
function present(obj, k) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== "";
}

function sameKeys(keys, expected) {
  if (keys.length !== expected.length) return false;
  const s = new Set(keys);
  return expected.every((k) => s.has(k));
}
function err400(msg) { return { mode: "error", status: 400, msg }; }

/**
 * extractScope — take the required { tenantId, bizId } pair from exactly ONE
 * permitted source and reject any scoped key supplied in the other source
 * (ambiguity / source confusion). Both ids required and validated.
 * @param {object} req
 * @param {{source:"query"|"body"}} opts
 * @returns {{tenantId:string,bizId:string}}
 * @throws {{status:number,msg:string}} 400 on ambiguity / missing / invalid
 */
export function extractScope(req, { source }) {
  if (source !== "query" && source !== "body") throw { status: 500, msg: "bad source" };
  const otherName = source === "query" ? "body" : "query";
  const other = container(req, otherName);
  for (const k of SCOPED_KEYS) {
    if (present(other, k)) throw { status: 400, msg: `unexpected ${k} in ${otherName}` };
  }
  const src = container(req, source);
  const tenantId = src.tenantId;
  const bizId = src.bizId;
  if (!validId(tenantId) || !validId(bizId)) throw { status: 400, msg: "tenantId and bizId are required" };
  return { tenantId, bizId };
}

/**
 * classifyAlertsRequest — decide the alerts branch with NO repo/DB access.
 * Returns one of:
 *   { mode:"options" }
 *   { mode:"cron" }
 *   { mode:"read", read:"alerts"|"config" }
 *   { mode:"write", action:"run"|"config"|"dismiss" }
 *   { mode:"error", status, msg }
 * Rules: cron ONLY for a GET with an empty query (no identifiers, no config, no
 * stray params — arbitrary params never fall into cron). POST can never be cron.
 */
export function classifyAlertsRequest(req) {
  const method = req && req.method;
  if (method === "OPTIONS") return { mode: "options" };

  if (method === "GET") {
    const q = (req && req.query) || {};
    const keys = Object.keys(q);

    // Cron: EXACTLY zero query keys.
    if (keys.length === 0) return { mode: "cron" };

    // Alerts read: EXACTLY { tenantId, bizId }.
    if (sameKeys(keys, ["tenantId", "bizId"])) {
      if (!present(q, "tenantId") || !present(q, "bizId")) return err400("Missing tenantId or bizId");
      return { mode: "read", read: "alerts" };
    }

    // Config read: EXACTLY { tenantId, bizId, config }, config === "1".
    if (sameKeys(keys, ["tenantId", "bizId", "config"])) {
      if (!present(q, "tenantId") || !present(q, "bizId")) return err400("Missing tenantId or bizId");
      if (q.config !== "1") return err400("invalid config");
      return { mode: "read", read: "config" };
    }

    // Any other query shape (action present, unknown keys, config-only,
    // single id, duplicates, config="") is rejected — never falls into cron.
    return err400("unknown query mode");
  }

  if (method === "POST") {
    const b = (req && req.body) || {};
    const action = b.action;
    if (action !== "run" && action !== "config" && action !== "dismiss") {
      return err400("invalid action");
    }
    return { mode: "write", action };
  }

  return { mode: "error", status: 405, msg: "Method not allowed" };
}

/**
 * validateAskScope — /api/agent/ask input policy (body-only ids; timezone and
 * branchId constraints). See PR2A report for the branchId decision + evidence.
 *   • tenantId/bizId from body only (query duplicates rejected by extractScope);
 *   • timezone absent/null OR exactly Asia/Jerusalem, else 400;
 *   • branchId absent/null OK; if present it MUST equal bizId (no arbitrary
 *     branch scope), else 400. Resolved branchId is bizId or undefined.
 * @returns {{tenantId:string,bizId:string,timezone:string,branchId:(string|undefined)}}
 * @throws {{status:number,msg:string}} 400
 */
export function validateAskScope(req) {
  const { tenantId, bizId } = extractScope(req, { source: "body" });
  const b = (req && req.body) || {};

  const tz = b.timezone;
  if (tz != null && tz !== ALLOWED_TIMEZONE) throw { status: 400, msg: "unsupported timezone" };

  const branchId = b.branchId;
  if (branchId != null && branchId !== "" && branchId !== bizId) {
    throw { status: 400, msg: "invalid_branch_scope" };
  }
  const resolvedBranchId = branchId != null && branchId !== "" ? bizId : undefined;

  return { tenantId, bizId, timezone: ALLOWED_TIMEZONE, branchId: resolvedBranchId };
}
