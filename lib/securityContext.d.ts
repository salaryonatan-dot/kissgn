// Type declarations for lib/securityContext.js (PR #2A). Value exports only.
export interface SecurityContextRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
}
export interface BizContextOptions { tenantId: string; bizId: string; mode: "read" | "write"; }
export interface BizContextDeps {
  requireAuth?: (req: unknown) => Promise<{ uid: string; email?: string | null }>;
  requireTenantAccess?: (uid: string, tenantId: string, minRole: string) => Promise<string>;
  getDb?: () => Promise<unknown> | unknown;
}
export interface BizContext {
  uid: string; email: string | null; tenantId: string; bizId: string; role: string; db: unknown;
}
export const READ_ROLES: readonly string[];
export const WRITE_ROLES: readonly string[];
export function isValidId(v: unknown): boolean;
export function requireCron(req: SecurityContextRequestLike, opts?: { cronSecret?: string }): true;
export function requireBizAccess(db: unknown, tenantId: string, bizId: string, uid: string, role: string): Promise<boolean>;
export function requireBizContext(
  req: SecurityContextRequestLike,
  opts: BizContextOptions,
  deps?: BizContextDeps
): Promise<BizContext>;
