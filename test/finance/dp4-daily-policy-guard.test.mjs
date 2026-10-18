// DP4 guard (LOCAL correction successor of DP3 a125824c, itself unaccepted; pending independent Codex review of the whole
// OT4 → DP1 → DP2 → DP3 → DP4 policy chain; T-DP4-GUARD). Nothing here is an approval: it proves what the candidate IS.
// Behaviour: test/delivery/dp4-legacy-date-scope.test.mjs (DP4-01..06).
//   DP4G-01  DP3 is the sole parent (→ DP2 → DP1 → accepted OT4); the committed delta is exactly the fixed scope + its record;
//            every scoped file is pinned in HEAD, index, checkout and the effective overlay; without this layer the overlay is DP3
//   DP4G-02  every edited file re-derives from the literal DP3 blob by the recorded edits; new files are new; the DP3 guard is
//            layered on the literal DP3 object
//   DP4G-03  nothing outside the scope moves: the route, Rules, declarations, the operator tool (its legacy report readers
//            included — L-3 is a documented reporting boundary, not changed here), both delivery paths, the admission and every
//            other runtime function are DP3 bytes; the only runtime change is inside manualEvidence; nothing reconciles (P7)
//   DP4G-04  regression control: the literal DP3 runtime hands over on an unreadable-date incomplete failure (with and without a
//            valid failed admission) on both routes; DP4 does not; a complete definitive failure hands over once on both
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "079fe656779eb6f922d2e3bfe3a567a6a73545ef", "test/finance/dp4-daily-policy-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DP4_PARENT, DP4_SCOPE, DP4_EDITED, DP4_PINS, isDP4Tree, deriveDP4 } from "../support/dp4-daily-policy.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { releasedHoldRecord } from "../support/daily-email-harness.mjs";

const SKIP = !isDP4Tree(REPO) && "not a DP4 successor";
const DP2 = "78b6f05775cdbbad8de161c1377de79aafa41e96", DP1 = "b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6", OT4 = "f34eec92aed4851c2da8a8dfd8f1f353b1d582d7";
const RECORD = "test/support/dp4-daily-policy.json";
const ED = "lib/emailDelivery.js", DTS = "lib/emailDelivery.d.ts", RT = "api/daily-snapshot/run.ts", TOOL = "tools/daily-delivery/hold.mjs";
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], "-z", ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\0").filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ["cat-file", "blob", `${DP4_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, "anchor: " + a.slice(0, 60)); const j = b === null ? s.length : s.indexOf(b, i + a.length); assert.ok(j >= 0, "end: " + String(b).slice(0, 60)); return s.slice(i, j); };
const fn = (s, name) => between(s, `function ${name}(`, "\n}\n");
const code = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));

test("DP4G-01 DP3 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree", { skip: SKIP }, () => {
  assert.deepEqual(git(["rev-list", "--parents", "-n1", "HEAD"]).split(" ").slice(1), [DP4_PARENT]);
  assert.equal(git(["rev-parse", `${DP4_PARENT}^`]), DP2, "DP3 is the sole child of DP2");
  assert.equal(git(["rev-parse", `${DP2}^`]), DP1, "DP2 is the sole child of DP1");
  assert.equal(git(["rev-parse", `${DP1}^`]), OT4, "DP1 is the sole child of accepted OT4");
  assert.deepEqual(names(["diff", "--name-only", DP4_PARENT, "HEAD", "--"]).sort(), [...DP4_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(DP4_PINS).sort(), [...DP4_SCOPE].sort());
  for (const args of [["diff", "--cached", "--name-only", "HEAD", "--"], ["diff", "--name-only", "HEAD", "--"],
    ["ls-files", "--others", "--", ":(exclude)node_modules", ":(exclude)test/historical/.deps"]]) assert.deepEqual(names(args), [], args.join(" "));
  const without = m1EffectivePins(REPO, { withDP4: false });
  for (const f of DP4_SCOPE) {
    assert.match(DP4_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(["rev-parse", `HEAD:${f}`]), DP4_PINS[f], f + " HEAD");
    assert.equal(git(["rev-parse", `:${f}`]), DP4_PINS[f], f + " index");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), DP4_PINS[f], f + " checkout");
    assert.equal(m1EffectivePins(REPO)[f], DP4_PINS[f], f + " overlay");
    if (without[f] !== undefined) assert.equal(without[f], git(["rev-parse", `${DP4_PARENT}:${f}`]), f + " overlay without this layer = the DP3 bytes");
  }
});

test("DP4G-02 edited files re-derive from literal DP3 by the recorded edits; new files are new; the DP3 guard is layered", { skip: SKIP }, () => {
  for (const f of DP4_EDITED) {
    const r = deriveDP4(REPO, f); assert.ok(r.ok, f + ": " + r.reason);
    assert.equal(gitBlobId(r.bytes), DP4_PINS[f], f + " re-derived");
    assert.equal(deriveDP4(REPO, f, { [f]: [{ from: "\u0000anchor absent from every source file\u0000", to: "" }] }).reason, "edit_anchor_not_unique");
  }
  for (const f of DP4_SCOPE.filter((x) => !DP4_EDITED.includes(x)))
    assert.notEqual(gitIn(REPO, ["cat-file", "-e", `${DP4_PARENT}:${f}`]).status, 0, f + " is new in DP4");
  const g = readFileSync(join(REPO, "test/finance/dp3-daily-policy-guard.test.mjs"), "utf8");
  assert.ok(g.includes(`const DP3 = "${DP4_PARENT}";`) && g.includes('const SOURCE = LAYERED ? DP3 : "HEAD";'));
});

test("DP4G-03 scope: only manualEvidence changes; the route, declarations, operator tool, admission and both delivery paths are DP3 bytes", { skip: SKIP }, () => {
  for (const f of [RT, DTS, TOOL, "lib/sendEmail.js", "lib/sendEmail.d.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts",
    "lib/securityContext.js", "lib/businessRegistry.js", "lib/bizAccess.js", "lib/helpers.js", "api/admin.js", "database.rules.json",
    "test/emulator/database.rules.json", "test/support/rules-authorized-delta.mjs", "vercel.json", "package.json", "package-lock.json", "index.html",
    "fincore/v1/MANIFEST.json", "test/support/dp1-daily-policy.json", "test/support/dp2-daily-policy.json", "test/support/dp3-daily-policy.json",
    "test/support/dp3-daily-policy.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/dp3-evidence-validation.test.mjs",
    "test/emulator/dp3-evidence-emulator.mjs", "test/finance/dp2-daily-policy-guard.test.mjs", "test/finance/dp1-daily-policy-guard.test.mjs"])
    assert.equal(git(["rev-parse", `HEAD:${f}`]), git(["rev-parse", `${DP4_PARENT}:${f}`]), f + " is DP3 bytes");
  assert.deepEqual(names(["diff", "--name-only", DP4_PARENT, "HEAD", "--", "src", "fincore", "scripts", "migrations"]), []);
  assert.deepEqual(names(["diff", "--name-only", DP4_PARENT, "HEAD", "--", "lib", "api", "tools"]), [ED]);
  const ed = readFileSync(join(REPO, ED), "utf8"), dp3 = parentBlob(ED);
  // the runtime delta is exactly manualEvidence: every other line of the module is DP3 bytes
  assert.equal(ed.replace(fn(ed, "manualEvidence"), "§"), dp3.replace(fn(dp3, "manualEvidence"), "§"), "every runtime byte outside manualEvidence is DP3");
  const now = fn(ed, "manualEvidence"), was = fn(dp3, "manualEvidence");
  assert.deepEqual(code(was).filter((l) => !code(now).includes(l)), [
    'if (!validDate(x.businessDate) && x.state !== "failed") codes.push("delivery_history_unreadable");',
    'if (x.state === "failed" && (!Number.isSafeInteger(x.startedAt) || typeof x.messageIdHeader !== "string" ||',
    '!Number.isSafeInteger(x.settledAt) || typeof x.code !== "string")) { codes.push("delivery_history_unreadable"); continue; }',
  ], "removed: the failed-only date excuse and the inline completeness check");
  assert.deepEqual(code(now).filter((l) => !code(was).includes(l)), [
    'const definitiveFailure = x.state === "failed" && Number.isSafeInteger(x.startedAt) && typeof x.messageIdHeader === "string" &&',
    'Number.isSafeInteger(x.settledAt) && typeof x.code === "string";',
    'if (!validDate(x.businessDate) && !definitiveFailure) codes.push("delivery_history_unreadable");',
    'if (x.state === "failed" && !definitiveFailure) { codes.push("delivery_history_unreadable"); continue; }',
  ], "added: one completeness predicate used by both the unreadable-date excuse and the same-date failure");
  // the definitive-failure predicate is evaluated BEFORE any record is excused; a valid other date is still excused unconditionally
  const iPred = now.indexOf("const definitiveFailure"), iDate = now.indexOf("if (x.businessDate !== businessDate) {");
  assert.ok(iPred > 0 && iPred < iDate, "the completeness predicate precedes the date branch (DP3-R01)");
  assert.ok(between(now, "if (x.businessDate !== businessDate) {", "continue;").includes("!validDate(x.businessDate) && !definitiveFailure"));
  assert.ok(!/\b(db|transact|ref|set|update|remove|push|delete)\b\s*\(/.test(now.replace(/codes\.push\(/g, "")) && !/\bawait\b/.test(now), "manualEvidence stays pure (it only collects codes)");
  assert.ok(!/x\.(businessDate|code|settledAt)\s*=(?!=)/.test(now), "nothing is defaulted or repaired");
  assert.ok(!/export (async )?function \w*(reconcil|repair|settle(?!Admission)|clear(?!DeliveryNotice)|release|reset|resolve(?!DeliveryTarget))/i.test(ed), "no reconciliation / repair / clearing entry point (P7 not implemented)");
});

test("DP4G-04 regression control: the literal DP3 runtime hands over on DP3-R01's records; DP4 does not; a complete failure hands over on both", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp4-dp3-"));
  mkdirSync(join(dir, "lib"), { recursive: true });
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "emailDelivery.js"), parentBlob(ED));
  const P = await import(pathToFileURL(join(dir, "lib", "emailDelivery.js")).href);
  const C = await import(pathToFileURL(join(REPO, ED)).href);
  const T = "tenantA", B = "bizA", D = "2026-09-08", NOW = Date.UTC(2026, 8, 8, 4, 5), TO = "o@example.test", MID = "a0000000-0000-4000-8000-000000000061";
  const failedRec = (M, extra = {}) => ({ v: M.MANUAL_ATTEMPT_VERSION, attemptId: MID, kind: "daily_snapshot", tenantId: T, bizId: B, state: "failed",
    messageIdHeader: `<manual.${MID}@delivery.marjin.app>`, startedAt: NOW - 30_000, updatedAt: NOW - 29_000, settledAt: NOW - 29_000, code: "provider_rejected_550", ...extra });
  const failedAdm = (M) => ({ v: M.ADMISSION_VERSION, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: D, state: "failed", route: "scheduled",
    ref: "b0000000-0000-4000-8000-000000000061", attempt: 1, since: NOW - 20_000, code: "provider_rejected_550", settledAt: NOW - 19_000, updatedAt: NOW - 19_000 });
  const handOffs = async (M, rec, admission, via) => {
    let handed = 0; const db = makeDb(); db.seed("delivery_control/daily_snapshot", releasedHoldRecord());
    db.seed(`email_delivery_manual/${T}/${B}/${MID}`, rec); if (admission) db.seed(`email_delivery_admission/daily_snapshot/${T}/${B}/${D}`, admission);
    const send = async () => { const a = M.currentDeliveryAttempt(); await a.beforeTransport(); handed++; a.info = { accepted: [TO], rejected: [], response: "250 OK" }; };
    if (via === "scheduled") await M.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW, gate: M.makeDailyDeliveryGate(db, D, { clock: () => NOW }) });
    else await M.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: D, recipient: TO, send, clock: () => NOW });
    return handed;
  };
  for (const via of ["scheduled", "manual"]) for (const withAdm of [false, true]) for (const date of [undefined, "unreadable"]) {
    const name = `${via}, date ${date ?? "absent"}, ${withAdm ? "valid failed admission" : "no admission"}`;
    const incomplete = (M) => { const { code, ...x } = failedRec(M, date === undefined ? {} : { businessDate: date }); return x; };
    assert.equal(await handOffs(P, incomplete(P), withAdm ? failedAdm(P) : null, via), 1, "DP3 hands over (DP3-R01): " + name);
    assert.equal(await handOffs(C, incomplete(C), withAdm ? failedAdm(C) : null, via), 0, "DP4 refuses: " + name);
    // positive control: the complete definitive failure is excused on both runtimes
    for (const M of [P, C]) assert.equal(await handOffs(M, failedRec(M, date === undefined ? {} : { businessDate: date }), withAdm ? failedAdm(M) : null, via), 1, "complete failure: " + name);
  }
});
