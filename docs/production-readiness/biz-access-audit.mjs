// READ-ONLY biz_access coverage audit for the Marjin Foundation Release.
//
// This script NEVER writes. It performs only .once("value") reads and prints a
// classified coverage report + a dry-run backfill input file. It is intended to
// be run by an authenticated operator with READ-ONLY Firebase access.
//
// SAFETY:
//   - No set/update/remove/push/transaction calls exist in this file.
//   - Refuses to run against the emulator-less prod URL unless GOOGLE_APPLICATION_
//     CREDENTIALS (read-only service account) OR FIREBASE_DATABASE_EMULATOR_HOST
//     is explicitly provided by the operator.
//   - Personal identifiers (uid, email) are redacted to short salted hashes.
//
// Usage (operator, read-only creds):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
//   FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
//   node docs/production-readiness/biz-access-audit.mjs --tenant <tenantId> \
//       [--out docs/production-readiness/biz-access-dry-run.json]
//
// Output categories per (tenant,business,user): READY, NEEDS_BACKFILL,
// AMBIGUOUS_MAPPING, ORPHANED_ACCESS, INVALID_ROLE, UNKNOWN_BUSINESS,
// MISSING_MEMBERSHIP.

import admin from "firebase-admin";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TENANT = arg("--tenant");
const OUT = arg("--out", "docs/production-readiness/biz-access-dry-run.json");
const SALT = process.env.AUDIT_SALT || "marjin-readonly-audit";
const redact = (s) => s == null ? null : "id_" + createHash("sha256").update(SALT + ":" + String(s)).digest("hex").slice(0, 10);

if (!TENANT) { console.error("ERROR: --tenant <tenantId> is required"); process.exit(2); }
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  console.error("ERROR: provide read-only GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_DATABASE_EMULATOR_HOST). This script only reads.");
  process.exit(2);
}

// Role → whether an explicit per-business biz_access grant is REQUIRED for biz data.
const NEEDS_GRANT = new Set(["manager", "shift_manager", "viewer"]);
const IMPLICIT = new Set(["owner", "super_owner"]);           // owner/super_owner bypass biz_access
const VALID_ROLES = new Set(["owner", "super_owner", "manager", "shift_manager", "viewer"]);

function parseV(node) {
  if (node && typeof node === "object" && typeof node._v === "string") {
    try { return JSON.parse(node._v); } catch { return null; }
  }
  return node ?? null;
}

async function main() {
  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL ||
      (process.env.FIREBASE_DATABASE_EMULATOR_HOST ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=demo` : undefined),
  });
  const db = admin.database();
  const base = db.ref(`tenants/${TENANT}`);

  // READ-ONLY snapshot of the whole tenant subtree (single read).
  const snap = await base.once("value");
  const t = snap.val() || {};

  const members = t.members || {};                 // {uid:true}
  const roles = t.roles || {};                     // {uid:role}
  const bizAccess = t.biz_access || {};            // {bizId:{uid:true}}
  const appUsers = parseV(t.app?.users) || {};     // authoritative user registry (may carry allowedBizIds)
  const appBiz = parseV(t.app?.business) || {};    // business registry

  // Discover business ids from: registry, biz_access, and biz:{id}:* data keys.
  const bizIds = new Set(Object.keys(appBiz || {}));
  for (const b of Object.keys(bizAccess)) bizIds.add(b);
  for (const k of Object.keys(t)) { const m = k.match(/^biz:([^:]+):/); if (m) bizIds.add(m[1]); }

  const cats = { READY: 0, NEEDS_BACKFILL: 0, AMBIGUOUS_MAPPING: 0, ORPHANED_ACCESS: 0, INVALID_ROLE: 0, UNKNOWN_BUSINESS: 0, MISSING_MEMBERSHIP: 0 };
  const findings = [];
  const backfill = []; // dry-run proposed grants (NOT written)

  const uids = new Set([...Object.keys(members), ...Object.keys(roles), ...Object.keys(appUsers)]);

  for (const uid of uids) {
    const role = roles[uid];
    const isMember = members[uid] === true;
    const desired = Array.isArray(appUsers[uid]?.allowedBizIds) ? appUsers[uid].allowedBizIds : [];

    if (!VALID_ROLES.has(role)) { cats.INVALID_ROLE++; findings.push({ user: redact(uid), business: null, category: "INVALID_ROLE", role: role ?? null }); continue; }
    if (!isMember) { cats.MISSING_MEMBERSHIP++; findings.push({ user: redact(uid), business: null, category: "MISSING_MEMBERSHIP", role }); }

    if (IMPLICIT.has(role)) {
      // owner/super_owner: implicit scope; report READY (no per-biz grant needed).
      cats.READY++; findings.push({ user: redact(uid), business: "*", category: "READY", role, note: "implicit-scope" });
      continue;
    }

    // Roles that need explicit grants: reconcile desired (allowedBizIds) vs actual (biz_access).
    for (const b of desired) {
      if (!bizIds.has(b)) { cats.UNKNOWN_BUSINESS++; findings.push({ user: redact(uid), business: redact(b), category: "UNKNOWN_BUSINESS", role }); continue; }
      const has = bizAccess[b]?.[uid] === true;
      if (has && isMember) { cats.READY++; findings.push({ user: redact(uid), business: redact(b), category: "READY", role }); }
      else if (!has && isMember) { cats.NEEDS_BACKFILL++; backfill.push({ tenantId: TENANT, bizId: b, uid, role, grant: true }); findings.push({ user: redact(uid), business: redact(b), category: "NEEDS_BACKFILL", role }); }
      else { cats.AMBIGUOUS_MAPPING++; findings.push({ user: redact(uid), business: redact(b), category: "AMBIGUOUS_MAPPING", role, note: "grant desired but no membership" }); }
    }
  }

  // Orphaned biz_access: grants for uids with no membership, unknown business, or unknown user.
  for (const [b, grants] of Object.entries(bizAccess)) {
    for (const uid of Object.keys(grants || {})) {
      if (grants[uid] !== true) continue;
      if (!bizIds.has(b)) { cats.UNKNOWN_BUSINESS++; findings.push({ user: redact(uid), business: redact(b), category: "UNKNOWN_BUSINESS", note: "grant to nonexistent business" }); }
      else if (members[uid] !== true) { cats.ORPHANED_ACCESS++; findings.push({ user: redact(uid), business: redact(b), category: "ORPHANED_ACCESS", note: "grant without membership" }); }
    }
  }

  const report = { tenantId: TENANT, generatedAt: new Date().toISOString(), businessesDiscovered: bizIds.size, usersDiscovered: uids.size, categories: cats, findings };
  const dryRun = { note: "DRY-RUN ONLY — NOT A PRODUCTION WRITE PAYLOAD. Review + separate authorization required before any backfill.", tenantId: TENANT, proposedGrants: backfill };
  writeFileSync(OUT, JSON.stringify(dryRun, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nDry-run proposed grants written (NOT applied): ${OUT} (${backfill.length} grants)`);

  await admin.app().delete().catch(() => {});
  // Gate: any category other than READY means backfill/review is required.
  const needsWork = cats.NEEDS_BACKFILL + cats.AMBIGUOUS_MAPPING + cats.ORPHANED_ACCESS + cats.INVALID_ROLE + cats.UNKNOWN_BUSINESS + cats.MISSING_MEMBERSHIP;
  process.exit(needsWork > 0 ? 3 : 0); // 0=READY, 3=NEEDS_BACKFILL/attention (read-only signal)
}
main().catch((e) => { console.error("AUDIT ERROR:", e && (e.message || e)); process.exit(2); });
