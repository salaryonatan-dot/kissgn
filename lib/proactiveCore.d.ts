// Type declarations for lib/proactiveCore.js.
export interface HandlerResult { status: number; json?: unknown; end?: boolean; }
export interface ProactiveReadRepos {
  tenantExists?(tenantId: string): Promise<boolean>;
  getInsights(tenantId: string, bizId: string, limit: number): Promise<unknown>;
  getDigest(tenantId: string, bizId: string, date: string): Promise<unknown>;
  getWeeklySummary(tenantId: string, bizId: string): Promise<unknown>;
}
export interface ProactiveReadDeps {
  requireBizContext(req: unknown, opts: { tenantId: string; bizId: string; mode: "read" | "write" }): Promise<unknown>;
  repos: ProactiveReadRepos;
  now?: Date;
  logError?(where: string, err: unknown): void;
}
export function handleProactiveRead(req: unknown, deps: ProactiveReadDeps): Promise<HandlerResult>;
