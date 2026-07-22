// Type declarations for lib/agentAskCore.js (PR #2A).
// Dependency callbacks use METHOD signatures (bivariant params) so the real,
// more-specifically-typed functions remain assignable under strictFunctionTypes.
export interface HandlerResult { status: number; json?: unknown; end?: boolean; }
export interface AgentAskDeps {
  requireBizContext(req: unknown, opts: { tenantId: string; bizId: string; mode: "read" | "write" }): Promise<{ uid: string }>;
  routeQuestion(context: unknown): Promise<{ text: string; confidence: { level: string }; intent: string; usedSources: unknown }>;
  rateLimit?(key: string): boolean;
  now?(): string;
  logError?(where: string, err: unknown): void;
}
export function handleAgentAsk(req: unknown, deps: AgentAskDeps): Promise<HandlerResult>;
