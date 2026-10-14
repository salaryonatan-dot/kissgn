// Daily e-mail delivery harness (test support; LOCAL ONLY — no network, no real e-mail, no Firebase).
//
// Builds a disposable sandbox of the REAL route `api/daily-snapshot/run.ts`, the REAL snapshot builder / e-mail presenter
// (`src/snapshot/*`), the REAL `lib/sendEmail.js`, `lib/securityContext.js`, `lib/helpers.js`, `lib/bizAccess.js` (and,
// when present, `lib/emailDelivery.js`), compiled with the project's TypeScript. Only these terminal seams are replaced:
//   • `src/firebase/admin.ts` / `lib/adminSdk.js` → the in-memory RTDB in globalThis.__DB (tools/storage-v2/reader-sandbox.mjs;
//                                                   receipt transactions follow the SDK's cold-cache protocol, see sdkTransactions)
//   • `lib/verifyToken.js`                         → globalThis.__DE.requireAuth (a verified identity or a throw)
//   • the `nodemailer` package                     → a CONTROLLED FAKE SMTP provider (globalThis.__SMTP)
// Everything else in node_modules is the real dependency tree (per-package symlinks).
//
// The fake provider records every message handed to `sendMail` (to, subject, messageId header, html length) and answers
// with a scripted behavior per call: accept, a nodemailer-shaped error, or hang (never settles). It never opens a socket.
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const FAKE_NODEMAILER = `
// CONTROLLED FAKE of nodemailer.createTransport (test only). No network.
// The transport may be cached by the module under test across scenarios: every call reads the CURRENT script.
function createTransport(options) {
  (globalThis.__SMTP_TRANSPORTS ||= []).push(options);
  return {
    sendMail(mail) {
      const S = globalThis.__SMTP;
      const call = { to: mail.to, subject: mail.subject, messageIdHeader: mail.messageId ?? null, htmlLength: String(mail.html || "").length, at: S.calls.length };
      S.calls.push(call);
      const behavior = S.next(call);
      return behavior(mail, call);
    },
  };
}
module.exports = { createTransport, default: { createTransport } };
`;

let built = null;
/** Compile the sandbox once per process (or a NEW one with { fresh: true }); returns { dir, route } (route = the default handler). */
export async function buildSandbox({ fresh = false } = {}) {
  if (built && !fresh) return built;
  const dir = mkdtempSync(join(tmpdir(), "daily-email-"));
  cpSync(join(REPO, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "api", "daily-snapshot"), { recursive: true });
  cpSync(join(REPO, "api", "daily-snapshot", "run.ts"), join(dir, "api", "daily-snapshot", "run.ts"));
  // node_modules: real packages by symlink, nodemailer replaced by the fake
  const realNm = realpathSync(join(REPO, "node_modules"));
  const nm = join(dir, "node_modules"); mkdirSync(nm);
  for (const name of readdirSync(realNm)) if (name !== "nodemailer") symlinkSync(join(realNm, name), join(nm, name));
  mkdirSync(join(nm, "nodemailer"));
  writeFileSync(join(nm, "nodemailer", "package.json"), JSON.stringify({ name: "nodemailer", version: "0.0.0-fake", main: "index.js" }));
  writeFileSync(join(nm, "nodemailer", "index.js"), FAKE_NODEMAILER);
  // seams
  writeFileSync(join(dir, "src", "firebase", "admin.ts"), `export function getDb(): any { return (globalThis as any).__DB; }\nexport function getFirebaseAdmin(): any { return null; }\n`);
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return null; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth(req) { return globalThis.__DE.requireAuth(req); }\nexport async function verifyIdToken(t) { return null; }\n`);
  const TSC = join(nm, "typescript", "bin", "tsc");
  const r = spawnSync("node", [TSC, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", "--allowJs", "false",
    join(dir, "api", "daily-snapshot", "run.ts")], { encoding: "utf8" });
  const out = join(dir, "api", "daily-snapshot", "run.js");
  if (!existsSync(out)) throw new Error("route compile failed:\n" + r.stdout + r.stderr);
  const route = (await import(pathToFileURL(out).href)).default;
  const sandbox = { dir, route, tscOutput: r.stdout + r.stderr, import: (rel) => import(pathToFileURL(join(dir, rel)).href) };
  if (!fresh) built = sandbox;
  return sandbox;
}

// ── fake provider behaviors (nodemailer 6.10.1 shapes: lib/smtp-connection/index.js _formatError) ──────────────────────
const smtpError = (message, code, { response, command, syscall } = {}) => {
  const e = new Error(message + (response ? ": " + response : ""));
  e.code = code;
  if (response) { e.response = response; const n = Number((response.match(/^\d+/) || [])[0]); if (n) e.responseCode = n; }
  if (command) e.command = command;
  if (syscall) e.syscall = syscall;
  return e;
};
export const SMTP = {
  accept: () => async (mail, call) => ({ messageId: mail.messageId || `<fake-${call.at}@smtp.test>`, accepted: [mail.to], rejected: [], response: "250 2.0.0 OK fake-queue-id" }),
  /** the server answered but listed the recipient as rejected (nodemailer resolves when some recipient was accepted) */
  acceptedNone: () => async (mail, call) => ({ messageId: `<fake-${call.at}@smtp.test>`, accepted: [], rejected: [mail.to], response: "250 2.0.0 OK" }),
  rejectRecipient: () => async () => { throw smtpError("Can't send mail - all recipients were rejected", "EENVELOPE", { response: "550 5.1.1 The email account that you tried to reach does not exist. recipient@example.test", command: "RCPT TO" }); },
  transient: () => async () => { throw smtpError("Message failed", "EMESSAGE", { response: "421 4.7.0 Try again later, closing connection.", command: "DATA" }); },
  authFailure: () => async () => { throw smtpError("Invalid login", "EAUTH", { response: "535-5.7.8 Username and Password not accepted.", command: "AUTH PLAIN" }); },
  connectRefused: () => async () => { throw smtpError("connect ECONNREFUSED 142.250.0.1:465", "ESOCKET", { command: "CONN", syscall: "connect" }); },
  connectTimeout: () => async () => { throw smtpError("Connection timeout", "ETIMEDOUT", { command: "CONN" }); },
  /** an inactivity timeout: nodemailer reports it as ETIMEDOUT / CONN whatever the phase — possibly after DATA */
  socketTimeout: () => async () => { throw smtpError("Timeout", "ETIMEDOUT", { command: "CONN" }); },
  /** the connection dropped after the message was transmitted, before the final 250 reached us */
  closedAfterData: () => async () => { throw smtpError("Connection closed unexpectedly", "ECONNECTION", { command: "CONN" }); },
  /** never settles (a stalled SMTP session) */
  hang: () => () => new Promise(() => {}),
};

/** Reset the provider script: `script` is an array of behaviors consumed per sendMail call; the last one repeats. */
export function installSmtp(script = [SMTP.accept()]) {
  const list = [...script];
  globalThis.__SMTP = { calls: [], get transportOptions() { return globalThis.__SMTP_TRANSPORTS || []; }, next: () => (list.length > 1 ? list.shift() : list[0]) };
  return globalThis.__SMTP;
}

/**
 * Model the Admin SDK's ref().transaction() as the real RTDB client runs it (established on the local emulator,
 * test/emulator/de1-receipt-emulator.mjs): the update function is FIRST called with the client's cached value — null when
 * the path is not cached, which is a server route's normal state (no listeners) — and an `undefined` return then aborts the
 * transaction WITHOUT consulting the server. A defined return is sent with the cached value's hash; on a mismatch the
 * server's value is fed back and the function re-runs.
 */
export function sdkTransactions(db, prefix = "") {
  const ref = db.ref;
  db.ref = (p, q) => {
    const x = ref(p, q);
    if (!String(p).startsWith(prefix)) return x;
    return { ...x, transaction: async (fn) => {
      let guess = null;
      for (let run = 0; run < 25; run++) {
        const next = fn(guess);
        if (next === undefined) return { committed: false, snapshot: { val: () => guess, exists: () => guess !== null } };
        const server = db.read(p) === undefined ? null : db.read(p);
        if (JSON.stringify(server) !== JSON.stringify(guess)) { guess = server; continue; }
        return x.transaction(() => next);
      }
      throw new Error("maxretry");
    } };
  };
  return db;
}

export const T = "tenantA", B = "bizA", B2 = "bizB", T2 = "tenantB", B3 = "bizC";
const env = (v) => ({ _v: JSON.stringify(v) });
/** a completed day with revenue, purchases and payroll (VAT-net strings) */
const day = (date, n) => ({ id: `de000000-0000-4000-8000-${String(n).padStart(12, "0")}`, date, sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" });
// HR1 (Daily-only delivery hold; T-HR1-TEST-SEED): the gates hold every Daily unless a well-formed, logged "released" record
// exists (absent = held, fail closed). This is only a test fixture; it does not authorize a bootstrap release.
// The world is seeded with that released record so every pre-HR1 scenario keeps its meaning; `hold: "absent"` leaves it out.
export const HOLD_PATH = "delivery_control/daily_snapshot";
export function releasedHoldRecord(at = 0) {
  return { schema: 1, state: "released", version: 2, log: {
    v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "fixture", reason: "fixture bootstrap", at },
    v000000002: { action: "release", state: "released", version: 2, prevVersion: 1, actor: "fixture", reason: "fixture release", at } } };
}
export function seedWorld({ withSecondBiz = true, withSecondTenant = true, ownerEmail = "owner-a@example.test", tenantBOwner = "owner-b@example.test", users, hold = "released" } = {}) {
  const db = makeDb();
  if (hold === "released") db.seed(HOLD_PATH, releasedHoldRecord());
  const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];
  const seedBiz = (t, b, name) => {
    db.seed(`tenants/${t}/biz:${b}:entries`, env(days.map((d, i) => day(d, i + 1))));
    db.seed(`tenants/${t}/biz:${b}:config`, env({ businessName: name }));
    db.seed(`tenants/${t}/biz:${b}:fixed`, env([]));
  };
  seedBiz(T, B, "מסעדה א");
  if (withSecondBiz) seedBiz(T, B2, "מסעדה ב");
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, ...(withSecondBiz ? [{ id: B2, name: "מסעדה ב" }] : [])]));
  db.seed(`tenants/${T}/app/users`, env(users || [{ id: 1, name: "Owner A", email: ownerEmail, role: "owner", firebaseUid: "u_owner_a" }, { id: 2, name: "Viewer", email: "viewer-a@example.test", role: "viewer", firebaseUid: "u_viewer_a" }]));
  db.seed(`tenants/${T}/members/u_owner_a`, true); db.seed(`tenants/${T}/roles/u_owner_a`, "owner");
  db.seed(`tenants/${T}/members/u_viewer_a`, true); db.seed(`tenants/${T}/roles/u_viewer_a`, "viewer");
  if (withSecondTenant) {
    seedBiz(T2, B3, "מסעדה ג");
    db.seed(`tenants/${T2}/app/business`, env([{ id: B3, name: "מסעדה ג" }]));
    db.seed(`tenants/${T2}/app/users`, env([{ id: 1, name: "Owner B", email: tenantBOwner, role: "owner", firebaseUid: "u_owner_b" }]));
    db.seed(`tenants/${T2}/members/u_owner_b`, true); db.seed(`tenants/${T2}/roles/u_owner_b`, "owner");
  }
  sdkTransactions(db, RECEIPTS);
  globalThis.__DB = db;
  return db;
}

/** Fix the process clock (the builder and the route read Date.now()). Returns a restore function. */
export function freezeClock(ms) {
  const real = Date.now;
  Date.now = () => ms;
  return () => { Date.now = real; };
}

export function mkRes() {
  const x = { statusCode: 0, body: null, headers: {} };
  x.setHeader = (k, v) => { x.headers[k] = v; };
  x.status = (c) => { x.statusCode = c; return x; };
  x.json = (b) => { x.body = b; return x; };
  x.end = () => x;
  return x;
}
export const CRON_SECRET = "fixture-cron-secret-daily-email";   // deterministic test value, not a real secret
export async function runCron(route) {
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  const res = mkRes();
  await route({ method: "GET", headers: { authorization: "Bearer " + CRON_SECRET }, query: {}, body: undefined }, res);
  return res;
}
export async function runManual(route, { uid = "u_owner_a", email = "owner-a@example.test", tenantId = T, bizId = B } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => (uid ? { uid, email } : (() => { throw new Error("no auth"); })()) };
  const res = mkRes();
  await route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body: { tenantId, bizId } }, res);
  return res;
}
/** capture console output during fn (to assert that no secret / address is logged) */
export async function captureConsole(fn) {
  const lines = [], orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  try { return { value: await fn(), lines }; } finally { Object.assign(console, orig); }
}
export const RECEIPTS = "email_delivery/daily_snapshot";
