// Type declarations for the runtime module lib/emailDelivery.js (daily e-mail delivery receipts).

export const RECEIPT_VERSION: "MARJIN_EMAIL_RECEIPT/1";
export const RECEIPT_ROOT: "email_delivery";
export const DAILY_SNAPSHOT_KIND: "daily_snapshot";
export const MAX_AUTOMATIC_ATTEMPTS: number;
export const IN_RUN_ATTEMPTS: number;
export const CLAIM_LEASE_MS: number;
export const HISTORY_KEEP: number;

export type DeliveryOutcome = "accepted" | "failed" | "unknown" | "skipped" | "held";
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
  /** HR1: the scheduled Daily gate (makeDailyDeliveryGate); consulted before every claim (G0) and in beforeTransport (G3). */
  gate?: DeliveryGateFn | null;
}): Promise<DeliveryResult>;
export function deliverWithoutReceipt(args: {
  recipient: string;
  send: () => Promise<unknown>;
  newClaimId?: () => string;
}): Promise<{ outcome: "accepted" | "failed" | "unknown"; code: string | null; messageId?: string }>;

// ── HR1: the Daily-only delivery hold ─────────────────────────────────────────────────────────────────────────────────────
export const DELIVERY_HOLD_PATH: "delivery_control/daily_snapshot";
export const HELD_DATES_ROOT: "delivery_control/daily_snapshot_held_dates";
export const MANUAL_ATTEMPT_ROOT: "email_delivery_manual";
export const MANUAL_ATTEMPT_VERSION: "MARJIN_MANUAL_ATTEMPT/1";
export const HOLD_SCHEMA: 1;
export const HOLD_READ_TIMEOUT_MS: number;
export const HOLD_ACTIONS: Readonly<{ init: "held"; hold: "held"; release: "released" }>;
export type HoldCode = "delivery_held" | "delivery_hold_unreadable" | "delivery_hold_unavailable";
export type GateCode = HoldCode | "held_day" | "held_day_unverifiable" | "legacy_evidence_unresolved";
export interface HoldState { state: "released" | "held"; code: HoldCode | null; version: number | null }
export interface DeliveryGate { open: boolean; code: GateCode | null; version: number | null; heldDate?: "recorded" | "exists" | "not_recorded" }
export type DeliveryGateFn = (stage?: string) => Promise<DeliveryGate>;
export function holdLogKey(version: number): string;
export function classifyHoldRecord(raw: unknown): HoldState;
export function readDeliveryHold(db: unknown, opts?: { timeoutMs?: number }): Promise<HoldState>;
export function heldDatePath(businessDate: unknown): string | null;
export function readDailyDeliveryGate(db: unknown, businessDate: string | null, opts?: { timeoutMs?: number }): Promise<DeliveryGate>;
export function recordHeldDate(db: unknown, businessDate: string | null, opts?: { code?: string | null; version?: number | null; stage?: string; nowMs?: number; timeoutMs?: number; proof?: { decision: "committed_hold_refusal"; generation: string; intent: string; holdVersion: number } }): Promise<"recorded" | "exists" | "not_recorded">;
export function makeDailyDeliveryGate(db: unknown, businessDate: string | null, opts?: { timeoutMs?: number; clock?: () => number }): DeliveryGateFn;
export function readManualDeliveryGate(db: unknown, opts?: { timeoutMs?: number }): Promise<DeliveryGate>;
export type HoldChangeCode = "applied" | "invalid_request" | "exists" | "not_initialized" | "unreadable_record" | "version_conflict" | "no_change" | "transaction_failed" | "inventory_missing_or_unreadable" | "inventory_incomplete" | "inventory_confirmation_required" | "inventory_confirmation_mismatch" | "inventory_coverage_unverified";
export function changeDeliveryHold(db: unknown, args: { action: "init" | "hold" | "release"; actor: string; reason: string; expectVersion?: number; nowMs?: number; timeoutMs?: number }):
  Promise<{ ok: boolean; code: HoldChangeCode; state?: "held" | "released"; version?: number }>;
export function manualAttemptPath(tenantId: string, bizId: string, attemptId: string): string | null;
export function deliverManualDaily(args: {
  db: unknown;
  tenantId: string;
  bizId: string;
  businessDate: string | null;
  recipient: string;
  recipientSelection?: string | null;
  actorRole?: "owner" | "super_owner" | string | null;
  send: () => Promise<unknown>;
  gate?: DeliveryGateFn;
  clock?: () => number;
  newClaimId?: () => string;
  deploymentId?: string;
}): Promise<{ outcome: "accepted" | "failed" | "unknown" | "held"; code: string | null; attemptId: string | null; record: "recorded" | "write_failed" | "not_written"; messageId?: string }>;

export function deliveryInventoryView(raw: unknown): { ok: boolean; code?: string; generation?: string; digest?: string; eligible?: boolean; complete?: boolean; pending?: string[]; unresolvedLegacy?: boolean };
export function confirmDeliveryInventory(db: unknown, args: { generation: string; digest: string; actor: string; reason: string; nowMs?: number; timeoutMs?: number }): Promise<{ ok: boolean; code: string; generation?: string; digest?: string }>;
