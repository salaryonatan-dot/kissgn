/**
 * Firebase Admin SDK initializer for Node.js serverless runtime.
 * Uses Service Account credentials from env vars — NO legacy database secret.
 *
 * Required env vars:
 *   FIREBASE_SA_PROJECT_ID
 *   FIREBASE_SA_CLIENT_EMAIL
 *   FIREBASE_SA_PRIVATE_KEY      (PEM, with literal \n for newlines)
 *   FIREBASE_DATABASE_URL
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase }                   from "firebase-admin/database";
import { getAuth }                       from "firebase-admin/auth";

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const projectId   = process.env.FIREBASE_SA_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_SA_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !clientEmail || !privateKey || !databaseURL) {
    throw new Error("Missing Firebase Admin SDK env vars");
  }

  return initializeApp({
    credential:  cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  });
}

export function getAdminDb()   { return getDatabase(getAdminApp()); }
export function getAdminAuth() { return getAuth(getAdminApp()); }
