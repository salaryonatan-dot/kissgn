/**
 * Firebase Admin SDK initializer for Node.js serverless runtime.
 *
 * Supports TWO modes (checked in order):
 *   1. FIREBASE_SA_JSON  — full service-account JSON (preferred, avoids escaping issues)
 *   2. Individual env vars: FIREBASE_SA_PROJECT_ID, FIREBASE_SA_CLIENT_EMAIL,
 *      FIREBASE_SA_PRIVATE_KEY (PEM, literal \n), FIREBASE_DATABASE_URL
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase }                   from "firebase-admin/database";
import { getAuth }                       from "firebase-admin/auth";

function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  // --- Mode 1: full JSON blob ---
  if (process.env.FIREBASE_SA_JSON) {
    const sa = JSON.parse(process.env.FIREBASE_SA_JSON);
    if (!databaseURL) throw new Error("Missing FIREBASE_DATABASE_URL env var");
    return initializeApp({
      credential: cert(sa),
      databaseURL,
    });
  }

  // --- Mode 2: individual env vars (legacy) ---
  const projectId   = process.env.FIREBASE_SA_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_SA_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
