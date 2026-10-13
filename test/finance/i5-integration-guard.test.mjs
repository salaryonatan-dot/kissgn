// Agent/Daily integration I5 guard — identity, provenance and scope of the exact-identity correction (LOCAL; pending independent
// Codex review). Nothing here is an approval: it proves what the candidate IS, so that the M1 identity, admin-API, P0, P1 and
// user-access owners can confirm it. Behaviour is proven separately (test/finance/i5-exact-identity.test.mjs EX-01..06, and the
// I4 contract test/finance/i4-dctrl-boundaries.test.mjs DB-01..11 still on this tree).
//   I5G-01  sole parent the I4 candidate e1c432f3; the protected files I5 changes relative to I4 are EXACTLY api/admin.js and
//           lib/bizAccess.js; every effective pin holds committed / staged / checked out; the page is still the I3 page
//   I5G-02  provenance: each pin is the I4 bytes + exactly the recorded edits; the I4 lines that are removed are exactly the
//           enumerated ones (the trim in normalizeAllowedBizIds, the three super_owner control-only checks, the update-user stored
//           prev, eeValidIds' return line, two lines extended); non-vacuity
//   I5G-03  the rule in the source: the business slot uses the approved isRegistryBizId and nothing trims it; the super_owner
//           handlers use the approved isValidId before getAdminDb(); the I4 control class and helpers are still present
//   I5G-04  scope: no shared predicate, helper, registry reader, page, declaration, route, delivery, Builder, Rules, schedule or
//           configuration byte moves
//   I5G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5, each at its literal pin
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R5Pins, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { de1EffectivePins, DE1_SCOPE } from "../support/de1-daily-email.mjs";
import { ADB06_PINS, ADB06_FILES } from "../support/adb06-builder-layer.mjs";
import { I1_ENTRY, I1_PINS, I1_SCOPE } from "../support/i1-integration.mjs";
import { I2_PINS } from "../support/i2-integration.mjs";
import { I3_PINS, I3_SCOPE } from "../support/i3-integration.mjs";
import { I4_PINS, I4_SCOPE } from "../support/i4-integration.mjs";
import { I5_PARENT, I5_PINS, I5_NEW_FILES, I5_EDITS, I5_SCOPE, isI5Tree, deriveI5 } from "../support/i5-integration.mjs";
// I6 layering (Agent/Daily integration I6; PROPOSED for the M1 integration owner — the CF-04 / I1G / I2G / I3G / I4G pattern): on a
// tree that carries the I6 registry-binding successor on top of the I5 candidate, I5G-01..05 verify the I5 commit ITSELF (59b87a6a)
// from git objects — sole parent I4, protected change set api/admin.js + lib/bizAccess.js, pins the I5 pins — and the HEAD / index /
// checkout identity of the later tree is held by its own guard (I6G-01). Nothing is skipped.
import { isI6Tree, I6_PARENT } from "../support/i6-integration.mjs";

const SKIP = !isI5Tree(REPO) && "not an I5 tree";
const LAYERED = isI6Tree(REPO);
const I5_TREE = LAYERED ? I6_PARENT : "HEAD";          // the I5 commit itself when the I6 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const AD = "api/admin.js", BA = "lib/bizAccess.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I5_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${I5_PARENT}:${f}`]).stdout;
// every I4 line I5 removes or replaces (the review's three findings; nothing else)
const REMOVED = {
  [AD]: [
    'import { readRegistryTarget } from "../lib/businessRegistry.js";',
    "// D-CTRL (I4): a control-character tenant id is refused after authentication and BEFORE the super_owner lookup or any reference.",
    'if (carriesControlChar((req.body || {}).tenantId)) { res.status(400).json({ error: "invalid tenantId" }); return; }',
    "if (allowedBizIdsCarryControl(allowedBizIds)) {",
    "const prevBiz = Array.isArray(currentUser.allowedBizIds) ? normalizeAllowedBizIds(currentUser.allowedBizIds) : [];",
    "!RTDB_FORBIDDEN.test(tenantId) && !RTDB_FORBIDDEN.test(bizId) && !RTDB_CONTROL_CHARS.test(tenantId) && !RTDB_CONTROL_CHARS.test(bizId);",
  ],
  [BA]: [
    "const id = raw.trim();",
    "if (!id) continue; // skip blank entries",
    'if (id.length > 128 || RTDB_FORBIDDEN.test(id)) throw { status: 400, msg: "invalid bizId in allowedBizIds" };',
    "if (!seen.has(id)) { seen.add(id); out.push(id); }",
  ],
};

test("I5G-01 identity: sole parent the I4 candidate; I5 changes exactly api/admin.js and lib/bizAccess.js; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I5_PARENT, "e1c432f3c8ac066f1e6ed8fa7b6a1e7da1702a62", "built on the rejected I4 candidate");
  if (LAYERED) assert.equal(I5_TREE, "59b87a6a9c77af80637ad5fb7f5a2f92560f5ef5", "the I5 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", I5_TREE + "^"]).stdout.trim(), I5_PARENT, "the I4 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I5_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I5_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(I5_PINS).sort(), [...I5_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I5_PARENT, I5_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", I5_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", I5_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...I5_SCOPE].sort(), label + ": protected changes vs I4 = the I5 scope");
  // the I5 commit's own pin table when layered: the effective tables without the I6 overlay (the I6 files are held by I6G-01)
  const eff = { ...m1EffectivePins(REPO, { withI6: false }), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of I5_SCOPE) assert.equal(eff[f], I5_PINS[f], f + " is held to its I5 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(I5_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the I5 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId(I5_TREE + ":" + PG), I3_PINS[PG], "the page is the I3 page");
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I5_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("I5G-02 provenance: the I4 bytes + exactly the recorded edits; the removed I4 lines are exactly the enumerated ones; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I5_NEW_FILES], []);
  for (const f of I5_SCOPE) {
    assert.equal(blobId(`${I5_PARENT}:${f}`), I4_PINS[f], f + ": the parent bytes are its I4 pin");
    const d = deriveI5(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), I5_PINS[f], f + ": I4 bytes + the recorded edits = the pin");
    const removed = [];
    for (const { from, to } of I5_EDITS[f]) { const t = to.split("\n"); for (const l of from.split("\n")) if (!t.includes(l)) removed.push(l.trim()); }
    assert.deepEqual([...new Set(removed)].sort(), [...REMOVED[f]].sort(), f + ": exactly the enumerated I4 lines are removed or replaced");
  }
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(I5_EDITS)); fn(e[f]); return e; };
  assert.equal(deriveI5(REPO, BA, tamper(BA, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI5(REPO, BA, tamper(BA, (l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveI5(REPO, AD, tamper(AD, (l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I5_PINS[AD]);
});

test("I5G-03 the rule in the source: approved predicates only; no trim of a business id; I4's control protection still present", { skip: SKIP }, () => {
  const ad = read(AD), ba = read(BA);
  assert.ok(ba.includes('import { isRegistryBizId } from "./businessRegistry.js";'), "bizAccess uses the approved business predicate");
  const norm = ba.slice(ba.indexOf("export function normalizeAllowedBizIds"), ba.indexOf("/** Build `= true` set updates"));
  assert.ok(!/\.trim\(/.test(norm), "normalizeAllowedBizIds trims nothing");
  assert.ok(norm.includes("if (!isRegistryBizId(raw)) throw") && norm.indexOf("RTDB_CONTROL_CHARS.test(raw)") < norm.indexOf("isRegistryBizId(raw)"), "exact predicate on the raw entry; the I4 control refusal first");
  assert.ok(ba.includes("export const RTDB_FORBIDDEN = /[.#$\\[\\]\\/]/;") && read("lib/apiScope.js") === parentText("lib/apiScope.js"), "RTDB_FORBIDDEN (lib/apiScope.js) unchanged");
  for (const action of ["edit-client", "delete-client", "resend-invite"]) {
    const at = ad.indexOf(`console.error("[${action}] auth failed:"`), body = ad.slice(at, at + 1200);
    assert.ok(body.includes("if (t && !scIsValidId(t)) { res.status(400).json({ error: \"invalid tenantId\" }); return; }"), action + ": the approved tenant predicate");
    assert.ok(body.indexOf("scIsValidId(t)") < body.indexOf("getAdminDb()"), action + ": before the database handle and the super_owner lookup");
  }
  const ee = ad.slice(ad.indexOf("function eeValidIds"), ad.indexOf("async function handleListEntryExceptions"));
  assert.ok(ee.includes("isRegistryBizId(bizId)") && !ee.includes("isRegistryBizId(tenantId)"), "eeValidIds: business slot = isRegistryBizId; tenant slot keeps its rule");
  for (const s of ["const RTDB_CONTROL_CHARS = /[\\u0000-\\u001f\\u007f]/;", "function carriesControlChar(v)", "function allowedBizIdsCarryControl(list)", "if (carriesControlChar(peek.tenantId))"])
    assert.ok(ad.includes(s), "I4 control protection present: " + s);
  assert.ok(!ad.includes("String(tenantId)") && !/`\$\{\s*\(req\.body/.test(ad), "no tenant coercion added");
});

test("I5G-04 scope: no predicate, helper, registry reader, page, declaration, route, delivery, Builder, Rules or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I5_PARENT, I5_TREE, "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I5_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f) && !["docs/production-readiness/lib/biz-access-model.mjs", "docs/production-readiness/test/biz-access-audit.test.mjs"].includes(f)), [], "outside the scope only tests and the audit model + its test (T-I5-AUDIT-MODEL) change");
  for (const f of ["index.html", "lib/securityContext.js", "lib/businessRegistry.js", "lib/helpers.js", "lib/securityContext.d.ts", "lib/businessRegistry.d.ts", "lib/apiScope.js", "lib/emailDelivery.js", "lib/sendEmail.js",
    "api/daily-snapshot/run.ts", "api/cost-history.js", "api/analytics/daily-builder.ts", "api/alerts/run.ts", "api/agent/ask.ts", "api/proactive/run.ts", "lib/alertsCore.js", "lib/agentAskCore.js", "lib/finance/costHistoryWriter.js",
    "lib/repositories/supplierCreditsRepo.js", "lib/repositories/entryExceptionsRepo.js", "lib/repositories/bizDataRepo.js", "lib/ownerGuard.js", "src/snapshot/snapshotBuilder.ts", "src/analytics/dailyBuilder.ts",
    "scripts/backfill-biz-access.mjs", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh"])
    assert.equal(blobId(I5_TREE + ":" + f), blobId(`${I5_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(I5_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I5G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, I5_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE, ...I5_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS, ...I5_PINS };
  for (const f of expected) assert.equal(blobId(I5_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(I5_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
