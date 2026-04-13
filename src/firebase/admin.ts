/**
 * Firebase Admin SDK initializer for TypeScript serverless modules.
 *
 * Matches env-var logic in lib/adminSdk.js:
 *   1. FIREBASE_SA_JSON  — full service-account JSON (preferred)
 *   2. Individual env vars: FIREBASE_SA_PROJECT_ID, FIREBASE_SA_CLIENT_EMAIL,
 *      FIREBASE_SA_PRIVATE_KEY, FIREBASE_DATABASE_URL
 *   3. Legacy: FIREBASE_SERVICE_ACCOUNT (kept for backward compat)
 */
import admin from "firebase-admin";

let initialized = false;

export function getFirebaseAdmin(): admin.app.App {
  if (!initialized) {
    if (!admin.apps.length) {
      const databaseURL = process.env.FIREBASE_DATABASE_URL;

      // Mode 1: full JSON blob (matches lib/adminSdk.js)
      if (process.env.FIREBASE_SA_JSON) {
        const sa = JSON.parse(process.env.FIREBASE_SA_JSON);
        admin.initializeApp({
          credential: admin.credential.cert(sa),
          databaseURL,
        });
      }
      // Mode 2: individual env vars (matches lib/adminSdk.js)
      else if (process.env.FIREBASE_SA_PROJECT_ID && process.env.FIREBASE_SA_CLIENT_EMAIL && process.env.FIREBASE_SA_PRIVATE_KEY) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_SA_PROJECT_ID,
            clientEmail: process.env.FIREBASE_SA_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_SA_PRIVATE_KEY.replace(/\\n/g, "\n"),
          }),
          databaseURL,
        });
      }
      // Mode 3: legacy FIREBASE_SERVICE_ACCOUNT (backward compat)
      else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(sa),
          databaseURL,
        });
      }
      // Fallback: application default credentials
      else {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          databaseURL,
        });
      }
    }
    initialized = true;
  }
  return admin.app();
}

export function getDb(): admin.database.Database {
  return getFirebaseAdmin().database();
}
