// RF1 — the ordinary local canary gate on the CANDIDATE EXPECTATION, with the release pin held apart (T-RF1-GATE).
// These rows re-state, on the ordinary gate, the protections of the retired Codex lane 21a651d0 (RC-L01..04; T-RF1-LANE):
//   RF-01 the identities: release pin unchanged (= F1 candidate), gate expectation = the integration Rules = the checkout =
//         the emulator mirror; the two differ by EXACTLY the P1 legacy-credits denial (the approved composition, nothing else)
//   RF-02 (RC-L01) a manifest naming the RELEASE pin is refused against the checked-out Rules — exit 14, zero writes:
//         publication of the candidate is PENDING and the fingerprint gate still catches a stale pin
//   RF-03 (RC-L03) unexpected Rules text is refused under the default manifest — exit 14, zero writes
//   RF-04 (RC-L02) the default emulator manifest runs the real plan and preflight: byte match, zero writes
//   RF-05 (RC-L04) the fixture distinction: emulator manifests name the candidate, production-shaped manifests the release pin;
//         the matrix has no selector and no environment path; the operator tool is byte-identical to I7
// When the Rules owner moves APPROVED_RULES_BLOB to the candidate (RELEASE_GATES §1), RF-01's "differ by the P1 denial" and
// RF-02 are transitioned in that same owner-accepted change (see proposed/rules-owner-publication-repin.patch) — never silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as X from "../support/canary-fixtures.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../../tools/storage-v2/canary-transport.mjs";
import { F1_RULES_CANDIDATE_BLOB, M1_INTEGRATION_RULES_BLOB, APPROVED_FENCE_RULES_BLOB, authorizedLegacyCreditsDenialDelta } from "../support/rules-authorized-delta.mjs";
import { RF1_PARENT, RF1_RELEASE_PIN, RF1_GATE_EXPECTATION } from "../support/rf1-rules-gate.mjs";

const blobText = (id) => { const r = gitIn(X.ROOT, ["cat-file", "blob", id]); assert.equal(r.status, 0, "git object " + id); return r.stdout; };
const blobAt = (spec) => { const r = gitIn(X.ROOT, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
async function call(db, manifest, command = "plan") {
  const dir = X.tempEvidenceDir();
  const path = X.writeJsonFile(dir, "manifest.json", manifest);
  const result = await X.runCli(X.args(command, path, dir), { db });
  return { result, report: result.summary?.report ? X.readReport(result.summary.report) : null };
}

test("RF-01 identities: the release pin is unchanged; the gate expectation is the integration Rules = the checkout = the mirror; they differ by exactly the P1 denial", () => {
  assert.equal(X.APPROVED_RULES_BLOB, RF1_RELEASE_PIN, "the release pin literal is unchanged by RF1");
  assert.equal(X.APPROVED_RULES_BLOB, F1_RULES_CANDIDATE_BLOB, "the release pin is still the F1 candidate (RV-G01 unchanged)");
  assert.equal(X.CANDIDATE_RULES_BLOB, RF1_GATE_EXPECTATION);
  assert.equal(X.CANDIDATE_RULES_BLOB, M1_INTEGRATION_RULES_BLOB, "the gate expectation is the recorded integration Rules");
  assert.notEqual(X.CANDIDATE_RULES_BLOB, X.APPROVED_RULES_BLOB, "publication pending: the gate expectation is not the release pin");
  assert.notEqual(X.CANDIDATE_RULES_BLOB, APPROVED_FENCE_RULES_BLOB);
  const canonical = readFileSync(join(X.ROOT, "database.rules.json"), "utf8"), mirror = readFileSync(join(X.ROOT, "test/emulator/database.rules.json"), "utf8");
  assert.equal(gitBlobId(canonical), X.CANDIDATE_RULES_BLOB, "the checked-out Rules are the gate expectation");
  assert.equal(mirror, canonical, "the emulator mirror is byte-identical");
  assert.equal(blobAt("HEAD:database.rules.json"), X.CANDIDATE_RULES_BLOB, "committed");
  // the only difference between the release pin and the gate expectation is the approved P1 legacy-credits client-write denial
  const release = JSON.parse(blobText(X.APPROVED_RULES_BLOB)), gate = JSON.parse(blobText(X.CANDIDATE_RULES_BLOB));
  assert.deepEqual(authorizedLegacyCreditsDenialDelta(release, gate), { ok: true }, "release pin → gate expectation = exactly the P1 denial");
  assert.equal(authorizedLegacyCreditsDenialDelta(gate, release).ok, false, "the denial is not reversible (the grant is gone)");
  assert.equal(authorizedLegacyCreditsDenialDelta(release, JSON.parse(blobText(APPROVED_FENCE_RULES_BLOB))).ok, false, "the P0 fence is neither");
});

test("RF-02 (RC-L01) a manifest naming the RELEASE pin is refused against the checked-out Rules: exit 14, mismatch, zero writes (publication pending)", async () => {
  const restore = X.stubRulesFetch();
  try {
    const db = X.fakeRtdb(); X.seedBusiness(db);
    const m = X.diagnosticManifest({ approved: { rulesBlob: X.APPROVED_RULES_BLOB } }, "RF-02 stale pin: the release pin against the checked-out candidate Rules");   // RF2: fault injection is explicitly diagnostic
    assert.equal(m.approved.rulesBlob, RF1_RELEASE_PIN); assert.ok(X.isDiagnosticManifest(m));
    const { result, report } = await call(db, m);
    assert.equal(result.exitCode, 14, JSON.stringify(result.error));
    assert.equal(report?.environment?.deployedRulesMatch, "mismatch");
    assert.equal(report?.environment?.deployedRulesBlob, X.CANDIDATE_RULES_BLOB, "the served (checked-out) Rules are reported by identity");
    assert.equal(db.writes.length, 0);
    // a stale historical pin (the P0 fence) is refused the same way — the fingerprint gate, not the particular literal, is the protection
    const stale = await call(db, X.diagnosticManifest({ approved: { rulesBlob: APPROVED_FENCE_RULES_BLOB } }, "RF-02 stale pin: the P0 fence"));
    assert.equal(stale.result.exitCode, 14); assert.equal(stale.report?.environment?.deployedRulesMatch, "mismatch"); assert.equal(db.writes.length, 0);
  } finally { restore(); }
});

test("RF-03 (RC-L03) unexpected Rules text is refused under the default manifest with zero writes", async () => {
  const text = readFileSync(join(X.ROOT, "database.rules.json"), "utf8");
  // semantic changes only: a byte-different but JSON-equal text is a `structural` match by the transport contract, not unexpected Rules
  const widened = text.replace("$dataKey.matches(/^biz:[^:]+:credits$/) ? false", "$dataKey.matches(/^biz:[^:]+:credits$/) ? true");
  assert.notEqual(widened, text, "the P1 denial branch is present in the checked-out Rules");
  for (const changed of [text.replace("storage_v2_control", "storage_v2_controL"), widened]) {
    assert.notEqual(changed, text);
    const restore = X.stubRulesFetch(changed);
    try {
      const db = X.fakeRtdb(); X.seedBusiness(db);
      const { result, report } = await call(db, X.manifestFor());
      assert.equal(result.exitCode, 14);
      assert.equal(report?.environment?.deployedRulesMatch, "mismatch");
      assert.notEqual(report?.environment?.deployedRulesBlob, X.CANDIDATE_RULES_BLOB);
      assert.equal(db.writes.length, 0);
    } finally { restore(); }
  }
});

test("RF-04 (RC-L02) the default emulator manifest runs the real plan and preflight on the checked-out Rules: byte match, zero writes", async () => {
  const manifest = X.manifestFor();
  assert.equal(manifest.environment, "emulator");
  assert.equal(manifest.approved.rulesBlob, X.CANDIDATE_RULES_BLOB);
  const restore = X.stubRulesFetch();
  try {
    const db = X.fakeRtdb(); X.seedBusiness(db);
    const plan = await call(db, manifest, "plan");
    assert.equal(plan.result.exitCode, 0, JSON.stringify(plan.result.error));
    assert.equal(plan.report.environment.deployedRulesMatch, "byte");
    assert.equal(plan.report.environment.deployedRulesBlob, X.CANDIDATE_RULES_BLOB);
    const preflight = await call(db, manifest, "preflight");
    assert.equal(preflight.result.exitCode, 0, JSON.stringify(preflight.result.error));
    assert.ok(preflight.report.findings.some((x) => x.code === "rules_fingerprint_match"));
    assert.equal(db.writes.length, 0);
  } finally { restore(); }
});

test("RF-05 (RC-L04) the fixture distinction: emulator manifests name the candidate, production-shaped manifests the release pin; the matrix has no selector or environment path; the operator tool is I7's bytes", () => {
  assert.equal(X.manifestFor().approved.rulesBlob, X.CANDIDATE_RULES_BLOB);
  assert.equal(X.manifestFor({ environment: "production" }).approved.rulesBlob, X.APPROVED_RULES_BLOB, "a production-shaped manifest never names the candidate");
  assert.equal(X.manifestFor({ environment: "production" }).projectId, "example-prod-project");
  const matrix = readFileSync(join(X.ROOT, "test/emulator/canary-operator-matrix.mjs"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");   // code lines only
  assert.match(matrix, /if \(T\.gitBlobId\(b\) !== CANDIDATE_RULES_BLOB\) fail\(/, "the startup assertion compares with the gate expectation");
  assert.match(matrix, /rulesBlob: CANDIDATE_RULES_BLOB \}/, "the matrix manifest names the gate expectation");
  assert.doesNotMatch(matrix, /APPROVED_RULES_BLOB|local-rules-candidate|LOCAL_SELECTOR|process\.argv\.slice|selectors|MARJIN_|process\.env\.[A-Z_]*RULES/, "no release-pin use, no selector, no argv / environment expectation path");
  assert.equal((matrix.match(/CANDIDATE_RULES_BLOB/g) || []).length, 4, "the expectation is used exactly where recorded: import, startup assertion (+ its abort message), manifest");
  for (const f of ["tools/storage-v2/canary.mjs", "tools/storage-v2/canary-transport.mjs", "tools/storage-v2/canary-contract.mjs", "test/support/rules-authorized-delta.mjs", "database.rules.json", "test/emulator/database.rules.json"])
    assert.equal(blobAt("HEAD:" + f), blobAt(`${RF1_PARENT}:${f}`), f + " is byte-identical to I7");
});
