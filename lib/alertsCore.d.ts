// Type declarations for lib/alertsCore.js (PR #2A).
// Dependency callbacks use METHOD signatures (bivariant params) so the real,
// more-specifically-typed functions remain assignable under strictFunctionTypes.
export interface HandlerResult { status: number; json?: unknown; end?: boolean; }
export interface AlertsRepos {
  runAlertsForBiz(tenantId: string, bizId: string): Promise<unknown>;
  runAlertsForAll(): Promise<Array<{ alertsFired: number; emailSent: boolean }>>;
  getActiveAlerts(tenantId: string, bizId: string): Promise<Array<{ severity: string }>>;
  dismissAlert(tenantId: string, bizId: string, alertId: string): Promise<unknown>;
  getThresholds(tenantId: string, bizId: string): Promise<unknown>;
  saveThresholds(tenantId: string, bizId: string, thresholds: unknown): Promise<unknown>;
}
export interface AlertsDeps {
  requireCron(req: unknown, opts?: { cronSecret?: string }): true;
  requireBizContext(req: unknown, opts: { tenantId: string; bizId: string; mode: "read" | "write" }): Promise<unknown>;
  repos: AlertsRepos;
  logError?(where: string, err: unknown): void;
}
export function handleAlerts(req: unknown, deps: AlertsDeps): Promise<HandlerResult>;
