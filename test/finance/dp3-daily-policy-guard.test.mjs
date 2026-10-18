// DP3 guard (LOCAL correction successor of DP2 78b6f057, itself unaccepted; pending independent Codex review of the whole
// OT4 → DP1 → DP2 → DP3 policy chain; T-DP3-GUARD). Nothing here is an approval: it proves what the candidate IS. Behaviour:
// test/delivery/dp3-evidence-validation.test.mjs (DP3-01..12) and the author emulator gate test/emulator/dp3-evidence-emulator.mjs.
//   DP3G-01  DP2 is the sole parent (→ DP1 → accepted OT4); the committed delta is exactly the fixed scope + its record; every
//            scoped file is pinned in HEAD, index, checkout and the effective overlay; without this layer the overlay is DP2
//   DP3G-02  every edited file re-derives from the literal DP2 blob by the recorded edits; new files are new; the DP2 guard is
//            layered on the literal DP2 object
//   DP3G-03  nothing outside the scope moves: the route, Rules, both delivery paths' bodies, the receipt machine, the admission
//            writers (admitHandoff / settleAdmission), the gates, the outcome classification and deliverWithoutReceipt are DP2
//            bytes; only the admission decision, its validation, the DP1 legacy readers, the declarations and the evidence
//            report's admission reader change; the validation is pure; nothing releases, clears, repairs or reconciles
//   DP3G-04  regression control: the literal DP2 runtime / report accepts each DP2-R01 / R02 / R03 case; DP3 refuses each
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "079fe656779eb6f922d2e3bfe3a567a6a73545ef", "test/finance/dp3-daily-policy-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DP3_PARENT, DP3_SCOPE, DP3_EDITED, DP3_PINS, isDP3Tree, deriveDP3 } from "../support/dp3-daily-policy.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { releasedHoldRecord } from "../support/daily-email-harness.mjs";

const SKIP = !isDP3Tree(REPO) && "not a DP3 successor";
// DP4 (T-DP4-LAYERING): on a successor of DP3 this guard judges the literal, immutable DP3 object; HEAD / index / checkout /
// overlay move to the successor's own guard (the DP2-on-DP3 pattern one layer up).
const DP3 = "a125824cdf1b824da3e60c6a85f43b73d5ee4e68";
const LAYERED = gitIn(REPO, ["merge-base", "--is-ancestor", DP3, "HEAD"]).status === 0 && gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim() !== DP3;
const SOURCE = LAYERED ? DP3 : "HEAD";
const src = (f) => LAYERED ? gitIn(REPO, ["cat-file", "blob", `${SOURCE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8");
const DP1 = "b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6", OT4 = "f34eec92aed4851c2da8a8dfd8f1f353b1d582d7";
const RECORD = "test/support/dp3-daily-policy.json";
const ED = "lib/emailDelivery.js", DTS = "lib/emailDelivery.d.ts", RT = "api/daily-snapshot/run.ts", TOOL = "tools/daily-delivery/hold.mjs";
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], "-z", ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\0").filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ["cat-file", "blob", `${DP3_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, "anchor: " + a.slice(0, 60)); const j = b === null ? s.length : s.indexOf(b, i + a.length); assert.ok(j >= 0, "end: " + String(b).slice(0, 60)); return s.slice(i, j); };
const fn = (s, name) => between(s, `function ${name}(`, "\n}\n");
const code = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));

test("DP3G-01 DP2 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree", { skip: SKIP }, () => {
  assert.deepEqual(git(["rev-list", "--parents", "-n1", SOURCE]).split(" ").slice(1), [DP3_PARENT]);
  assert.equal(git(["rev-parse", `${DP3_PARENT}^`]), DP1, "DP2 is the sole child of DP1");
  assert.equal(git(["rev-parse", `${DP1}^`]), OT4, "DP1 is the sole child of accepted OT4");
  assert.deepEqual(names(["diff", "--name-only", DP3_PARENT, SOURCE, "--"]).sort(), [...DP3_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(DP3_PINS).sort(), [...DP3_SCOPE].sort());
  if (!LAYERED) for (const args of [["diff", "--cached", "--name-only", "HEAD", "--"], ["diff", "--name-only", "HEAD", "--"],
    ["ls-files", "--others", "--", ":(exclude)node_modules", ":(exclude)test/historical/.deps"]]) assert.deepEqual(names(args), [], args.join(" "));
  const without = m1EffectivePins(REPO, { withDP3: false });
  for (const f of DP3_SCOPE) {
    assert.match(DP3_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), DP3_PINS[f], f + " HEAD");
    if (LAYERED) assert.equal(m1EffectivePins(REPO, { withDP4: false })[f], DP3_PINS[f], f + " overlay without the successor layer");
    else {
    assert.equal(git(["rev-parse", `:${f}`]), DP3_PINS[f], f + " index");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), DP3_PINS[f], f + " checkout");
    assert.equal(m1EffectivePins(REPO)[f], DP3_PINS[f], f + " overlay");
    }
    if (without[f] !== undefined) assert.equal(without[f], git(["rev-parse", `${DP3_PARENT}:${f}`]), f + " overlay without this layer = the DP2 bytes");
  }
});

test("DP3G-02 edited files re-derive from literal DP2 by the recorded edits; new files are new; the DP2 guard is layered", { skip: SKIP }, () => {
  for (const f of DP3_EDITED) {
    const r = deriveDP3(REPO, f); assert.ok(r.ok, f + ": " + r.reason);
    assert.equal(gitBlobId(r.bytes), DP3_PINS[f], f + " re-derived");
    assert.equal(deriveDP3(REPO, f, { [f]: [{ from: "\u0000anchor absent from every source file\u0000", to: "" }] }).reason, "edit_anchor_not_unique");
  }
  for (const f of DP3_SCOPE.filter((x) => !DP3_EDITED.includes(x)))
    assert.notEqual(gitIn(REPO, ["cat-file", "-e", `${DP3_PARENT}:${f}`]).status, 0, f + " is new in DP3");
  const g = src("test/finance/dp2-daily-policy-guard.test.mjs");
  assert.ok(g.includes(`const DP2 = "${DP3_PARENT}";`) && g.includes('const SOURCE = LAYERED ? DP2 : "HEAD";'));
});

test("DP3G-03 scope, unchanged delivery paths and writers, a pure validation, and the P7 invariant", { skip: SKIP }, () => {
  for (const f of [RT, "lib/sendEmail.js", "lib/sendEmail.d.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js",
    "lib/businessRegistry.js", "lib/bizAccess.js", "lib/helpers.js", "api/admin.js", "database.rules.json", "test/emulator/database.rules.json",
    "test/support/rules-authorized-delta.mjs", "vercel.json", "package.json", "package-lock.json", "index.html", "fincore/v1/MANIFEST.json",
    "test/support/dp1-daily-policy.json", "test/support/dp1-daily-policy.mjs", "test/support/dp2-daily-policy.json", "test/support/dp2-daily-policy.mjs",
    "test/emulator/dp2-shared-admission-emulator.mjs", "test/emulator/dp2-admission-worker.mjs", "test/emulator/hr1-daily-hold-emulator.mjs"])
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), git(["rev-parse", `${DP3_PARENT}:${f}`]), f + " is DP2 bytes");
  assert.deepEqual(names(["diff", "--name-only", DP3_PARENT, SOURCE, "--", "src", "fincore", "scripts", "migrations"]), []);
  assert.deepEqual(names(["diff", "--name-only", DP3_PARENT, SOURCE, "--", "lib", "api", "tools"]).sort(), [DTS, ED, TOOL].sort());
  const ed = src(ED), dp2 = parentBlob(ED);
  for (const name of ["decideClaim", "attemptOutcome", "classifyTransportError", "classifyTransportInfo", "classifyHoldRecord", "decideScheduledGate",
    "readDailyDeliveryGate", "makeDailyDeliveryGate", "readManualDeliveryGate", "changeDeliveryHold", "recordHeldDate", "receiptPath", "manualAttemptPath",
    "transact", "readBounded", "callGate", "deliveryInventoryView", "confirmDeliveryInventory", "admissionPath", "admitHandoff", "settleAdmission"])
    assert.equal(fn(ed, name), fn(dp2, name), name + " is DP2 bytes");
  for (const [a, b] of [["export async function deliverWithReceipt(", "\n}\n"], ["export async function deliverWithoutReceipt(", "\n}\n"], ["export async function deliverManualDaily(", "\n}\n"]])
    assert.equal(between(ed, a, b), between(dp2, a, b), a + " is DP2 bytes (both routes' order: gates → other evidence → admission → own transition → hand-off)");
  // the runtime delta is exactly: the validation (new), the admission decision, the two DP1 legacy readers and decideManualRepeat's call
  const changed = ["decideAdmission", "scheduledEvidence", "manualEvidence", "decideManualRepeat"];
  const strip = (s) => { let t = s; for (const n of changed) t = t.replace(fn(s, n), ""); return t.replace(fn(s, "admissionRecordDefect"), ""); };
  const edNo = strip(ed), dp2No = (() => { let t = dp2; for (const n of changed) t = t.replace(fn(dp2, n), ""); return t; })();
  assert.deepEqual(code(edNo).filter((l) => !code(dp2No).includes(l)), [], "no other runtime line is new");
  assert.deepEqual(code(dp2No).filter((l) => !code(edNo).includes(l)), [], "no other runtime line is removed");
  // the validation is pure and writes nothing; the admission decision writes only an in_flight record (history entries are failed holders)
  const v = fn(ed, "admissionRecordDefect");
  assert.ok(!/\b(db|transact|ref|set|update|remove|push|delete)\b\s*\(/.test(v) && !/\bawait\b/.test(v), "admissionRecordDefect is a pure function");
  assert.deepEqual(fn(ed, "decideAdmission").match(/state: "\w+"/g), ['state: "in_flight"', 'state: "failed"'], "admitting writes in_flight only (the second is the earlier failed holder's history entry)");
  assert.ok(fn(ed, "decideAdmission").includes("if (admissionRecordDefect(current, ids) !== null) return refuse(\"delivery_admission_unreadable\");"));
  assert.ok(fn(ed, "decideAdmission").includes("if (legacy !== null) return refuse(legacy);"), "a failed admission never erases blocking evidence (DP2-R01)");
  const edCode = code(ed).join("\n");
  assert.equal((edCode.match(/transact\(db, path, \(cur\) => decideAdmission\(/g) || []).length, 1, "one admitting transaction");
  assert.deepEqual(edCode.match(/\.ref\([^)]*\)\.(set|update|remove|push)\(/g), [".ref(path).remove("], "no direct write but the owner-notice removal");
  assert.ok(!/export (async )?function \w*(reconcil|repair|settle(?!Admission)|clear(?!DeliveryNotice)|release|reset|resolve(?!DeliveryTarget))/i.test(ed), "no reconciliation / repair / clearing entry point");
  assert.equal(fn(ed, "scheduledEvidence").includes("Number(raw.leaseUntil)"), false, "no coerced lease (DP2-R02)");
  // the declarations: only the admission section changes
  const d = src(DTS), d2 = parentBlob(DTS);
  assert.deepEqual(code(d2).filter((l) => !code(d).includes(l)).map((l) => l.slice(0, 40)), [
    'export type AdmissionCode = "delivery_al', "ids: { kind: string; tenantId: string; b", "attempt?: number; nowMs: number; leaseMs"], "only the admission code union and the two option lists are replaced");
  // the operator tool: only the admission reader of the evidence report changes; every command and the input parser are DP2 bytes
  const tool = src(TOOL), tool2 = parentBlob(TOOL);
  assert.deepEqual(code(tool2).filter((l) => !code(tool).includes(l)).map((l) => l.slice(0, 48)), [
    "import { DELIVERY_HOLD_PATH, HELD_DATES_ROOT, MANUAL",
    "const admissions = { live: [], inFlightExpired: [],",
    'if (!isPlain(x) || x.v !== "MARJIN_DELIVERY_ADMISS',
    'x.businessDate !== businessDate || !["scheduled", "',
    '!["in_flight", "accepted", "failed", "unknown"].inc'].map((x) => x.slice(0, 48)), "replaced DP2 tool lines: the import, the admission lists and the old predicate");
  assert.equal(code(tool).filter((l) => !code(tool2).includes(l)).length, 4, "four new tool lines: the import, the lists, the shared validation and its unreadable entry");
  for (const name of ["maxDurationInput", "parseArgs", "runCommand"]) assert.equal(fn(tool, name), fn(tool2, name), name + " is DP2 bytes");
  const report = fn(tool, "drainEvidence");
  assert.ok(report.includes("const defect = admissionRecordDefect(x, { kind: DAILY_SNAPSHOT_KIND, tenantId, bizId, businessDate });"), "the runtime's validation");
  assert.ok(report.includes('C2_no_live_scheduled_claim: receipts.unreadable.length || admissions.unreadable.length || admissions.live.length ? "not_met"'), "an unreadable admission keeps C2 not_met");
});

test("DP3G-04 regression control: the literal DP2 runtime and report accept each DP2-R01 / R02 / R03 case; DP3 refuses each", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp3-dp2-"));
  mkdirSync(join(dir, "tools", "daily-delivery"), { recursive: true });
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "emailDelivery.js"), parentBlob(ED));
  writeFileSync(join(dir, TOOL), parentBlob(TOOL));
  const P = { lib: await import(pathToFileURL(join(dir, "lib", "emailDelivery.js")).href), tool: await import(pathToFileURL(join(dir, TOOL)).href) };
  // on a successor the literal DP3 runtime and report are judged (written beside the copied library)
  if (LAYERED) { mkdirSync(join(dir, "dp3", "tools", "daily-delivery"), { recursive: true }); cpSync(join(REPO, "lib"), join(dir, "dp3", "lib"), { recursive: true });
    writeFileSync(join(dir, "dp3", "lib", "emailDelivery.js"), src(ED)); writeFileSync(join(dir, "dp3", TOOL), src(TOOL)); }
  const CR = LAYERED ? join(dir, "dp3") : REPO;
  const C = { lib: await import(pathToFileURL(join(CR, ED)).href), tool: await import(pathToFileURL(join(CR, TOOL)).href) };
  const T = "tenantA", B = "bizA", D = "2026-09-08", NOW = Date.UTC(2026, 8, 8, 4, 5), TO = "o@example.test", MID = "a0000000-0000-4000-8000-000000000041";
  const ids = { kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: D };
  const failedAdm = (M, extra = {}) => ({ v: M.ADMISSION_VERSION, ...ids, state: "failed", route: "scheduled", ref: "b0000000-0000-4000-8000-000000000041", attempt: 1,
    messageIdHeader: "<daily_snapshot.1.x@delivery.marjin.app>", since: NOW - 20_000, code: "provider_rejected_550", settledAt: NOW - 19_000, updatedAt: NOW - 19_000, ...extra });
  const manualAccepted = (M) => ({ v: M.MANUAL_ATTEMPT_VERSION, attemptId: MID, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: D, state: "accepted",
    messageIdHeader: `<manual.${MID}@delivery.marjin.app>`, startedAt: NOW - 30_000, updatedAt: NOW - 29_000, settledAt: NOW - 29_000 });
  const claimedNoLease = (M) => ({ v: M.RECEIPT_VERSION, ...ids, state: "claimed", claimId: "c0000000-0000-4000-8000-000000000041", attempt: 1, claimedAt: NOW - 2000,
    updatedAt: NOW - 2000, recipientHash: "a".repeat(64) });
  const handOffs = async (M, seed, via) => {
    let handed = 0; const db = makeDb(); db.seed("delivery_control/daily_snapshot", releasedHoldRecord()); seed(db);
    const send = async () => { const a = M.currentDeliveryAttempt(); await a.beforeTransport(); handed++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
    if (via === "scheduled") await M.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW, gate: M.makeDailyDeliveryGate(db, D, { clock: () => NOW }) });
    else await M.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW });
    return handed;
  };
  const admPath = `email_delivery_admission/daily_snapshot/${T}/${B}/${D}`;
  const cases = [
    ["R01 failed admission + older manual acceptance (scheduled)", (M) => (db) => { db.seed(admPath, failedAdm(M)); db.seed(`email_delivery_manual/${T}/${B}/${MID}`, manualAccepted(M)); }, "scheduled"],
    ["R02 incomplete failed admission (manual)", (M) => (db) => { const { attempt, since, settledAt, updatedAt, code, ...x } = failedAdm(M); db.seed(admPath, x); }, "manual"],
    ["R02 failed admission with an accepted historical holder (scheduled)", (M) => (db) => db.seed(admPath, failedAdm(M, { history: [{ route: "manual", ref: MID, attempt: 1, state: "accepted", code: "x", at: NOW - 30_000 }] })), "scheduled"],
    ["R02 claimed receipt without a lease (manual)", (M) => (db) => db.seed(`email_delivery/daily_snapshot/${T}/${B}/${D}`, claimedNoLease(M)), "manual"],
  ];
  for (const [name, seed, via] of cases) {
    assert.equal(await handOffs(P.lib, seed(P.lib), via), 1, "DP2 hands over: " + name);
    assert.equal(await handOffs(C.lib, seed(C.lib), via), 0, "DP3 refuses: " + name);
  }
  // positive control on both runtimes: a valid failed admission and nothing else blocking ⇒ one hand-off
  for (const via of ["scheduled", "manual"]) for (const M of [P.lib, C.lib]) assert.equal(await handOffs(M, (db) => db.seed(admPath, failedAdm(M)), via), 1, via);
  // R03: the report on a runtime-unreadable admission
  const holdRaw = { schema: 1, state: "held", version: 1, log: { v000000001: { action: "init", state: "held", version: 1, prevVersion: 0, actor: "op", reason: "evidence check", at: NOW - 36_000_000 } } };
  const args = (M) => ({ holdRaw, receiptsRaw: null, manualRaw: null, nowMs: NOW, maxDurationMs: 300000, inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true,
    admissionRaw: { [T]: { [B]: { [D]: failedAdm(M, { history: { corrupt: true } }) } } } });
  assert.equal(P.tool.drainEvidence(args(P.lib)).verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", "DP2 completes on a runtime-unreadable admission");
  assert.equal(C.tool.drainEvidence(args(C.lib)).verdict, "ABORT_D", "DP3 does not");
});
