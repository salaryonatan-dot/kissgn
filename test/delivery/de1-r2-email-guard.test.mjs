// DE1 R2 — identity, provenance and scope of the Daily Email reliability R2 successor (LOCAL author candidate; pending
// independent Codex review). Built on the rejected R1 candidate (DE1R2_PARENT, DAILY_EMAIL_RELIABILITY_R1_VERDICT:
// CHANGES_REQUIRED); answers the R1 review's findings E1 and E2.
//   DE1R2G-01  the protected runtime files R2 changes relative to R1 are EXACTLY the recorded set; committed / staged /
//              checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1 ⊕ DE1 R2) are the pins
//   DE1R2G-02  provenance: each R2 pin is the R1 bytes (= the R1 pin) + exactly the recorded edits
//   DE1R2G-03  scope: only the receipt module's provider-outcome evidence (lib/emailDelivery.{js,d.ts}); the route, the SMTP
//              wrapper, builder, presenter, financial code, authorization, Rules, schedule, pins, generated assets and tools
//              are byte-identical to R1
//   DE1R2G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the R1 receipt module is not the R2 one
//   DE1R2G-05  the evidence rules in the source: no provider-controlled property is read as phase evidence (no
//              `deliveryPhase`, no syscall, no message text); the attempt outcome comes from the trusted attempt state
// On a DE1 R3 tree (the successor of this rejected R2 candidate, test/support/de1-r3-email.mjs) DE1R2G-01..05 verify the R2
// commit itself from git objects (DE1R3_PARENT); the HEAD / index / checkout identity is held by the R3 guard (DE1R3G-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R1Pins } from "../support/m1-r1-remediation.mjs";
import { DE1R1_PINS } from "../support/de1-r1-email.mjs";
import { de1EffectivePins, de1R2Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { isDE1R3Tree, DE1R3_PARENT } from "../support/de1-r3-email.mjs";
import { DE1R2_PARENT, DE1R2_PINS, DE1R2_NEW_FILES, DE1R2_EDITS, DE1R2_SCOPE, isDE1R2Tree, deriveDE1R2 } from "../support/de1-r2-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R2Tree(REPO) && "not a DE1 R2 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R2_PINS).filter((f) => !DE1R2_NEW_FILES.includes(f)).sort();
const LAYERED = isDE1R3Tree(REPO);
const R2_TREE = LAYERED ? DE1R3_PARENT : "HEAD";          // the R2 commit itself when the R3 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R2_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R2G-01 the R2 change set vs R1 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R2_PARENT, "0576ced6b9d067cf4485ccefd2a06622a07b3137", "R2 is built on the rejected R1 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", R2_TREE + "^"]).stdout.trim(), DE1R2_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R2_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R2_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R2_PARENT, R2_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R2_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R2_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R2_PINS).sort(), label + ": protected changes vs R1 = the recorded R2 set");
  // the R2 commit's own pins: on an R3 tree the effective table without the R3 overlay (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1 ⊕ DE1 R2)
  // INTEGRATION I1 (layering transition): the historical proof at the R2 commit uses the pins OF THAT COMMIT — the M1 ⊕ R1
  // pins its lineage carried, plus DE1 … R2 — never the checked-out tree's M1 R2..R5 / I1 pins (a later lineage's files)
  const eff = LAYERED ? { ...m1R1Pins(), ...de1R2Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R2_PINS)) assert.equal(eff[f], pin, f + ": the R2 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R2_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R2 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R2G-02 provenance: each R2 pin is the R1 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R2_NEW_FILES, [], "R2 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R2_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R2_PARENT}:${f}`), DE1R1_PINS[f], f + ": the parent bytes are the R1 pin");
    const d = deriveDE1R2(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R2_PINS[f], f + " = R1 + recorded R2 edits");
  }
});

test("DE1R2G-03 scope: only the receipt module's provider-outcome evidence changes; everything else is byte-identical to R1", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R2_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R2_PARENT, R2_TREE, "--"]));
  // the only emulator files R2 touches are the delivery receipt gates (the new R2 gate, and the DE1 gate's fixture shape)
  const outside = all.filter((f) => !/^test\/(delivery|finance|support|dashboard)\//.test(f) && !/^test\/emulator\/de1-(r2-)?receipt-emulator\.mjs$/.test(f) && !DE1R2_SCOPE.includes(f));
  assert.deepEqual(outside, [], "no runtime / config / tool / emulator Rules / Rules change outside the receipt module");
  for (const f of ["api/daily-snapshot/run.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/verifyToken.js", "lib/businessRegistry.js", "test/support/canary-fixtures.mjs", "fincore/v1/MANIFEST.json"])
    assert.equal(blobId(R2_TREE + ":" + f), blobId(`${DE1R2_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R2_PARENT, R2_TREE, "--", "src", "fincore", "api", "tools", "index.html"])), [], "no src / fincore / api / tools / page change");
});

test("DE1R2G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the R1 module is not the R2 one", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R2_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R2(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R2(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R2_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R2(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R2_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R2_PINS[f], DE1R1_PINS[f], f + ": the R2 pin differs from the rejected R1 pin");
  }
  const eff = LAYERED ? de1R2Pins() : de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R2_PINS[f]);
  for (const f of Object.keys(DE1R1_PINS).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], DE1R1_PINS[f], f + " keeps its R1 pin");
});

test("DE1R2G-05 the evidence rules in the source: no provider-controlled property is phase evidence", { skip: SKIP }, () => {
  const src = readAt("lib/emailDelivery.js");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");     // executable lines only
  for (const gone of ['"deliveryPhase"', "deliveryPhase =", '"syscall"', "SYSCALLS", '"message")', "Connection timeout", "provider_unreachable"])
    assert.ok(!code.includes(gone), "no " + gone + " in the classification");
  assert.ok(code.includes("function attemptOutcome(ctx, threw, thrown, recipient)"), "one attempt-outcome function");
  assert.equal((code.match(/attemptOutcome\(ctx, threw, thrown, recipient\)/g) || []).length, 3, "used by the receipted and the manual send");
  assert.ok(code.includes("if (!ctx.handedToProvider) {") && code.includes("if (ctx.claimLost) return"), "the not-handed-over decision reads only our attempt state");
  assert.ok(code.includes('if (isRejected) return { outcome: "failed"') && code.includes('if (!isAccepted) return { outcome: "unknown", code: "provider_result_indeterminate"'), "E2: refusal only for a listed rejection");
});
