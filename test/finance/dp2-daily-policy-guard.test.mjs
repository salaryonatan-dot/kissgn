// DP2 guard (LOCAL successor of DP1 b2b7dd08, itself unaccepted; pending independent Codex review of OT4 → DP2; T-DP2-GUARD).
// Nothing here is an approval: it proves what the candidate IS. Behaviour: test/delivery/dp2-shared-admission.test.mjs
// (DP2-01..12) and the author emulator gate test/emulator/dp2-shared-admission-emulator.mjs (DP2E-01..08).
//   DP2G-01  DP1 is the sole parent (→ accepted OT4); the committed delta is exactly the fixed scope + its record; every scoped
//            file is pinned in HEAD, index, checkout and the effective overlay; without this layer the overlay describes DP1
//   DP2G-02  every edited file re-derives from the literal DP1 blob by the recorded edits; new files are new; the DP1 guard is
//            layered on the literal DP1 object
//   DP2G-03  nothing outside the scope moves; the receipt state machine, deliverWithoutReceipt, the gates, the hold writer,
//            the outcome classification and the P4 legacy decision are DP1 bytes; both routes take the shared admission after
//            their gates and before their own hand-off transition; the admission is written only by admitHandoff /
//            settleAdmission (settle only an in_flight record held by the same ref); nothing releases, clears or reconciles
//   DP2G-04  regression control: the literal DP1 runtime hands over twice in both DP1 gaps; DP2 hands over once
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "079fe656779eb6f922d2e3bfe3a567a6a73545ef", "test/finance/dp2-daily-policy-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DP2_PARENT, DP2_SCOPE, DP2_EDITED, DP2_PINS, isDP2Tree, deriveDP2 } from "../support/dp2-daily-policy.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { releasedHoldRecord } from "../support/daily-email-harness.mjs";

const SKIP = !isDP2Tree(REPO) && "not a DP2 successor";
// DP3 (T-DP3-LAYERING): on a successor of DP2 this guard judges the literal, immutable DP2 object; HEAD / index / checkout /
// overlay move to the successor's own guard (the DP1-on-DP2 pattern one layer up).
const DP2 = "78b6f05775cdbbad8de161c1377de79aafa41e96";
const LAYERED = gitIn(REPO, ["merge-base", "--is-ancestor", DP2, "HEAD"]).status === 0 && gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim() !== DP2;
const SOURCE = LAYERED ? DP2 : "HEAD";
const src = (f) => LAYERED ? gitIn(REPO, ["cat-file", "blob", `${SOURCE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8");
const OT4 = "f34eec92aed4851c2da8a8dfd8f1f353b1d582d7";
const RECORD = "test/support/dp2-daily-policy.json";
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts", TOOL = "tools/daily-delivery/hold.mjs";
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], "-z", ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\0").filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ["cat-file", "blob", `${DP2_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, "anchor: " + a.slice(0, 60)); const j = b === null ? s.length : s.indexOf(b, i + a.length); assert.ok(j >= 0, "end: " + String(b).slice(0, 60)); return s.slice(i, j); };
const fn = (s, name) => between(s, `function ${name}(`, "\n}\n");
const code = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
const order = (s, ...xs) => { let i = -1; for (const x of xs) { const j = s.indexOf(x, i + 1); assert.ok(j > i, "order: " + x.slice(0, 70)); i = j; } };

test("DP2G-01 DP1 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree", { skip: SKIP }, () => {
  assert.deepEqual(git(["rev-list", "--parents", "-n1", SOURCE]).split(" ").slice(1), [DP2_PARENT]);
  assert.equal(git(["rev-parse", `${DP2_PARENT}^`]), OT4, "DP1 is the sole child of accepted OT4");
  assert.deepEqual(names(["diff", "--name-only", DP2_PARENT, SOURCE, "--"]).sort(), [...DP2_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(DP2_PINS).sort(), [...DP2_SCOPE].sort());
  if (!LAYERED) for (const args of [["diff", "--cached", "--name-only", "HEAD", "--"], ["diff", "--name-only", "HEAD", "--"],
    ["ls-files", "--others", "--", ":(exclude)node_modules", ":(exclude)test/historical/.deps"]]) assert.deepEqual(names(args), [], args.join(" "));
  const without = m1EffectivePins(REPO, { withDP2: false });
  for (const f of DP2_SCOPE) {
    assert.match(DP2_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), DP2_PINS[f], f + " HEAD");
    if (LAYERED) assert.equal(m1EffectivePins(REPO, { withDP3: false })[f], DP2_PINS[f], f + " overlay without the successor layer");
    else {
    assert.equal(git(["rev-parse", `:${f}`]), DP2_PINS[f], f + " index");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), DP2_PINS[f], f + " checkout");
    assert.equal(m1EffectivePins(REPO)[f], DP2_PINS[f], f + " overlay");
    }
    if (without[f] !== undefined) assert.equal(without[f], git(["rev-parse", `${DP2_PARENT}:${f}`]), f + " overlay without this layer = the DP1 bytes");
  }
});

test("DP2G-02 edited files re-derive from literal DP1 by the recorded edits; new files are new; the DP1 guard is layered", { skip: SKIP }, () => {
  for (const f of DP2_EDITED) {
    const r = deriveDP2(REPO, f); assert.ok(r.ok, f + ": " + r.reason);
    assert.equal(gitBlobId(r.bytes), DP2_PINS[f], f + " re-derived");
    assert.equal(deriveDP2(REPO, f, { [f]: [{ from: "\u0000anchor absent from every source file\u0000", to: "" }] }).reason, "edit_anchor_not_unique");
  }
  for (const f of DP2_SCOPE.filter((x) => !DP2_EDITED.includes(x)))
    assert.notEqual(gitIn(REPO, ["cat-file", "-e", `${DP2_PARENT}:${f}`]).status, 0, f + " is new in DP2");
  const g = src("test/finance/dp1-daily-policy-guard.test.mjs");
  assert.ok(g.includes(`const DP1 = "${DP2_PARENT}";`) && g.includes('const SOURCE = LAYERED ? DP1 : "HEAD";'));
});

test("DP2G-03 scope, the shared admission's place in both routes, its only writers, and the P7 invariant", { skip: SKIP }, () => {
  for (const f of ["lib/sendEmail.js", "lib/sendEmail.d.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js",
    "lib/businessRegistry.js", "lib/bizAccess.js", "lib/helpers.js", "api/admin.js", "database.rules.json", "test/emulator/database.rules.json",
    "test/support/rules-authorized-delta.mjs", "vercel.json", "package.json", "package-lock.json", "index.html", "fincore/v1/MANIFEST.json",
    "test/support/dp1-daily-policy.json", "test/support/dp1-daily-policy.mjs", "test/emulator/hr1-daily-hold-emulator.mjs"])
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), git(["rev-parse", `${DP2_PARENT}:${f}`]), f + " is DP1 bytes");
  assert.deepEqual(names(["diff", "--name-only", DP2_PARENT, SOURCE, "--", "src", "fincore", "scripts", "migrations"]), []);
  assert.deepEqual(names(["diff", "--name-only", DP2_PARENT, SOURCE, "--", "lib", "api", "tools"]).sort(), [RT, "lib/emailDelivery.d.ts", ED, TOOL].sort());
  const ed = src(ED), dp1 = parentBlob(ED);
  for (const name of ["decideClaim", "attemptOutcome", "classifyTransportError", "classifyTransportInfo", "classifyHoldRecord", "decideScheduledGate",
    "readDailyDeliveryGate", "makeDailyDeliveryGate", "readManualDeliveryGate", "changeDeliveryHold", "recordHeldDate", "receiptPath", "manualAttemptPath",
    "transact", "readBounded", "callGate", "deliveryInventoryView", "confirmDeliveryInventory", "decideManualRepeat", "scheduledEvidence", "manualEvidence"])
    assert.equal(fn(ed, name), fn(dp1, name), name + " is DP1 bytes");
  assert.equal(between(ed, "export async function deliverWithoutReceipt(", "\n}\n"), between(dp1, "export async function deliverWithoutReceipt(", "\n}\n"), "deliverWithoutReceipt is DP1 (= OT4) bytes");
  // the scheduled route: G3 → legacy manual evidence → the admission → claimed → sending → hand-off
  const dwr = between(ed, "export async function deliverWithReceipt(", "\nexport async function deliverWithoutReceipt(");
  order(between(dwr, "async beforeTransport() {", "\n      },\n    };"), 'const g = await callGate(gate, "g3");', "if (!g.open) {",
    "const prior = await readBounded(db, `${MANUAL_ATTEMPT_ROOT}/${tenantId}/${bizId}`, HOLD_READ_TIMEOUT_MS);",
    'const adm = await admitHandoff(db, { kind, tenantId, bizId, businessDate, route: "scheduled", ref: claimId,', "if (!adm.ok) await refuseAdmission(adm.code);",
    "ctx.admitted = true;", 'state: "sending"', 'state: "failed", code: "claim_lost"', "ctx.handedToProvider = true;");
  assert.ok(dwr.includes('if (ctx.admissionRefused !== null && !ctx.handedToProvider) return { outcome: "skipped", code: ctx.admissionRefused, attempt, receipt: ctx.heldReceipt || "write_failed" };'));
  assert.ok(dwr.includes("? await settleAdmission(db, { kind, tenantId, bizId, businessDate, ref: claimId, state: terminal.state, code: terminal.code ?? null, nowMs: now })"));
  // the manual route: G3 (E4) → receipt read → legacy records read → the admission → the record (handing_off) → hand-off
  const manual = between(ed, "export async function deliverManualDaily(", null);
  order(between(manual, "async beforeTransport() {", "\n    },\n  };"), 'const g = await callGate(gate, "g3");', "const receiptRead = await readBounded(db, rcptPath, HOLD_READ_TIMEOUT_MS);",
    "const recordsRead = await readBounded(db, `${MANUAL_ATTEMPT_ROOT}/${tenantId}/${bizId}`, HOLD_READ_TIMEOUT_MS);",
    'const adm = await admitHandoff(db, { ...ids, route: "manual", ref: attemptId, attempt: 1,', "ctx.admitted = true;",
    "r = await transact(db, `${MANUAL_ATTEMPT_ROOT}/${tenantId}/${bizId}`, (cur) => {", 'state: "handing_off"', "ctx.handedToProvider = true;");
  assert.ok(manual.includes("const settled = await settleAdmission(db, { tenantId, bizId, businessDate, ref: attemptId, state: c.outcome, code: c.code ?? null, nowMs: clock() });"));
  // the admission's only writers; settle only an in_flight record of the same holder; nothing releases / clears / reconciles
  const edCode = code(ed).join("\n");
  assert.equal((edCode.match(/transact\(db, path, \(cur\) => decideAdmission\(/g) || []).length, 1, "one admitting transaction");
  assert.ok(fn(ed, "settleAdmission").includes('if (!isPlain(cur) || cur.v !== ADMISSION_VERSION || cur.state !== "in_flight" || cur.ref !== ref) return { next: undefined, result: false };'));
  assert.equal((edCode.match(/admissionPath\(/g) || []).length, 3, "admissionPath: its definition, admitHandoff and settleAdmission");
  assert.deepEqual(edCode.match(/\.ref\([^)]*\)\.(set|update|remove|push)\(/g), [".ref(path).remove("], "no direct write but the owner-notice removal");
  assert.ok(!/export (async )?function \w*(reconcil|settle(?!Admission)|clear(?!DeliveryNotice)|release|reset|resolve(?!DeliveryTarget))/i.test(ed), "no reconciliation / clearing entry point");
  assert.deepEqual(fn(ed, "decideAdmission").match(/state: "\w+"/g), ['state: "in_flight"', 'state: "failed"'], "admitting writes in_flight only (the second is the history entry of the earlier failed holder)");
  assert.ok(fn(ed, "settleAdmission").includes('!["accepted", "failed", "unknown"].includes(state)'), "settling writes accepted / failed / unknown only");
  // the route: authorization section unchanged; the scheduled section changes only the admission accounting
  const rt = src(RT), rt1 = parentBlob(RT);
  const auth = (s) => between(s, "export default async function handler(req: VercelRequest, res: VercelResponse) {", "  try {\n    // GET = cron trigger");
  assert.equal(auth(rt), auth(rt1), "authorization section");
  const before = code(rt1), after = code(rt);
  assert.deepEqual(before.filter((l) => !after.includes(l)).sort(), [
    "attempt?: number; receipt?: string; phase?: string; recipientSelection?: RecipientSelection; notice?: \"recorded\" | \"not_recorded\" };",
    'if (outcome === "skipped" && code === "already_accepted") return "delivered";',
    'if (outcome === "skipped" && code === "in_progress") return "pending";',
    'if (outcome === "unknown" || (outcome === "skipped" && code === "unknown_requires_reconciliation")) return "unknown";',
    "const receiptWriteFailures = count((x) => x.receipt === \"write_failed\" || x.receipt === \"unavailable\");",
    "results.push({ ...base, outcome: r.outcome, code, settlement, attempt: attemptNo, receipt: r.receipt,",
  ].sort());
  assert.equal(after.filter((l) => !before.includes(l)).length, 9, "nine new route lines (settlement, accounting, two refusal codes, the unsettled-admission log)");
  // the operator tool: only the admissions reading changes in the evidence report
  const tool = src(TOOL), tool1 = parentBlob(TOOL);
  assert.deepEqual(code(tool1).filter((l) => !code(tool).includes(l)), [
    "import { DELIVERY_HOLD_PATH, HELD_DATES_ROOT, MANUAL_ATTEMPT_ROOT, RECEIPT_ROOT, DAILY_SNAPSHOT_KIND, CLAIM_LEASE_MS, classifyHoldRecord,",
    "export function drainEvidence({ holdRaw, receiptsRaw, manualRaw, nowMs, maxDurationMs = null, inventoryAttested = false, logsAttested = false,",
    'C2_no_live_scheduled_claim: receipts.unreadable.length ? "not_met" : receipts.active.length === 0 ? "met" : "not_met",',
    'C3_no_manual_attempt_handing_off: manual.unreadable.length ? "not_met" : manual.handingOff.length === 0 ? "met" : "not_met",',
    "const [holdRaw, receiptsRaw, manualRaw] = await Promise.all([read(db, DELIVERY_HOLD_PATH, timeout),",
    "read(db, `${RECEIPT_ROOT}/${DAILY_SNAPSHOT_KIND}`, timeout), read(db, MANUAL_ATTEMPT_ROOT, timeout)]);",
    "report = drainEvidence({ holdRaw, receiptsRaw, manualRaw, nowMs, maxDurationMs: Number.isInteger(maxDurationMs) ? maxDurationMs : null,",
  ], "only the evidence report's inputs and C2 / C3 change; every other tool line is DP1 (= OT4) bytes");
  assert.equal(code(tool).filter((l) => !code(tool1).includes(l)).length, 16, "sixteen new tool lines (the admissions reading)");
  for (const name of ["maxDurationInput", "parseArgs"]) assert.equal(fn(tool, name), fn(tool1, name), name + " is DP1 (= OT4) bytes");
});

test("DP2G-04 regression control: the literal DP1 runtime hands over twice in both gaps; DP2 hands over once", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp2-dp1-"));
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "emailDelivery.js"), parentBlob(ED));
  const DP1 = await import(pathToFileURL(join(dir, "lib", "emailDelivery.js")).href);
  // on a successor the literal DP2 runtime is judged (written beside the copied library)
  if (LAYERED) { mkdirSync(join(dir, "dp2", "lib"), { recursive: true }); cpSync(join(REPO, "lib"), join(dir, "dp2", "lib"), { recursive: true }); writeFileSync(join(dir, "dp2", "lib", "emailDelivery.js"), src(ED)); }
  const DP2R = await import(pathToFileURL(LAYERED ? join(dir, "dp2", "lib", "emailDelivery.js") : join(REPO, ED)).href);
  const T = "tenantA", B = "bizA", D = "2026-09-08", NOW = Date.UTC(2026, 8, 8, 4, 5), TO = "o@example.test";
  const run = async (M, gap) => {
    let handed = 0; const db = makeDb(); db.seed("delivery_control/daily_snapshot", releasedHoldRecord());
    const send = async () => { const a = M.currentDeliveryAttempt(); await a.beforeTransport(); handed++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
    const scheduled = () => M.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW, gate: M.makeDailyDeliveryGate(db, D, { clock: () => NOW }) });
    const manual = (d = db) => M.deliverManualDaily({ db: d, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW });
    if (gap === 2) { await manual(); await scheduled(); return handed; }
    const ref = db.ref; let armed = true;   // gap 1: the scheduled delivery runs to completion inside the manual send's first manual-side transaction
    const wrapped = { ...db, ref: (p, q) => { const x = ref(p, q);
      return armed && (String(p).startsWith("email_delivery_manual/") || String(p).startsWith("email_delivery_admission/"))
        ? { ...x, transaction: async (f) => { armed = false; await scheduled(); return x.transaction(f); } } : x; } };
    await manual(wrapped); return handed;
  };
  assert.deepEqual([await run(DP1, 1), await run(DP1, 2)], [2, 2], "DP1: both gaps hand the Daily over twice");
  assert.deepEqual([await run(DP2R, 1), await run(DP2R, 2)], [1, 1], "DP2: one hand-off per identity");
});
