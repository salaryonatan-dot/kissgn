// Financial Core B2 successor — shared harness for the morning snapshot + e-mail tests.
// The reader sandbox compiles the builder (which imports the e-mail module); the e-mail seam is
// replaced BEFORE the first import so the rendered HTML is captured (never sent).
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { compileServer, makeDb, installDb, offlineFetch } from "./server-reader-harness.mjs";
import { seedRaw, env, T, B } from "./b1-fixtures.mjs";
import { INV_NOW_MS, GLOBAL_3000, FIXED_3100 } from "./financial-invariants.mjs";

offlineFetch();
export const srv = compileServer();
writeFileSync(join(srv.dir, "lib", "sendEmail.js"), "export async function sendEmail(to, subject, html) { (globalThis.__EMAILS ||= []).push({ kind: 'email', to, subject, html }); return { messageId: 'm' }; }\nexport async function sendAlertDigest() { return { messageId: 'd' }; }\n");
// The e-mail module is normally compiled with the builder (which imports it); compile it on its
// own when it is not (e.g. an older tree used for failing-first evidence) — same tsc flags.
if (!existsSync(join(srv.dir, "src", "snapshot", "snapshotEmail.js"))) {
  spawnSync("node", [join(srv.dir, "node_modules", "typescript", "bin", "tsc"), "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(srv.dir, "src", "snapshot", "snapshotEmail.ts")], { encoding: "utf8" });
}
export const SB = await srv.import("src/snapshot/snapshotBuilder.js");
export const SE = await srv.import("src/snapshot/snapshotEmail.js");
export const CI = await srv.import("src/finance-server/canonicalInputs.js");
export const CM = await srv.import("src/finance-server/canonicalMetrics.js");

/** A closure envelope as the structured ledger stores it (state only; the operations ledger is irrelevant to readers). */
export const closure = () => ({ state: { status: "active", reasonCode: "closure", revision: 1 } });

export function seed({ rows, config = GLOBAL_3000, fixed = FIXED_3100, exceptions, raw = {}, bizName = "Biz " + B } = {}) {
  const db = installDb(makeDb());
  seedRaw(db, {
    entries: raw.entries !== undefined ? raw.entries : env(rows),
    config: raw.config !== undefined ? raw.config : env(config),
    fixed: raw.fixed !== undefined ? raw.fixed : fixed === null ? null : env(fixed),
    businesses: [{ id: B, name: bizName }],
  });
  if (exceptions !== undefined) db.seed(`tenants/${T}/entry_exceptions/${B}`, exceptions);
  return db;
}

export async function snapOf(opts, nowMs = INV_NOW_MS) { seed(opts); return SB.buildSnapshotForBiz(T, B, { nowMs }); }

/** The canonical report + projection the server API gives for the same seeded inputs (oracle). */
export async function coreOf(nowMs = INV_NOW_MS) {
  const inputs = await CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "t", nowMs, need: { config: true, fixed: true, exceptions: true } });
  const month = inputs.asOfBusinessDate.slice(0, 7);
  const { report } = CM.canonicalMonthReport(inputs, { kind: "open_month", month });
  const projection = report.window.state === "actual" ? CM.canonicalMonthProjection(inputs, report, { nowMs }) : null;
  return { inputs, report, projection };
}

export const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** Full normalized e-mail: the subject line, then every non-empty HTML line trimmed (B2-G36 goldens). */
export const normalizeEmail = (subject, html) => ["SUBJECT: " + subject, ...html.split("\n").map((l) => l.trim()).filter(Boolean)].join("\n") + "\n";

export async function mail(opts, nowMs = INV_NOW_MS) {
  const snapshot = await snapOf(opts, nowMs);
  await SE.sendSnapshotEmail("owner@example.test", snapshot);
  const m = globalThis.__EMAILS.at(-1);
  return { snapshot, subject: m.subject, html: m.html, text: textOf(m.html), normalized: normalizeEmail(m.subject, m.html) };
}
