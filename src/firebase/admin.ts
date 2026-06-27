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
  // The shared app initialized inside lib/adminSdk.js. getAdminDb() is
  // idempotent and guarantees the app exists before we read its handle.
  return getAdminDb().app;
}

export function getDb(): admin.database.Database {
  // Delegate to the single shared Admin RTDB handle.
  return getAdminDb();
}
