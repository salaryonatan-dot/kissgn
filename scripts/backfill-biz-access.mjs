#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// backfill-biz-access.mjs — one-time migration that derives the server-managed
// biz_access index from the existing (human-facing) app/users allowedBizIds.
//
//   Path written:  tenants/{tid}/biz_access/{bizId}/{uid} = true
//
// SAFETY:
//   • DEFAULT MODE IS DRY-RUN — computes and prints a plan, writes NOTHING.
//   • Production execution refuses to run without BOTH:
//       --apply                       (opt out of dry-run)
//       --confirm-production=<envId>  (explicit, matching --env=<envId>)
//   • --verify only compares existing biz_access vs. the derived plan; no writes.
//   • Skips owner/super_owner (implicit ALL-business).
//   • Stages `= true` entries ONLY; removes nothing.
//   • Idempotent (re-running yields the same booleans).
//   • STOPS on malformed tenant data rather than guessing.
//   • Emits a summary only — no secrets, no full PII (uids/bizIds are opaque ids).
//
//   DO NOT RUN as part of the local implementation task. This file ships the
//   tooling; execution is a separately-approved, controlled Production step.
//
//   Usage:
//     node scripts/backfill-biz-access.mjs --env=<envId>                # dry-run
//     node scripts/backfill-biz-access.mjs --env=<envId> --verify       # verify only
//     node scripts/backfill-biz-access.mjs --env=<envId> --apply \
//          --confirm-production=<envId>                                 # real write
// ─────────────────────────────────────────────────────────────────────────────
import {
  isImplicitAllRole, normalizeAllowedBizIds, parseAppUsers,
} from "../lib/bizAccess.js";

// ── PURE PLANNING CORE (unit-tested; no Firebase, no network) ────────────────

/**
 * Plan biz_access entries for ONE tenant from its raw app/users + roles values.
 * @returns {{ updates: Record<string, true>, scopedUsers: number, skipped: number,
 *             usersScanned: number, malformedUsers: number }}
 * @throws {{malformed:true}} when the app/users blob itself is malformed (STOP).
 */
export function planTenantBackfill(tenantId, appUsersRaw, rolesRaw) {
  const users = parseAppUsers(appUsersRaw); // throws {malformed:true} on bad blob
  const roles = (rolesRaw && typeof rolesRaw === "object") ? rolesRaw : {};
  const updates = {};
  let scopedUsers = 0, skipped = 0, malformedUsers = 0;

  for (const u of users) {
    if (!u || typeof u !== "object") { malformedUsers++; continue; }
    const uid = u.firebaseUid;
    if (typeof uid !== "string" || !uid) { malformedUsers++; continue; }
    // Trust the RTDB roles node first; fall back to the record's role field.
    const role = (typeof roles[uid] === "string" ? roles[uid] : u.role);
    if (isImplicitAllRole(role)) { skipped++; continue; } // implicit ALL — no entries
    // scoped role → derive from allowedBizIds
    let bizIds;
    try {
      bizIds = normalizeAllowedBizIds(Array.isArray(u.allowedBizIds) ? u.allowedBizIds : []);
    } catch {
      malformedUsers++; continue; // malformed per-user scope: report, do not guess
    }
    scopedUsers++;
    for (const bizId of bizIds) {
      updates[`tenants/${tenantId}/biz_access/${bizId}/${uid}`] = true;
    }
  }
  return { updates, scopedUsers, skipped, usersScanned: users.length, malformedUsers };
}

/**
 * Plan the whole backfill across all tenants.
 * @param {Record<string, any>} tenantsData  value of `tenants/`
 * @param {{stopOnMalformed?: boolean}} opts
 * @returns {{ updates, summary }}
 * @throws {{malformed:true, tenantId}} on malformed tenant when stopOnMalformed.
 */
export function planBackfill(tenantsData, opts = {}) {
  const stopOnMalformed = opts.stopOnMalformed !== false; // default: stop
  const updates = {};
  const summary = {
    tenantsScanned: 0, usersScanned: 0, scopedUsers: 0,
    accessEntriesProposed: 0, malformedRecords: 0, skippedUsers: 0,
    malformedTenants: [],
  };
  const tenants = (tenantsData && typeof tenantsData === "object") ? tenantsData : {};
  for (const [tenantId, tv] of Object.entries(tenants)) {
    summary.tenantsScanned++;
    const appUsersRaw = tv && tv.app ? tv.app.users : undefined;
    const rolesRaw = tv ? tv.roles : undefined;
    let plan;
    try {
      plan = planTenantBackfill(tenantId, appUsersRaw, rolesRaw);
    } catch (e) {
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

/** Parse argv into flags. Pure. */
export function parseArgs(argv) {
  const a = { env: null, apply: false, verify: false, confirmProduction: null, stopOnMalformed: true };
  for (const arg of argv) {
    if (arg === "--apply") a.apply = true;
    else if (arg === "--verify") a.verify = true;
    else if (arg === "--allow-malformed") a.stopOnMalformed = false;
    else if (arg.startsWith("--env=")) a.env = arg.slice(6);
    else if (arg.startsWith("--confirm-production=")) a.confirmProduction = arg.slice("--confirm-production=".length);
  }
  return a;
}

/** Decide whether a real write is permitted. Pure, fail-closed. */
export function writeAllowed(args) {
  if (!args.apply) return { allowed: false, reason: "dry-run (default) — pass --apply to write" };
  if (!args.env) return { allowed: false, reason: "missing --env=<envId>" };
  if (args.confirmProduction !== args.env) {
    return { allowed: false, reason: "production write requires --confirm-production=<envId> matching --env" };
  }
  return { allowed: true, reason: "confirmed" };
}

// ── CLI (guarded; firebase-admin imported dynamically so pure fns stay testable) ──
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.env) { console.error("ERROR: --env=<envId> is required"); process.exit(2); }
  const decision = writeAllowed(args);

  // firebase-admin is imported ONLY here, at execution time.
  const admin = await import("firebase-admin");
  if (!admin.apps || admin.apps.length === 0) {
    admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS / env for the selected env
  }
  const db = admin.database();
  const tenantsSnap = await db.ref("tenants").once("value");
  const { updates, summary } = planBackfill(tenantsSnap.val(), { stopOnMalformed: args.stopOnMalformed });

  console.log("── biz_access backfill summary ──");
  console.log(JSON.stringify(summary, null, 2));

  if (args.verify) {
    const existingSnap = await db.ref("tenants").once("value"); // re-read for verify context
    let missing = 0, present = 0;
    for (const key of Object.keys(updates)) {
      const snap = await db.ref(key).once("value");
      if (snap.val() === true) present++; else missing++;
    }
    console.log(`verify: ${present} present, ${missing} missing (no writes performed)`);
    process.exit(0);
  }

  if (!decision.allowed) {
    console.log(`DRY-RUN — NO WRITES. Reason: ${decision.reason}`);
    console.log(`Would write ${Object.keys(updates).length} biz_access entries.`);
    process.exit(0);
  }

  // Real, confirmed write.
  console.log(`APPLYING ${Object.keys(updates).length} biz_access entries to env=${args.env} …`);
  await db.ref().update(updates);
  console.log("done.");
  process.exit(0);
}

// Only run the CLI when executed directly (not when imported by tests).
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    if (e && e.malformed) { console.error(`STOP: malformed tenant data (${e.tenantId}). Fix data before backfill.`); process.exit(3); }
    console.error("backfill failed:", e?.message || e); process.exit(1);
  });
}
