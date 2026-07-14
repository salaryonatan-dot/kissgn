// Type declarations for the runtime module lib/verifyToken.js.
// verifyFirebaseToken() returns only the three fields the runtime extracts from
// the decoded Admin SDK token; email/tenantId are nullable (decoded value ?? null).

/** Minimal request shape verifyToken reads: a Web `Headers` or a Node header bag. */
export interface VerifyTokenRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
}

export interface VerifiedToken {
  uid: string;
  email: string | null;
  tenantId: string | null;
}

export function verifyFirebaseToken(token: string, _projectId?: string): Promise<VerifiedToken>;
export function requireAuth(req: VerifyTokenRequestLike): Promise<VerifiedToken>;
