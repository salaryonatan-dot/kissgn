// DE1 R3 — identity, provenance and scope of the Daily Email reliability R3 successor (LOCAL author candidate; pending
// independent Codex review). Built on the rejected R2 candidate (DE1R3_PARENT, independent review: CHANGES_REQUIRED); answers
// the R2 review's blocking finding (E2 continuation: a contradictory resolved result recorded as a definite refusal).
//   DE1R3G-01  the protected runtime files R3 changes relative to R2 are EXACTLY the recorded set; committed / staged /
//              checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1 ⊕ DE1 R2 ⊕ DE1 R3) are the pins
//   DE1R3G-02  provenance: the R3 pin is the R2 bytes (= the R2 pin) + exactly the recorded edit
//   DE1R3G-03  scope: only the resolved-result classifier of the receipt module (lib/emailDelivery.js classifyTransportInfo);
//              the declarations, route, SMTP wrapper, builder, presenter, financial code, authorization, Rules, schedule, pins,
//              generated assets and tools are byte-identical to R2; outside the classifier the module is byte-identical
//   DE1R3G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R2 module is not the R3 one
//   DE1R3G-05  the evidence rules in the source: a resolved result is judged with all of its fields (the reply code, both
//              lists, the refusal details and the envelope); a refusal needs a present 4xx/5xx reply code; R2's E1 evidence
//              rules (no provider-controlled phase evidence, the trusted attempt state) are unchanged
// On a DE1 R4 tree (the successor of this rejected R3 candidate, test/support/de1-r4-email.mjs) DE1R3G-01..05 verify the R3
// commit itself from git objects (DE1R4_PARENT); the HEAD / index / checkout identity is held by the R4 guard (DE1R4G-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R1Pins } from "../support/m1-r1-remediation.mjs";
import { DE1R2_PINS } from "../support/de1-r2-email.mjs";
import { de1EffectivePins, de1R2Pins, de1R3Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { isDE1R4Tree, DE1R4_PARENT } from "../support/de1-r4-email.mjs";
import { DE1R3_PARENT, DE1R3_PINS, DE1R3_NEW_FILES, DE1R3_EDITS, DE1R3_SCOPE, isDE1R3Tree, deriveDE1R3 } from "../support/de1-r3-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R3Tree(REPO) && "not a DE1 R3 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R3_PINS).filter((f) => !DE1R3_NEW_FILES.includes(f)).sort();
const ED = "lib/emailDelivery.js";
const LAYERED = isDE1R4Tree(REPO);
const R3_TREE = LAYERED ? DE1R4_PARENT : "HEAD";          // the R3 commit itself when the R4 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R3_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R3G-01 the R3 change set vs R2 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R3_PARENT, "3a66397c2aa83cf7e6d6cb3c6ca5cc37fdde9f13", "R3 is built on the rejected R2 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", R3_TREE + "^"]).stdout.trim(), DE1R3_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R3_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R3_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R3_PARENT, R3_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R3_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R3_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R3_PINS).sort(), label + ": protected changes vs R2 = the recorded R3 set");
  // the R3 commit's own pins: on an R4 tree the effective table without the R4 overlay
  // INTEGRATION I1 (layering transition): the historical proof at the R3 commit uses the pins OF THAT COMMIT — the M1 ⊕ R1
  // pins its lineage carried, plus DE1 … R3 — never the checked-out tree's M1 R2..R5 / I1 pins (a later lineage's files)
  const eff = LAYERED ? { ...m1R1Pins(), ...de1R3Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R3_PINS)) assert.equal(eff[f], pin, f + ": the R3 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R3_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R3 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R3G-02 provenance: the R3 pin is the R2 pin's bytes + exactly the recorded edit", { skip: SKIP }, () => {
  assert.deepEqual(DE1R3_NEW_FILES, [], "R3 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R3_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R3_PARENT}:${f}`), DE1R2_PINS[f], f + ": the parent bytes are the R2 pin");
    const d = deriveDE1R3(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R3_PINS[f], f + " = R2 + recorded R3 edit");
  }
});

test("DE1R3G-03 scope: only the resolved-result classifier changes; everything else is byte-identical to R2", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R3_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R3_PARENT, R3_TREE, "--"]));
  const outside = all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && !DE1R3_SCOPE.includes(f));
  assert.deepEqual(outside, [], "no runtime / config / tool / emulator / Rules change outside the receipt module");
  for (const f of ["lib/emailDelivery.d.ts", "api/daily-snapshot/run.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/verifyToken.js", "lib/businessRegistry.js", "test/support/canary-fixtures.mjs", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json"])
    assert.equal(blobId(R3_TREE + ":" + f), blobId(`${DE1R3_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R3_PARENT, R3_TREE, "--", "src", "fincore", "api", "tools", "index.html"])), [], "no src / fincore / api / tools / page change");
  // outside classifyTransportInfo (and its doc comment) the receipt module is byte-identical to R2
  const cut = (s) => { const a = s.indexOf("/**\n * Classify a resolved sendMail result for one recipient."), b = s.indexOf("// ── the per-attempt context lib/sendEmail.js reads"); assert.ok(a > 0 && b > a); return s.slice(0, a) + s.slice(b); };
  assert.equal(cut(readAt(ED)), cut(bytesOf(`${DE1R3_PARENT}:${ED}`).toString("utf8")), "only the resolved-result classifier changed");
});

test("DE1R3G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R2 module is not the R3 one", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R3_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R3(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R3(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R3_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R3(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R3_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R3_PINS[f], DE1R2_PINS[f], f + ": the R3 pin differs from the rejected R2 pin");
  }
  const eff = LAYERED ? de1R3Pins() : de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R3_PINS[f]);
  for (const f of Object.keys(DE1R2_PINS).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], de1R2Pins()[f], f + " keeps its R2 pin");
});

test("DE1R3G-05 the evidence rules in the source", { skip: SKIP }, () => {
  const src = readAt(ED);
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");     // executable lines only
  // R2's E1 rules are unchanged
  for (const gone of ['"deliveryPhase"', "deliveryPhase =", '"syscall"', "SYSCALLS", '"message")', "Connection timeout", "provider_unreachable"])
    assert.ok(!code.includes(gone), "no " + gone + " in the classification");
  assert.ok(code.includes("function attemptOutcome(ctx, threw, thrown, recipient)") && code.includes("if (!ctx.handedToProvider) {") && code.includes("if (ctx.claimLost) return"), "the trusted attempt state decides the hand-off");
  // R3: the resolved result is judged with all of its fields
  const fn = code.slice(code.indexOf("export function classifyTransportInfo(info, to) {"), code.indexOf("const attemptStore"));
  for (const field of ['"accepted"', '"rejected"', '"response"', '"rejectedErrors"', '"envelope"']) assert.ok(fn.includes(field), "reads " + field);
  assert.ok(!fn.includes('if (isRejected) return { outcome: "failed"'), "a listed rejection alone is never a refusal (the R2 rule)");
  assert.ok(fn.includes("if (rc === null) return { outcome: \"unknown\", code: \"provider_result_incomplete\"") && fn.includes("if (!rcNegative) return inconsistent(rc);"), "a refusal needs a present 4xx/5xx reply code");
  assert.equal((fn.match(/outcome: "failed"/g) || []).length, 1, "exactly one refusal exit");
  assert.equal((fn.match(/outcome: "accepted"/g) || []).length, 1, "exactly one acceptance exit");
});
