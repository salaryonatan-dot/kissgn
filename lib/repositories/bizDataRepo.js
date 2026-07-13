// ─────────────────────────────────────────────────────────────────────────────
// bizDataRepo.js — server-mediated Admin-SDK access to PARAMETERIZED business
// keys whose bizId cannot be extracted in RTDB rules (so Rules deny direct client
// access and the Admin SDK is the only reader/writer).
//
// Paths are CONSTRUCTED from already-validated (tenantId, bizId, date, templateId)
// — never from a client-supplied path/suffix. No generic "read/write business key".
// ─────────────────────────────────────────────────────────────────────────────
import { getAdminDb } from "../adminSdk.js";

const P = (t, b, suffix) => `tenants/${t}/biz:${b}:${suffix}`;

/** Unwrap a stored value: {_v:"<json>"} | "<json>" | raw object → parsed doc | null. */
function unwrap(raw) {
  if (raw == null) return null;
  if (raw && typeof raw === "object" && typeof raw._v === "string") { try { return JSON.parse(raw._v); } catch { return null; } }
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
  return raw;
}

/** Read one flat business doc by validated suffix. */
export async function readBizDoc(tenantId, bizId, suffix) {
  const snap = await getAdminDb().ref(P(tenantId, bizId, suffix)).once("value");
  return unwrap(snap.val());
}

/** Write one flat business doc as {_v:"<json>"} (matches the legacy client envelope). */
export async function writeBizDoc(tenantId, bizId, suffix, doc) {
  await getAdminDb().ref(P(tenantId, bizId, suffix)).set({ _v: JSON.stringify(doc) });
}

/**
 * Read a bounded date-range of daily docs for a `kind` ("analytics" | "insights").
 * Uses an RTDB key-range query on the tenant node over the exact flat-key prefix,
 * so ONLY existing keys in range for THIS business are read. Returns {date: doc}.
 */
export async function readBizDailyRange(tenantId, bizId, kind, fromDate, toDate) {
  const prefix = `biz:${bizId}:${kind}:daily:`;
  const snap = await getAdminDb().ref(`tenants/${tenantId}`)
    .orderByKey().startAt(prefix + fromDate).endAt(prefix + toDate).once("value");
  const val = snap.val() || {};
  const out = {};
  for (const [fullKey, raw] of Object.entries(val)) {
    if (!fullKey.startsWith(prefix)) continue; // defensive: only this biz+kind prefix
    const date = fullKey.slice(prefix.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const doc = unwrap(raw);
    if (doc != null) out[date] = doc;
  }
  return out;
}
