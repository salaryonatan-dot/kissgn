// Server runtime only. Daily e-mail subscription — per business, server-only preference (owner requirement 2026-10-22; author candidate, pending
// independent review). Label in the page: «קבלת דוח יומי במייל».
//
// Contract:
//   - One record per (tenant, business) at email_delivery_subscriptions/daily_snapshot/{tenantId}/{bizId}. The root is
//     outside every client grant of database.rules.json (`$other`: no client read or write); only the server writes it,
//     through api/daily-snapshot/run.ts after the owner / super_owner check of requireBizContext.
//   - DEFAULT OFF. The scheduled Daily may be sent for a business ONLY when its record is well formed AND enabled === true.
//     An absent record is "disabled" (the default); a malformed record is "unreadable"; a failed or timed-out read is
//     "unavailable". None of them permits a scheduled send.
//   - The preference never grants recipient eligibility and never names an address: the recipient remains exclusively the
//     server configuration MARJIN_DAILY_RECIPIENTS_JSON (src/server/dailyRecipientConfig.ts).
//   - The manual Daily (an explicit owner request) does not read this preference; its own checks are unchanged.
//   - A change applies to scheduled runs that read the preference after the change. Nothing here touches a receipt, a
//     claim, an admission, a manual record or the hold.
import { isTenantKey, isBusinessKey } from "../../lib/emailDelivery.js";

export type SubscriptionState = "enabled" | "disabled" | "unreadable" | "unavailable" | "invalid";
export type SubscriptionCode = "daily_email_not_enabled" | "daily_email_subscription_unreadable" | "daily_email_subscription_unavailable" | "invalid_business_identity";
export type SubscriptionView = { state: SubscriptionState; enabled: boolean; explicit: boolean; code: SubscriptionCode | null; version: number | null };
export type SetSubscriptionResult =
  | { ok: true; enabled: boolean; version: number; changed: boolean }
  | { ok: false; code: "invalid_subscription_request" | "daily_email_subscription_unavailable" | "daily_email_subscription_unconfirmed" };
type SubscriptionRecord = { schema: 1; enabled: boolean; version: number; updatedAt: number; updatedByRole: string };

export const SUBSCRIPTION_ROOT = "email_delivery_subscriptions/daily_snapshot";
export const SUBSCRIPTION_SCHEMA = 1;
export const SUBSCRIPTION_READ_TIMEOUT_MS = 5000;
export const SUBSCRIPTION_WRITE_TIMEOUT_MS = 5000;
export const SUBSCRIPTION_ACTOR_ROLES: readonly string[] = Object.freeze(["owner", "super_owner"]);
const RECORD_KEYS: readonly string[] = Object.freeze(["enabled", "schema", "updatedAt", "updatedByRole", "version"]);

/** The record path, or null when an identity is not safely addressable (the delivery scope's own identity rules). */
export function subscriptionPath(tenantId: unknown, bizId: unknown): string | null {
  if (!isTenantKey(tenantId) || !isBusinessKey(bizId)) return null;
  return `${SUBSCRIPTION_ROOT}/${tenantId}/${bizId}`;
}

const isPlain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/** Whether a stored value is a well-formed record (exact keys and types; nothing is coerced). */
export function isSubscriptionRecord(raw: unknown): raw is SubscriptionRecord {
  if (!isPlain(raw)) return false;
  const keys = Object.keys(raw).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((k, i) => k !== RECORD_KEYS[i])) return false;
  return raw.schema === SUBSCRIPTION_SCHEMA && typeof raw.enabled === "boolean" &&
    Number.isSafeInteger(raw.version) && (raw.version as number) >= 1 &&
    Number.isSafeInteger(raw.updatedAt) && (raw.updatedAt as number) >= 0 && typeof raw.updatedByRole === "string" && SUBSCRIPTION_ACTOR_ROLES.includes(raw.updatedByRole);
}

/**
 * The preference as the scheduled Daily sees it. { state, enabled, explicit, code, version }:
 *   enabled      well formed, enabled === true                          → the ONLY state that permits a scheduled send
 *   disabled     well formed with enabled === false, or absent (default) → code daily_email_not_enabled
 *   unreadable   present but malformed                                   → code daily_email_subscription_unreadable
 */
export function classifySubscription(raw: unknown): SubscriptionView {
  if (raw === null || raw === undefined) return { state: "disabled", enabled: false, explicit: false, code: "daily_email_not_enabled", version: null };
  if (!isSubscriptionRecord(raw)) return { state: "unreadable", enabled: false, explicit: false, code: "daily_email_subscription_unreadable", version: null };
  return raw.enabled === true
    ? { state: "enabled", enabled: true, explicit: true, code: null, version: raw.version }
    : { state: "disabled", enabled: false, explicit: true, code: "daily_email_not_enabled", version: raw.version };
}

async function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ ok: false; timedOut: boolean }>((resolve) => { timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs); });
    const run = (async () => ({ ok: true as const, value: await work() }))().catch(() => ({ ok: false as const, timedOut: false }));
    return await Promise.race([run, timeout]);
  } catch { return { ok: false, timedOut: false }; } finally { clearTimeout(timer); }
}

/**
 * Read one preference. Never throws. A failed or timed-out read is "unavailable"; an identity that cannot be addressed is
 * "invalid". Neither permits a scheduled send.
 */
export async function readDailySubscription(db: any, tenantId: string, bizId: string, { timeoutMs = SUBSCRIPTION_READ_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<SubscriptionView> {
  const path = subscriptionPath(tenantId, bizId);
  if (path === null) return { state: "invalid", enabled: false, explicit: false, code: "invalid_business_identity", version: null };
  const r = await bounded<unknown>(async () => (await db.ref(path).once("value")).val(), timeoutMs);
  if (!r.ok) return { state: "unavailable", enabled: false, explicit: false, code: "daily_email_subscription_unavailable", version: null };
  return classifySubscription(r.value === undefined ? null : r.value);
}

/**
 * Record an explicit owner decision. The CALLER has already authorized the actor (owner / super_owner of this tenant and
 * business, server-verified); the record keeps the actor's ROLE and the time, never an address or identity token. Never
 * throws. Returns:
 *   { ok: true, enabled, version, changed }                    the stored record now says `enabled` (changed=false: it already did)
 *   { ok: false, code: "invalid_subscription_request" }        bad identity / value / actor (nothing written)
 *   { ok: false, code: "daily_email_subscription_unavailable" }  the write was refused or failed: nothing changed
 *   { ok: false, code: "daily_email_subscription_unconfirmed" }  no answer in time: the change may or may not have applied
 * A malformed stored record is replaced by the explicit decision (version 1); it is never read as enabled.
 */
export async function setDailySubscription(db: any, { tenantId, bizId, enabled, actorRole, nowMs, timeoutMs = SUBSCRIPTION_WRITE_TIMEOUT_MS }:
  { tenantId?: unknown; bizId?: unknown; enabled?: unknown; actorRole?: unknown; nowMs?: unknown; timeoutMs?: number } = {}): Promise<SetSubscriptionResult> {
  const path = subscriptionPath(tenantId, bizId);
  if (path === null || typeof enabled !== "boolean" || typeof actorRole !== "string" || !SUBSCRIPTION_ACTOR_ROLES.includes(actorRole) ||
      typeof nowMs !== "number" || !Number.isSafeInteger(nowMs) || nowMs < 0) return { ok: false, code: "invalid_subscription_request" };
  let decided: { changed: boolean; version: number } | null = null;
  const r = await bounded<{ committed: boolean; value: unknown }>(async () => {
    const t = await db.ref(path).transaction((current: unknown) => {
      const cur = current === undefined ? null : current;
      if (isSubscriptionRecord(cur) && cur.enabled === enabled) {
        decided = { changed: false, version: cur.version };
        return cur;                                   // unchanged: committed against the server's value (no blind abort)
      }
      const version = isSubscriptionRecord(cur) ? cur.version + 1 : 1;
      decided = { changed: true, version };
      return { schema: SUBSCRIPTION_SCHEMA, enabled, version, updatedAt: nowMs, updatedByRole: actorRole };
    });
    return { committed: !!(t && t.committed), value: t && t.snapshot && typeof t.snapshot.val === "function" ? t.snapshot.val() : null };
  }, timeoutMs);
  if (!r.ok) return { ok: false, code: r.timedOut ? "daily_email_subscription_unconfirmed" : "daily_email_subscription_unavailable" };
  const done = decided as { changed: boolean; version: number } | null;
  if (!r.value.committed || !done) return { ok: false, code: "daily_email_subscription_unavailable" };
  const stored = classifySubscription(r.value.value);
  if (!stored.explicit || stored.enabled !== enabled || stored.version !== done.version)
    return { ok: false, code: "daily_email_subscription_unconfirmed" };
  return { ok: true, enabled, version: done.version, changed: done.changed };
}
