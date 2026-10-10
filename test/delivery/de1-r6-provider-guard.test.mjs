// DE1 R6 guard — identity, provenance and scope of the provider-structure candidate (LOCAL; pending independent review).
//   DE1R6G-01  the protected runtime files R6 changes relative to R5 are EXACTLY { lib/emailDelivery.js }; committed / staged /
//              checked out bytes equal the effective pins (M1 ⊕ DE1 ⊕ R1 … ⊕ R6); R6 has exactly one parent, R5
//   DE1R6G-02  provenance: the R6 pin is the R5 bytes (= the R5 pin) + exactly the recorded edits
//   DE1R6G-03  scope: only the resolved-result classifier changes; the route, the declarations, the SMTP wrapper, the builder,
//              the predicates, Rules and schedule are byte-identical to R5; outside classifyTransportInfo the module is R5
//   DE1R6G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R5 module is not the R6 one
//   DE1R6G-05  the structure rules in the source: the result and the envelope must be plain records (prototype read in a
//              try/catch), a refusal detail is never a list, the `typeof info === "object"` acceptance of a decorated array is gone
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { de1EffectivePins, de1R5Pins, de1R6Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { DE1R6_PARENT, DE1R6_PINS, DE1R6_NEW_FILES, DE1R6_EDITS, DE1R6_SCOPE, isDE1R6Tree, deriveDE1R6 } from "../support/de1-r6-provider.mjs";
import { isDE1R7Tree, DE1R7_PARENT } from "../support/de1-r7-notice.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R6Tree(REPO) && "not a DE1 R6 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R6_PINS).filter((f) => !DE1R6_NEW_FILES.includes(f)).sort();
const ED = "lib/emailDelivery.js";
const LAYERED = isDE1R7Tree(REPO);
const R6_TREE = LAYERED ? DE1R7_PARENT : "HEAD";          // the R6 commit itself when the R7 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R6_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R6G-01 the R6 change set vs R5 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R6_PARENT, "054fd87316839a8d6e2f66d9594f0ef867d21ba7", "R6 is built on the R5 candidate (under independent review)");
  assert.equal(gitIn(REPO, ["rev-parse", R6_TREE + "^"]).stdout.trim(), DE1R6_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R6_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R6_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R6_PARENT, R6_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R6_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R6_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R6_PINS).sort(), label + ": protected changes vs R5 = the recorded R6 set");
  // the R6 commit's own pins: on an R7 tree the effective table without the R7 overlay
  const eff = LAYERED ? { ...m1EffectivePins(REPO), ...de1R6Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R6_PINS)) assert.equal(eff[f], pin, f + ": the R6 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R6_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R6 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R6G-02 provenance: the R6 pin is the R5 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R6_NEW_FILES, [], "R6 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R6_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R6_PARENT}:${f}`), de1R5Pins()[f], f + ": the parent bytes are the R5 pin");
    const d = deriveDE1R6(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R6_PINS[f], f + " = R5 + recorded R6 edits");
  }
});

test("DE1R6G-03 scope: only the resolved-result classifier changes; everything else is byte-identical to R5", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R6_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R6_PARENT, R6_TREE, "--"]));
  const outside = all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && !DE1R6_SCOPE.includes(f));
  assert.deepEqual(outside, [], "no runtime / config / tool / emulator / Rules change outside the receipt module");
  for (const f of ["lib/emailDelivery.d.ts", "api/daily-snapshot/run.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/verifyToken.js", "lib/businessRegistry.js", "test/support/canary-fixtures.mjs", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json", "index.html"])
    assert.equal(blobId(R6_TREE + ":" + f), blobId(`${DE1R6_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R6_PARENT, R6_TREE, "--", "src", "fincore", "api", "tools", "index.html"])), [], "no src / fincore / api / tools / page change");
  // outside classifyTransportInfo (and its doc comment) the receipt module is byte-identical to R5
  const cut = (s) => { const a = s.indexOf("/**\n * Classify a resolved sendMail result for one recipient."), b = s.indexOf("// ── the per-attempt context lib/sendEmail.js reads"); assert.ok(a > 0 && b > a); return s.slice(0, a) + s.slice(b); };
  assert.equal(cut(readAt(ED)), cut(bytesOf(`${DE1R6_PARENT}:${ED}`).toString("utf8")), "only the resolved-result classifier changed");
});

test("DE1R6G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R5 module is not the R6 one", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R6_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R6(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R6(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R6_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R6(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R6_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R6_PINS[f], de1R5Pins()[f], f + ": the R6 pin differs from the R5 pin");
  }
  const eff = LAYERED ? de1R6Pins() : de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R6_PINS[f]);
  for (const f of Object.keys(de1R5Pins()).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], de1R5Pins()[f], f + " keeps its R5 pin");
});

test("DE1R6G-05 the structure rules in the source", { skip: SKIP }, () => {
  const src = readAt(ED);
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  const fn = code.slice(code.indexOf("export function classifyTransportInfo"), code.indexOf("export function currentDeliveryAttempt"));
  assert.ok(fn.includes("const isPlainRecord = (x) => {"), "a plain-record predicate exists");
  assert.ok(fn.includes("if (Array.isArray(x)) return false;") && fn.includes("const proto = Object.getPrototypeOf(x);") && fn.includes("return proto === Object.prototype || proto === null;"), "an array is never a record; the prototype must be Object.prototype or null");
  assert.ok(/try \{[^\n]*\n\s*if \(Array\.isArray\(x\)\) return false;/.test(fn), "the structural reads are guarded (a revoked Proxy throws on Array.isArray)");
  assert.ok(fn.includes("if (!isPlainRecord(info)) return malformed(null);"), "the result itself is validated first");
  assert.ok(!fn.includes('if (info === null || typeof info !== "object") return malformed(null);'), "the R4 typeof-only check is gone");
  assert.ok(fn.includes("if (!isPlainRecord(envelope)) return malformed(rc);"), "the envelope is a plain record");
  assert.ok(fn.includes('if (e === null || typeof e !== "object" || Array.isArray(e)) return malformed(rc);'), "a refusal detail is never a list");
  assert.ok(fn.indexOf("if (!isPlainRecord(info))") < fn.indexOf('field(info, "response")'), "structure before evidence");
});
