// Deterministic, non-reversible redaction for readiness audit artifacts.
// Never emit raw uid / email / name / tenantId / bizId. Same input -> same ref,
// so references cross-link within a report while carrying no personal data.
import { createHash } from "node:crypto";

export function makeRedactor(salt = "marjin-readiness-audit") {
  const cache = new Map();
  return function redact(kind, value) {
    if (value == null) return null;
    const key = kind + " " + String(value);
    if (cache.has(key)) return cache.get(key);
    const ref = kind + "_" + createHash("sha256").update(salt + " " + key).digest("hex").slice(0, 12);
    cache.set(key, ref);
    return ref;
  };
}
