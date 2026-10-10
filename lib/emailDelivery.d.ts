// Type declarations for the runtime module lib/emailDelivery.js (daily e-mail delivery receipts).

export const RECEIPT_VERSION: "MARJIN_EMAIL_RECEIPT/1";
export const RECEIPT_ROOT: "email_delivery";
export const DAILY_SNAPSHOT_KIND: "daily_snapshot";
export const MAX_AUTOMATIC_ATTEMPTS: number;
export const IN_RUN_ATTEMPTS: number;
export const CLAIM_LEASE_MS: number;
export const HISTORY_KEEP: number;

export type DeliveryOutcome = "accepted" | "failed" | "unknown" | "skipped";
export type ReceiptWrite = "recorded" | "write_failed" | "unavailable" | "not_written";
export type ProviderIdEcho = "match" | "different" | "absent" | "invalid";

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  code: string | null;
  attempt?: number;
  receipt: ReceiptWrite;
  messageId?: string;
  retryable?: boolean;
  phase?: "claimed" | "sending";
}

export interface TransportClassification {
  outcome: "failed" | "unknown" | "accepted";
  retryable?: boolean;
  inRunRetry?: boolean;
  code?: string;
  responseCode?: number | null;
}

export interface DeliveryAttemptContext {
  kind: string;
  claimId: string;
  attempt: number;
  path: string;
  messageId: string;
  handedToProvider: boolean;
  claimLost: boolean;
  multipleHandoffs: boolean;
  info: unknown;
  error: unknown;
  beforeTransport(): Promise<void>;
}

// identity rules of the delivery scope (owner decisions 2026-10-09): the approved shared predicates per slot + RTDB key safety
export const RTDB_CONTROL_CHARS: RegExp;
export function isTenantKey(v: unknown): boolean;
export function isBusinessKey(v: unknown): boolean;
export function receiptPath(kind: string, tenantId: string, bizId: string, businessDate: string): string | null;

// the delivery target (G4 / G10): every state carries a bounded code; the route decides the HTTP mapping
export type DeliveryTargetCode = "invalid_business_identity" | "registry_unreadable" | "registry_unavailable" | "ambiguous_business_identity"
  | "business_not_registered" | "business_name_unavailable";
export type DeliveryTarget =
  | { state: "deliverable"; code: null; name: string }
  | { state: "invalid_identity" | "unreadable" | "unavailable" | "ambiguous" | "not_registered" | "name_unavailable"; code: DeliveryTargetCode; reason?: string };
export function resolveDeliveryTarget(raw: unknown, tenantId: string, bizId: string): DeliveryTarget;
export function readDeliveryTarget(db: unknown, tenantId: string, bizId: string, opts?: { cache?: Map<string, unknown> }): Promise<DeliveryTarget>;

// the owner notice for a business whose Daily cannot be prepared (G4)
export const DELIVERY_NOTICE_ROOT: "email_delivery/daily_snapshot_notices";
export const MISSING_NAME_NOTICE_HE: string;
export interface DeliveryNotice { code: "business_name_unavailable"; message: string; tenantId: string; bizId: string; businessDate: string | null; firstSeenAt: number; lastSeenAt: number; runs: number }
export function deliveryNoticePath(tenantId: string, bizId: string): string | null;
export function recordMissingNameNotice(db: unknown, args: { tenantId: string; bizId: string; businessDate: string | null; nowMs?: number }): Promise<"recorded" | "not_recorded">;
export function clearDeliveryNotice(db: unknown, tenantId: string, bizId: string): Promise<boolean>;
export function readDeliveryNotice(db: unknown, tenantId: string, bizId: string): Promise<DeliveryNotice | null>;
/** R7: the notice store state, never a manufactured notice; never throws. */
export type DeliveryNoticeState = { state: "present"; record: DeliveryNotice | null } | { state: "absent" } | { state: "unavailable" };
export function readDeliveryNoticeState(db: unknown, tenantId: string, bizId: string): Promise<DeliveryNoticeState>;
export function recipientHash(email: string): string;
export const recipientRef: (email: string) => string;
export function safeRead(obj: unknown, key: string): unknown;
export function providerCode(err: unknown): string;
export function providerCommand(err: unknown): string;
export function providerResponseCode(x: unknown): number | null;
export function providerIdEcho(reported: unknown, ours: string): ProviderIdEcho;
export function boundedCode(code: unknown): string | null;
export function smtpNegativeReply(err: unknown): { code: "EENVELOPE" | "EMESSAGE" | "EAUTH"; command: string; responseCode: number } | null;
export function classifyTransportError(err: unknown): TransportClassification;
export function classifyTransportInfo(info: unknown, to: string): TransportClassification;
export function currentDeliveryAttempt(): DeliveryAttemptContext | undefined;
export function deliverWithReceipt(args: {
  db: unknown;
  kind?: string;
  tenantId: string;
  bizId: string;
  businessDate: string;
  recipient: string;
  send: () => Promise<unknown>;
  clock?: () => number;
  leaseMs?: number;
  maxAttempts?: number;
  inRunAttempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  newClaimId?: () => string;
}): Promise<DeliveryResult>;
export function deliverWithoutReceipt(args: {
  recipient: string;
  send: () => Promise<unknown>;
  newClaimId?: () => string;
}): Promise<{ outcome: "accepted" | "failed" | "unknown"; code: string | null; messageId?: string }>;
