#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// backfill-biz-access.mjs — one-time migration deriving the server-managed
// biz_access index from the existing (human-facing) app/users allowedBizIds.
//
//   Path written:  tenants/{tid}/biz_access/{bizId}/{uid} = true
//
// SAFETY / HARDENING (Codex P0.4):
//   • ACTUAL Firebase project identity is verified against a required
//     --project=<projectId>. A mismatch (or unknown project) REFUSES to run.
//     Never trusts the --env label alone.
//   • Modes are explicit and mutually distinct:
//       (default)         dry-run — computes plan, writes NOTHING.
//       --reconcile       report plan vs. existing: missing + UNEXPECTED entries. No writes.
//       --apply           write the derived `= true` entries (add-only).
//       --cleanup         remove UNEXPECTED entries (not in the derived plan).
//     --apply and --cleanup each require --confirm-production=<projectId> matching --project.
//   • Skips owner/super_owner (implicit ALL-business).
//   • --apply stages `= true` only (adds; removes nothing). Removal happens ONLY
//     under the explicit --cleanup mode.
//   • Idempotent. STOPS on malformed tenant data rather than guessing.
//   • Emits a summary only — no secrets, no full PII (uids/bizIds are opaque ids).
//
//   • BF1 (independent I6 review I6-R-03 / R6-6; T-BF-GATE — a candidate on I7, pending independent Claude technical review,
//     and for the S0 server-reader / VAT-invariant guard owners, since this stored-data script is under their protection): a grant is
//     PLANNED only when the tenant's authoritative raw registry node (tenants/{tid}/app/business) classifies the exact business
//     `registered` under the runtime rule (lib/businessRegistry.js classifyRegistryTarget) — the same rule every runtime grant
//     writer applies. not_registered / ambiguous / unreadable targets are listed as REFUSED and never written. --apply fails closed
//     when ANY target is refused, and only applies the plan the operator approved: it requires --expect-plan=<digest> printed by the
//     dry-run. The apply transaction reclassifies the current snapshot on every server pass: a changed payload or refused target
//     aborts before commit, including a concurrent registry change after its first pass. Identity is exact, never trimmed or coerced.
//
//   DO NOT RUN as part of local implementation. Execution is a separately-approved,
//   controlled Production step.
//
//   Usage:
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p>                       # dry-run
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --reconcile           # report only
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --apply   --confirm-production=<p> --expect-plan=<dry-run digest>
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --cleanup --confirm-production=<p>
// ─────────────────────────────────────────────────────────────────────────────
import {
  isImplicitAllRole, normalizeAllowedBizIds, parseAppUsers, flattenBizAccess,
} from "../lib/bizAccess.js";
import { classifyRegistryTarget } from "../lib/businessRegistry.js";
import { isValidId } from "../lib/securityContext.js";
import { createHash } from "node:crypto";

// ── PURE CORE (unit-tested; no Firebase, no network) ─────────────────────────

// BF-GATE (T-BF-GATE): `appBusinessRaw` is the tenant's RAW registry node; every derived grant is classified against it exactly as the
// runtime grant writers do. Only `registered` targets enter `updates`; every other target is returned in `refused` (never written).
export function planTenantBackfill(tenantId, appUsersRaw, rolesRaw, appBusinessRaw) {
  if (!isValidId(tenantId)) throw Object.assign(new Error("invalid tenantId"), { malformed: true });
  const users = parseAppUsers(appUsersRaw); // throws {malformed:true} on bad blob
  const roles = (rolesRaw && typeof rolesRaw === "object") ? rolesRaw : {};
  const updates = {};
  const refused = [];
  let scopedUsers = 0, skipped = 0, malformedUsers = 0;
  for (const u of users) {
    if (!u || typeof u !== "object" || Array.isArray(u)) { malformedUsers++; refused.push({ state: "invalid_request", reason: "user_shape" }); continue; }
    const uid = u.firebaseUid;
    if (!isValidId(uid)) { malformedUsers++; refused.push({ state: "invalid_request", reason: "uid" }); continue; }
    const role = (typeof roles[uid] === "string" ? roles[uid] : u.role);
    if (isImplicitAllRole(role)) { skipped++; continue; } // implicit ALL — no entries
    let bizIds;
    try { bizIds = normalizeAllowedBizIds(u.allowedBizIds === undefined ? [] : u.allowedBizIds); }
    catch { malformedUsers++; refused.push({ state: "invalid_request", reason: "allowedBizIds" }); continue; }
    scopedUsers++;
    for (const bizId of bizIds) {
      const path = `tenants/${tenantId}/biz_access/${bizId}/${uid}`;
      const state = classifyRegistryTarget(appBusinessRaw, bizId).state;
      if (state === "registered") updates[path] = true;
      else refused.push({ path, state });
    }
  }
  return { updates, refused, scopedUsers, skipped, usersScanned: users.length, malformedUsers };
}

export function planBackfill(tenantsData, opts = {}) {
  const stopOnMalformed = opts.stopOnMalformed !== false; // default: stop
  const updates = {};
  const refused = [];
  const summary = {
    tenantsScanned: 0, usersScanned: 0, scopedUsers: 0,
    accessEntriesProposed: 0, accessEntriesRefused: 0, refusedByState: {}, malformedRecords: 0, skippedUsers: 0, malformedTenants: [],
  };
  const tenants = (tenantsData && typeof tenantsData === "object") ? tenantsData : {};
  for (const [tenantId, tv] of Object.entries(tenants)) {
    summary.tenantsScanned++;
    const appUsersRaw = tv && tv.app ? tv.app.users : undefined;
    const rolesRaw = tv ? tv.roles : undefined;
    const appBusinessRaw = tv && tv.app ? tv.app.business : undefined;
    let plan;
    try { plan = planTenantBackfill(tenantId, appUsersRaw, rolesRaw, appBusinessRaw); }
    catch (e) {
      summary.malformedTenants.push(tenantId);
      if (stopOnMalformed) { const err = new Error(`malformed tenant ${tenantId}`); err.malformed = true; err.tenantId = tenantId; throw err; }
      continue;
    }
    Object.assign(updates, plan.updates);
    refused.push(...plan.refused);
    summary.usersScanned += plan.usersScanned;
    summary.scopedUsers += plan.scopedUsers;
    summary.skippedUsers += plan.skipped;
    summary.malformedRecords += plan.malformedUsers;
  }
  summary.accessEntriesProposed = Object.keys(updates).length;
  summary.accessEntriesRefused = refused.length;
  for (const r of refused) summary.refusedByState[r.state] = (summary.refusedByState[r.state] || 0) + 1;
  refused.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { updates, refused, summary };
}

/** BF-GATE (T-BF-GATE): a stable digest of exactly what --apply would write and refuse (sorted paths). Pure. */
export function planDigest(plan) {
  const body = JSON.stringify({ updates: Object.keys(plan.updates || {}).sort(), refused: (plan.refused || []).map((r) => [r.path ?? null, r.state, r.reason ?? null]).sort(), malformedTenants: [...(plan.summary?.malformedTenants || [])].sort() });
  return createHash("sha256").update(body).digest("hex");
}

/** BF-GATE (T-BF-GATE): the apply gate — fail closed on any refused target and on any plan other than the approved one. Pure. */
export function applyGate(plan, args) {
  if (plan.summary?.malformedTenants?.length) return { allowed: false, reason: "malformed tenant data — report only; nothing is written" };
  if ((plan.refused || []).length > 0) return { allowed: false, reason: `${plan.refused.length} derived grant(s) target a business the authoritative registry does not register (refused: ${[...new Set(plan.refused.map((r) => r.state))].sort().join(", ")}) — fix the data or the scope lists first; nothing is written` };
  if (!args.expectPlan) return { allowed: false, reason: "missing --expect-plan=<digest> (the digest the approved dry-run printed)" };
  const digest = planDigest(plan);
  if (args.expectPlan !== digest) return { allowed: false, reason: `plan drift: the current plan digest ${digest} is not the approved ${args.expectPlan}` };
  return { allowed: true, reason: "approved plan, every target registered" };
}

/** Compare derived plan against existing biz_access. Pure.
 *  BF-GATE: `refused` (the derived grants the registry does not register) still count as DERIVED, so an existing grant to such a business
 *  is NOT reported unexpected — cleanup removes exactly what it removed before; the registry gate restricts only what is WRITTEN. */
export function reconcile(planUpdates, tenantsData, refused = []) {
  const planSet = new Set([...Object.keys(planUpdates), ...refused.map((r) => r.path).filter(Boolean)]);
  const existing = flattenBizAccess(tenantsData); // Set of existing `= true` paths
  const missing = Object.keys(planUpdates).filter(p => !existing.has(p));   // in the (registered) plan, not in DB
  const unexpected = [...existing].filter(p => !planSet.has(p));    // in DB, not in plan
  return { missing, unexpected };
}

/** Build null updates to remove unexpected entries (cleanup mode). Pure. */
export function cleanupUpdates(unexpectedPaths) {
  const u = {};
  for (const p of unexpectedPaths) u[p] = null;
  return u;
}

export function parseArgs(argv) {
  const a = { env: null, project: null, apply: false, cleanup: false, reconcile: false,
              confirmProduction: null, expectPlan: null, stopOnMalformed: true };
  for (const arg of argv) {
    if (arg === "--apply") a.apply = true;
    else if (arg === "--cleanup") a.cleanup = true;
    else if (arg === "--reconcile") a.reconcile = true;
    else if (arg === "--allow-malformed") a.stopOnMalformed = false;
    else if (arg.startsWith("--env=")) a.env = arg.slice(6);
    else if (arg.startsWith("--project=")) a.project = arg.slice("--project=".length);
    else if (arg.startsWith("--confirm-production=")) a.confirmProduction = arg.slice("--confirm-production=".length);
    else if (arg.startsWith("--expect-plan=")) a.expectPlan = arg.slice("--expect-plan=".length);
  }
  return a;
}

/** Determine the ACTUAL connected Firebase project id from an initialized app. */
export function getActualProjectId(adminApp) {
  const o = (adminApp && adminApp.options) ? adminApp.options : {};
  return o.projectId
    || (o.credential && o.credential.projectId)
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || null;
}

/** Verify the connected project matches the operator's declared --project. Pure, fail-closed. */
export function verifyProject(actualProjectId, expectedProjectId) {
  if (!expectedProjectId) return { ok: false, reason: "missing --project=<projectId>" };
  if (!actualProjectId)   return { ok: false, reason: "could not determine the connected Firebase project id" };
  if (actualProjectId !== expectedProjectId) {
    return { ok: false, reason: `project mismatch: connected='${actualProjectId}' expected='${expectedProjectId}'` };
  }
  return { ok: true, reason: "project verified" };
}

/** Decide whether a mutating operation is permitted. Pure, fail-closed. */
export function writeAllowed(args, mode /* "apply" | "cleanup" */) {
  const requested = mode === "cleanup" ? args.cleanup : args.apply;
  if (!requested) return { allowed: false, reason: `dry-run (default) — pass --${mode} to write` };
  if (!args.env) return { allowed: false, reason: "missing --env=<envId>" };
  if (!args.project) return { allowed: false, reason: "missing --project=<projectId>" };
  if (args.confirmProduction !== args.project) {
    return { allowed: false, reason: `${mode} requires --confirm-production=<projectId> matching --project` };
  }
  return { allowed: true, reason: "confirmed" };
}

// ── CLI (guarded; firebase-admin imported dynamically so pure fns stay testable) ──
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.env)     { console.error("ERROR: --env=<envId> is required"); process.exit(2); }
  if (!args.project) { console.error("ERROR: --project=<projectId> is required (identity is verified, not trusted from --env)"); process.exit(2); }
  if (args.apply && args.cleanup) { console.error("ERROR: choose either --apply or --cleanup, not both"); process.exit(2); }

  // BF2 (independent BF1 review BF1-R-01): initialize through the REAL module shape. firebase-admin is CommonJS
  // (module.exports = the namespace), so its ESM import namespace is only `{ default }`: `admin.initializeApp` was undefined and
  // every invocation exited 1 before any read. The namespace is the `default` export. The project is still verified BEFORE any read.
  const admin = (await import("firebase-admin")).default;
  if (admin.apps.length === 0) admin.initializeApp();
  const app = admin.app();

  // ── verify ACTUAL project identity BEFORE any read/write ──
  const actualProject = getActualProjectId(app);
  const pv = verifyProject(actualProject, args.project);
  if (!pv.ok) { console.error(`ABORT (project verification): ${pv.reason}`); process.exit(4); }
  console.log(`project verified: ${actualProject}`);

  const db = admin.database(app);
  process.exit(await runBackfill(db, args, actualProject));
}

/** The plan / reconcile / cleanup / apply flow on an Admin-SDK-shaped `db`. Returns the exit code.
 *  BF-GATE: exported so the local emulator gate exercises the REAL apply path; main() still verifies the project before calling it. */
export async function runBackfill(db, args, actualProject, log = console.log) {
  const project = verifyProject(actualProject, args.project);
  if (!project.ok) { log(`ABORT (project verification): ${project.reason}`); return 4; }
  if (args.apply && args.cleanup) { log("ERROR: choose either --apply or --cleanup, not both"); return 2; }
  const tenantsSnap = await db.ref("tenants").once("value");
  const tenantsData = tenantsSnap.val();
  const plan = planBackfill(tenantsData, { stopOnMalformed: args.stopOnMalformed });
  const { updates, refused, summary } = plan;
  const { missing, unexpected } = reconcile(updates, tenantsData, refused);
  const digest = planDigest(plan);

  log("── biz_access backfill summary ──");
  log(JSON.stringify({ ...summary, missingEntries: missing.length, unexpectedEntries: unexpected.length, planDigest: digest }, null, 2));
  if (refused.length) log("REFUSED (not written):\n" + refused.map((r) => `${r.path ?? r.reason}  ${r.state}`).join("\n"));

  if (args.reconcile) {
    log(`reconcile: ${missing.length} missing (in plan, absent in DB), ${unexpected.length} UNEXPECTED (in DB, not in plan). No writes.`);
    if (unexpected.length) log("unexpected paths:\n" + unexpected.join("\n"));
    return 0;
  }

  if (args.cleanup) {
    const decision = writeAllowed(args, "cleanup");
    if (!decision.allowed) { log(`CLEANUP REFUSED — ${decision.reason}`); return 0; }
    if (!unexpected.length) { log("cleanup: no unexpected entries to remove."); return 0; }
    log(`CLEANUP: removing ${unexpected.length} unexpected biz_access entries on project=${actualProject} …`);
    await db.ref().update(cleanupUpdates(unexpected));
    log("cleanup done.");
    return 0;
  }

  const decision = writeAllowed(args, "apply");
  if (!decision.allowed) {
    log(`DRY-RUN — NO WRITES. Reason: ${decision.reason}`);
    log(`Would write ${Object.keys(updates).length} biz_access entries (${missing.length} currently missing); ${refused.length} refused. Plan digest: ${digest}`);
    return 0;
  }
  // BF1: the initial snapshot must itself be safe; a later matching snapshot cannot excuse a refused first read.
  const gate = applyGate(plan, args);
  if (!gate.allowed) { log(`APPLY REFUSED — ${gate.reason}`); return 5; }
  // Bind the decision to the state at COMMIT, not to a read followed by an unconditional write. The one-time backfill already
  // reads the tenant snapshot; this transaction changes only the derived biz_access leaves, preserving every other value.
  // A server retry reclassifies its current registry and payload and ABORTS on drift. No business document handler is called.
  const ref = db.ref("tenants");
  let refusal = null;
  let listener;
  const ready = new Promise((resolve, reject) => { listener = ref.on("value", resolve, reject); });
  let result;
  try {
    await ready; // hold the listener through the transaction so its first pass has the server state (cold Admin SDK cache)
    result = await ref.transaction((current) => {
      let live;
      try { live = planBackfill(current, { stopOnMalformed: args.stopOnMalformed }); }
      catch { refusal = "malformed current tenant snapshot"; return; }
      const checked = applyGate(live, args);
      if (!checked.allowed) { refusal = checked.reason; return; }
      const next = structuredClone(current);
      const ownMap = (parent, key) => {
        const value = Object.hasOwn(parent, key) ? parent[key] : null;
        const map = Array.isArray(value) ? { ...value } : value && typeof value === "object" ? value : {};
        Object.defineProperty(parent, key, { value: map, enumerable: true, writable: true, configurable: true });
        return map;
      };
      for (const path of Object.keys(live.updates)) {
        const [, tid, , bid, uid] = path.split("/"); // all path slots validated before construction
        const grants = ownMap(ownMap(next[tid], "biz_access"), bid);
        Object.defineProperty(grants, uid, { value: true, enumerable: true, writable: true, configurable: true });
      }
      return next;
    }, undefined, false);
  } finally { if (listener) ref.off("value", listener); }
  if (!result?.committed) { log(`APPLY REFUSED (commit gate) — ${refusal ?? "transaction not committed"}`); return 5; }
  log("done.");
  return 0;
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    if (e && e.malformed) { console.error(`STOP: malformed tenant data (${e.tenantId}). Fix data before backfill.`); process.exit(3); }
    console.error("backfill failed:", e?.message || e); process.exit(1);
  });
}
