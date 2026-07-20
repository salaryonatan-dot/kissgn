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
//   DO NOT RUN as part of local implementation. Execution is a separately-approved,
//   controlled Production step.
//
//   Usage:
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p>                       # dry-run
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --reconcile           # report only
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --apply   --confirm-production=<p>
//     node scripts/backfill-biz-access.mjs --env=<e> --project=<p> --cleanup --confirm-production=<p>
// ─────────────────────────────────────────────────────────────────────────────
import {
  isImplicitAllRole, normalizeAllowedBizIds, parseAppUsers, flattenBizAccess,
} from "../lib/bizAccess.js";

// ── PURE CORE (unit-tested; no Firebase, no network) ─────────────────────────

export function planTenantBackfill(tenantId, appUsersRaw, rolesRaw) {
  const users = parseAppUsers(appUsersRaw); // throws {malformed:true} on bad blob
  const roles = (rolesRaw && typeof rolesRaw === "object") ? rolesRaw : {};
  const updates = {};
  let scopedUsers = 0, skipped = 0, malformedUsers = 0;
  for (const u of users) {
    if (!u || typeof u !== "object") { malformedUsers++; continue; }
    const uid = u.firebaseUid;
    if (typeof uid !== "string" || !uid) { malformedUsers++; continue; }
    const role = (typeof roles[uid] === "string" ? roles[uid] : u.role);
    if (isImplicitAllRole(role)) { skipped++; continue; } // implicit ALL — no entries
    let bizIds;
    try { bizIds = normalizeAllowedBizIds(Array.isArray(u.allowedBizIds) ? u.allowedBizIds : []); }
    catch { malformedUsers++; continue; }
    scopedUsers++;
    for (const bizId of bizIds) updates[`tenants/${tenantId}/biz_access/${bizId}/${uid}`] = true;
  }
  return { updates, scopedUsers, skipped, usersScanned: users.length, malformedUsers };
}

export function planBackfill(tenantsData, opts = {}) {
  const stopOnMalformed = opts.stopOnMalformed !== false; // default: stop
  const updates = {};
  const summary = {
    tenantsScanned: 0, usersScanned: 0, scopedUsers: 0,
    accessEntriesProposed: 0, malformedRecords: 0, skippedUsers: 0, malformedTenants: [],
  };
  const tenants = (tenantsData && typeof tenantsData === "object") ? tenantsData : {};
  for (const [tenantId, tv] of Object.entries(tenants)) {
    summary.tenantsScanned++;
    const appUsersRaw = tv && tv.app ? tv.app.users : undefined;
    const rolesRaw = tv ? tv.roles : undefined;
    let plan;
    try { plan = planTenantBackfill(tenantId, appUsersRaw, rolesRaw); }
    catch (e) {
      summary.malformedTenants.push(tenantId);
      if (stopOnMalformed) { const err = new Error(`malformed tenant ${tenantId}`); err.malformed = true; err.tenantId = tenantId; throw err; }
      continue;
    }
    Object.assign(updates, plan.updates);
    summary.usersScanned += plan.usersScanned;
    summary.scopedUsers += plan.scopedUsers;
    summary.skippedUsers += plan.skipped;
    summary.malformedRecords += plan.malformedUsers;
  }
  summary.accessEntriesProposed = Object.keys(updates).length;
  return { updates, summary };
}

/** Compare derived plan against existing biz_access. Pure. */
export function reconcile(planUpdates, tenantsData) {
  const planSet = new Set(Object.keys(planUpdates));
  const existing = flattenBizAccess(tenantsData); // Set of existing `= true` paths
  const missing = [...planSet].filter(p => !existing.has(p));       // in plan, not in DB
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
              confirmProduction: null, stopOnMalformed: true };
  for (const arg of argv) {
    if (arg === "--apply") a.apply = true;
    else if (arg === "--cleanup") a.cleanup = true;
    else if (arg === "--reconcile") a.reconcile = true;
    else if (arg === "--allow-malformed") a.stopOnMalformed = false;
    else if (arg.startsWith("--env=")) a.env = arg.slice(6);
    else if (arg.startsWith("--project=")) a.project = arg.slice("--project=".length);
    else if (arg.startsWith("--confirm-production=")) a.confirmProduction = arg.slice("--confirm-production=".length);
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

  const admin = await import("firebase-admin");
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp();
  const app = (admin.app ? admin.app() : (admin.default && admin.default.app ? admin.default.app() : null));

  // ── verify ACTUAL project identity BEFORE any read/write ──
  const actualProject = getActualProjectId(app);
  const pv = verifyProject(actualProject, args.project);
  if (!pv.ok) { console.error(`ABORT (project verification): ${pv.reason}`); process.exit(4); }
  console.log(`project verified: ${actualProject}`);

  const db = admin.database();
  const tenantsSnap = await db.ref("tenants").once("value");
  const tenantsData = tenantsSnap.val();
  const { updates, summary } = planBackfill(tenantsData, { stopOnMalformed: args.stopOnMalformed });
  const { missing, unexpected } = reconcile(updates, tenantsData);

  console.log("── biz_access backfill summary ──");
  console.log(JSON.stringify({ ...summary, missingEntries: missing.length, unexpectedEntries: unexpected.length }, null, 2));

  if (args.reconcile) {
    console.log(`reconcile: ${missing.length} missing (in plan, absent in DB), ${unexpected.length} UNEXPECTED (in DB, not in plan). No writes.`);
    if (unexpected.length) console.log("unexpected paths:\n" + unexpected.join("\n"));
    process.exit(0);
  }

  if (args.cleanup) {
    const decision = writeAllowed(args, "cleanup");
    if (!decision.allowed) { console.log(`CLEANUP REFUSED — ${decision.reason}`); process.exit(0); }
    if (!unexpected.length) { console.log("cleanup: no unexpected entries to remove."); process.exit(0); }
    console.log(`CLEANUP: removing ${unexpected.length} unexpected biz_access entries on project=${actualProject} …`);
    await db.ref().update(cleanupUpdates(unexpected));
    console.log("cleanup done.");
    process.exit(0);
  }

  const decision = writeAllowed(args, "apply");
  if (!decision.allowed) {
    console.log(`DRY-RUN — NO WRITES. Reason: ${decision.reason}`);
    console.log(`Would write ${Object.keys(updates).length} biz_access entries (${missing.length} currently missing).`);
    process.exit(0);
  }
  console.log(`APPLYING ${Object.keys(updates).length} biz_access entries to project=${actualProject} …`);
  await db.ref().update(updates);
  console.log("done.");
  process.exit(0);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    if (e && e.malformed) { console.error(`STOP: malformed tenant data (${e.tenantId}). Fix data before backfill.`); process.exit(3); }
    console.error("backfill failed:", e?.message || e); process.exit(1);
  });
}
