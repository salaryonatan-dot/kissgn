// Agent/Daily integration I4 — the real admin API (api/admin.js) and its helpers, run against a REFERENCE-RECORDING database whose
// every path is checked by the REAL Firebase Admin SDK path constructor (offline app; no network). Only token verification, the
// Admin construction, Firebase Auth and e-mail are seams, and each seam records its calls. The rate limiter's Upstash transport
// is observed through a recording `fetch` (offline), so "before any rate-limiter call" is measurable.
//
// `source: "HEAD"` runs the checked-out bytes; `source: <commit>` runs that commit's bytes of the files I4 changes (read from git
// objects) with everything else identical — the parent-parity half of DB-14.
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const I4_RUNTIME = ["api/admin.js", "lib/helpers.js", "lib/businessRegistry.js", "lib/bizAccess.js"];
export const CTRL = [...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), "\u007f"];   // the D-CTRL class, 33 code points
export const withCtrl = (base, c) => [base + c, c + base, base.slice(0, 3) + c + base.slice(3)];   // suffix, prefix, middle
export const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const env = (x) => ({ _v: JSON.stringify(x) });

export function seed() {
  return {
    tenants: {
      tenantA: {
        members: { own: true, mgr: true, super: true, view: true, sub1: true },
        roles: { own: "owner", mgr: "manager", super: "super_owner", view: "viewer", sub1: "viewer" },
        biz_access: { bizA: { mgr: true, view: true, sub1: true }, bizB: { sub2: true } },
        app: {
          business: env([{ id: "bizA", name: "Alpha", createdAt: 1 }, { id: "bizB", name: "Beta", createdAt: 2 }]),
          users: env([
            { role: "owner", name: "Owner", email: "own@example.test", username: "own", firebaseUid: "own" },
            { role: "viewer", name: "Sub", email: "sub1@example.test", username: "sub1", firebaseUid: "sub1", allowedBizIds: ["bizA"] },
          ]),
        },
        users: { sub1: { username: "sub1", name: "Sub", email: "sub1@example.test", phone: "", role: "viewer", allowedBizIds: ["bizA"] } },
        lookup: { own: { email: "own@example.test", firebaseUid: "own" } },
        meta: { inviteLink: "https://app.example.test/?login=1&hint=own", createdAt: 1 },
      },
      "t:1": { members: { own: true }, roles: { own: "owner" }, app: { business: env([{ id: "bizA", name: "Colon" }]) } },
      tenantB: { members: { foreign: true }, roles: { foreign: "owner" }, app: { business: env([{ id: "foreignBiz" }]) } },
    },
    user_tenants: { own: "tenantA", sub1: "tenantA" },
    username_index: { own: { tenantId: "tenantA", email: "own@example.test" } },
  };
}

/** The real Admin SDK's path validation, offline (no connection is ever opened: only Reference construction is used). */
let SDK = null;
export async function realSdk() {
  if (SDK) return SDK;
  const require = createRequire(join(ROOT, "package.json"));
  const admin = require("firebase-admin");
  const app = admin.initializeApp({ databaseURL: "https://i4-dctrl-boundary-offline.firebaseio.com" }, `i4-boundary-${process.pid}`);
  SDK = { db: app.database(), app };
  return SDK;
}
export async function closeSdk() { if (SDK) { const a = SDK.app; SDK = null; await a.delete(); } }

/** In-memory RTDB with the Admin SDK surface the handlers use; EVERY reference is recorded and passed through the real SDK. */
export function recordingDb(sdk, initial = seed()) {
  let data = clone(initial);
  let pushN = 0;
  const db = { refs: [], refused: [], updates: [], writes: [] };
  const keys = (p) => (p === undefined || p === null ? [] : String(p).split("/").filter(Boolean));
  db.reset = (v = seed()) => { data = clone(v); pushN = 0; db.refs.length = 0; db.refused.length = 0; db.updates.length = 0; db.writes.length = 0; };
  db.value = () => clone(data);
  db.read = (p) => clone(keys(p).reduce((v, k) => (v == null ? undefined : v[k]), data) ?? null);
  db.put = (p, value) => {
    const ks = keys(p);
    if (!ks.length) { data = clone(value) ?? {}; return; }
    let v = data; for (const k of ks.slice(0, -1)) { if (v[k] === null || typeof v[k] !== "object") v[k] = {}; v = v[k]; }
    if (value === null || value === undefined) delete v[ks.at(-1)]; else v[ks.at(-1)] = clone(value);
  };
  const snap = (v, key) => ({ val: () => clone(v), exists: () => v !== null && v !== undefined, hasChildren: () => v !== null && typeof v === "object" && Object.keys(v).length > 0, key });
  const validate = (p) => {
    try { if (p === undefined) sdk.ref(); else sdk.ref(p); }
    catch (e) { db.refused.push({ path: p, message: String(e?.message) }); throw e; }
  };
  db.ref = (p) => {
    validate(p);
    db.refs.push(p === undefined ? "(root)" : p);
    const ref = {
      get: async () => snap(db.read(p), keys(p).at(-1) ?? null),
      once: async () => snap(db.read(p), keys(p).at(-1) ?? null),
      set: async (v) => { db.writes.push(p); db.put(p, v); },
      remove: async () => { db.writes.push(p); db.put(p, null); },
      update: async (o) => {
        const base = keys(p).join("/");
        for (const k of Object.keys(o)) validate(base ? `${base}/${k}` : k);   // the SDK refuses an invalid key before writing anything
        for (const [k, v] of Object.entries(o)) { const full = base ? `${base}/${k}` : k; db.updates.push(full); db.put(full, v); }
      },
      transaction: async (fn) => {
        const cur = db.read(p); const next = fn(cur);
        if (next === undefined) return { committed: false, snapshot: snap(cur) };
        db.writes.push(p); db.put(p, next); return { committed: true, snapshot: snap(next) };
      },
      push: () => { pushN += 1; const key = `-push${String(pushN).padStart(4, "0")}`; return db.ref(`${keys(p).join("/")}/${key}`); },
      child: (c) => db.ref(`${keys(p).join("/")}/${c}`),
      key: keys(p).at(-1) ?? null,
    };
    return ref;
  };
  return db;
}

const git = (args) => spawnSync("git", ["-C", ROOT, ...args], { encoding: "buffer", maxBuffer: 1 << 28 });
/** Bytes of a file at a commit (the parent half of the parity harness). */
export function bytesAt(commit, file) {
  const r = git(["cat-file", "blob", `${commit}:${file}`]);
  if (r.status !== 0) throw new Error(`${commit}:${file} unreadable`);
  return r.stdout;
}

/**
 * One isolated copy of api/admin.js + lib + fincore wired to the recording seams. Returns
 *   { call(action, body, actor, method), db, auth, emails, limiter, helpers(), bizAccess(), registry() }.
 */
export async function adminHarness({ source = "HEAD" } = {}) {
  const sdk = (await realSdk()).db;
  const dir = mkdtempSync(join(tmpdir(), "i4-boundary-"));
  for (const f of ["lib", "fincore"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  mkdirSync(join(dir, "api"));
  cpSync(join(ROOT, "api/admin.js"), join(dir, "api/admin.js"));
  if (source !== "HEAD") for (const f of I4_RUNTIME) writeFileSync(join(dir, f), bytesAt(source, f));
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const key = "__i4h_" + dir;
  const db = recordingDb(sdk);
  const auth = { calls: [] };
  for (const m of ["createUser", "updateUser", "deleteUser", "getUser", "getUserByEmail"])
    auth[m] = async (...a) => { auth.calls.push([m, ...clone(a)]); return m === "createUser" ? { uid: "newuid" } : { uid: a[0] || "u", email: "x@example.test", displayName: "x" }; };
  const emails = [];
  const limiter = [];
  globalThis[key] = { db, auth, emails };
  writeFileSync(join(dir, "lib/adminSdk.js"), `export function getAdminDb(){return globalThis[${JSON.stringify(key)}].db} export function getAdminAuth(){return globalThis[${JSON.stringify(key)}].auth}`);
  writeFileSync(join(dir, "lib/verifyToken.js"), 'export async function requireAuth(req){if(!req.__claims)throw Error("no auth");return req.__claims} export async function verifyToken(){return null}');
  writeFileSync(join(dir, "lib/sendEmail.js"), `export async function sendEmail(...a){globalThis[${JSON.stringify(key)}].emails.push(a)} export async function sendAlertDigest(){}`);
  const handler = (await import(pathToFileURL(join(dir, "api/admin.js")).href)).default;
  const mod = (f) => import(pathToFileURL(join(dir, f)).href);
  const call = async (action, body = {}, actor = "own", method = "POST") => {
    const res = { code: 0, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; }, end() { return this; } };
    const prevFetch = globalThis.fetch;
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL, prevTok = process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.offline.invalid"; process.env.UPSTASH_REDIS_REST_TOKEN = "offline";
    globalThis.fetch = async (url) => { limiter.push(String(url)); return { ok: true, json: async () => [{ result: 1 }, { result: 1 }] }; };
    try {
      await handler({ method, query: { action, ...(method === "GET" ? body : {}) }, body: method === "GET" ? {} : body,
        headers: { "x-forwarded-for": "198.51.100.7" }, __claims: actor ? { uid: actor, email: actor + "@example.test" } : null }, res);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
      if (prevTok === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = prevTok;
    }
    return res;
  };
  const reset = (v) => { db.reset(v); auth.calls.length = 0; emails.length = 0; limiter.length = 0; };
  return { call, reset, db, auth, emails, limiter, dir,
    helpers: () => mod("lib/helpers.js"), bizAccess: () => mod("lib/bizAccess.js"), registry: () => mod("lib/businessRegistry.js") };
}

/** Everything observable about one call: response, references (built + SDK-refused), Auth, e-mail, limiter, final state. */
export function observe(h, res) {
  return { status: res.code, body: clone(res.body), refs: [...h.db.refs], refused: h.db.refused.map((r) => r.path), auth: clone(h.auth.calls),
    emails: h.emails.length, limiter: h.limiter.length, state: h.db.value() };
}
