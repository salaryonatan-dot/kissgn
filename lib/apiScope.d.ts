// Type declarations for lib/apiScope.js (PR #2A). Value exports only.
export const ALLOWED_TIMEZONE: string;
export function validId(v: unknown): boolean;
export function extractScope(req: unknown, opts: { source: "query" | "body" }): { tenantId: string; bizId: string };
export interface AlertsClassification {
  mode: "options" | "cron" | "read" | "write" | "error";
  status?: number; msg?: string; read?: "alerts" | "config"; action?: "run" | "config" | "dismiss";
}
export function classifyAlertsRequest(req: unknown): AlertsClassification;
export function validateAskScope(req: unknown): {
  tenantId: string; bizId: string; timezone: string; branchId?: string;
};
