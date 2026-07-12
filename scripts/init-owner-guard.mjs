#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// init-owner-guard.mjs — one-time initialization of the owner-guard node
//   tenants/{tid}/access_meta/owner_guard = { version, ownerUids, updatedAt }
// derived from the trusted current `roles` map.
//
// This is SEPARATE from the biz_access backfill (its own plan, its own run).
//
// SAFETY / HARDENING:
//   • DEFAULT DRY-RUN — writes nothing.
//   • ACTUAL Firebase project identity is verified against required --project;
//     mismatch/unknown ABORTS (never trusts --env alone). Reuses backfill's verifier.
//   • Detects ZERO-OWNER tenants and STOPS (cannot initialize a valid guard).
//   • Detects MISMATCH between an existing guard.ownerUids and roles-derived owners.
//   • STOPS on malformed data rather than guessing.
//   • --apply requires --confirm-production=<projectId> matching --project.
//   • Summary only — no secrets/PII.
//   DO NOT RUN as part of local implementation.
//
//   Usage:
//     node scripts/init-owner-guard.mjs --env=<e> --project=<p>                    # dry-run
//     node scripts/init-owner-guard.mjs --env=<e> --project=<p> --apply --confirm-production=<p>
// ─────────────────────────────────────────────────────────────────────────────
import { ownersFromRolesMap } from "../lib/ownerGuard.js";
import { getActualProjectId, verifyProject } from "./backfill-biz-access.mjs";

// ── PURE CORE (unit-tested; no Firebase) ─────────────────────────────────────

/** Plan the owner-guard node for ONE tenant from its roles map + existing guard. */
export function planTenantOwnerGuard(tenantId, rolesRaw, existingGuard, now = 0) {
  if (rolesRaw !== undefined && rolesRaw !== null && typeof rolesRaw !== "object") {
    const e = new Error(`malformed roles for ${tenantId}`); e.malformed = true; e.tenantId = tenantId; throw e;
  }
  const owners = ownersFromRolesMap(rolesRaw);
  const zeroOwner = owners.length === 0;
  const ownerUids = {};
  for (const uid of owners) ownerUids[uid] = true;

  let mismatch = false;
  if (existingGuard && existingGuard.ownerUids && typeof existingGuard.ownerUids === "object") {
    const g = Object.keys(existingGuard.ownerUids).sort().join(",");
    const r = owners.slice().sort().join(",");
    mismatch = g !== r;
  }
  const value = { version: 1, ownerUids, updatedAt: now, lastOpId: null, ops: {}, pending: null };
  const path = `tenants/${tenantId}/access_meta/owner_guard`;
  return { path, value, owners: owners.length, zeroOwner, mismatch, alreadyInitialized: !!existingGuard };
}

/** Plan across all tenants. Stops on malformed and (by default) on zero-owner tenants. */
export function planOwnerGuardInit(tenantsData, opts = {}) {
  const stopOnZeroOwner = opts.stopOnZeroOwner !== false; // default: stop
  const updates = {};
  const summary = { tenantsScanned: 0, initialized: 0, zeroOwnerTenants: [], mismatchTenants: [], alreadyInitialized: 0 };
  const tenants = (tenantsData && typeof tenantsData === "object") ? tenantsData : {};
  for (const [tid, tv] of Object.entries(tenants)) {
    summary.tenantsScanned++;
    const existingGuard = tv && tv.access_meta ? tv.access_meta.owner_guard : undefined;
    const plan = planTenantOwnerGuard(tid, tv ? tv.roles : undefined, existingGuard, opts.now || 0);
    if (plan.zeroOwner) {
      summary.zeroOwnerTenants.push(tid);
      if (stopOnZeroOwner) { const e = new Error(`zero-owner tenant ${tid}`); e.zeroOwner = true; e.tenantId = tid; throw e; }
      continue;
    }
    if (plan.mismatch) summary.mismatchTenants.push(tid);
    if (plan.alreadyInitialized) { summary.alreadyInitialized++; continue; } // don't overwrite an existing guard
    updates[plan.path] = plan.value;
    summary.initialized++;
  }
  return { updates, summary };
}

export function parseArgs(argv) {
  const a = { env: null, project: null, apply: false, confirmProduction: null, stopOnZeroOwner: true };
  for (const arg of argv) {
    if (arg === "--apply") a.apply = true;
    else if (arg === "--allow-zero-owner") a.stopOnZeroOwner = false;
    else if (arg.startsWith("--env=")) a.env = arg.slice(6);
    else if (arg.startsWith("--project=")) a.project = arg.slice("--project=".length);
    else if (arg.startsWith("--confirm-production=")) a.confirmProduction = arg.slice("--confirm-production=".length);
  }
  return a;
}

export function writeAllowed(args) {
  if (!args.apply) return { allowed: false, reason: "dry-run (default) — pass --apply to write" };
  if (!args.env) return { allowed: false, reason: "missing --env=<envId>" };
  if (!args.project) return { allowed: false, reason: "missing --project=<projectId>" };
  if (args.confirmProduction !== args.project) return { allowed: false, reason: "apply requires --confirm-production=<projectId> matching --project" };
  return { allowed: true, reason: "confirmed" };
}

// ── CLI (guarded; firebase-admin dynamic so pure fns stay testable) ──
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.env)     { console.error("ERROR: --env=<envId> required"); process.exit(2); }
  if (!args.project) { console.error("ERROR: --project=<projectId> required (identity verified, not trusted from --env)"); process.exit(2); }

  const admin = await import("firebase-admin");
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp();
  const app = admin.app ? admin.app() : null;
  const actual = getActualProjectId(app);
  const pv = verifyProject(actual, args.project);
  if (!pv.ok) { console.error(`ABORT (project verification): ${pv.reason}`); process.exit(4); }
  console.log(`project verified: ${actual}`);

  const db = admin.database();
  const tenantsSnap = await db.ref("tenants").once("value");
  const { updates, summary } = planOwnerGuardInit(tenantsSnap.val(), { stopOnZeroOwner: args.stopOnZeroOwner, now: Date.now() });
  console.log("── owner-guard init summary ──");
  console.log(JSON.stringify(summary, null, 2));

  const decision = writeAllowed(args);
  if (!decision.allowed) {
    console.log(`DRY-RUN — NO WRITES. Reason: ${decision.reason}`);
    console.log(`Would initialize ${Object.keys(updates).length} tenant owner-guard nodes.`);
    process.exit(0);
  }
  console.log(`APPLYING owner-guard init for ${Object.keys(updates).length} tenants on project=${actual} …`);
  await db.ref().update(updates);
  console.log("done.");
  process.exit(0);
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    if (e && e.malformed) { console.error(`STOP: malformed roles (${e.tenantId}). Fix data first.`); process.exit(3); }
    if (e && e.zeroOwner) { console.error(`STOP: zero-owner tenant (${e.tenantId}). Cannot initialize a valid guard.`); process.exit(5); }
    console.error("owner-guard init failed:", e?.message || e); process.exit(1);
  });
}
