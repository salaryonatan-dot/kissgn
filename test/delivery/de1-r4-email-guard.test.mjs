// DE1 R4 — identity, provenance and scope of the Daily Email reliability R4 successor (LOCAL author candidate; pending
// independent Codex review). Built on the rejected R3 candidate (DE1R4_PARENT, independent review: CHANGES_REQUIRED); answers
// the R3 review's blocking finding (E2/D4 continuation: a present but empty / null / unreadable field read as absent).
//   DE1R4G-01  the protected runtime files R4 changes relative to R3 are EXACTLY the recorded set; committed / staged /
//              checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1 ⊕ DE1 R2 ⊕ DE1 R3 ⊕ DE1 R4) are the pins
//   DE1R4G-02  provenance: the R4 pin is the R3 bytes (= the R3 pin) + exactly the recorded edit
//   DE1R4G-03  scope: only the resolved-result classifier of the receipt module (lib/emailDelivery.js classifyTransportInfo);
//              the declarations, route, SMTP wrapper, builder, presenter, financial code, authorization, Rules, schedule, pins,
//              generated assets and tools are byte-identical to R3; outside the classifier the module is byte-identical
//   DE1R4G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R3 module is not the R4 one
//   DE1R4G-05  the evidence rules in the source: every field is read once through the classifier's own reader, which keeps an
//              UNREADABLE field distinct from an ABSENT one; a present envelope must carry `to`; a refusal detail must be a
//              readable record; R2's E1 rules (no provider-controlled phase evidence, the trusted attempt state) are unchanged
// On a DE1 R5 tree (the delivery owner-decisions successor built on this R4 candidate, test/support/de1-r5-delivery.mjs)
// DE1R4G-01..05 verify the R4 commit itself from git objects (DE1R5_PARENT); the HEAD / index / checkout identity is held
// by the R5 guard (DE1R5G-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R1Pins } from "../support/m1-r1-remediation.mjs";
import { DE1R3_PINS } from "../support/de1-r3-email.mjs";
import { de1EffectivePins, de1R3Pins, de1R4Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { isDE1R5Tree, DE1R5_PARENT } from "../support/de1-r5-delivery.mjs";
import { DE1R4_PARENT, DE1R4_PINS, DE1R4_NEW_FILES, DE1R4_EDITS, DE1R4_SCOPE, isDE1R4Tree, deriveDE1R4 } from "../support/de1-r4-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R4Tree(REPO) && "not a DE1 R4 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R4_PINS).filter((f) => !DE1R4_NEW_FILES.includes(f)).sort();
const ED = "lib/emailDelivery.js";
const LAYERED = isDE1R5Tree(REPO);
const R4_TREE = LAYERED ? DE1R5_PARENT : "HEAD";          // the R4 commit itself when the R5 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R4_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R4G-01 the R4 change set vs R3 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R4_PARENT, "843d52c2c4a8e78b0409f1fce5e43f7fe0c96146", "R4 is built on the rejected R3 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", R4_TREE + "^"]).stdout.trim(), DE1R4_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R4_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R4_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R4_PARENT, R4_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R4_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R4_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R4_PINS).sort(), label + ": protected changes vs R3 = the recorded R4 set");
  // the R4 commit's own pins: on an R5 tree the effective table without the R5 overlay
  // INTEGRATION I1 (layering transition): the historical proof at the R4 commit uses the pins OF THAT COMMIT — the M1 ⊕ R1
  // pins its lineage carried, plus DE1 … R4 — never the checked-out tree's M1 R2..R5 / I1 pins (a later lineage's files)
  const eff = LAYERED ? { ...m1R1Pins(), ...de1R4Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R4_PINS)) assert.equal(eff[f], pin, f + ": the R4 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R4_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R4 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R4G-02 provenance: the R4 pin is the R3 pin's bytes + exactly the recorded edit", { skip: SKIP }, () => {
  assert.deepEqual(DE1R4_NEW_FILES, [], "R4 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R4_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R4_PARENT}:${f}`), DE1R3_PINS[f], f + ": the parent bytes are the R3 pin");
    const d = deriveDE1R4(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R4_PINS[f], f + " = R3 + recorded R4 edit");
  }
});

test("DE1R4G-03 scope: only the resolved-result classifier changes; everything else is byte-identical to R3", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R4_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R4_PARENT, R4_TREE, "--"]));
  const outside = all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && !DE1R4_SCOPE.includes(f));
  assert.deepEqual(outside, [], "no runtime / config / tool / emulator / Rules change outside the receipt module");
  for (const f of ["lib/emailDelivery.d.ts", "api/daily-snapshot/run.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/verifyToken.js", "lib/businessRegistry.js", "test/support/canary-fixtures.mjs", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json"])
    assert.equal(blobId(R4_TREE + ":" + f), blobId(`${DE1R4_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R4_PARENT, R4_TREE, "--", "src", "fincore", "api", "tools", "index.html"])), [], "no src / fincore / api / tools / page change");
  // outside classifyTransportInfo (and its doc comment) the receipt module is byte-identical to R2
  const cut = (s) => { const a = s.indexOf("/**\n * Classify a resolved sendMail result for one recipient."), b = s.indexOf("// ── the per-attempt context lib/sendEmail.js reads"); assert.ok(a > 0 && b > a); return s.slice(0, a) + s.slice(b); };
  assert.equal(cut(readAt(ED)), cut(bytesOf(`${DE1R4_PARENT}:${ED}`).toString("utf8")), "only the resolved-result classifier changed");
});

test("DE1R4G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R3 module is not the R4 one", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R4_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R4(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R4(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R4_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R4(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R4_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R4_PINS[f], DE1R3_PINS[f], f + ": the R4 pin differs from the rejected R3 pin");
  }
  const eff = LAYERED ? de1R4Pins() : de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R4_PINS[f]);
  for (const f of Object.keys(de1R3Pins()).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], de1R3Pins()[f], f + " keeps its R3 pin");
});

test("DE1R4G-05 the evidence rules in the source", { skip: SKIP }, () => {
  const src = readAt(ED);
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");     // executable lines only
  // R2's E1 rules are unchanged
  for (const gone of ['"deliveryPhase"', "deliveryPhase =", '"syscall"', "SYSCALLS", '"message")', "Connection timeout", "provider_unreachable"])
    assert.ok(!code.includes(gone), "no " + gone + " in the classification");
  assert.ok(code.includes("function attemptOutcome(ctx, threw, thrown, recipient)") && code.includes("if (!ctx.handedToProvider) {") && code.includes("if (ctx.claimLost) return"), "the trusted attempt state decides the hand-off");
  const fn = code.slice(code.indexOf("export function classifyTransportInfo(info, to) {"), code.indexOf("const attemptStore"));
  // R4: one reader that keeps UNREADABLE apart from absent; safeRead (which maps a throwing getter to undefined) is not used
  assert.ok(fn.includes('const UNREADABLE = Symbol("unreadable");') && fn.includes("try { return obj[k]; } catch { return UNREADABLE; }"), "the classifier's own reader");
  assert.ok(!fn.includes("safeRead("), "no safeRead in the classifier: a throwing getter is never 'absent'");
  for (const k of ['"accepted"', '"rejected"', '"response"', '"rejectedErrors"', '"envelope"', '"to"', '"responseCode"', '"recipient"']) assert.ok(fn.includes("field(") && fn.includes(k), "reads " + k);
  assert.ok(fn.includes("if (envToRaw === undefined) return malformed(rc);") && fn.includes("if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);"), "a present envelope names exactly the recipient");
  assert.ok(fn.includes("if (e === null || typeof e !== \"object\") return malformed(rc);") && fn.includes("if (erc === null || who === null || who === \"\") return malformed(rc);"), "a refusal detail is a readable record");
  assert.ok(fn.includes("if (details.length === 0) return inconsistent(rc);"), "present but empty refusal details never confirm a refusal");
  assert.equal((fn.match(/outcome: "failed"/g) || []).length, 1, "exactly one refusal exit");
  assert.equal((fn.match(/outcome: "accepted"/g) || []).length, 1, "exactly one acceptance exit");
});
