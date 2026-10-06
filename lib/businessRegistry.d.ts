// Declarations for lib/businessRegistry.js (M1 R1 shared target-scoped registry rule; M1 R2 adds resolveRegistryTarget).
export type RegistryState = "registered" | "not_registered" | "ambiguous" | "unreadable" | "unavailable" | "invalid_request";
export interface RegistryClassification {
  state: RegistryState;
  reason?: string;
  unrelatedDefects?: number;
}
export interface RegistryResolution extends RegistryClassification {
  record: Record<string, unknown> | null;
}
export function isRegistryBizId(v: unknown): v is string;
export function decodeRegistryNode(raw: unknown): { ok: true; list: unknown[] } | { ok: false; reason: string };
export function classifyRegistryTarget(raw: unknown, bizId: unknown): RegistryClassification;
export function resolveRegistryTarget(raw: unknown, bizId: unknown): RegistryResolution;
export function readRegistryTarget(db: unknown, tenantId: string, bizId: unknown): Promise<RegistryClassification>;
