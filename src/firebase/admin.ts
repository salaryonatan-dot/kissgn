import admin from "firebase-admin";

let initialized = false;

export function getFirebaseAdmin(): admin.app.App {
  if (!initialized) {
    if (!admin.apps.length) {
      const raw = process.env.FIREBASE_SA_JSON
        || process.env.FIREBASE_SERVICE_ACCOUNT;
      const serviceAccount = raw ? JSON.parse(raw) : undefined;

      admin.initializeApp({
        credential: serviceAccount
          ? admin.credential.cert(serviceAccount)
          : admin.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL || undefined,
      });
    }
    initialized = true;
  }
  return admin.app();
}

export function getDb(): admin.database.Database {
  return getFirebaseAdmin().database();
}
