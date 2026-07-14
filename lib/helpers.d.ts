// Type declarations for the runtime module lib/helpers.js.
// Signatures mirror the real JS: role checks, fail-closed tenant access (returns
// the resolved role string, throws { status, msg } on denial), rate limiting,
// and CORS/security response helpers. No `any`.

/** Web `Headers` or a Node header bag (both handled at runtime). */
export interface HttpRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
}

export function hasRole(role: string, minRole: string): boolean;

/** Resolves to the caller's role for the tenant; throws { status, msg } when denied. */
export function requireTenantAccess(uid: string, tenantId: string, minRole: string): Promise<string>;

/** True when rate-limited. Throws { status, msg } in production if Upstash is unavailable. */
export function isRateLimited(key: string, limit?: number, windowMs?: number): Promise<boolean>;

export function errResponse(status: number, message: string, req?: HttpRequestLike): Response;
export function secHeaders(req: HttpRequestLike, extra?: Record<string, string>): Record<string, string>;
export function getIP(req: HttpRequestLike): string;

export const VALID_ROLES: Set<string>;
