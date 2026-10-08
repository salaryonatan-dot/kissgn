// M1 integration R5 — identity, provenance and scope of the successor of the REJECTED R4 candidate (LOCAL; pending independent
// Codex review). Built on M1_R5_PARENT (the R4 candidate 6d460027, itself rejected by its independent review: CHANGES_REQUIRED).
//   R5G-01  the protected files R5 changes relative to its parent are EXACTLY the recorded set; committed / staged / checked-out
//           bytes of every effective pin (M1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4 ⊕ R5, and the S0 reader table) are the pins
//   R5G-02  provenance: the R5 pin is the parent's (R4) bytes + exactly the recorded edits; the parent bytes are the R4 pin
//   R5G-03  scope: ONLY the nightly discovery pair key of src/analytics/dailyBuilder.ts. No other protected file; no financial,
//           registry-classification, run-outcome or persisted-record line changes; the endpoint, page, admin API, shared
//           registry module, securityContext, Rules, configuration, Core, P1, snapshot / e-mail and schedule are the R4 bytes
//   R5G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R4 bytes are not the R5 pin
//   R5G-05  the corrected rule in the source: no delimiter-concatenated tenant/business key remains in the nightly builder; the
//           ONE injective pair key is used at every discovery / ambiguity site; the ids are never parsed back from a key
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { m1EffectivePins, m1R4Pins, gitBlobId } from "../support/m1-r1-remediation.mjs";
import { M1_R2_PROTECTED } from "../support/m1-r2-remediation.mjs";
import { M1_R5_PARENT, M1_R5_PINS, M1_R5_NEW_FILES, M1_R5_EDITS, M1_R5_SCOPE, isM1R5Tree, deriveR5, applyR5Edits } from "../support/m1-r5-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, SERVER_READER_APPROVED_BLOBS } from "../support/server-reader-authorized-delta.mjs";

const SKIP = !isM1R5Tree(REPO) && "not an M1 R5 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(M1_R5_PINS).filter((f) => !M1_R5_NEW_FILES.includes(f)).sort();
const DB = "src/analytics/dailyBuilder.ts";
const read = (f) => readFileSync(join(REPO, f), "utf8");

test("R5G-01 the R5 change set vs the rejected R4 parent is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(M1_R5_PARENT, "6d4600275bb8a80dc147880c5776cacfd4c0090c", "R5 is built on the rejected R4 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), M1_R5_PARENT, "the R4 candidate is the SOLE parent");
  assert.equal(gitIn(REPO, ["rev-list", "--parents", "-n", "1", "HEAD"]).stdout.trim().split(" ").length, 2, "one parent");
  for (const [f, pin] of Object.entries(M1_R5_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", M1_R5_PARENT, "HEAD", "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", M1_R5_PARENT, "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", M1_R5_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => M1_R2_PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), Object.keys(M1_R5_PINS).sort(), label + ": protected changes vs the R4 parent = the recorded R5 set");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS };
  for (const f of Object.keys(M1_R5_PINS)) assert.equal(eff[f], M1_R5_PINS[f], f + " is held to its R5 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(SERVER_READER_APPROVED_BLOBS[DB], "6b70d03c245d163264f1bad2cefa71c0d85ff761", "the approved B1 pin itself is untouched");
});

test("R5G-02 provenance: the R5 pin is the R4 parent's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...M1_R5_SCOPE].sort());
  assert.deepEqual([...M1_R5_NEW_FILES], [], "R5 adds no protected file");
  assert.deepEqual(Object.keys(M1_R5_EDITS).sort(), MODIFIED, "edits are recorded for exactly the modified files");
  const r4 = m1R4Pins();
  for (const f of MODIFIED) {
    assert.equal(blobId(`${M1_R5_PARENT}:${f}`), r4[f], f + ": the parent bytes are the R4 pin");
    const d = deriveR5(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), M1_R5_PINS[f], f + " = parent + recorded R5 edits");
  }
});

test("R5G-03 scope: the nightly discovery pair key only", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", M1_R5_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => M1_R2_PROTECTED.test(f) && !M1_R5_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => /^(database\.rules\.json|vercel\.json|package(-lock)?\.json|fincore\/|lib\/|api\/|index\.html$|tools\/|test\/emulator\/database\.rules\.json$)/.test(f)), [], "no Rules / config / shared module / route / page / Core / tool change");
  for (const f of ["index.html", "api/admin.js", "api/analytics/daily-builder.ts", "lib/businessRegistry.js", "lib/securityContext.js", "lib/emailDelivery.js", "lib/sendEmail.js", "api/daily-snapshot/run.ts", "vercel.json", "database.rules.json", "src/snapshot/snapshotBuilder.ts", "src/alerts/runner.ts"])
    assert.equal(blobId("HEAD:" + f), blobId(`${M1_R5_PARENT}:${f}`), f + " is the R4 bytes");
  const diff = gitIn(REPO, ["diff", "-U0", M1_R5_PARENT, "HEAD", "--", DB]).stdout.split("\n");
  const removed = diff.filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
  const added = diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  assert.equal(removed.length, 3, "exactly the three pair-key lines are replaced");
  for (const l of removed) assert.match(l, /\$\{(t|tenantId|candidate\.tenantId)\}\|\$\{(b|id|candidate\.bizId)\}/, "a removed line is a delimiter-concatenated pair key: " + l);
  assert.deepEqual(added.filter((l) => /canonical|toAnalyticsFinancials|loadCanonicalInputs|payroll|purchases|revenue|labor|vat|forecast|classifyRegistryTarget|reportRegistryFailure|recordAnalyticsRun|analyticsRunOutcome|failures\.push/i.test(l)), [], "no financial / classification / run-outcome / accounting line added");
});

test("R5G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the R4 bytes are not the R5 pin", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(M1_R5_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveR5(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f + ": changed anchor");
    const dropped = deriveR5(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== M1_R5_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveR5(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== M1_R5_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(M1_R5_PINS[f], m1R4Pins()[f], f + ": the R5 pin differs from the rejected R4 bytes");
  }
  assert.equal(applyR5Edits(DB, "no anchors here").reason, "edit_anchor_not_unique");
});

test("R5G-05 the corrected rule in the source: one injective pair key at every nightly discovery / ambiguity site", { skip: SKIP }, () => {
  const code = read(DB).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  assert.doesNotMatch(code, /\$\{[A-Za-z.]*\}\|\$\{[A-Za-z.]*\}/, "no `${a}|${b}` key remains");
  assert.ok(code.includes("export function analyticsPairKey(tenantId: string, bizId: string): string {\n  return JSON.stringify([tenantId, bizId]);\n}"), "the pair key is the JSON array encoding");
  assert.equal((code.match(/analyticsPairKey\(/g) || []).length, 4, "defined once, used at the three discovery / ambiguity sites");
  assert.doesNotMatch(code, /JSON\.parse\([^)]*[Kk]ey/, "a pair key is never parsed back into ids");
});
