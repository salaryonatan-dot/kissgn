/**
 * Vercel Serverless Function: /api/create-tenant
 *
 * Creates a new tenant using Firebase Admin SDK (bypasses RTDB rules).
 * This is the "backup" approach — the client calls this endpoint
 * if direct RTDB writes fail due to permission errors.
 *
 * SETUP:
 * 1. Place this file at: api/create-tenant.js (in your Vercel project root)
 * 2. Add these environment variables in Vercel:
 *    - FIREBASE_PROJECT_ID
 *    - FIREBASE_CLIENT_EMAIL
 *    - FIREBASE_PRIVATE_KEY (the full PEM key, with \n escaped)
 *    - FIREBASE_DATABASE_URL (e.g., https://your-project-default-rtdb.firebaseio.com)
 * 3. Install: npm install firebase-admin
 *
 * REQUEST (POST):
 * {
 *   "tenantId": "biz_1234567890",
 *   "firebaseUid": "abc123...",
 *   "ownerEmail": "user@example.com",
 *   "ownerUsername": "username",
 *   "ownerName": "Display Name"
 * }
 *
 * The function verifies the Firebase ID token from the Authorization header
 * to ensure the request is from an authenticated user.
 */

const admin = require("firebase-admin");

// Initialize Admin SDK (singleton)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

module.exports = async function handler(req, res) {
  // CORS — strict origin, never wildcard with auth
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://kissgn.vercel.app";
  const incomingOrigin = req.headers.origin || "";
  if (incomingOrigin && incomingOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Verify Firebase ID token ───────────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: "Missing Authorization header (Bearer <idToken>)" });
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token", detail: e.message });
  }

  const callerUid = decodedToken.uid;

  // ── Parse body ─────────────────────────────────────────────────────────────
  const { tenantId, firebaseUid, ownerEmail, ownerUsername, ownerName } = req.body || {};
  if (!tenantId || !firebaseUid) {
    return res.status(400).json({ error: "tenantId and firebaseUid are required" });
  }

  // Security: the caller must be the same user as firebaseUid
  if (callerUid !== firebaseUid) {
    return res.status(403).json({ error: "firebaseUid does not match authenticated user" });
  }

  // ── Check tenant doesn't already have members (prevent hijacking) ──────────
  try {
    const membersSnap = await db.ref(`tenants/${tenantId}/members`).once("value");
    if (membersSnap.exists()) {
      return res.status(409).json({ error: "Tenant already has members. Cannot bootstrap." });
    }
  } catch (e) {
    return res.status(500).json({ error: "Failed to check tenant", detail: e.message });
  }

  // ── Atomic multi-path write (Admin SDK bypasses all rules) ─────────────────
  const updates = {};
  updates[`tenants/${tenantId}/members/${firebaseUid}`] = true;
  updates[`tenants/${tenantId}/roles/${firebaseUid}`] = "super_owner";
  updates[`user_tenants/${firebaseUid}`] = tenantId;

  if (ownerUsername) {
    const unameLower = ownerUsername.toLowerCase();
    updates[`tenants/${tenantId}/lookup/${unameLower}`] = {
      email: ownerEmail || "",
      firebaseUid,
    };
    updates[`username_index/${unameLower}`] = {
      tenantId,
      email: ownerEmail || "",
    };
  }

  try {
    await db.ref().update(updates);
    return res.status(200).json({
      success: true,
      tenantId,
      firebaseUid,
      message: "Tenant bootstrapped successfully",
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to write tenant data", detail: e.message });
  }
};
