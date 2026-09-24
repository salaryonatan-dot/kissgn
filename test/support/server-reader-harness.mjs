// Marjin — SERVER READER HARNESS: compiles the real server TypeScript modules into a
// temp directory (one compile per process), with ONLY the Firebase Admin seam
// (`src/firebase/admin.ts` → getDb()) and the email seam (`lib/sendEmail.js`) replaced,
// and provides an in-memory RTDB so every converted reader runs its real code against
// dual-form fixtures.
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSC = process.env.TSC_BIN || join(ROOT, "node_modules", "typescript", "bin", "tsc");

let compiled = null;
/** Compile once; returns { dir, import(rel) } where rel is e.g. "src/analytics/dailyBuilder.js". */
export function compileServer() {
  if (compiled) return compiled;
  if (!existsSync(TSC)) throw new Error("typescript not found at " + TSC);
  const dir = mkdtempSync(join(tmpdir(), "srv-readers-"));
  cpSync(join(ROOT, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  try { symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  // seams
  writeFileSync(join(dir, "src", "firebase", "admin.ts"), `export function getDb(): any { return (globalThis as any).__DB; }\nexport function getFirebaseAdmin(): any { return null; }\n`);
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return null; }\n`);
  writeFileSync(join(dir, "lib", "sendEmail.js"), `export async function sendEmail(to, subject, html) { (globalThis.__EMAILS ||= []).push({ kind: "email", to, subject }); return { messageId: "m" }; }\nexport async function sendAlertDigest(to, bizName, alerts) { (globalThis.__EMAILS ||= []).push({ kind: "digest", to, bizName, alerts }); return { messageId: "d" }; }\n`);
  const entries = ["src/analytics/dailyBuilder.ts", "src/snapshot/snapshotBuilder.ts", "src/alerts/checkers.ts", "src/alerts/runner.ts",
    "src/repositories/analytics/dailyMetricsRepo.ts", "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts",
    "src/services/analyticsService.ts", "src/agent/proactive/runProactiveJob.ts",
    "src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts"].map((f) => join(dir, f));
  const r = spawnSync("node", [TSC, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", "--allowJs", "false", ...entries], { encoding: "utf8" });
  if (!existsSync(join(dir, "src", "analytics", "dailyBuilder.js")) || !existsSync(join(dir, "src", "services", "analyticsService.js"))) {
    throw new Error("server compile failed:\n" + r.stdout + r.stderr);
  }
  compiled = { dir, import: (rel) => import(pathToFileURL(join(dir, rel)).href), tscOutput: (r.stdout || "") + (r.stderr || "") };
  return compiled;
}

// ── in-memory RTDB (the subset the readers/writers use) ──────────────────────
export function makeDb() {
  const store = {};                       // nested plain object
  const writes = [];
  const getAt = (path) => { let cur = store; for (const p of path.split("/").filter(Boolean)) { if (cur === null || typeof cur !== "object" || !(p in cur)) return null; cur = cur[p]; } return cur === undefined ? null : cur; };
  const setAt = (path, value) => {
    const parts = path.split("/").filter(Boolean); let cur = store;
    for (let i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] === null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {}; cur = cur[parts[i]]; }
    if (value === null || value === undefined) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  };
  // Key-range queries (orderByKey().startAt(a).endAt(b).limitToLast(n)) filter
  // the CHILD KEYS of the node, like RTDB. Other orderings are unfiltered.
  const applyQuery = (v, q) => {
    if (v === null || typeof v !== "object" || !q || q.order !== "key") return v;
    let keys = Object.keys(v).sort();
    if (q.startAt !== undefined) keys = keys.filter((k) => k >= q.startAt);
    if (q.endAt !== undefined) keys = keys.filter((k) => k <= q.endAt);
    if (q.limitToLast !== undefined) keys = keys.slice(Math.max(0, keys.length - q.limitToLast));
    if (keys.length === 0) return null;
    const out = {}; for (const k of keys) out[k] = v[k]; return out;
  };
  const snap = (path, q) => { const v = applyQuery(getAt(path), q); return { val: () => (v === null ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== null, key: path.split("/").pop() }; };
  const ref = (path, q = null) => ({
    child: (c) => ref(path + "/" + c),
    once: async (ev) => snap(path, q),
    get: async () => snap(path, q),   // Admin SDK `ref.get()` shape (helpers/securityContext use it)
    set: async (v) => { writes.push({ op: "set", path, value: JSON.parse(JSON.stringify(v ?? null)) }); setAt(path, v); },
    update: async (v) => { writes.push({ op: "update", path, value: v }); for (const [k, x] of Object.entries(v)) setAt(path + "/" + k, x); },
    remove: async () => { writes.push({ op: "remove", path }); setAt(path, null); },
    orderByChild: () => ref(path, { ...(q || {}), order: "child" }),
    orderByKey: () => ref(path, { ...(q || {}), order: "key" }),
    startAt: (k) => ref(path, { ...(q || {}), startAt: k }),
    endAt: (k) => ref(path, { ...(q || {}), endAt: k }),
    limitToLast: (n) => ref(path, { ...(q || {}), limitToLast: n }),
    transaction: async (fn) => { const next = fn(getAt(path)); if (next === undefined) return { committed: false }; setAt(path, next); writes.push({ op: "txn", path }); return { committed: true, snapshot: snap(path) }; },
  });
  return { ref, seed: setAt, read: getAt, writes, store };
}
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
export function offlineFetch() { globalThis.fetch = async () => { throw new Error("offline"); }; }
