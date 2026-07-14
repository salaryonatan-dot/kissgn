// Type declarations for the runtime module lib/adminSdk.js.
// Adjacent to the .js so `import { getAdminDb } from "../../lib/adminSdk.js"`
// resolves under strict TypeScript. At runtime these return the shared Firebase
// Admin RTDB / Auth handles for the single default admin App.
import admin from "firebase-admin";

export function getAdminDb(): admin.database.Database;
export function getAdminAuth(): admin.auth.Auth;
