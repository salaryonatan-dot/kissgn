// Marjin — SERVER READER HARNESS: compiles the real server TypeScript modules into a
// temp directory (one compile per process), with ONLY the Firebase Admin seam
// (`src/firebase/admin.ts` → getDb()) and the email seam (`lib/sendEmail.js`) replaced,
// and provides an in-memory RTDB so every converted reader runs its real code against
// dual-form fixtures.
import { ROOT, compileServer, makeDb, offlineFetch } from "../../tools/storage-v2/reader-sandbox.mjs";
export { ROOT, compileServer, makeDb, offlineFetch };

export const T = "tenantA", B = "bizA";
export const KEY = (biz = B, tenant = T) => `tenants/${tenant}/biz:${biz}:entries`;
/** Seed a whole business: entries node + config/business/fixed so builders run. */
export function seedBusiness(db, { tenant = T, biz = B, entries, config = {}, fixed = [], businesses } = {}) {
  db.seed(KEY(biz, tenant), entries);
  db.seed(`tenants/${tenant}/biz:${biz}:config`, { _v: JSON.stringify({ businessName: "Biz " + biz, lat: 32.1, lon: 34.8, ...config }) });
  db.seed(`tenants/${tenant}/biz:${biz}:fixed`, { _v: JSON.stringify(fixed) });
  db.seed(`tenants/${tenant}/app/business`, { _v: JSON.stringify(businesses || [{ id: biz, name: "Biz " + biz }]) });
}
export function installDb(db) { globalThis.__DB = db; globalThis.__EMAILS = []; return db; }
