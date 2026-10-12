// Agent/Daily integration I4 guard — identity, provenance and scope of the M1 D-CTRL application-boundary layer (LOCAL; pending
// independent Codex review). Nothing here is an approval: it proves what the candidate IS, so that the M1 identity, admin-API,
// P0 and P1 owners can confirm it. Behaviour is proven separately (test/finance/i4-dctrl-boundaries.test.mjs DB-01..11).
//   I4G-01  sole parent the I3 candidate 40b8a8a6; the protected files I4 changes relative to I3 are EXACTLY api/admin.js,
//           lib/helpers.js, lib/businessRegistry.js and lib/bizAccess.js; every effective pin holds committed / staged /
//           checked out; the page is still the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3 (I4 moves no page byte)
//   I4G-02  provenance: each pin is the I3 bytes + exactly the recorded edits; every edit only ADDS — an I3 line is either kept
//           byte for byte or extended by a control-character clause and nothing else; non-vacuity
//   I4G-03  the rule in the source: one class, U+0000–U+001F and U+007F, in every changed file (= the shared predicates' and the
//           delivery side's); the raw allowedBizIds entry is judged BEFORE the trim; nothing trims, replaces or aliases;
//           lib/bizAccess.js RTDB_FORBIDDEN (imported by lib/apiScope.js) is unchanged
//   I4G-04  scope: no route, delivery, Builder, Agent, Core, P1 repository, shared predicate, page, declaration, Rules, schedule
//           or configuration byte moves
//   I4G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4, each at its literal pin
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
import { I4_PARENT, I4_PINS, I4_NEW_FILES, I4_EDITS, I4_SCOPE, isI4Tree, deriveI4 } from "../support/i4-integration.mjs";
// I5 layering (Agent/Daily integration I5; PROPOSED for the M1 integration owner — the CF-04 / I1G / I2G / I3G pattern): on a tree
// that carries the I5 exact-identity correction on top of the I4 candidate, I4G-01..05 verify the I4 commit ITSELF (e1c432f3) from
// git objects — sole parent I3, protected change set the four boundary modules, pins the I4 pins — and the HEAD / index / checkout
// identity of the later tree is held by its own guard (I5G-01). Nothing is skipped.
import { isI5Tree, I5_PARENT } from "../support/i5-integration.mjs";

const SKIP = !isI4Tree(REPO) && "not an I4 tree";
const LAYERED = isI5Tree(REPO);
const I4_TREE = LAYERED ? I5_PARENT : "HEAD";          // the I4 commit itself when the I5 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const AD = "api/admin.js", HE = "lib/helpers.js", BR = "lib/businessRegistry.js", BA = "lib/bizAccess.js", PG = "index.html";
const CTRL_SRC = "/[\\u0000-\\u001f\\u007f]/";
const CLAUSES = / \|\| RTDB_CONTROL_CHARS\.test\(tenantId\)| && !RTDB_CONTROL_CHARS\.test\((?:tenantId|bizId)\)/g;
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I4_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${I4_PARENT}:${f}`]).stdout;

test("I4G-01 identity: sole parent the I3 candidate; I4 changes exactly the four boundary modules; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I4_PARENT, "40b8a8a6f548389ce8c9dc4b7f0be5ce669c3ab1", "built on the rejected I3 candidate");
  if (LAYERED) assert.equal(I4_TREE, "e1c432f3c8ac066f1e6ed8fa7b6a1e7da1702a62", "the I4 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", I4_TREE + "^"]).stdout.trim(), I4_PARENT, "the I3 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I4_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I4_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(I4_PINS).sort(), [...I4_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I4_PARENT, I4_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", I4_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", I4_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...I4_SCOPE].sort(), label + ": protected changes vs I3 = the I4 scope");
  // the I4 commit's own pin table when layered: the effective tables without the I5 overlay (the I5 files are held by I5G-01)
  const eff = { ...m1EffectivePins(REPO, { withI5: false }), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of I4_SCOPE) assert.equal(eff[f], I4_PINS[f], f + " is held to its I4 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(I4_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the I4 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId(I4_TREE + ":" + PG), I3_PINS[PG], "the page is the I3 page");
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I4_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("I4G-02 provenance: the I3 bytes + exactly the recorded, purely additive edits; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I4_NEW_FILES], []);
  for (const f of [BR]) assert.equal(blobId(`${I4_PARENT}:${f}`), I3_PINS[f], f + ": the parent bytes are its I3 pin");
  for (const f of [AD]) assert.equal(blobId(`${I4_PARENT}:${f}`), m1EffectivePins(REPO, { withI4: false })[f], f + ": the parent bytes are its effective M1 pin");
  for (const f of [HE, BA]) assert.equal(blobId(`${I4_PARENT}:${f}`), blobId(`${I1_ENTRY}:${f}`), f + ": the parent bytes are the approved M1 R5 entry base's (no later layer moved them)");
  let extended = 0;
  for (const f of I4_SCOPE) {
    assert.ok(I4_EDITS[f].length >= 1, f + ": recorded edits");
    const d = deriveI4(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), I4_PINS[f], f + ": I3 bytes + the recorded edits = the pin");
    for (const [k, { from, to }] of I4_EDITS[f].entries()) {
      const fromLines = from.split("\n"), toLines = to.split("\n");
      for (const old of fromLines.filter((l) => !toLines.includes(l))) {
        const neu = toLines.find((l) => l !== old && l.replace(CLAUSES, "") === old);
        assert.ok(neu, `${f}#${k}: a replaced I3 line is only extended by a control-character clause: ${old}`);
        extended += 1;
      }
      // every I3 line of `from` survives, in order, in `to` (modulo the clause): the edit only adds
      const stripped = toLines.map((l) => l.replace(CLAUSES, ""));
      let i = 0; for (const l of fromLines) { i = stripped.indexOf(l, i); assert.ok(i >= 0, `${f}#${k}: I3 line kept in order: ${l}`); i += 1; }
    }
  }
  assert.equal(extended, 4, "exactly four I3 lines are extended (delete-user, update-user, bootstrap-self, eeValidIds)");
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(I4_EDITS)); fn(e[f]); return e; };
  assert.equal(deriveI4(REPO, HE, tamper(HE, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI4(REPO, BA, tamper(BA, (l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveI4(REPO, AD, tamper(AD, (l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I4_PINS[AD]);
});

test("I4G-03 the rule in the source: one control-character class everywhere; the raw entry is judged before the trim; no alias", { skip: SKIP }, () => {
  const ad = read(AD), he = read(HE), br = read(BR), ba = read(BA);
  for (const [f, src] of [[AD, ad], [BA, ba], [BR, br], ["lib/securityContext.js", read("lib/securityContext.js")]]) assert.ok(src.includes(`const RTDB_CONTROL_CHARS = ${CTRL_SRC};`), f + ": the class");
  assert.ok(read("lib/emailDelivery.js").includes(`export const RTDB_CONTROL_CHARS = ${CTRL_SRC};`), "= the delivery side's class");
  assert.ok(he.includes(`if (${CTRL_SRC}.test(tenantId)) throw { status: 400, msg: "invalid characters in id" };`), "requireTenantAccess: the same class, the same 400");
  assert.equal((ad.match(/\/\[\\u0000-\\u001f\\u007f\]\//g) || []).length, 1, "admin: one class literal");
  const norm = ba.slice(ba.indexOf("export function normalizeAllowedBizIds"), ba.indexOf("/** Build `= true` set updates"));
  assert.ok(norm.indexOf("RTDB_CONTROL_CHARS.test(raw)") > 0 && norm.indexOf("RTDB_CONTROL_CHARS.test(raw)") < norm.indexOf("raw.trim()"), "the raw entry is judged before the trim");
  assert.ok(ba.includes("export const RTDB_FORBIDDEN = /[.#$\\[\\]\\/]/;") && read("lib/apiScope.js") === parentText("lib/apiScope.js"), "RTDB_FORBIDDEN (lib/apiScope.js) unchanged");
  for (const f of I4_SCOPE) {
    const added = I4_EDITS[f].flatMap(({ from, to }) => to.split("\n").filter((l) => !from.split("\n").includes(l)));
    assert.ok(added.length > 0, f + ": something added");
    for (const l of added) assert.ok(!/\.replace\(|normalize\(|\.trim\(\)/.test(l) || /^\s*\/\//.test(l) || /^\s*\*/.test(l) || /\/\*\*/.test(l), f + ": no added line trims, replaces or normalizes: " + l);
  }
  for (const action of ["edit-client", "delete-client", "resend-invite"]) {
    const body = ad.slice(ad.indexOf(`console.error("[${action}] auth failed:"`), ad.indexOf(`console.error("[${action}] auth failed:"`) + 600);
    assert.ok(body.indexOf("carriesControlChar((req.body || {}).tenantId)") > 0 && body.indexOf("carriesControlChar") < body.indexOf("getAdminDb()"), action + ": the refusal precedes the database handle and the super_owner lookup");
  }
  const roles = ad.slice(ad.indexOf("async function handleRoles"));
  assert.ok(roles.indexOf("carriesControlChar(peek.tenantId)") < roles.indexOf("isRateLimited("), "roles: the refusal precedes the rate limiter");
});

test("I4G-04 scope: no route, delivery, Builder, Agent, Core, P1 repository, predicate, page, declaration, Rules or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I4_PARENT, I4_TREE, "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I4_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f)), [], "outside the scope only tests change");
  for (const f of ["index.html", "lib/securityContext.js", "lib/securityContext.d.ts", "lib/businessRegistry.d.ts", "lib/apiScope.js", "lib/emailDelivery.js", "lib/sendEmail.js", "api/daily-snapshot/run.ts",
    "api/cost-history.js", "api/analytics/daily-builder.ts", "api/alerts/run.ts", "api/agent/ask.ts", "api/proactive/run.ts", "lib/alertsCore.js", "lib/agentAskCore.js", "lib/finance/costHistoryWriter.js",
    "lib/repositories/supplierCreditsRepo.js", "lib/repositories/entryExceptionsRepo.js", "lib/repositories/bizDataRepo.js", "lib/ownerGuard.js", "src/snapshot/snapshotBuilder.ts", "src/analytics/dailyBuilder.ts",
    "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh"])
    assert.equal(blobId(I4_TREE + ":" + f), blobId(`${I4_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(I4_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I4G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, I4_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS };
  for (const f of expected) assert.equal(blobId(I4_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(I4_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
