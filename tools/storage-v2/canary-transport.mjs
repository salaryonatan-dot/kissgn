// Storage V2 — CANARY TOOLING: environment gate and scoped transports.
//
// HARD BOUNDARY — this module:
//   • initialises ONE named Firebase Admin app from an EXPLICIT manifest + credentials file
//     (production) or the demo emulator (tests); refuses inherited/default apps and any
//     environment that does not match the manifest, fail closed;
//   • exposes reads for the EXACT derived paths of one business only — no generic `ref(path)`,
//     no listing, no parent reads; permission/transport errors are typed, never "absent";
//   • exposes write capabilities ONLY on a `writable` transport (execute mode): the policy
//     CAS adapter for tools/storage-v2/policy.mjs and the SOURCE-BOUND entries transaction
//     for the unchanged tools/storage-v2/upgrade.mjs; a read-only transport has no write
//     method at all, and a dry-run transport throws `dry_run` if a write is reached;
//   • contains no clear-all, no raw set/remove of entries, no restore.

import { readFileSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import admin from "firebase-admin";
import { CanaryError, EXIT, derivePaths, digestV1, sha256Hex } from "./canary-contract.mjs";

// ── environment gate (pure; fully unit-testable with a fake env) ──────────────
export function resolveEnvironment({ manifest, envFlag, credentialsFile, processEnv = process.env, adminApps = admin.apps, fsStat = statSync, fsExists = existsSync, readFile = readFileSync }) {
  const fail = (code, detail) => { throw new CanaryError(code, detail, EXIT.ENV); };
  if (!envFlag) fail("environment_not_explicit", "--env production|emulator is required");
  if (envFlag !== manifest.environment) fail("environment_mismatch", `--env ${envFlag} but manifest.environment is ${manifest.environment}`);
  if (adminApps.length > 0) fail("foreign_admin_app", `${adminApps.length} Admin app(s) already initialised in this process`);
  const emuHost = processEnv.FIREBASE_DATABASE_EMULATOR_HOST;
  const forbiddenCreds = ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SA_JSON", "FIREBASE_SA_PRIVATE_KEY", "FIREBASE_SA_CLIENT_EMAIL"].filter((k) => processEnv[k]);
  if (envFlag === "emulator") {
    if (!emuHost || !/^(127\.0\.0\.1|localhost):\d+$/.test(emuHost)) fail("emulator_host_required", "FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:<port> is required");
    const gp = processEnv.GCLOUD_PROJECT || processEnv.GOOGLE_CLOUD_PROJECT;
    if (!gp || !/^demo-/.test(gp) || gp !== manifest.projectId) fail("emulator_project_required", `GCLOUD_PROJECT must be the demo project ${manifest.projectId}`);
    if (!manifest.databaseURL.includes(emuHost)) fail("emulator_url_mismatch", `manifest.databaseURL does not target ${emuHost}`);
    if (forbiddenCreds.length) fail("credentials_forbidden_in_emulator", forbiddenCreds.join(","));
    if (credentialsFile) fail("credentials_forbidden_in_emulator", "--credentials-file is not accepted in emulator mode");
    return Object.freeze({ mode: "emulator", databaseURL: manifest.databaseURL, projectId: manifest.projectId, emulatorHost: emuHost, credentialsFile: null });
  }
  // production
  if (emuHost) fail("emulator_host_set_in_production", "FIREBASE_DATABASE_EMULATOR_HOST must be unset for production");
  if (forbiddenCreds.length) fail("credentials_env_forbidden", "credentials must come from --credentials-file only: " + forbiddenCreds.join(","));
  for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"]) if (processEnv[k] && processEnv[k] !== manifest.projectId) fail("project_env_mismatch", `${k}=${processEnv[k]}`);
  if (!credentialsFile) fail("credentials_file_required", "--credentials-file <service-account.json> is required in production");
  if (!fsExists(credentialsFile)) fail("credentials_file_missing", credentialsFile);
  const st = fsStat(credentialsFile);
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) fail("credentials_file_permissions", `mode ${(st.mode & 0o777).toString(8)} (need 0600)`);
  let sa; try { sa = JSON.parse(readFile(credentialsFile, "utf8")); } catch (e) { fail("credentials_file_unreadable", e.message); }
  if (!sa || sa.type !== "service_account" || !sa.client_email || !sa.private_key) fail("credentials_file_shape", "not a service-account JSON");
  if (sa.project_id !== manifest.projectId) fail("credentials_project_mismatch", `${sa.project_id} ≠ ${manifest.projectId}`);
  return Object.freeze({ mode: "production", databaseURL: manifest.databaseURL, projectId: manifest.projectId, emulatorHost: null, credentialsFile, serviceAccount: sa });
}

export function createAdminApp(env, manifest) {
  if (admin.apps.length > 0) throw new CanaryError("foreign_admin_app", String(admin.apps.length), EXIT.ENV);
  const name = "canary-" + manifest.operation.id;
  const app = env.mode === "emulator"
    ? admin.initializeApp({ databaseURL: env.databaseURL, projectId: env.projectId }, name)
    : admin.initializeApp({ credential: admin.credential.cert(env.serviceAccount), databaseURL: env.databaseURL, projectId: env.projectId }, name);
  if (app.options.databaseURL !== manifest.databaseURL) throw new CanaryError("database_url_mismatch", app.options.databaseURL, EXIT.ENV);
  return app;
}

const denied = (e) => /permission[_ ]denied/i.test(String((e && (e.message || "")) + (e && e.code || "")));
async function readAt(db, path) {
  try { const s = await db.ref(path).once("value"); return { ok: true, value: s.exists() ? s.val() : null }; }
  catch (e) { return { ok: false, error: denied(e) ? "permission_denied" : "read_failed:" + (e && e.message) }; }
}

/**
 * Scoped transport for one business. `writable:false` ⇒ no write method exists.
 * `dryRun:true` ⇒ write methods exist but throw `dry_run` when reached (so command code paths are exercised).
 */
export function createTransport({ app, manifest, writable = false, dryRun = false }) {
  const db = app.database(), P = derivePaths(manifest);
  const t = manifest.tenantId, b = manifest.bizId;
  const listeners = [];
  const api = {
    paths: P,
    readEntries: () => readAt(db, P.entries),
    readControl: () => readAt(db, P.control),
    readExceptions: () => readAt(db, P.exceptions),
    readContext: async () => { const [config, fixed, suppliers] = await Promise.all([readAt(db, P.config), readAt(db, P.fixed), readAt(db, P.suppliers)]); return { config, fixed, suppliers }; },
    readDerived: async (date) => ({ analyticsDaily: await readAt(db, P.analyticsDaily(date)), insightsDaily: await readAt(db, P.insightsDaily(date)), proactiveDigest: await readAt(db, P.proactiveDigest(date)) }),
    // insights are keyed by insight id with ISO timestamps; the per-business node is bounded, so read it and filter by day
    readProactiveInsightsForDate: async (date) => { const r = await readAt(db, P.proactiveInsights); if (!r.ok) return r; const all = r.value && typeof r.value === "object" ? r.value : {}; const onDay = Object.fromEntries(Object.entries(all).filter(([, v]) => v && typeof v === "object" && [v.lastDetectedAt, v.createdAt, v.detectedAt, v.date].some((x) => typeof x === "string" && x.startsWith(date)))); return { ok: true, value: Object.keys(onDay).length ? onDay : null }; },
    /** Warm, retained listener on the entries node (returns the first snapshot value). */
    warmEntries: () => new Promise((resolve, reject) => { const ref = db.ref(P.entries); const h = ref.on("value", (s) => resolve(s.exists() ? s.val() : null), (e) => reject(e)); listeners.push(() => ref.off("value", h)); }),
    /** One-shot wait for the next change of the entries node (live-check observation). */
    awaitEntriesChange: (timeoutMs) => new Promise((resolve) => { const ref = db.ref(P.entries); let first = true; const h = ref.on("value", (s) => { if (first) { first = false; return; } ref.off("value", h); resolve({ changed: true, value: s.exists() ? s.val() : null }); }); listeners.push(() => ref.off("value", h)); setTimeout(() => { ref.off("value", h); resolve({ changed: false }); }, timeoutMs); }),
    detach: () => { while (listeners.length) { try { listeners.pop()(); } catch (_) {} } },
    /** Deployed Rules text via the REST settings endpoint (read-only). */
    readRulesText: async () => {
      try {
        const base = manifest.databaseURL.replace(/\/?$/, "");
        const [urlBase, ns] = base.includes("?ns=") ? base.split("?ns=") : [base, null];
        let headers;
        if (manifest.environment === "emulator") headers = { Authorization: "Bearer owner" };
        else { const tok = await app.options.credential.getAccessToken(); headers = { Authorization: "Bearer " + tok.access_token }; }
        const res = await fetch(`${urlBase}/.settings/rules.json${ns ? "?ns=" + ns : ""}`, { headers });
        if (!res.ok) return { ok: false, error: "rules_http_" + res.status };
        return { ok: true, text: await res.text() };
      } catch (e) { return { ok: false, error: "rules_fetch_failed:" + (e && e.message) }; }
    },
    policyIo: {
      readControl: async () => { const r = await readAt(db, P.control); if (!r.ok) throw new CanaryError("read_failed", r.error); return r.value; },
      readEntriesNode: async () => { const r = await readAt(db, P.entries); if (!r.ok) throw new CanaryError("read_failed", r.error); return r.value; },
      transactControl: async () => { throw new CanaryError(dryRun ? "dry_run" : "read_only_transport", "policy CAS attempted on a non-writable transport", EXIT.ENV); },
      now: () => Date.now(),
    },
  };
  if (writable) {
    api.policyIo.transactControl = async (tenantId, bizId, fn) => {
      if (tenantId !== t || bizId !== b) throw new CanaryError("target_mismatch", `${tenantId}/${bizId}`, EXIT.ENV);
      if (dryRun) throw new CanaryError("dry_run", "policy CAS not executed in dry-run", EXIT.OK);
      const r = await db.ref(P.control).transaction(fn, undefined, false);
      return { committed: r.committed, snapshot: r.snapshot };
    };
    /**
     * SOURCE-BOUND entries transaction for the unchanged upgrader: on EVERY callback the current
     * node's full-content digest must equal the evidence digest BEFORE the core callback runs.
     * The cache is warmed by `warmEntries()` first, so a null callback value means truly absent.
     */
    api.boundTransactNode = ({ expectedDigest }) => {
      const stats = { runs: 0, nullRuns: 0, drift: false, driftDigest: null, coreRuns: 0 };
      const transactNode = async (tenantId, key, coreFn) => {
        if (tenantId !== t || key !== `biz:${b}:entries`) throw new CanaryError("target_mismatch", `${tenantId}/${key}`, EXIT.ENV);
        if (dryRun) throw new CanaryError("dry_run", "entries transaction not executed in dry-run", EXIT.OK);
        const r = await db.ref(P.entries).transaction((cur) => {
          stats.runs++;
          if (cur === null || cur === undefined) { stats.nullRuns++; return undefined; }
          const d = digestV1(cur);
          if (d !== expectedDigest) { stats.drift = true; stats.driftDigest = d; return undefined; }
          stats.coreRuns++;
          return coreFn(cur);
        }, undefined, false);
        return { committed: r.committed, snapshot: r.snapshot };
      };
      return { transactNode, stats };
    };
  }
  return api;
}

// ── ordinary-token REST probe (Option B: control-record denial + authenticated read) ──
/**
 * Emulator: the RTDB emulator treats `Authorization: Bearer <jwt>` as ADMIN, so probes MUST use the
 * `?auth=` query form there (verified 2026-09-25). Production: `Authorization: Bearer <ID token>`.
 * The token is never logged; URLs are never printed.
 */
export function createRestProbe({ manifest, token }) {
  if (typeof token !== "string" || token.length < 20) throw new CanaryError("token_invalid", "ordinary ID token required (file/stdin)", EXIT.ENV);
  const base = manifest.databaseURL.replace(/\/?$/, "");
  const [urlBase, ns] = base.includes("?ns=") ? base.split("?ns=") : [base, null];
  const emu = manifest.environment === "emulator";
  const url = (path) => `${urlBase}/${path}.json?${ns ? "ns=" + ns + "&" : ""}${emu ? "auth=" + token : "print=pretty"}`;
  const headers = emu ? { "Content-Type": "application/json" } : { "Content-Type": "application/json", Authorization: "Bearer " + token };
  const classify = async (res) => { const text = await res.text(); if (res.status === 200) return { outcome: "ACCEPTED", status: 200 }; if (res.status === 401 && /permission denied/i.test(text)) return { outcome: "DENIED", status: 401 }; return { outcome: "INCONCLUSIVE", status: res.status, body: text.slice(0, 120) }; };
  const P = derivePaths(manifest);
  return {
    form: emu ? "query" : "bearer",
    authenticatedRead: async () => { try { const res = await fetch(url(P.entries), { headers }); const text = await res.text(); return res.status === 200 ? { outcome: "READABLE", status: 200, digest: sha256Hex(text) } : { outcome: res.status === 401 ? "DENIED" : "INCONCLUSIVE", status: res.status }; } catch (e) { return { outcome: "INCONCLUSIVE", error: e.message }; } },
    controlSameValueWrite: async (currentPhase) => { try { return await classify(await fetch(url(P.control + "/phase"), { method: "PUT", headers, body: JSON.stringify(currentPhase) })); } catch (e) { return { outcome: "INCONCLUSIVE", error: e.message }; } },
  };
}

// ── repository identity (read-only) ──────────────────────────────────────────
/** git blob id of `bytes` without invoking git: sha1("blob <len>\0" + bytes). */
export const gitBlobId = (bytes) => { const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8"); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
export function repoIdentity(root, files = ["index.html", "database.rules.json", "src/analytics/dailyBuilder.ts", "src/repositories/analytics/dailyMetricsRepo.ts", "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts", "src/snapshot/snapshotBuilder.ts", "tools/storage-v2/preflight.mjs", "tools/storage-v2/upgrade.mjs", "tools/storage-v2/policy.mjs", "lib/storagePolicy.js", "tools/storage-v2/canary.mjs", "tools/storage-v2/canary-contract.mjs", "tools/storage-v2/canary-transport.mjs", "tools/storage-v2/canary-evidence.mjs", "tools/storage-v2/canary-readers.mjs"]) {
  const git = (args) => spawnSync("git", ["--no-optional-locks", ...args], { cwd: root, encoding: "utf8" });
  const head = git(["rev-parse", "HEAD"]), status = git(["status", "--porcelain", "--untracked-files=no"]);
  const blobs = {}; for (const f of files) { try { blobs[f] = gitBlobId(readFileSync(join(root, f))); } catch (_) { blobs[f] = null; } }
  return { repoSha: head.status === 0 ? head.stdout.trim() : null, treeClean: status.status === 0 ? status.stdout.trim() === "" : null, gitReachable: head.status === 0, blobs, nodeVersion: process.version };
}
/**
 * Compare the DEPLOYED Rules text with the approved blob: `byte` (same git blob id), `structural`
 * (same JSON as the repo's database.rules.json, which itself must hash to the approved blob),
 * `mismatch`, or UNKNOWN when the deployed text is unavailable. Needs no git binary.
 */
export function rulesFingerprint({ text, approvedBlob, root }) {
  if (typeof text !== "string") return { match: "UNKNOWN", deployedRulesBlob: null, reason: "no deployed rules text" };
  const served = sha256Hex(Buffer.from(text, "utf8")), servedBlob = gitBlobId(text);
  if (servedBlob === approvedBlob) return { match: "byte", deployedRulesBlob: approvedBlob, servedSha256: served };
  let repoText = null; try { repoText = readFileSync(join(root, "database.rules.json"), "utf8"); } catch (_) { repoText = null; }
  if (repoText !== null && gitBlobId(repoText) === approvedBlob) {
    try { if (JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(repoText))) return { match: "structural", deployedRulesBlob: approvedBlob, servedSha256: served, servedBlob }; } catch (_) { /* fall through */ }
  }
  return { match: "mismatch", deployedRulesBlob: servedBlob, servedSha256: served, repoRulesBlob: repoText === null ? null : gitBlobId(repoText) };
}
