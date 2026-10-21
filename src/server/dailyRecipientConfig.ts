// Server runtime only. Owner-approved 1.0 amendment: 2026-10-20 17:31 Asia/Jerusalem.
// The deployment variable is private configuration, never a browser setting or RTDB fallback.
import { isTenantKey, isBusinessKey } from "../../lib/emailDelivery.js";
export type RecipientSelection = "server_configured";
export type RecipientCode = "no_recipient" | "recipient_unavailable" | "recipient_data_invalid" | "recipient_invalid";
export type RecipientResult = { ok: true; email: string; selection: RecipientSelection } | { ok: false; code: RecipientCode };
const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
/** One plain mailbox (no display name, list, comment, whitespace or control character), at most 254 characters. */
function isSingleMailbox(x: string): boolean { return x.length <= 254 && MAILBOX.test(x); }

// Only arrays of exact [tenantId, businessId, email] tuples are supported. Objects
// are deliberately not a schema: duplicate JSON property names can never pick a winner.
// Validate the COMPLETE configuration before lookup: any invalid/duplicate row blocks all delivery.
// Identity uses the existing delivery predicates, never trimming/coercing/aliasing either slot.
export function resolveDailyRecipient(tenantId: unknown, bizId: unknown): RecipientResult {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") return { ok: false, code: "recipient_unavailable" };
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return { ok: false, code: "recipient_data_invalid" };
  let raw: unknown;
  try { raw = process.env.MARJIN_DAILY_RECIPIENTS_JSON; }
  catch { return { ok: false, code: "recipient_unavailable" }; }
  if (raw === undefined || raw === "") return { ok: false, code: "recipient_unavailable" };
  if (typeof raw !== "string") return { ok: false, code: "recipient_data_invalid" };
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return { ok: false, code: "recipient_data_invalid" }; }
  if (!Array.isArray(rows)) return { ok: false, code: "recipient_data_invalid" };
  const seen = new Set<string>();
  let selected: string | undefined;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3 || !isTenantKey(row[0]) || !isBusinessKey(row[1])) return { ok: false, code: "recipient_data_invalid" };
    const [tenant, business, email] = row;
    const key = JSON.stringify([tenant, business]);
    if (seen.has(key)) return { ok: false, code: "recipient_data_invalid" };
    seen.add(key);
    if (typeof email !== "string" || !isSingleMailbox(email) || email.endsWith("@temp.marjin.app")) return { ok: false, code: "recipient_invalid" };
    if (tenant === tenantId && business === bizId) selected = email;
  }
  return selected === undefined ? { ok: false, code: "no_recipient" } : { ok: true, email: selected, selection: "server_configured" };
}
