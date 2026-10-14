// HR1 guard — identity, provenance, source rules and scope of the Daily-only delivery hold on I7 (LOCAL; pending independent Codex
// review and the delivery-runtime / route, P0, Rules, test and M1 integration owners' acceptance, T-HR1-*). Nothing here is an
// approval: it proves what the candidate IS. Behaviour is proven separately (test/delivery/hr1-daily-hold.test.mjs HR-01..11,
// test/delivery/hr1-operator-and-compat.test.mjs OT-01..03 / CP-01, the emulator gate test/emulator/hr1-daily-hold-emulator.mjs).
//   HR1G-01  sole parent the I7 candidate 5bae812c; the protected files HR1 changes relative to I7 are exactly run.ts and
//            lib/emailDelivery.js (+ .d.ts); every effective pin (the HR1 overlay included) holds committed / staged / checked out
//   HR1G-02  provenance: the I7 bytes + exactly the recorded edits = the pins; the I7 lines that disappear are exactly the enumerated
//            ones; non-vacuity
//   HR1G-03  the rule in the source: the route's authorization section is the I7 (P0) bytes; G1 follows the one build and precedes
//            every claim / notice / recipient / delivery; the scheduled send passes the date gate; G2 precedes the manual build; the
//            manual send goes through deliverManualDaily; G0 precedes every claim, G3 precedes the claimed → sending transition and
//            the provider; a held attempt writes no terminal state; the hold record has exactly one writer (one transaction); the
//            receipt state machine (decideClaim) and lib/sendEmail.js are byte-identical to I7
//   HR1G-04  scope: outside the three protected files only the operator tool and tests change (both protected-path rules); no Rules,
//            configuration, schedule, sendEmail, builder, presenter, alerts, admin API, date helper or other byte moves
//   HR1G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7 ∪ HR1, each at its pin
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
import { I7_PINS, I7_SCOPE } from "../support/i7-integration.mjs";
import { HR1_PARENT, HR1_PINS, HR1_NEW_FILES, HR1_EDITS, HR1_SCOPE, HR1_UNPROTECTED, isHR1Tree, deriveHR1 } from "../support/hr1-daily-hold.mjs";

const SKIP = !isHR1Tree(REPO) && "not an HR1 tree";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const RT = "api/daily-snapshot/run.ts", ED = "lib/emailDelivery.js", EDT = "lib/emailDelivery.d.ts", AD = "api/admin.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => readFileSync(join(REPO, f), "utf8");
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${HR1_PARENT}:${f}`]).stdout;
// every I7 line that does NOT survive into HR1 (multiset, trimmed)
const REMOVED = /*BEGIN-REMOVED*/{
    "api/daily-snapshot/run.ts": [
      "// an invocation that died while sending ⇒ unknown after the lease).",
      "// claim is never re-claimed early and never re-sent: a later invocation observes its outcome (accepted ⇒ already_accepted;",
      "// receipt write problem) ⇒ \"completed_with_failures\" (500); otherwise any pending row ⇒ \"incomplete\" (503). An unresolved",
      "const complete = !broken && run.status === \"complete\" && inProgressCount === 0 && deliveredCount + skippedCount === results.length;",
      "const r = await deliverWithoutReceipt({ recipient: ownerEmail, send: () => sendSnapshotEmail(ownerEmail, snapshot) });",
      "if (settlement === \"pending\") {",
      "import { deliverWithReceipt, deliverWithoutReceipt, boundedCode, DAILY_SNAPSHOT_KIND,",
      "readDeliveryTarget, recordMissingNameNotice, clearDeliveryNotice, readDeliveryNoticeState } from \"../../lib/emailDelivery.js\";",
      "status: complete ? \"completed\" : broken ? \"completed_with_failures\" : \"incomplete\",",
      "type Settlement = \"delivered\" | \"no_send\" | \"pending\" | \"unknown\" | \"unrecorded\" | \"failed\";"
    ],
    "lib/emailDelivery.d.ts": [
      "export type DeliveryOutcome = \"accepted\" | \"failed\" | \"unknown\" | \"skipped\";"
    ],
    "lib/emailDelivery.js": [
      "*   accepted | failed | unknown | skipped   and receipt is \"recorded\" | \"write_failed\" | \"unavailable\" | \"not_written\".",
      "backoffMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), newClaimId = () => randomUUID() }) {",
      "handedToProvider: false, claimLost: false, multipleHandoffs: false, info: null, error: null,"
    ]
  }/*END-REMOVED*/;
const removedLines = (before, after) => {
  const count = (t) => t.split("\n").map((l) => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(before), b = count(after), out = [];
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) || 0); i++) out.push(l);
  return out.sort();
};

test("HR1G-01 identity: sole parent the I7 candidate; HR1 changes exactly run.ts and lib/emailDelivery.js (+ .d.ts) among the protected files; every pin holds", { skip: SKIP }, () => {
  assert.equal(HR1_PARENT, "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1", "built on the I7 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), HR1_PARENT, "the I7 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(HR1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(HR1_PINS).sort(), [...HR1_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", HR1_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", HR1_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", HR1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), [...HR1_SCOPE].sort(), label + ": protected changes vs I7 = the HR1 scope");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of HR1_SCOPE) assert.equal(eff[f], HR1_PINS[f], f + " is held to its HR1 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId("HEAD:" + AD), I7_PINS[AD], "api/admin.js is the I7 pin");
  assert.equal(blobId("HEAD:lib/sendEmail.js"), de1EffectivePins(REPO)["lib/sendEmail.js"], "lib/sendEmail.js keeps its DE1 pin");
  assert.equal(blobId("HEAD:" + PG), I3_PINS[PG], "the page is the I3 page");
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, PG))), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("HR1G-02 provenance: the I7 bytes + exactly the recorded edits; the I7 lines that disappear are exactly the enumerated ones; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...HR1_NEW_FILES], []);
  for (const f of HR1_SCOPE) {
    const d = deriveHR1(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), HR1_PINS[f], f + ": I7 bytes + the recorded edits = the pin");
    assert.deepEqual(removedLines(parentText(f), d.bytes.toString("utf8")), [...(REMOVED[f] || [])].sort(), f + ": exactly the enumerated I7 lines disappear");
  }
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(HR1_EDITS)); fn(e[f]); return e; };
  assert.equal(deriveHR1(REPO, ED, tamper(ED, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveHR1(REPO, RT, tamper(RT, (l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveHR1(REPO, ED, tamper(ED, (l) => { l[l.length - 1].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== HR1_PINS[ED]);
});

const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const between = (src, from, to) => { const i = src.indexOf(from); assert.ok(i >= 0, "anchor: " + from); const j = to === null ? src.length : src.indexOf(to, i + from.length); assert.ok(j > i, "anchor: " + to); return src.slice(i, j); };
const order = (src, ...marks) => { let at = -1; for (const m of marks) { const i = src.indexOf(m, at + 1); assert.ok(i > at, `"${m}" follows the previous mark`); at = i; } };

test("HR1G-03 the rule in the source: gates G0–G3 at their positions, one hold writer, the authorization section and the receipt machine unchanged", { skip: SKIP }, () => {
  const rt = read(RT), rtI7 = parentText(RT);
  // the authorization section of the route is the I7 (= P0) bytes
  const auth = (s) => between(s, "export default async function handler(req: VercelRequest, res: VercelResponse) {", "  try {\n    // GET = cron trigger");
  assert.equal(auth(rt), auth(rtI7), "the authorization section is byte-identical to I7");
  const code = rt.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");   // comment lines removed (the I1G-05 reading)
  const get = between(code, 'if (req.method === "GET") {\n      const run', '    if (req.method === "POST" && snapshotCtx)');
  // G1 right after the one build, before any claim / notice / recipient / delivery
  order(get, "const run = await buildSnapshotRun({ nowMs: Date.now() });", 'const g1 = await makeDailyDeliveryGate(db, run.businessDate)("g1");', "if (!g1.open) {", "return res.status(503).json({ status: \"held\"",
    "recordMissingNameNotice(", "readDeliveryTarget(", "resolveOwnerRecipient(", "deliverWithReceipt(");
  assert.equal((get.match(/buildSnapshotRun\(/g) || []).length, 1, "one structured run per invocation");
  const call = between(get, "const r = await deliverWithReceipt({", "});");
  assert.ok(/\n\s+gate,\n/.test(call), "the scheduled send passes the date gate");
  assert.ok(get.includes("gate = makeDailyDeliveryGate(db, snapshot.date);"), "the gate is the message's own business date");
  assert.ok(get.includes('if (r.outcome === "held") runHeld = '), "a held message holds the rest of the run");
  // the manual send: G2 before the build; deliverManualDaily; held ⇒ 503 before the 502 / 504 mappings
  const post = between(code, '    if (req.method === "POST" && snapshotCtx)', null);
  order(post, "if (action === undefined) {", "const g2 = await readManualDeliveryGate(db);", "if (!g2.open) return heldReply(g2.code);", "buildSnapshotForBiz(", "await deliverManualDaily({",
    'if (r.outcome === "held") return heldReply(r.code);', 'if (r.outcome === "failed" && r.code === "manual_record_unavailable")', 'return res.status(502).json({ error: "email_not_sent"');
  assert.ok(!/deliverWithoutReceipt\(/.test(code), "the route never sends a Daily without the hold boundary and the attempt record");
  // the library: G0 before every claim, G3 before claimed → sending, held attempts write no terminal state
  const ed = read(ED), edI7 = parentText(ED);
  const dwr = codeOnly(between(ed, "export async function deliverWithReceipt(", "\nexport async function deliverWithoutReceipt("));
  order(dwr, "for (let round = 1; round <= inRunAttempts; round++) {", 'const g = await callGate(gate, "g0");', "if (!g.open) return last || { outcome: \"held\"", "decideClaim(cur,");
  const bt = between(dwr, "async beforeTransport() {", "\n      },\n    };");
  order(bt, "if (ctx.handedToProvider) { ctx.multipleHandoffs = true;", 'const g = await callGate(gate, "g3");', "if (!g.open) {", 'state: "held_before_send"', "throw e;", 'ownedIn("claimed")(cur, claimId)', 'state: "sending"', "ctx.handedToProvider = true;");
  order(dwr, "const outcome = attemptOutcome(ctx, threw, thrown, recipient);", 'if (outcome.outcome === "held") return { outcome: "held"', "const terminal = outcome.outcome === \"accepted\"");
  assert.ok(codeOnly(between(ed, "function attemptOutcome(", "\n}\n")).includes('if (ctx.held && !ctx.handedToProvider) return { outcome: "held", code: ctx.held };'), "a held attempt is its own outcome, never a failure");
  // the receipt state machine and the provider adapter are untouched
  const fn = (s, name) => between(s, `function ${name}(`, "\n}\n");
  assert.equal(fn(ed, "decideClaim"), fn(edI7, "decideClaim"), "decideClaim is byte-identical to I7 (no new receipt state, the same budget rule)");
  assert.equal(between(ed, "export async function deliverWithoutReceipt(", "\n}\n"), between(edI7, "export async function deliverWithoutReceipt(", "\n}\n"), "deliverWithoutReceipt is unchanged");
  assert.ok(ed.includes('export const RECEIPT_VERSION = "MARJIN_EMAIL_RECEIPT/1";') && ed.includes("export const MAX_AUTOMATIC_ATTEMPTS = 3;"), "the receipt contract and the budget are unchanged");
  assert.equal(blobId("HEAD:lib/sendEmail.js"), blobId(`${HR1_PARENT}:lib/sendEmail.js`), "lib/sendEmail.js is byte-identical (other e-mail is not gated)");
  // the hold record: one writer, one transaction; gates fail closed
  const edCode = codeOnly(ed);
  assert.equal((edCode.match(/transact\(db, DELIVERY_HOLD_PATH,/g) || []).length, 1, "the hold record is changed by exactly one transaction");
  assert.ok(!/DELIVERY_HOLD_PATH\)\.(set|update|remove|push)\(/.test(edCode), "no other write to the hold record");
  const cls = codeOnly(fn(ed, "classifyHoldRecord"));
  assert.ok(cls.includes('if (raw.state === "held") return { state: "held", code: "delivery_held"') && cls.includes('return { state: "released", code: null, version: raw.version };'), "released only at the end of the checks");
  assert.equal((cls.match(/state: "released"/g) || []).length, 1, "exactly one path releases");
  assert.ok(codeOnly(between(ed, "export async function readDeliveryHold(", "\n}\n")).includes('if (!r.ok) return { state: "held", code: "delivery_hold_unavailable"'), "an unreadable hold is held");
  const manual = codeOnly(between(ed, "export async function deliverManualDaily(", null));
  order(manual, "async beforeTransport() {", 'const g = await callGate(gate, "g3");', "if (!g.open) { ctx.held = g.code;", "state: \"handing_off\"", "ctx.recordFailed = true;", "ctx.handedToProvider = true;");
});

test("HR1G-04 scope: outside the three protected files only the operator tool and tests change (both protected-path rules); nothing else moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", HR1_PARENT, "HEAD", "--"]));
  const prot = (f) => PROTECTED.test(f) || isProtectedPath(f);
  assert.deepEqual(all.filter((f) => prot(f) && !HR1_SCOPE.includes(f)), [], "no other protected file (either rule)");
  assert.deepEqual(all.filter((f) => !prot(f) && !/^test\//.test(f) && !HR1_UNPROTECTED.includes(f)), [], "outside the scope only tests and the operator tool");
  for (const f of ["lib/sendEmail.js", "lib/sendEmail.d.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/securityContext.d.ts", "lib/businessRegistry.js",
    "lib/bizAccess.js", "lib/helpers.js", "lib/verifyToken.js", "lib/adminSdk.js", "api/admin.js", "api/alerts/run.ts", "lib/alertsCore.js", "api/proactive/run.ts", "api/analytics/daily-builder.ts", "api/cost-history.js",
    "lib/repositories/bizDataRepo.js", "lib/checklistVersion.js", "src/utils/dates.ts", "src/analytics/dailyBuilder.ts", "src/finance/businessDate.ts", "index.html", "scripts/backfill-biz-access.mjs",
    "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh"])
    assert.equal(blobId("HEAD:" + f), blobId(`${HR1_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  assert.ok(!isProtectedPath(HR1_UNPROTECTED[0]) && !PROTECTED.test(HR1_UNPROTECTED[0]), "the operator tool sits outside both protected-path rules (the tools/ precedent of tools/storage-v2/canary.mjs)");
});

test("HR1G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7 ∪ HR1, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE, ...I5_SCOPE, ...I6_SCOPE, ...I7_SCOPE, ...HR1_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS, ...I5_PINS, ...I6_PINS, ...I7_PINS, ...HR1_PINS };
  for (const f of expected) assert.equal(blobId("HEAD:" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId("HEAD:" + f), pin, f + " is the approved M1 R5 pin");
});
