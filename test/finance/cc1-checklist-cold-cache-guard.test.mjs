// CC1 guard — identity, provenance and scope of the checklist cold-cache successor on I7 (LOCAL; pending independent Codex review and
// the checklist / bizDataRepo owner's acceptance, T-CC1). Nothing here is an approval: it proves what the candidate IS. Behaviour is
// proven separately (test/security/checklist-cold-cache.test.mjs CC-01..08 through the real handlers, and the emulator gate
// test/emulator/checklist-cold-cache-emulator.mjs CCE-01..07).
//   CC1G-01  sole parent the I7 candidate 5bae812c; the only protected file CC1 changes relative to I7 is lib/repositories/bizDataRepo.js;
//            its CC1 pin and every effective pin hold committed / staged / checked out (I7G-01 verifies the I7 commit itself when layered)
//   CC1G-02  provenance: the I7 bytes + exactly the recorded edits = the pin; the I7 lines that disappear are exactly the enumerated
//            ones; non-vacuity
//   CC1G-03  the rule in the source: setBizDocGuarded keeps ONE transaction on exactly the document node; the first run (and only the
//            first) re-submits the value it saw, unchanged, on a mismatch — the CD-M2 pattern; every later run aborts; a match writes the
//            validated envelope; every other function of the repository and every checklist handler / response is byte-identical to I7
//   CC1G-04  scope: outside lib/repositories/bizDataRepo.js only tests change (both protected-path rules); no handler, authorization,
//            registry, version-token, other repository, page, Rules or configuration byte moves
//   CC1G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7 ∪ CC1, each at its pin
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
import { CC1_PARENT, CC1_PINS, CC1_NEW_FILES, CC1_EDITS, CC1_SCOPE, isCC1Tree, deriveCC1 } from "../support/cc1-checklist-cold-cache.mjs";
// CC2 layering (checklist concurrency test-contract successor CC2, T-CC2-TEST; the I7G-on-CC1 pattern): on a tree that carries CC2 on
// top of the CC1 candidate, CC1G-01..05 verify the CC1 commit ITSELF (026c2278) from git objects — sole parent I7, protected change set
// lib/repositories/bizDataRepo.js, its pin, the CC1 source rule — and the HEAD / index / checkout identity of the later tree is held by
// its own guard (CC2G-01). Nothing is skipped.
import { isCC2Tree, CC2_PARENT } from "../support/cc2-checklist-concurrency.mjs";

const SKIP = !isCC1Tree(REPO) && "not a CC1 tree";
const LAYERED = isCC2Tree(REPO);
const CC1_TREE = LAYERED ? CC2_PARENT : "HEAD";          // the CC1 commit itself when the CC2 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const BR = "lib/repositories/bizDataRepo.js", AD = "api/admin.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${CC1_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${CC1_PARENT}:${f}`]).stdout;
// every I7 line that does NOT survive into CC1 (multiset, trimmed): the abort-on-the-first-run and the two doc-comment lines describing it
const REMOVED = {
  [BR]: [
    "* token → compare to expectedVersionToken → on mismatch ABORT (no write) → on match",
    "* replace with the validated doc. Returns { ok } or { conflict:true, currentToken }.",
    "if (currentToken !== expectedVersionToken) { outcome = { conflict: true, currentToken }; return; } // abort",
  ],
};
const removedLines = (before, after) => {
  const count = (t) => t.split("\n").map((l) => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(before), b = count(after), out = [];
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) || 0); i++) out.push(l);
  return out.sort();
};

test("CC1G-01 identity: sole parent the I7 candidate; CC1 changes exactly lib/repositories/bizDataRepo.js among the protected files; every pin holds", { skip: SKIP }, () => {
  assert.equal(CC1_PARENT, "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1", "built on the I7 candidate");
  if (LAYERED) assert.equal(CC1_TREE, "026c2278e511a4007145d77ea019315867b76a23", "the CC1 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", CC1_TREE + "^"]).stdout.trim(), CC1_PARENT, "the I7 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", CC1_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(CC1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(CC1_PINS).sort(), [...CC1_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", CC1_PARENT, CC1_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", CC1_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", CC1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...CC1_SCOPE].sort(), label + ": protected changes vs I7 = the CC1 scope");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS, ...CC1_PINS };
  for (const f of CC1_SCOPE) assert.ok(!(f in m1EffectivePins(REPO)) && !(f in SERVER_READER_EFFECTIVE_BLOBS) && !(f in ADB06_PINS), f + ": in no earlier pin table (CC1 is its only pin)");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(CC1_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the CC1 commit)" : ""));
    if (LAYERED) continue;                                  // CC2G-01 holds HEAD / index / checkout of the later tree
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId(CC1_TREE + ":" + AD), I7_PINS[AD], "api/admin.js is the I7 pin");
  assert.equal(blobId(CC1_TREE + ":" + PG), I3_PINS[PG], "the page is the I3 page");
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${CC1_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("CC1G-02 provenance: the I7 bytes + exactly the recorded edits; the I7 lines that disappear are exactly the enumerated ones; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...CC1_NEW_FILES], []);
  for (const f of CC1_SCOPE) {
    const d = deriveCC1(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), CC1_PINS[f], f + ": I7 bytes + the recorded edits = the pin");
    assert.deepEqual(removedLines(parentText(f), d.bytes.toString("utf8")), [...REMOVED[f]].sort(), f + ": exactly the enumerated I7 lines disappear");
  }
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(CC1_EDITS)); fn(e[BR]); return e; };
  assert.equal(deriveCC1(REPO, BR, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveCC1(REPO, BR, tamper((l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveCC1(REPO, BR, tamper((l) => { l[3].to = l[3].to.replace("runs === 1 ? current : undefined", "current"); })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== CC1_PINS[BR]);
});

const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fnBody = (src, from, to) => { const i = src.indexOf(from), j = to ? src.indexOf(to, i + from.length) : src.length; assert.ok(i >= 0 && j > i, `${from} … ${to}`); return src.slice(i, j); };

test("CC1G-03 the rule in the source: one transaction on the document node; only the first run re-submits the value it saw; later runs abort; everything else byte-identical to I7", { skip: SKIP }, () => {
  const src = read(BR), par = parentText(BR);
  const g = codeOnly(fnBody(src, "export async function setBizDocGuarded", null));
  assert.equal((g.match(/\.transaction\(/g) || []).length, 1, "one transaction");
  assert.ok(g.includes("const ref = getAdminDb().ref(`tenants/${tenantId}/biz:${bizId}:${suffix}`);"), "exactly the document node");
  assert.ok(!/\.ref\("tenants"\)|\.ref\(\)/.test(g), "never the root or tenant node");
  assert.equal((g.match(/let runs = 0;/g) || []).length, 1); assert.equal((g.match(/runs \+= 1;/g) || []).length, 1);
  assert.ok(g.indexOf("runs += 1;") < g.indexOf("const currentDoc = unwrap(current);"), "every invocation is counted before it decides");
  const mismatch = g.slice(g.indexOf("if (currentToken !== expectedVersionToken) {"), g.indexOf("outcome = { conflict: false };"));
  assert.ok(mismatch.includes("outcome = { conflict: true, currentToken };"), "a mismatch is recorded as a conflict");
  assert.deepEqual(mismatch.match(/return [^;]*;/g), ["return runs === 1 ? current : undefined;"], "the mismatch branch: the first run re-submits the value it saw (unchanged), every later run aborts");
  assert.ok(!/current\s*=|current\.\w+\s*=|_v\s*:/.test(mismatch), "the seen value is never modified or replaced");
  assert.ok(g.includes("outcome = { conflict: false };\n      return { _v: JSON.stringify(doc) };"), "a match writes the validated envelope (unchanged)");
  assert.ok(g.includes("if (outcome.conflict) return { ok: false, conflict: true, currentToken: outcome.currentToken };") && g.includes("return { ok: true, versionToken: checklistVersionToken(doc) };"), "the outcome mapping is unchanged");
  // the same reviewed pattern as the CD-M2 entry-exception transaction
  const ee = codeOnly(read("lib/repositories/entryExceptionsRepo.js"));
  assert.ok(ee.includes("return runs === 1 ? current : undefined;"), "the CD-M2 pattern (lib/repositories/entryExceptionsRepo.js)");
  // every other function of the repository is byte-identical to I7
  const before = (s) => s.slice(0, s.indexOf("/**\n * Optimistic-concurrency write"));
  assert.equal(before(src), before(par), "unwrap / readBizDoc / writeBizDoc / readBizDailyRange / getBizDocWithToken are byte-identical to I7");
  assert.equal(src.slice(src.indexOf("  } catch (e) {\n    return { ok: false, error: \"txn_failed\" };")), par.slice(par.indexOf("  } catch (e) {\n    return { ok: false, error: \"txn_failed\" };")), "the error / outcome tail is byte-identical to I7");
  // the handlers and their responses: api/admin.js is the I7 file
  const ad = read(AD);
  assert.equal(gitBlobId(Buffer.from(ad, "utf8")), I7_PINS[AD], "api/admin.js is the I7 pin");
  assert.ok(ad.includes('if (r.conflict) { res.status(409).json({ ok: false, error: "checklist_conflict" }); return; }'), "409 checklist_conflict is still the conflict answer");
});

test("CC1G-04 scope: outside lib/repositories/bizDataRepo.js only tests change (both protected-path rules); no handler, authorization, registry, token, other repository, page, Rules or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", CC1_PARENT, CC1_TREE, "--"]));
  const prot = (f) => PROTECTED.test(f) || isProtectedPath(f);
  assert.deepEqual(all.filter((f) => prot(f) && !CC1_SCOPE.includes(f)), [], "no other protected file (either rule)");
  assert.deepEqual(all.filter((f) => !prot(f) && !/^test\//.test(f)), [], "outside the scope only tests");
  for (const f of ["api/admin.js", "lib/checklistVersion.js", "lib/repositories/entryExceptionsRepo.js", "lib/repositories/supplierCreditsRepo.js", "lib/businessRegistry.js", "lib/securityContext.js",
    "lib/bizAccess.js", "lib/helpers.js", "lib/apiScope.js", "lib/adminSdk.js", "lib/verifyToken.js", "lib/ownerGuard.js", "lib/emailDelivery.js", "lib/sendEmail.js", "src/utils/dates.ts", "src/finance/businessDate.ts",
    "src/analytics/dailyBuilder.ts", "src/snapshot/snapshotBuilder.ts", "index.html", "docs/production-readiness/lib/biz-access-model.mjs", "scripts/backfill-biz-access.mjs",
    "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh", "test/support/m1-r1-remediation.mjs"])
    assert.equal(blobId(CC1_TREE + ":" + f), blobId(`${CC1_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(CC1_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("CC1G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6 ∪ I7 ∪ CC1, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, CC1_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE, ...I5_SCOPE, ...I6_SCOPE, ...I7_SCOPE, ...CC1_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS, ...I5_PINS, ...I6_PINS, ...I7_PINS, ...CC1_PINS };
  for (const f of expected) assert.equal(blobId(CC1_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(CC1_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
