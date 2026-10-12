// Agent/Daily integration I3 guard — identity, provenance and scope of the M1 D-CTRL shared-predicate layer (LOCAL; pending
// independent Codex review). Nothing here is an approval: it proves what the candidate IS, so that the M1 identity owner and the
// page owner can confirm it. Behaviour is proven separately (test/finance/i3-dctrl-shared-predicates.test.mjs DC-01..09).
//   I3G-01  sole parent the I2 candidate cfe900dd; the protected files I3 changes relative to I2 are EXACTLY the two shared
//           predicate modules and the page; every effective pin holds committed / staged / checked out; the page is the
//           recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3
//   I3G-02  provenance: each pin is the I2 bytes + exactly ONE recorded edit; each edit only ADDS (every I2 line of `from`
//           survives in `to`, the predicate's return line extended by the control-character clause only); non-vacuity
//   I3G-03  the rule in the source: both predicates and the page mirror refuse exactly U+0000–U+001F and U+007F, the same
//           regular expression as the delivery side's RTDB_CONTROL_CHARS; nothing trims, replaces or aliases
//   I3G-04  scope: no route, delivery library, Builder, Agent, Core, P1, Rules, schedule or configuration byte moves; the
//           delivery / Builder composites are untouched (they now equal the shared predicates — DC-07)
//   I3G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ the two predicate modules, each held
//           to its literal pin
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
import { I3_PARENT, I3_PINS, I3_NEW_FILES, I3_EDITS, I3_SCOPE, isI3Tree, deriveI3 } from "../support/i3-integration.mjs";
// I4 layering (Agent/Daily integration I4; PROPOSED for the M1 integration owner — the CF-04 / I1G / I2G pattern): on a tree that
// carries the I4 D-CTRL boundary layer on top of the I3 candidate, I3G-01..05 verify the I3 commit ITSELF (40b8a8a6) from git
// objects — its sole parent is still I2, its protected change set still the two predicates and the page, its pins still the I3
// pins — and the HEAD / index / checkout identity of the later tree is held by its own guard (I4G-01). Nothing is skipped.
import { isI4Tree, I4_PARENT } from "../support/i4-integration.mjs";

const SKIP = !isI3Tree(REPO) && "not an I3 tree";
const LAYERED = isI4Tree(REPO);
const I3_TREE = LAYERED ? I4_PARENT : "HEAD";          // the I3 commit itself when the I4 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SC = "lib/securityContext.js", BR = "lib/businessRegistry.js", PG = "index.html";
const CTRL_SRC = "/[\\u0000-\\u001f\\u007f]/";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I3_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));

test("I3G-01 identity: sole parent the I2 candidate; I3 changes exactly the two shared predicates and the page; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I3_PARENT, "cfe900dd2073701b2392c186f95a9107cd5291ce", "built on the I2 candidate");
  if (LAYERED) assert.equal(I3_TREE, "40b8a8a6f548389ce8c9dc4b7f0be5ce669c3ab1", "the I3 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", I3_TREE + "^"]).stdout.trim(), I3_PARENT, "the I2 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I3_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I3_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(I3_PINS).sort(), [...I3_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I3_PARENT, I3_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", I3_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", I3_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...I3_SCOPE].sort(), label + ": protected changes vs I2 = the I3 scope");
  // the I3 commit's own pin table when layered: the effective tables without the I4 overlay (the I4 files are held by I4G-01)
  const eff = { ...m1EffectivePins(REPO, { withI4: false }), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of I3_SCOPE) assert.equal(eff[f], I3_PINS[f], f + " is held to its I3 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(I3_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the I3 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I3_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3 (I4 moves no page byte)");
});

test("I3G-02 provenance: the I2 bytes + exactly ONE recorded, purely additive edit per file; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I3_NEW_FILES], []);
  assert.equal(blobId(`${I3_PARENT}:${PG}`), I2_PINS[PG], "the parent page is the I2 pin");
  for (const f of [SC, BR]) assert.equal(blobId(`${I3_PARENT}:${f}`), blobId(`${I1_ENTRY}:${f}`), f + ": the parent bytes are the approved M1 R5 entry base's (no later layer moved them)");
  assert.equal(blobId(`${I3_PARENT}:${BR}`), m1EffectivePins(REPO, { withI3: false })[BR], "the registry module's parent bytes are its effective M1 pin");
  for (const f of I3_SCOPE) {
    assert.equal(I3_EDITS[f].length, 1, f + ": one edit");
    const d = deriveI3(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), I3_PINS[f], f + ": I2 bytes + the recorded edit = the pin");
    const { from, to } = I3_EDITS[f][0];
    const fromLines = from.split("\n"), toLines = to.split("\n");
    const changed = fromLines.filter((l) => !toLines.includes(l));
    assert.equal(changed.length, 1, f + ": exactly one I2 line is replaced (the predicate line)");
    const old = changed[0], neu = toLines.find((l) => l.startsWith(old.replace(/\) return false;$/, "").slice(0, 40)) && l !== old);
    assert.ok(neu, f + ": the replaced line is located");
    if (f === PG) assert.equal(neu, old.replace("/[.#$\\[\\]\\/:]/", "/[.#$\\[\\]\\/:\\u0000-\\u001f\\u007f]/") + "   // D-CTRL: = isRegistryBizId", "page: only the character class grows");
    else assert.equal(neu, old.replace(/;$/, " && !RTDB_CONTROL_CHARS.test(v);"), f + ": only the control-character clause is appended");
    for (const l of toLines.filter((x) => !fromLines.includes(x) && x !== neu)) assert.ok(/^\s*(\/\/.*|const RTDB_CONTROL_CHARS = \/\[\\u0000-\\u001f\\u007f\]\/;)?$/.test(l), f + ": an added line is a comment or the constant: " + l);
  }
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(I3_EDITS)); fn(e[f]); return e; };
  assert.equal(deriveI3(REPO, SC, tamper(SC, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI3(REPO, BR, tamper(BR, (l) => { l.pop(); })).reason, "no_recorded_edits");
  const altered = deriveI3(REPO, PG, tamper(PG, (l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I3_PINS[PG]);
});

test("I3G-03 the rule in the source: the same control-character class in both predicates, the page mirror and the delivery side", { skip: SKIP }, () => {
  const sc = read(SC), br = read(BR), pg = read(PG), ed = read("lib/emailDelivery.js");
  assert.ok(sc.includes(`const RTDB_CONTROL_CHARS = ${CTRL_SRC};`) && br.includes(`const RTDB_CONTROL_CHARS = ${CTRL_SRC};`), "one class in both predicate modules");
  assert.ok(ed.includes(`export const RTDB_CONTROL_CHARS = ${CTRL_SRC};`), "…equal to the delivery side's (Builder coordination contract §2.1)");
  assert.ok(sc.includes("return typeof v === \"string\" && v.length > 0 && v.length <= MAX_ID_LEN && !RTDB_FORBIDDEN.test(v) && !RTDB_CONTROL_CHARS.test(v);"));
  assert.ok(br.includes("return typeof v === \"string\" && v.length > 0 && v.length <= MAX_ID_LEN && !RTDB_FORBIDDEN.test(v) && !v.includes(\":\") && !RTDB_CONTROL_CHARS.test(v);"));
  assert.equal((pg.match(/\\u0000-\\u001f\\u007f/g) || []).length - (gitIn(REPO, ["cat-file", "blob", `${I3_PARENT}:${PG}`]).stdout.match(/\\u0000-\\u001f\\u007f/g) || []).length, 1, "the page gains exactly one class (the registry mirror)");
  for (const src of [sc, br]) assert.ok(!/\.trim\(\)|\.replace\(|normalize\(/.test(src.slice(src.indexOf("RTDB_CONTROL_CHARS"), src.indexOf("RTDB_CONTROL_CHARS") + 600)), "no trim / replace / normalize near the rule");
});

test("I3G-04 scope: no route, delivery, Builder, Agent, Core, P1, Rules, schedule or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I3_PARENT, I3_TREE, "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I3_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f)), [], "outside the scope only tests change");
  for (const f of ["api/daily-snapshot/run.ts", "api/admin.js", "api/cost-history.js", "api/analytics/daily-builder.ts", "lib/emailDelivery.js", "lib/sendEmail.js", "lib/bizAccess.js", "lib/apiScope.js", "lib/helpers.js",
    "lib/finance/costHistoryWriter.js", "src/snapshot/snapshotBuilder.ts", "src/analytics/dailyBuilder.ts", "lib/securityContext.d.ts", "lib/businessRegistry.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json"])
    assert.equal(blobId(I3_TREE + ":" + f), blobId(`${I3_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(I3_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I3G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ the two predicates, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, I3_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS };
  for (const f of expected) assert.equal(blobId(I3_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(I3_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
