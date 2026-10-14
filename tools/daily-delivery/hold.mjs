// HR1 — the Daily-only delivery hold: OPERATOR TOOL (server credentials; no HTTP surface; nothing here is reachable by a client).
//
//   status    read-only: the hold record as the gates see it, its log, the held business dates
//   evidence  read-only: the drain evidence report (operational r2 DRAIN_CRITERIA C1–C7). It reports evidence for an OWNER
//             judgement. It never prints "quiescent", "drained" or "nothing sent": stopping new hand-offs does not prove that
//             earlier hand-offs have finished, and only provider evidence can settle an `unknown` (P7).
//   init      create the record HELD (only when it is absent or malformed; a malformed record is digested, then replaced)
//   hold      held   (requires the current version: --expect-version=N, from `status`)
//   release   released (likewise). A release does NOT send any held business date: the held-date markers stay, and a
//             scheduled run for a held date is still refused (owner decision: no automatic sending of held-day summaries).
//
// Writes are ONE transaction on delivery_control/daily_snapshot (lib/emailDelivery.js changeDeliveryHold): state, version and
// the audit-log entry together, or nothing. Every command verifies the ACTUAL project of the credentials against --project
// and the ACTUAL default database instance against --database-url before any database reference. Named instances are refused
// until operations supplies a separately verified mapping. Writes additionally require --actor, --reason and --confirm.
//
//   node tools/daily-delivery/hold.mjs status   --project=<id> --database-url=<exact-url>
//   node tools/daily-delivery/hold.mjs evidence --project=<id> --database-url=<exact-url> [--max-duration-ms=<observed>]
//       [--inventory-attested] [--logs-attested] [--invocation-receipt-attested] [--provider-attested]
//   node tools/daily-delivery/hold.mjs init|hold|release --project=<id> --database-url=<exact-url> --actor=<id>
//       --reason="…" [--expect-version=<n>] --confirm=<action>@<id>
import { fileURLToPath } from "node:url";
import { DELIVERY_HOLD_PATH, HELD_DATES_ROOT, MANUAL_ATTEMPT_ROOT, RECEIPT_ROOT, DAILY_SNAPSHOT_KIND, CLAIM_LEASE_MS, classifyHoldRecord,
  changeDeliveryHold } from "../../lib/emailDelivery.js";

export const SEND_DEADLINE_MS = 60000;      // lib/sendEmail.js SEND_DEADLINE_MS (asserted equal by the HR1 tests)
export const DRAIN_MARGIN_MS = 60000;
export const EXIT = Object.freeze({ OK: 0, USAGE: 2, REFUSED: 3, PROJECT: 4, ABORT_D: 5 });
export const COMMANDS = Object.freeze(["status", "evidence", "init", "hold", "release"]);

export function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) { out._.push(a); continue; }
    if ((m[1] === "project" || m[1] === "database-url") && Object.hasOwn(out, m[1])) out.ambiguousTarget = true;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

/** The project the credentials actually belong to (never trusted from an argument). */
export function actualProjectId(app) {
  const o = (app && app.options) || {};
  const ids = [o.projectId, o.credential?.projectId, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT].filter(Boolean);
  return ids.length && ids.every((id) => id === ids[0]) ? ids[0] : null;
}

/** Verify the configured default RTDB namespace and its independent project identity before constructing a database ref. */
export function verifyTarget(app, { project, databaseUrl, emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST } = {}) {
  const configured = app?.options?.databaseURL;
  const actual = actualProjectId(app);
  if (!project || !actual || actual !== project || !databaseUrl || !configured || configured !== databaseUrl)
    return { ok: false, code: "target_identity_missing_or_mismatched" };
  let parsed;
  try { parsed = new URL(configured); } catch { return { ok: false, code: "invalid_database_url" }; }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.hash)
    return { ok: false, code: "invalid_database_url" };
  const local = /^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(emulatorHost || "");
  if (local && parsed.protocol === "http:") {
    if (parsed.host !== emulatorHost || parsed.searchParams.size !== 1 ||
        ![project, `${project}-default-rtdb`].includes(parsed.searchParams.get("ns")))
      return { ok: false, code: "unverified_database_instance" };
  } else {
    if (parsed.protocol !== "https:" || parsed.search) return { ok: false, code: "invalid_database_url" };
    // A named instance needs a separately verified mapping. This tool has none, so it refuses it rather than guessing.
    const defaults = [`${project}.firebaseio.com`, `${project}-default-rtdb.firebaseio.com`];
    if (!defaults.includes(parsed.hostname) && !new RegExp(`^${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-default-rtdb\\.[a-z0-9-]+\\.firebasedatabase\\.app$`).test(parsed.hostname))
      return { ok: false, code: "unverified_database_instance" };
  }
  if (!app.options.credential?.projectId && !local)
    return { ok: false, code: "credential_project_unverified" };
  return { ok: true, project, databaseUrl: configured };
}

const isPlain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const read = async (db, path) => (await db.ref(path).once("value")).val();

/** The log of a record, in version order (empty when the record is not a plain object). */
export function holdLog(raw) {
  if (!isPlain(raw) || !isPlain(raw.log)) return [];
  return Object.keys(raw.log).sort().map((k) => ({ key: k, ...(isPlain(raw.log[k]) ? raw.log[k] : { malformed: true }) }));
}

/** The status view. Pure. */
export function statusView(raw, heldDates) {
  const c = classifyHoldRecord(raw);
  return {
    gates: c.state, code: c.code, version: c.version,
    recordPresent: raw !== null && raw !== undefined,
    log: holdLog(raw).slice(-10),
    heldDates: isPlain(heldDates) ? Object.keys(heldDates).sort() : [],
  };
}

/**
 * The drain evidence report (DRAIN_CRITERIA C1–C7). Pure: every input is a value read once by the caller.
 * Each criterion is "met" | "not_met" | "not_evaluable" | "attested" (an operator attestation the tool cannot verify).
 * verdict: "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW" only when C1–C4 are met and C2b, C5–C7 are attested; otherwise "ABORT_D".
 */
export function drainEvidence({ holdRaw, receiptsRaw, manualRaw, nowMs, maxDurationMs = null, inventoryAttested = false, logsAttested = false,
  invocationReceiptAttested = false, providerAttested = false }) {
  const c = classifyHoldRecord(holdRaw);
  const log = holdLog(holdRaw);
  const last = log.length ? log[log.length - 1] : null;
  const tHold = c.code === "delivery_held" && last && (last.action === "hold" || last.action === "init") && last.version === c.version && Number.isFinite(last.at) ? last.at : null;
  const receipts = { active: [], sendingExpired: [], unknown: [], heldBeforeSend: [], claimedExpired: [], unreadable: [] };
  const walk = (root, unreadable, visit) => {
    if (root === null || root === undefined) return;
    if (!isPlain(root)) { unreadable.push("<root>"); return; }
    for (const [t, bs] of Object.entries(root)) {
      if (!isPlain(bs)) { unreadable.push(t); continue; }
      for (const [b, leaves] of Object.entries(bs)) {
        if (!isPlain(leaves)) { unreadable.push(`${t}/${b}`); continue; }
        for (const [key, value] of Object.entries(leaves)) visit(`${t}/${b}/${key}`, value);
      }
    }
  };
  walk(receiptsRaw, receipts.unreadable, (id, x) => {
    const [tenantId, bizId, businessDate] = id.split("/");
    if (!isPlain(x) || x.v !== "MARJIN_EMAIL_RECEIPT/1" || !Number.isInteger(x.attempt) || x.attempt < 1 ||
        x.kind !== DAILY_SNAPSHOT_KIND || x.tenantId !== tenantId || x.bizId !== bizId || x.businessDate !== businessDate ||
        typeof x.claimId !== "string" || !/^[a-f0-9]{64}$/.test(x.recipientHash) || !Array.isArray(x.history) ||
        !["claimed", "sending", "accepted", "failed", "unknown"].includes(x.state) ||
        (["claimed", "sending"].includes(x.state) && !Number.isFinite(x.leaseUntil))) { receipts.unreadable.push(id); return; }
    const live = Number(x.leaseUntil) > nowMs;
    if ((x.state === "claimed" || x.state === "sending") && live) receipts.active.push({ id, state: x.state, attempt: x.attempt ?? null });
    else if (x.state === "sending") receipts.sendingExpired.push({ id, attempt: x.attempt ?? null });
    else if (x.state === "unknown") receipts.unknown.push({ id, code: x.outcome?.code ?? x.code ?? null, messageIdHeader: x.messageIdHeader ?? null });
    else if (x.state === "claimed") {
      const h = Array.isArray(x.history) ? x.history[x.history.length - 1] : null;
      (h && h.state === "held_before_send" ? receipts.heldBeforeSend : receipts.claimedExpired).push({ id, attempt: x.attempt ?? null });
    }
  });
  const manual = { handingOff: [], unknown: [], unreadable: [] };
  walk(manualRaw, manual.unreadable, (id, x) => {
    const [tenantId, bizId, attemptId] = id.split("/");
    if (!isPlain(x) || x.v !== "MARJIN_MANUAL_ATTEMPT/1" || x.kind !== "daily_snapshot" ||
        x.tenantId !== tenantId || x.bizId !== bizId || x.attemptId !== attemptId ||
        !["handing_off", "accepted", "failed", "unknown"].includes(x.state) ||
        !Number.isFinite(x.startedAt) || typeof x.messageIdHeader !== "string" ||
        (x.state !== "handing_off" && !Number.isFinite(x.settledAt))) { manual.unreadable.push(id); return; }
    if (x.state === "handing_off") manual.handingOff.push({ id, startedAt: x.startedAt ?? null, deploymentId: x.deploymentId ?? null, messageIdHeader: x.messageIdHeader ?? null });
    else if (x.state === "unknown") manual.unknown.push({ id, code: x.code ?? null, messageIdHeader: x.messageIdHeader ?? null });
  });
  const bound = tHold !== null && Number.isInteger(maxDurationMs) && maxDurationMs > 0 ? tHold + maxDurationMs + SEND_DEADLINE_MS + CLAIM_LEASE_MS + DRAIN_MARGIN_MS : null;
  const criteria = {
    C1_hold_continuously_held: tHold !== null ? "met" : "not_met",
    C2_no_live_scheduled_claim: receipts.unreadable.length ? "not_met" : receipts.active.length === 0 ? "met" : "not_met",
    C2b_invocations_explained_by_receipts: invocationReceiptAttested ? "attested" : "not_evaluable",
    C3_no_manual_attempt_handing_off: manual.unreadable.length ? "not_met" : manual.handingOff.length === 0 ? "met" : "not_met",
    C4_time_bound_passed: bound === null ? "not_evaluable" : nowMs >= bound ? "met" : "not_met",
    C5_every_reachable_deployment_gated: inventoryAttested ? "attested" : "not_evaluable",
    C6_hosted_logs_complete: logsAttested ? "attested" : "not_evaluable",
    C7_provider_evidence_for_unresolved_manual: providerAttested ? "attested" : "not_evaluable",
  };
  const strict = ["C1_hold_continuously_held", "C2_no_live_scheduled_claim", "C3_no_manual_attempt_handing_off", "C4_time_bound_passed"];
  const attest = ["C2b_invocations_explained_by_receipts", "C5_every_reachable_deployment_gated", "C6_hosted_logs_complete", "C7_provider_evidence_for_unresolved_manual"];
  const complete = strict.every((k) => criteria[k] === "met") && attest.every((k) => criteria[k] === "attested");
  return {
    verdict: complete ? "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW" : "ABORT_D",
    hold: { gates: c.state, code: c.code, version: c.version, tHold },
    timeBound: { maxDurationMs: Number.isInteger(maxDurationMs) ? maxDurationMs : null, earliestMs: bound, sendDeadlineMs: SEND_DEADLINE_MS, claimLeaseMs: CLAIM_LEASE_MS, marginMs: DRAIN_MARGIN_MS },
    criteria,
    // the P7 population: everything whose provider outcome automation cannot establish (never re-sent automatically)
    p7Population: { scheduledUnknown: receipts.unknown, scheduledSendingExpired: receipts.sendingExpired, manualUnknown: manual.unknown, manualHandingOff: manual.handingOff },
    notHandedOver: { scheduledHeldBeforeSend: receipts.heldBeforeSend, scheduledClaimedExpired: receipts.claimedExpired },
    unreadable: { receipts: receipts.unreadable, manual: manual.unreadable },
    limits: [
      "This report is evidence for an owner judgement. Empty trees and complete logs do not prove that no message is in flight or was sent.",
      "C2b requires an explicit cross-check of every reachable scheduled invocation against its receipt, including invocations with no receipt.",
      "A hand-off that started before the hold cannot be recalled; an `unknown` outcome is settled only by provider evidence (P7).",
      "Deployments without HR1 (any earlier lineage, an Instant Rollback target) ignore the hold and may send.",
    ],
  };
}

/**
 * Run one command against `db`. Returns { exitCode, result }. `args` are parsed flags; `project` is the VERIFIED project.
 */
export async function runCommand(db, command, args, { project, nowMs = Date.now() } = {}) {
  if (!COMMANDS.includes(command)) return { exitCode: EXIT.USAGE, result: { error: "unknown_command", commands: COMMANDS } };
  if (command === "status") return { exitCode: EXIT.OK, result: statusView(await read(db, DELIVERY_HOLD_PATH), await read(db, HELD_DATES_ROOT)) };
  if (command === "evidence") {
    const maxDurationMs = args["max-duration-ms"] === undefined ? null : Number(args["max-duration-ms"]);
    let report;
    try {
      report = drainEvidence({ holdRaw: await read(db, DELIVERY_HOLD_PATH), receiptsRaw: await read(db, `${RECEIPT_ROOT}/${DAILY_SNAPSHOT_KIND}`),
        manualRaw: await read(db, MANUAL_ATTEMPT_ROOT), nowMs, maxDurationMs: Number.isInteger(maxDurationMs) ? maxDurationMs : null,
        inventoryAttested: args["inventory-attested"] === true, logsAttested: args["logs-attested"] === true,
        invocationReceiptAttested: args["invocation-receipt-attested"] === true, providerAttested: args["provider-attested"] === true });
    } catch { return { exitCode: EXIT.ABORT_D, result: { verdict: "ABORT_D", error: "evidence_read_unavailable" } }; }
    return { exitCode: report.verdict === "ABORT_D" ? EXIT.ABORT_D : EXIT.OK, result: report };
  }
  // writes
  if (args.confirm !== `${command}@${project}`) return { exitCode: EXIT.REFUSED, result: { error: "confirmation_required", expected: `--confirm=${command}@${project}` } };
  const expectVersion = args["expect-version"] === undefined ? undefined : Number(args["expect-version"]);
  const r = await changeDeliveryHold(db, { action: command, actor: typeof args.actor === "string" ? args.actor : "", reason: typeof args.reason === "string" ? args.reason : "", expectVersion, nowMs });
  return { exitCode: r.ok ? EXIT.OK : EXIT.REFUSED, result: r };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!COMMANDS.includes(command)) { console.error(`usage: hold.mjs <${COMMANDS.join("|")}> --project=<id> …`); process.exit(EXIT.USAGE); }
  if (args.ambiguousTarget || typeof args.project !== "string" || !args.project || typeof args["database-url"] !== "string" || !args["database-url"]) {
    console.error("ERROR: --project=<projectId> and --database-url=<exact default RTDB URL> are required"); process.exit(EXIT.USAGE); }
  const adminMod = await import("firebase-admin");
  const admin = adminMod.default || adminMod;
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp();
  const app = admin.app();
  const target = verifyTarget(app, { project: args.project, databaseUrl: args["database-url"] });
  if (!target.ok) { console.error(`ABORT (target verification): ${target.code}`); process.exit(EXIT.PROJECT); }
  const { exitCode, result } = await runCommand(admin.database(), command, args, { project: target.project });
  console.log(JSON.stringify(result, null, 2));
  if (command === "evidence") console.log(`VERDICT ${result.verdict}`);
  await app.delete().catch(() => {});
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
