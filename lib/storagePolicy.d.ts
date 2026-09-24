// Type declarations for lib/storagePolicy.js (Storage V2 version fence — server-owned
// per-business storage policy contract). Pure; mirrored by the Rules FENCE_GUARD.

export const POLICY_CONTRACT_VERSION: 1;
export const STORAGE_PROTOCOL_V2: 2;
export type PolicyPhase = "legacy" | "quiesced" | "v2_active" | "recovery_hold";
export const POLICY_PHASES: readonly PolicyPhase[];
export type OperationKind = "cutover" | "recovery";
export const OPERATION_KINDS: readonly OperationKind[];

export interface PolicyOperation { id: string; kind: OperationKind; owner: string; startedAt: number }
export interface PolicyRecord {
  contractVersion: 1;
  phase: PolicyPhase;
  policyRevision: number;
  allowV2Initialization: boolean;
  minStorageProtocol: number;
  operation: PolicyOperation | null;
  conversionAttempted: boolean;
  updatedAt?: number;
  updatedBy?: string;
  approvedReleaseId?: string;
}
export type ParsedPolicy =
  | { status: "absent" }
  | { status: "valid"; record: PolicyRecord }
  | { status: "unsupported_contract"; contractVersion: number }
  | { status: "malformed"; reason: string };
export function parsePolicyRecord(raw: unknown): ParsedPolicy;

export type EntriesMode = "absent" | "legacy" | "v2" | "malformed" | null | undefined;
export type AccessState =
  | "policy_unresolved" | "policy_malformed" | "update_required" | "maintenance_read_only"
  | "initialization_not_enabled" | "storage_unresolved" | "storage_malformed"
  | "v2_without_policy" | "conversion_pending" | "legacy" | "v2";
export interface AccessDecision { state: AccessState; writable: boolean; reason?: string; revision: number | null; initialization?: boolean }
export function decideEntriesAccess(parsed: ParsedPolicy | null | undefined, entriesMode: EntriesMode, clientProtocol?: number): AccessDecision;

export interface AdmissionDecision { admitted: boolean; reason: string; phase?: PolicyPhase }
export function decideAdminAdmission(parsed: ParsedPolicy | null | undefined): AdmissionDecision;

export interface TransitionContext { conversionAttempted?: boolean; entriesMode?: "absent" | "legacy" | "v2" | null; native?: boolean }
export function isAllowedTransition(from: "absent" | PolicyPhase, to: PolicyPhase, ctx?: TransitionContext): { ok: true } | { ok: false; reason: string };

export interface TransitionOptions extends TransitionContext {
  expectedRevision?: number;
  operator?: string;
  operationId?: string;
  now?: number;
  approvedReleaseId?: string;
}
export function planTransition(current: ParsedPolicy | unknown, target: PolicyPhase, opts?: TransitionOptions): PolicyRecord;

export interface StoragePolicyError extends Error { name: "StoragePolicyError"; code: string; detail?: unknown }
export function policyError(code: string, detail?: unknown): StoragePolicyError;
export function isStoragePolicyError(e: unknown): e is StoragePolicyError;
