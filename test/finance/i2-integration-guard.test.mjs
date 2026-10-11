// Agent/Daily integration I2 guard — identity, provenance and scope of the successor of the rejected I1 candidate (LOCAL;
// pending independent Codex review). Nothing here is an approval: it proves what the candidate IS, so that the named owners
// (page owner, M1 integration owner) can confirm it.
//   I2G-01  the candidate's sole parent is the I1 candidate 968155d6; the protected files I2 changes relative to I1 are EXACTLY
//           { index.html }; every effective pin (M1 ⊕ R1..R5 ⊕ DE1..R8 ⊕ I1 ⊕ I2, the reader table, the ADB-06 layer) holds
//           committed / staged / checked out
//   I2G-02  provenance: the page pin is the I1 page (= the carried UI R1 page) + exactly the ONE recorded edit; the edit is a
//           pure re-ordering of unchanged lines (+ two comment lines): the hydration function and the entries listener are
//           byte-identical to I1's; non-vacuity: a changed anchor, a dropped or an altered edit is refused
//   I2G-03  the rule in the source (I1-R-03): inside the business-data effect the entries hydration function is DEFINED
//           before the entries listener is registered — a value Firebase delivers synchronously inside onValue() can never
//           reach it in its temporal dead zone (behaviour: test/emulator/entries-hydrate-immediate.mjs EH-01..03)
//   I2G-04  scope and portability (I1-R-01): no tracked symbolic link points outside the repository (none at all is tracked);
//           test/historical/.deps is untracked and ignored as a directory AND as a link; route, libraries, Builder, Rules,
//           schedule and configuration bytes are I1's; outside the page only tests change
//   I2G-05  the whole later layer on the approved M1 R5 entry base is still exactly ADB-06 ∪ DE1 ∪ I1 (the page is already in
//           I1's scope), each file held to its literal pin with the page at the I2 pin
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R5Pins, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { de1EffectivePins, DE1_SCOPE } from "../support/de1-daily-email.mjs";
import { OWNUI_PINS } from "../support/owner-notice-ui.mjs";
import { ADB06_PINS, ADB06_FILES } from "../support/adb06-builder-layer.mjs";
import { I1_ENTRY, I1_PINS, I1_SCOPE } from "../support/i1-integration.mjs";
import { I2_PARENT, I2_PINS, I2_NEW_FILES, I2_EDITS, I2_SCOPE, isI2Tree, deriveI2 } from "../support/i2-integration.mjs";

const SKIP = !isI2Tree(REPO) && "not an I2 tree";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const HYDRATE_DECL = "    const __entriesHydrate = (val) => {\n";
const LISTENER = "    subNodeEntries(`biz:${currentBizId}:entries`, (raw) => {\n";
const NOTE = [
  "    // I2 (I1-R-03): defined BEFORE the entries listener is registered. Firebase delivers an already-cached value\n",
  "    // synchronously inside onValue(), so the callback below may run during registration (temporal dead zone otherwise).\n",
];
/** The text of the hydration function (declaration … its closing `};`) and of the listener registration (… its `});`). */
const blocks = (src) => {
  const h = src.indexOf(HYDRATE_DECL), l = src.indexOf(LISTENER);
  assert.ok(h > 0 && l > 0, "both blocks located");
  const hEnd = src.indexOf("\n    };\n", h) + "\n    };\n".length, lEnd = src.indexOf("\n    });\n", l) + "\n    });\n".length;
  return { h, l, hydrate: src.slice(h, hEnd), listener: src.slice(l, lEnd) };
};

test("I2G-01 identity: sole parent the I1 candidate; I2 changes exactly the page among protected files; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I2_PARENT, "968155d68712544b44b5132de4d6d9c9cc01f961", "built on the rejected I1 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), I2_PARENT, "the I1 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I2_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I2_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", I2_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", I2_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), [...I2_SCOPE].sort(), label + ": protected changes vs I1 = { index.html }");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  assert.equal(eff[PG], I2_PINS[PG], "the page is held to its I2 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, PG))), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2");
});

test("I2G-02 provenance: the I1 page + exactly ONE recorded edit — a pure re-ordering (+ two comment lines); non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I2_NEW_FILES], []); assert.deepEqual(Object.keys(I2_EDITS), [PG]); assert.equal(I2_EDITS[PG].length, 1, "one edit");
  assert.equal(blobId(`${I2_PARENT}:${PG}`), I1_PINS[PG], "the parent page is the I1 pin");
  assert.equal(I1_PINS[PG], OWNUI_PINS[PG], "…which is the carried owner-notice UI R1 page");
  const d = deriveI2(REPO, PG); assert.ok(d.ok, JSON.stringify(d));
  assert.equal(gitBlobId(d.bytes), I2_PINS[PG], "I1 page + the recorded edit = the I2 pin");
  const { from, to } = I2_EDITS[PG][0];
  const sorted = (s) => s.split(/(?<=\n)/).sort();
  assert.deepEqual(sorted(to), sorted(from + NOTE.join("")), "the edit only re-orders unchanged lines and adds the two comment lines");
  const a = blocks(bytesOf(`${I2_PARENT}:${PG}`).toString("utf8")), b = blocks(readFileSync(join(REPO, PG), "utf8"));
  assert.equal(b.hydrate, a.hydrate, "the hydration function is byte-identical to I1's");
  assert.equal(b.listener, a.listener, "the entries listener registration is byte-identical to I1's");
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(I2_EDITS)); fn(e[PG]); return e; };
  assert.equal(deriveI2(REPO, PG, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI2(REPO, PG, tamper((l) => { l.pop(); })).reason, "no_recorded_edits");
  const altered = deriveI2(REPO, PG, tamper((l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I2_PINS[PG]);
  assert.notEqual(I2_PINS[PG], I1_PINS[PG]);
});

test("I2G-03 the rule in the source: the entries hydration is defined before its listener is registered (I1-R-03)", { skip: SKIP }, () => {
  const page = readFileSync(join(REPO, PG), "utf8"), i1 = bytesOf(`${I2_PARENT}:${PG}`).toString("utf8");
  for (const [label, src] of [["I2", page], ["I1", i1]]) {
    assert.equal(src.split(HYDRATE_DECL).length, 2, label + ": one hydration function");
    assert.equal(src.split(LISTENER).length, 2, label + ": one entries listener registration");
    assert.equal(src.split("__entriesHydrate(").length - 1, 1, label + ": one call site (inside the listener)");
  }
  const b = blocks(page), a = blocks(i1);
  assert.ok(a.l < a.h, "I1 (the defect): the listener was registered before the function was defined");
  assert.ok(b.h < b.l, "I2: the function is defined before the listener is registered");
  assert.ok(b.listener.includes("      __entriesHydrate(read.rows);\n"), "the listener hydrates through the function");
  const between = page.slice(b.h + b.hydrate.length, b.l);
  assert.equal(between, "", "nothing between the definition and the registration");
  assert.equal(page.slice(b.h - NOTE.join("").length, b.h), NOTE.join(""), "the comment explains the order");
});

test("I2G-04 scope and portability: no tracked link leaves the repository; .deps untracked and ignored; nothing else changes", { skip: SKIP }, () => {
  const links = lines(gitIn(REPO, ["ls-files", "-s"])).filter((l) => l.startsWith("120000 "));
  assert.deepEqual(links, [], "no symbolic link is tracked (I1 tracked test/historical/.deps → an absolute author path)");
  assert.equal(blobId("HEAD:test/historical/.deps"), null, "test/historical/.deps is not in the commit");
  assert.equal(readFileSync(join(REPO, "test/historical/.gitignore"), "utf8"), ".deps\n", "the ignore entry names .deps itself");
  for (const p of ["test/historical/.deps", "test/historical/.deps/node_modules/react/package.json"])
    assert.equal(gitIn(REPO, ["check-ignore", "-q", "--no-index", p]).status, 0, p + " is ignored (a directory or a link alike)");
  assert.ok(readFileSync(join(REPO, "test/historical/install-deps.sh"), "utf8").includes('DEPS="$HERE/.deps"'), "the documented installer still installs into .deps");
  assert.equal(blobId("HEAD:test/historical/install-deps.sh"), blobId(`${I2_PARENT}:test/historical/install-deps.sh`), "installer unchanged");
  assert.equal(blobId("HEAD:test/historical/historical-page-harness.mjs"), blobId(`${I2_PARENT}:test/historical/historical-page-harness.mjs`), "harness unchanged");
  const all = lines(gitIn(REPO, ["diff", "--name-only", I2_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I2_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f)), [], "outside the page only tests change");
  for (const f of ["api/daily-snapshot/run.ts", "lib/emailDelivery.js", "lib/sendEmail.js", "lib/securityContext.js", "lib/businessRegistry.js", "src/snapshot/snapshotBuilder.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/daily-email-harness.mjs", "test/emulator/owner-notice-rendered.mjs", "test/support/m1-run-gates.sh"])
    assert.equal(blobId("HEAD:" + f), blobId(`${I2_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I2G-05 the later layer on the approved M1 R5 entry base is still exactly ADB-06 ∪ DE1 ∪ I1, the page at its I2 pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers (I2 adds no file)");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS };
  for (const f of expected) assert.equal(blobId("HEAD:" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId("HEAD:" + f), pin, f + " is the approved M1 R5 pin");
});
