// Shared redaction/sanitization for the readiness audits.
//
// This EXTENDS lib/redact.mjs (stable alias hashing for known fields) — it is not a
// second, incompatible system. Use makeRedactor() for deterministic field aliases, and
// the sanitizers here for free-text / error / report scrubbing of sensitive values that
// must never reach stdout/stderr or a reviewer artifact.
import { makeRedactor } from "./redact.mjs";
export { makeRedactor };

// Ordered replacement rules. Applied in sequence; earlier (more specific) rules win.
// Each: { name, re, to }. `re` must be global.
const RULES = [
  { name: "privateKey",   re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, to: "<redacted-private-key>" },
  { name: "serviceAccount", re: /"(private_key|client_email|private_key_id|client_id)"\s*:\s*"(?:[^"\\]|\\.)*"/g, to: '"$1":"<redacted>"' },
  { name: "jwt",          re: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, to: "<redacted-jwt>" },
  { name: "bearer",       re: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, to: "Bearer <redacted-token>" },
  { name: "apiKey",       re: /\bAIza[0-9A-Za-z_-]{10,}\b/g, to: "<redacted-api-key>" },
  { name: "apiKey",       re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, to: "<redacted-api-key>" },
  { name: "firebaseHost", re: /\b[A-Za-z0-9][A-Za-z0-9-]*(?:-default-rtdb)?\.(?:firebaseio\.com|firebasedatabase\.app)\b/g, to: "<redacted-firebase-host>" },
  { name: "firebaseHost", re: /\b[A-Za-z0-9][A-Za-z0-9-]*\.(?:[a-z0-9-]+\.)?firebasedatabase\.app\b/g, to: "<redacted-firebase-host>" },
  { name: "firebaseProjectLabel", re: /("(?:productionProject|projectId|project_id|firebaseProject)"\s*:\s*")[^"<]+(")/g, to: "$1<redacted-firebase-project>$2" },
  { name: "firebaseInstanceLabel", re: /("(?:productionInstance|databaseInstance|rtdbInstance)"\s*:\s*")[^"<]+(")/g, to: "$1<redacted-firebase-instance>$2" },
  { name: "rtdbInstanceName", re: /\b[A-Za-z0-9][A-Za-z0-9-]*-default-rtdb\b/g, to: "<redacted-firebase-instance>" },
  { name: "email",        re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: "<redacted-email>" },
  { name: "urlToken",     re: /([?&](?:access_token|auth|token|apikey|api_key|key|password|secret)=)[^&\s"'`]+/gi, to: "$1<redacted>" },
  { name: "rtdbTenant",   re: /\btenants\/(?!\{|<|tenant-[0-9])[A-Za-z0-9_-]{3,}/g, to: "tenants/<redacted-id>" },
  { name: "bizNamespace", re: /\bbiz:(?!<)[A-Za-z0-9_-]{2,}:/g, to: "biz:<redacted-id>:" },
  { name: "fsPath",       re: /(?:\/Users|\/home|\/sessions|\/private\/var|\/var\/folders)\/[^\s"'`]+/g, to: "<redacted-path>" },
  { name: "fsPath",       re: /\b[A-Za-z]:\\[^\s"'`]+/g, to: "<redacted-path>" },
  { name: "firebaseUid",  re: /\b[A-Za-z0-9]{28}\b/g, to: "<redacted-uid>" },
];

const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|private[_-]?key|client_email|authorization|credential|access[_-]?token|refresh[_-]?token)/i;

export function sanitizeString(s) {
  if (typeof s !== "string") return s;
  let out = s;
  for (const { re, to } of RULES) out = out.replace(re, to);
  return out;
}

// Count suspicious matches per category on the ORIGINAL text (no values returned).
export function scanForSecrets(s) {
  const text = typeof s === "string" ? s : String(s ?? "");
  const counts = {};
  let total = 0;
  for (const { name, re } of RULES) {
    const m = text.match(new RegExp(re.source, re.flags));
    const n = m ? m.length : 0;
    counts[name] = (counts[name] || 0) + n;
    total += n;
  }
  return { counts, total };
}

// Recursively sanitize a value: strings, arrays, object values AND keys.
export function sanitizeValue(v, seen = new WeakSet()) {
  if (typeof v === "string") return sanitizeString(v);
  if (v == null || typeof v !== "object") return v;
  if (seen.has(v)) return "<circular>";
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => sanitizeValue(x, seen));
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const key = sanitizeString(String(k));
    out[key] = SENSITIVE_KEY.test(k) ? "<redacted>" : sanitizeValue(val, seen);
  }
  return out;
}

// Safe error category from an error object (no raw values).
export function errorCategory(e) {
  const code = e && typeof e.code === "string" ? e.code : "";
  const msg = e && typeof e.message === "string" ? e.message : "";
  if (/PERMISSION_DENIED|permission/i.test(code + " " + msg)) return "permission";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch/i.test(code + " " + msg)) return "network";
  if (/ENOENT|EACCES|EISDIR|EEXIST/i.test(code)) return "filesystem";
  if (/SyntaxError|invalid|malformed|validation/i.test((e && e.constructor && e.constructor.name) + " " + msg)) return "validation";
  return "unknown";
}

// Produce a SAFE object describing an error — never the raw message/stack/paths.
export function sanitizeError(e) {
  const errorClass = (e && e.constructor && e.constructor.name) || typeof e;
  const code = e && typeof e.code === "string" && /^[A-Z0-9_]{2,40}$/.test(e.code) ? e.code : undefined;
  const category = errorCategory(e);
  let message = sanitizeString(String((e && e.message) ?? ""));
  // If sanitization left nothing meaningful, use the generic marker.
  if (!message || message.trim() === "") message = "AUDIT_FAILED_REDACTED";
  return { errorClass, code, category, message };
}

// One-line safe string for stderr/logs.
export function formatSafeError(e) {
  const s = sanitizeError(e);
  return `AUDIT_FAILED [class=${s.errorClass}${s.code ? " code=" + s.code : ""} category=${s.category}] ${s.message}`;
}
