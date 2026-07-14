/**
 * Firebase Admin accessor for TypeScript serverless modules.
 *
 * SINGLE SOURCE OF TRUTH: this module no longer initializes Firebase Admin on
 * its own. It delegates to lib/adminSdk.js (the same initializer used by
 * requireAuth / requireTenantAccess), so the ENTIRE codebase shares ONE Admin
 * app and ONE Realtime Database connection.
 *
 * Why: previously this file initialized a SEPARATE (namespaced) admin app. In
 * any request that first initialized the modular app via requireAuth /
 * requireTenantAccess (e.g. api/proactive/run.ts read paths) and then read
 * through getDb() here, the first read would hang. Routing everything through
 * lib/adminSdk.js removes that split.
 *
 * Public API is unchanged: getFirebaseAdmin() and getDb() keep the same
 * signatures, so existing imports (all of which import only getDb) keep working.
 */
import admin from "firebase-admin";
import { getAdminDb } from "../../lib/adminSdk.js";

export function getFirebaseAdmin(): admin.app.App {
  // getAdminDb() is idempotent and guarantees the single shared admin app is
  // initialized. Return it via the admin namespace API (typed admin.app.App)
  // rather than getAdminDb().app, which the firebase-admin RTDB types expose as
  // the narrower, incompatible modular FirebaseApp.
  getAdminDb();
  return admin.app();
}

export function getDb(): admin.database.Database {
  // Delegate to the single shared Admin RTDB handle.
  return getAdminDb();
}
