// ─────────────────────────────────────────────────────────────────────────────
// checklistVersion.js — pure, deterministic version-token for optimistic
// concurrency on server-mediated checklist documents. No timestamps/randomness.
//
// canonicalizeChecklistDocument(value) → a canonical string that is:
//   • independent of object-key order (keys sorted, recursively);
//   • order-preserving for arrays;
//   • type-distinguishing (null/array/object/string/boolean/number);
//   • rejecting non-JSON / cyclic / prototype-pollution keys.
// checklistVersionToken(value) → sha256 hex of the canonical form.
//   An empty/nonexistent document (null or undefined) has ONE deterministic token.
// The client's token is NEVER authoritative — the server recomputes the current
// token inside the write transaction.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function canonicalizeChecklistDocument(value) {
  const seen = new WeakSet();
  function canon(v) {
    if (v === null) return "N";
    const t = typeof v;
    if (t === "boolean") return "B" + (v ? "1" : "0");
    if (t === "number") {
      if (!Number.isFinite(v)) throw { code: "invalid_document" }; // NaN/Infinity are non-JSON
      return "D" + (Object.is(v, -0) ? "0" : String(v));
    }
    if (t === "string") return "S" + JSON.stringify(v);
    if (t === "object") {
      if (seen.has(v)) throw { code: "invalid_document" };          // cyclic
      seen.add(v);
      let out;
      if (Array.isArray(v)) {
        out = "A[" + v.map(canon).join(",") + "]";                  // preserve element order
      } else {
        const keys = Object.keys(v).sort();                        // canonical key order
        for (const k of keys) if (FORBIDDEN_KEYS.has(k)) throw { code: "forbidden_key" };
        out = "O{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
      }
      seen.delete(v);
      return out;
    }
    throw { code: "invalid_document" };                             // function / undefined / symbol / bigint
  }
  return canon(value);
}

export function checklistVersionToken(value) {
  const canon = canonicalizeChecklistDocument(value === undefined ? null : value);
  return createHash("sha256").update(canon).digest("hex");
}

/** Deep prototype-pollution key check (defense-in-depth; canonicalize also rejects). */
export function hasForbiddenKeys(value) {
  const seen = new WeakSet();
  function walk(v) {
    if (v === null || typeof v !== "object") return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    for (const k of Object.keys(v)) { if (FORBIDDEN_KEYS.has(k)) return true; if (walk(v[k])) return true; }
    return false;
  }
  return walk(value);
}
