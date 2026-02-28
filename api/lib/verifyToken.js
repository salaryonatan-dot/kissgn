/**
 * Verifies Firebase ID tokens using Admin SDK.
 * Node runtime only (firebase-admin).
 *
 * Falls back to manual JWT verification for Edge runtime (oref.js doesn't need auth).
 */
import { getAdminAuth } from "./adminSdk.js";

/**
 * Verifies a Firebase ID token via Admin SDK.
 * Admin SDK handles: signature, alg (RS256 only), exp, iat, aud, iss, kid rotation.
 *
 * @returns {{ uid, email, tenantId }}
 */
export async function verifyFirebaseToken(token, _projectId) {
  if (!token) throw new Error("missing token");

  const auth = getAdminAuth();
  // checkRevoked: true — also verifies the token hasn't been revoked
  const decoded = await auth.verifyIdToken(token, /* checkRevoked= */ true);

  // Admin SDK guarantees: alg=RS256, valid sig, exp, iat ≤ now+300s, aud, iss
  return {
    uid:      decoded.uid,
    email:    decoded.email    ?? null,
    // NOTE: role is NOT read from JWT — always fetched from RTDB per-request
    tenantId: decoded.tenantId ?? null,
  };
}

export async function requireAuth(req) {
  const header = typeof req.headers.get === "function"
    ? req.headers.get("authorization")
    : req.headers["authorization"];

  if (!header?.startsWith("Bearer ")) throw new Error("missing authorization header");
  return verifyFirebaseToken(header.slice(7));
}
