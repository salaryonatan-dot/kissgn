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

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  code: string | null;
  attempt?: number;
  receipt: ReceiptWrite;
  messageId?: string;
  retryable?: boolean;
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
  info: unknown;
  error: unknown;
  beforeTransport(): Promise<void>;
}

export function receiptPath(kind: string, tenantId: string, bizId: string, businessDate: string): string | null;
export function recipientHash(email: string): string;
export const recipientRef: (email: string) => string;
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
