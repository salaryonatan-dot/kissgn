// READ-ONLY biz_access coverage audit — THIN CLI wrapper over the pure model in
// ./lib/biz-access-model.mjs. NEVER writes to Production: performs only
// .once("value") reads and, optionally, writes a REDACTED local dry-run file to an
// explicit local path. No set/update/push/remove/transaction anywhere.
//
// Usage (operator, read-only Firebase credentials):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/readonly-sa.json \
//   FIREBASE_DATABASE_URL="https://<project>.firebaseio.com" \
//   node docs/production-readiness/biz-access-audit.mjs --tenant <tenantId> \
//       [--out docs/production-readiness/output/biz-access-dry-run.json]
//
// The report is redacted (no raw uid/email/name/tenantId/bizId). The optional file
// is a DRY-RUN artifact, NOT directly executable as a Production write payload.

import admin from "firebase-admin";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyBizAccess } from "./lib/biz-access-model.mjs";
import { formatSafeError } from "./lib/redaction.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

export function assertLocalOutPath(out) {
  const abs = resolve(process.cwd(), out);
  const allowed = [resolve(process.cwd(), "docs/production-readiness/output"), "/tmp"];
  if (!allowed.some((p) => abs === p || abs.startsWith(p + "/"))) {
    // PR-003: never emit the raw or resolved path (home dir, username, repo path).
    // Throw a stable, generic, path-free error; the CLI catch routes it through
    // formatSafeError. `abs` stays a local variable and is never interpolated into
    // any exception, log, stderr, stdout or persisted report.
    const err = new Error("Output path is outside the allowed local output directory");
    err.code = "INVALID_OUTPUT_PATH";
    throw err;
  }
  return abs;
}

async function main() {
  const TENANT = arg("--tenant");
  const OUT = arg("--out"); // optional; validated if present
  if (!TENANT) { console.error("ERROR: --tenant <tenantId> required"); process.exit(2); }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    console.error("ERROR: provide read-only GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_DATABASE_EMULATOR_HOST). This audit only reads.");
    process.exit(2);
  }
  const outAbs = OUT ? assertLocalOutPath(OUT) : null;

  admin.initializeApp({
    databaseURL: process.env.FIREBASE_DATABASE_URL ||
      (process.env.FIREBASE_DATABASE_EMULATOR_HOST ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=demo` : undefined),
  });
  const db = admin.database();

  // Single READ-ONLY snapshot of the tenant subtree.
  const t = (await db.ref(`tenants/${TENANT}`).once("value")).val() || {};
  const dataKeyBizIds = [];
  for (const k of Object.keys(t)) { const m = k.match(/^biz:([^:]+):/); if (m) dataKeyBizIds.push(m[1]); }

  const result = classifyBizAccess({
    tenantId: TENANT,
    members: t.members || {},
    roles: t.roles || {},
    bizAccess: t.biz_access || {},
    appUsersRaw: t.app?.users ?? null,
    appBusinessRaw: t.app?.business ?? null,
    dataKeyBizIds,
    salt: process.env.AUDIT_SALT,
  });

  // Redacted report only (never log the raw snapshot).
  console.log(JSON.stringify({
    tenantRef: result.tenantRef, generatedAt: new Date().toISOString(),
    businessesDiscovered: result.businessesDiscovered, usersDiscovered: result.usersDiscovered,
    categories: result.categories, malformed: result.malformed, findings: result.findings,
  }, null, 2));

  if (outAbs) {
    writeFileSync(outAbs, JSON.stringify({
      note: "DRY-RUN ONLY (redacted) — NOT a Production write payload. References are non-reversible hashes + appUsersIndex source indexes; reconcile against your own access-controlled mapping. Any backfill requires separate written authorization and uses scripts/backfill-biz-access.mjs.",
      tenantRef: result.tenantRef, proposedGrants: result.proposedGrants,
    }, null, 2));
    console.log(`\n[local-only] redacted dry-run written: ${outAbs} (${result.proposedGrants.length} proposed grants)`);
  }

  await admin.app().delete().catch(() => {});
  process.exit(result.needsAttention ? 3 : 0); // 0 = all READY, 3 = attention needed
}

// main() runs ONLY on direct execution — never on import (keeps tests side-effect free).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(formatSafeError(e)); process.exit(2); });
}
