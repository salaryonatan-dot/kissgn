// EV-1 collector — READ TRANSPORT. The ONLY module of the EV-1 collector that touches the network.
//
// READ-ONLY BY CONSTRUCTION:
//   • Realtime Database access is HTTP GET only (`GET <db>/<path>.json[?shallow=true]`).
//   • The only non-GET requests are the two credential exchanges, neither of which reads or
//     writes Marjin data:
//       1. POST https://oauth2.googleapis.com/token (JWT-bearer grant → short-lived access token);
//       2. POST https://cloudresourcemanager.googleapis.com/v1/projects/<p>:testIamPermissions
//          (a permission QUERY: the credential must NOT hold database update/create/delete).
//   • No Firebase SDK and no Admin app are imported (no write API is even reachable).
//   • Every response is typed: { ok:true, status:200, value } or { ok:false, code, status? }.
//     HTTP 200 with body `null` is a SUCCESSFUL EMPTY read (value null). Any other status,
//     network error, timeout or unparseable body is a FAILURE — never an empty value.
//   • No retry: an ambiguous outcome is reported, never re-attempted silently.
//   • No token, header, key or response body ever appears in a returned failure.
import { createSign } from "node:crypto";

export const RTDB_SCOPES = [
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/cloud-platform",
];
export const IAM_PERMISSIONS = [
  "firebasedatabase.instances.get",
  "firebasedatabase.instances.update",
  "firebasedatabase.instances.create",
  "firebasedatabase.instances.delete",
];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const iamUrl = (project) => `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(project)}:testIamPermissions`;

export class Ev1TransportError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "Ev1TransportError";
    this.code = code;
    this.detail = detail;
  }
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** RS256 JWT assertion for the Google OAuth2 JWT-bearer grant. */
export function signJwtAssertion(sa, nowSec) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: sa.client_email, scope: RTDB_SCOPES.join(" "), aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const unsigned = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return unsigned + "." + b64url(signer.sign(sa.private_key));
}

async function timed(fetchImpl, url, init, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Parse a response body as JSON. Returns { ok:true, value } or { ok:false } — never throws. */
function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

/**
 * Production REST transport. Acquires a token, proves the credential cannot write the database,
 * then exposes GET-only reads. Throws Ev1TransportError (before any database read) when the
 * credential exchange or the scope proof fails.
 */
export async function createRestTransport({ sa, project, databaseUrl, fetchImpl = globalThis.fetch, nowMs = Date.now(), timeoutMs = 60_000 }) {
  const requests = [];
  const record = (method, kind, status) => requests.push({ method, kind, status });

  // 1) token (POST, credential exchange only)
  let tokenRes;
  try {
    tokenRes = await timed(fetchImpl, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwtAssertion(sa, Math.floor(nowMs / 1000)) }).toString(),
    }, timeoutMs);
  } catch { throw new Ev1TransportError("token_request_failed", "network"); }
  record("POST", "oauth_token", tokenRes.status);
  if (tokenRes.status !== 200) throw new Ev1TransportError("token_request_failed", `HTTP ${tokenRes.status}`);
  const tok = parseJson(await tokenRes.text());
  if (!tok.ok || !tok.value || typeof tok.value.access_token !== "string" || tok.value.access_token === "") throw new Ev1TransportError("token_response_invalid");
  const token = tok.value.access_token;

  // 2) scope proof (POST, permission query only)
  let iam;
  try {
    iam = await timed(fetchImpl, iamUrl(project), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: IAM_PERMISSIONS }),
    }, timeoutMs);
  } catch { throw new Ev1TransportError("credential_scope_unverifiable", "network"); }
  record("POST", "iam_test_permissions", iam.status);
  if (iam.status !== 200) throw new Ev1TransportError("credential_scope_unverifiable", `HTTP ${iam.status}`);
  const perms = parseJson(await iam.text());
  if (!perms.ok || !perms.value || typeof perms.value !== "object") throw new Ev1TransportError("credential_scope_unverifiable", "unparseable");
  const granted = Array.isArray(perms.value.permissions) ? perms.value.permissions.filter((p) => typeof p === "string").sort() : [];
  const broad = granted.filter((p) => /\.(update|create|delete)$/.test(p));
  if (broad.length) throw new Ev1TransportError("CREDENTIAL_SCOPE_TOO_BROAD", broad.join(","));
  if (!granted.includes("firebasedatabase.instances.get")) throw new Ev1TransportError("credential_cannot_read");

  // 3) GET-only database reads
  const base = databaseUrl.replace(/\/+$/, "");
  async function get(kind, path, shallow) {
    const url = `${base}/${path}.json${shallow ? "?shallow=true" : ""}`;
    let res;
    try {
      res = await timed(fetchImpl, url, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
    } catch (e) {
      record("GET", kind, null);
      return { ok: false, code: e && e.name === "AbortError" ? "timeout" : "network" };
    }
    record("GET", kind, res.status);
    let text;
    try { text = await res.text(); } catch { return { ok: false, code: "body_unreadable", status: res.status }; }
    if (res.status === 401 || res.status === 403) return { ok: false, code: "unauthorized", status: res.status };
    if (res.status !== 200) return { ok: false, code: "http_status", status: res.status };
    const p = parseJson(text);
    if (!p.ok) return { ok: false, code: "json_parse", status: 200 };
    return { ok: true, status: 200, value: p.value };
  }
  return {
    mode: "production",
    identity: { grantedPermissions: granted },
    requests,
    listTenants: () => get("tenant_list", "tenants", true),
    listTenantKeys: (t) => get("tenant_keys", `tenants/${encodeURIComponent(t)}`, true),
    readRegistry: (t) => get("business_registry", `tenants/${encodeURIComponent(t)}/app/business`, false),
    readEntries: (t, b) => get("entries", `tenants/${encodeURIComponent(t)}/${encodeURIComponent(`biz:${b}:entries`)}`, false),
  };
}

/**
 * Offline fixture transport over an in-memory RTDB-shaped tree `{ tenants: { <t>: { ... } } }`.
 * `faults` maps a read key to a forced failure: "tenant_list", "tenant_keys:<t>",
 * "business_registry:<t>", "entries:<t>/<b>" → { code, status } (or { rawBody } to simulate an
 * unparseable HTTP-200 body). Shallow reads return `{ key: true }` exactly like RTDB REST.
 */
export function createFixtureTransport(tree, faults = {}) {
  const requests = [];
  const shallow = (node) => (node && typeof node === "object" && !Array.isArray(node) ? Object.fromEntries(Object.keys(node).map((k) => [k, true])) : node === undefined ? null : true);
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const answer = (kind, key, produce) => {
    requests.push({ method: "GET", kind, status: 200 });
    const f = faults[key];
    if (f) {
      requests[requests.length - 1].status = f.status ?? null;
      if (f.rawBody !== undefined) {
        const p = (() => { try { return { ok: true, value: JSON.parse(f.rawBody) }; } catch { return { ok: false }; } })();
        return p.ok ? { ok: true, status: 200, value: p.value } : { ok: false, code: "json_parse", status: 200 };
      }
      return { ok: false, code: f.code || "http_status", status: f.status };
    }
    return { ok: true, status: 200, value: produce() };
  };
  const tenants = () => (tree && tree.tenants) || null;
  return {
    mode: "fixture",
    identity: { grantedPermissions: [] },
    requests,
    listTenants: async () => answer("tenant_list", "tenant_list", () => shallow(tenants() === null ? undefined : tenants())),
    listTenantKeys: async (t) => answer("tenant_keys", `tenant_keys:${t}`, () => shallow((tenants() || {})[t])),
    readRegistry: async (t) => answer("business_registry", `business_registry:${t}`, () => clone((((tenants() || {})[t] || {}).app || {}).business)),
    readEntries: async (t, b) => answer("entries", `entries:${t}/${b}`, () => clone(((tenants() || {})[t] || {})[`biz:${b}:entries`])),
  };
}
