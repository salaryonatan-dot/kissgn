// Agent/Daily integration I7 guard — identity, provenance and scope of the successor to the rejected I6 candidate (LOCAL; pending
// independent Codex review). Nothing here is an approval: it proves what the candidate IS, so that the P0 / admin-API, M1 identity,
// user-access and production-readiness audit owners can confirm it. Behaviour is proven separately
// (test/finance/i7-admin-local-registry.test.mjs AL-01..04, i7-update-user-alignment.test.mjs UA-01..04,
// i7-parity.test.mjs PA-01 / PA-02, the audit rows I7-A1..A3 and the emulator gate test/emulator/i7-integration-emulator.mjs).
//   I7G-01  sole parent the I6 candidate 224a00a6; the only protected file I7 changes relative to I6 is api/admin.js; every effective pin
//           holds committed / staged / checked out; the page is still the I3 page
//   I7G-02  provenance: the I6 bytes + exactly the recorded edits = the pin; the I6 lines that disappear are exactly the enumerated
//           ones; non-vacuity
//   I7G-03  the rule in the source: every Admin-local business-data authorization (list-entry-exceptions, eeAuthorizeWrite,
//           bizDataAuthRead, bizDataAuthWrite) calls the approved scRequireRegisteredBusiness AFTER the biz_access decision and before it
//           returns; every handler reaching an Admin-local business repository goes through one of them (or the P1 scAccess);
//           update-user: after the Auth e-mail change only the one atomic write, and Auth is only read inside the compensation helpers
//           (one revert, no loop); the audit classifies the raw node
//   I7G-04  scope: outside api/admin.js only tests and the audit model + its test change — judged against BOTH protected-path rules
//           (this guard's and the S0 server-reader / VAT roots, which include stored-data scripts); no registry module, security
//           context, route, repository, delivery, Builder, date helper, backfill script, page, Rules, schedule or configuration byte moves
//   I7G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7, each at its pin
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R5Pins, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, isProtectedPath } from "../support/server-reader-authorized-delta.mjs";
import { de1EffectivePins, DE1_SCOPE } from "../support/de1-daily-email.mjs";
import { ADB06_PINS, ADB06_FILES } from "../support/adb06-builder-layer.mjs";
import { I1_ENTRY, I1_PINS, I1_SCOPE } from "../support/i1-integration.mjs";
import { I2_PINS } from "../support/i2-integration.mjs";
import { I3_PINS, I3_SCOPE } from "../support/i3-integration.mjs";
import { I4_PINS, I4_SCOPE } from "../support/i4-integration.mjs";
import { I5_PINS, I5_SCOPE } from "../support/i5-integration.mjs";
import { I6_PINS, I6_SCOPE } from "../support/i6-integration.mjs";
import { I7_PARENT, I7_PINS, I7_NEW_FILES, I7_EDITS, I7_SCOPE, I7_UNPROTECTED, isI7Tree, deriveI7 } from "../support/i7-integration.mjs";
// HR1 layering (Daily-only delivery hold HR1, T-HR1-LAYER; PROPOSED for the M1 integration owner — the I6G-on-I7 pattern): on a tree
// that carries HR1 on top of the I7 candidate, I7G-01..05 verify the I7 commit ITSELF (5bae812c) from git objects — sole parent I6,
// protected change set api/admin.js, pins the I7 pins, the I7 source rules — and the HEAD / index / checkout identity of the later
// tree is held by its own guard (HR1G-01). Nothing is skipped.
import { isHR1Tree, HR1_PARENT } from "../support/hr1-daily-hold.mjs";

const SKIP = !isI7Tree(REPO) && "not an I7 tree";
const LAYERED = isHR1Tree(REPO);
const I7_TREE = LAYERED ? HR1_PARENT : "HEAD";          // the I7 commit itself when the HR1 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const AD = "api/admin.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I7_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${I7_PARENT}:${f}`]).stdout;
// every I6 line that does NOT survive into I7 (multiset, trimmed): only update-user's single unverified revert, replaced by revertAuthEmail
const REMOVED = {
  [AD]: [
    "if (emailChanged && oldEmail) {",
    "try { await auth.updateUser(firebaseUid, { email: oldEmail }); }",
    'catch (revErr) { console.error("[update-user] Auth revert FAILED — manual repair required:", revErr.message); }',
  ],
};
const removedLines = (before, after) => {
  const count = (t) => t.split("\n").map((l) => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(before), b = count(after), out = [];
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) || 0); i++) out.push(l);
  return out.sort();
};

test("I7G-01 identity: sole parent the I6 candidate; I7 changes exactly api/admin.js among the protected files; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I7_PARENT, "224a00a655f0f2af9a0e55abac96db3265355cfb", "built on the rejected I6 candidate");
  if (LAYERED) assert.equal(I7_TREE, "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1", "the I7 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", I7_TREE + "^"]).stdout.trim(), I7_PARENT, "the I6 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I7_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I7_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(I7_PINS).sort(), [...I7_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I7_PARENT, I7_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", I7_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", I7_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...I7_SCOPE].sort(), label + ": protected changes vs I6 = the I7 scope");
  // the I7 commit's own pin table when layered: the effective tables without the HR1 overlay (the HR1 files are held by HR1G-01)
  const eff = { ...m1EffectivePins(REPO, { withHR1: false }), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of I7_SCOPE) assert.equal(eff[f], I7_PINS[f], f + " is held to its I7 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(I7_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the I7 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId(I7_TREE + ":" + PG), I3_PINS[PG], "the page is the I3 page");
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I7_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("I7G-02 provenance: the I6 bytes + exactly the recorded edits; the I6 lines that disappear are exactly the enumerated ones; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I7_NEW_FILES], []);
  for (const f of I7_SCOPE) {
    assert.equal(blobId(`${I7_PARENT}:${f}`), I6_PINS[f], f + ": the parent bytes are its I6 pin");
    const d = deriveI7(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), I7_PINS[f], f + ": I6 bytes + the recorded edits = the pin");
    assert.deepEqual(removedLines(parentText(f), d.bytes.toString("utf8")), [...REMOVED[f]].sort(), f + ": exactly the enumerated I6 lines disappear");
  }
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(I7_EDITS)); fn(e[AD]); return e; };
  assert.equal(deriveI7(REPO, AD, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI7(REPO, AD, tamper((l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveI7(REPO, AD, tamper((l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I7_PINS[AD]);
});

const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fnBody = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + from.length); assert.ok(i >= 0 && j > i, `${from} … ${to}`); return src.slice(i, j); };
/** A handler's text up to the next top-level async function (or the end of the file). */
const handlerBody = (src, name) => { const from = `async function ${name}(req, res)`, i = src.indexOf(from); assert.ok(i >= 0, from); const j = src.indexOf("\nasync function ", i + from.length); return src.slice(i, j < 0 ? src.length : j); };

test("I7G-03 the rule in the source: Admin-local authorizations call the approved registry check after biz_access; update-user compensation is bounded; the audit uses the runtime classifier", { skip: SKIP }, () => {
  const ad = read(AD);
  const REG = "await scRequireRegisteredBusiness(db, tenantId, bizId);";
  const helpers = [
    ["list-entry-exceptions", "async function handleListEntryExceptions", "async function tenantMaintenanceHold", "await listEntryExceptions("],
    ["eeAuthorizeWrite", "async function eeAuthorizeWrite", "function eeRespond", "storage_v2_control/${tenantId}/${bizId}"],
    ["bizDataAuthRead", "async function bizDataAuthRead", "async function bizDataAuthWrite", "return { claims, role, db };"],
    ["bizDataAuthWrite", "async function bizDataAuthWrite", "function validVersionToken", "return { claims, role, db, body, tenantId, bizId };"],
  ];
  for (const [name, from, to, after] of helpers) {
    const b = fnBody(ad, from, to);
    assert.equal(b.split(REG).length, 2, name + ": exactly one registry check");
    const access = b.indexOf("await requireBizAccess(db, tenantId, bizId, claims.uid, role);");
    assert.ok(access > 0 && access < b.indexOf(REG) && b.indexOf(REG) < b.indexOf(after), name + ": biz_access → registry → data / return");
  }
  const sc = fnBody(ad, "async function scRequireRegisteredBusiness", "async function scAccess");
  assert.ok(sc.includes("const t = await readRegistryTarget(db, tenantId, bizId);") && sc.includes('if (t.state === "registered") return;'), "the approved P1 registry check (unchanged)");
  assert.equal(sc, fnBody(parentText(AD), "async function scRequireRegisteredBusiness", "async function scAccess"), "scRequireRegisteredBusiness is byte-identical to I6");
  // every handler that reaches an Admin-local business repository goes through a guarded authorization (or the P1 scAccess)
  const code = codeOnly(ad);
  const repoCalls = ["listEntryExceptions(", "runEntryExceptionTxn(", "getBizDocWithToken(", "setBizDocGuarded(", "readBizDailyRange("];
  const handlers = [...code.matchAll(/async function (handle\w+)\(req, res\)/g)].map((m) => m[1]);
  const covering = { list: /await listEntryExceptions\(/, ee: /await eeAuthorizeWrite\(req, res\)/, read: /await bizDataAuthRead\(req, res, tenantId, bizId\)/, write: /await bizDataAuthWrite\(req, res, "(manager|shift_manager)"\)/ };
  let reached = 0;
  for (const h of handlers) {
    const b = handlerBody(code, h);
    if (!repoCalls.some((c) => b.includes(c))) continue;
    reached++;
    assert.ok(h === "handleListEntryExceptions" || covering.ee.test(b) || covering.read.test(b) || covering.write.test(b), h + ": reaches a business repository only through a guarded authorization");
  }
  const range = handlerBody(code.replace("async function bizDailyRangeGet(req, res, kind)", "async function bizDailyRangeGet(req, res)"), "bizDailyRangeGet");
  assert.ok(covering.read.test(range) && range.indexOf("bizDataAuthRead(") < range.indexOf("readBizDailyRange("), "analytics / insights range: guarded read before the repository");
  assert.ok(reached >= 8, "non-vacuous: " + reached + " handlers reach a business repository");
  // update-user: after the Auth e-mail change only the one atomic write; Auth reads only inside the compensation helpers
  const uu = fnBody(ad, "async function handleUpdateUser", "async function handleBootstrapSelf");
  const afterAuth = uu.slice(uu.indexOf("await auth.updateUser(firebaseUid, { email: newEmail });"));
  assert.equal((afterAuth.match(/\.once\(|\.get\(\)/g) || []).length, 0, "update-user: no database read after the Auth e-mail change");
  assert.equal((afterAuth.match(/await db\.ref\(\)\.update\(updates\)/g) || []).length, 1, "update-user: one atomic write after Phase 4");
  assert.ok(!/auth\.getUser\(/.test(uu), "update-user reads Auth only through the compensation helpers");
  assert.ok(afterAuth.includes("await settleAuthEmailAfterError(auth, firebaseUid, newEmail, oldEmail)") && afterAuth.includes("await revertAuthEmail(auth, firebaseUid, newEmail, oldEmail)"), "both residual cases use the helpers");
  assert.deepEqual([...uu.matchAll(/res\.status\((\d+)\)\.json\(\{ error: "(שגיאה בעדכון Firebase Auth|שגיאה בשמירת המשתמש — פנה לתמיכה)" \}\)/g)].map((m) => m[1]), ["500", "500"], "the two failure answers are unchanged");
  const comp = fnBody(ad, "const normEmail =", "async function handleUpdateUser");
  assert.equal((comp.match(/auth\.updateUser\(/g) || []).length, 1, "one revert, nowhere else an Auth change");
  assert.ok(!/\b(for|while)\s*\(/.test(codeOnly(comp)), "no retry loop");
  assert.ok(!/db\.|ref\(/.test(codeOnly(comp)), "no new record is written");
  // the audit classifies the RAW node
  const model = read("docs/production-readiness/lib/biz-access-model.mjs");
  const rv = fnBody(model, "export function registryVerdict", "export function normalizeAllowedBizIds");
  assert.ok(rv.includes("return classifyRegistryTarget(biz.raw, bizId).state;") && !/_v:\s*JSON\.stringify/.test(rv), "registryVerdict: the raw node, never a rebuilt envelope");
});

test("I7G-04 scope: outside api/admin.js only tests and the audit model + its test change (both protected-path rules); no registry, security context, route, repository, delivery, Builder, date helper, backfill script, page, Rules or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I7_PARENT, I7_TREE, "--"]));
  const prot = (f) => PROTECTED.test(f) || isProtectedPath(f);   // this guard's roots ∪ the S0 server-reader / VAT roots (stored-data scripts included)
  assert.deepEqual(all.filter((f) => prot(f) && !I7_SCOPE.includes(f)), [], "no other protected file (either rule)");
  assert.deepEqual(all.filter((f) => !prot(f) && !/^test\//.test(f) && !I7_UNPROTECTED.includes(f)), [], "outside the scope only tests and the audit model + its test");
  assert.ok(isProtectedPath("scripts/backfill-biz-access.mjs") && !PROTECTED.test("scripts/backfill-biz-access.mjs"), "non-vacuity: the S0 rule is what covers stored-data scripts");
  for (const f of ["index.html", "lib/businessRegistry.js", "lib/businessRegistry.d.ts", "lib/securityContext.js", "lib/securityContext.d.ts", "lib/bizAccess.js", "lib/helpers.js", "lib/apiScope.js",
    "lib/emailDelivery.js", "lib/sendEmail.js", "lib/repositories/bizDataRepo.js", "lib/repositories/entryExceptionsRepo.js", "lib/repositories/supplierCreditsRepo.js", "lib/ownerGuard.js",
    "api/daily-snapshot/run.ts", "api/cost-history.js", "api/analytics/daily-builder.ts", "api/alerts/run.ts", "api/agent/ask.ts", "api/proactive/run.ts", "lib/alertsCore.js", "lib/agentAskCore.js", "lib/proactiveCore.js",
    "lib/finance/costHistoryWriter.js", "src/snapshot/snapshotBuilder.ts", "src/analytics/dailyBuilder.ts", "src/utils/dates.ts", "src/finance/businessDate.ts",
    "docs/production-readiness/lib/analytics-model.mjs", "docs/production-readiness/biz-access-audit.mjs", "scripts/backfill-biz-access.mjs", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh"])
    assert.equal(blobId(I7_TREE + ":" + f), blobId(`${I7_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(I7_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I7G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, I7_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE, ...I5_SCOPE, ...I6_SCOPE, ...I7_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS, ...I5_PINS, ...I6_PINS, ...I7_PINS };
  for (const f of expected) assert.equal(blobId(I7_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(I7_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
