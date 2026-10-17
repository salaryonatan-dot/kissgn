// RF2 — the candidate expectation CONFINED to its exact emulator scope (closes the independent RF1 review's RF1-R-01; T-RF2-GATE).
// RF1 gave the ordinary local canary gate an explicit candidate expectation (CANDIDATE_RULES_BLOB) but its fixture let a final
// post-merge override produce a production-shaped manifest naming the candidate, other project / URL values and caller pins; the
// retired lane's constructor (RC-L04) refused all four. RF2 restores that boundary on every fixture path and proves it through the
// ACTUAL CLI entry (tools/storage-v2/canary.mjs main), with a fake Admin app, a fake credentials-shaped file and the stubbed Rules fetch:
//   RF-06 the constructors: the ordinary fixture refuses every scope override except the production switch; the candidate factory
//         refuses every scope override and freezes the exact scope; the diagnostic constructor requires a reason and never carries
//         the candidate outside its scope nor accepts the candidate as a selected pin; the sentinel is no git object and no known pin
//   RF-07 actual CLI, production shape: the default production manifest (release pin) is refused against the checked-out candidate
//         Rules — plan 14, preflight BLOCKER, zero writes; a production-shaped CANDIDATE manifest cannot be produced by any fixture
//         path, so no manifest file exists, the CLI is never entered and nothing is written (the RF1 forcing reached a confirmed enroll)
//   RF-08 actual CLI, selectors: project / URL / caller-pin overrides on the candidate are refused by the fixture (typed codes, zero
//         writes); their diagnostic shapes (sentinel pin) are refused by the CLI's own manifest validation or fingerprint gate — exit 14,
//         zero writes; the exact-scope diagnostic with a non-candidate pin is a fingerprint mismatch
//   RF-09 actual CLI, missing / malformed / mis-shaped manifests and an environment mismatch: refused before any plan — zero writes
// Nothing here publishes, re-pins or approves: APPROVED_RULES_BLOB stays the release pin; the matrix keeps its no-selector shape (RF-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import * as X from "../support/canary-fixtures.mjs";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import { gitIn } from "../support/git-context.mjs";
import { APPROVED_FENCE_RULES_BLOB, M1_INTEGRATION_RULES_BLOB } from "../support/rules-authorized-delta.mjs";
import { RF2_PARENT, DIAGNOSTIC_SENTINEL } from "../support/rf2-rules-gate.mjs";

const refused = (fn, code) => { let e = null; try { fn(); } catch (x) { e = x; } assert.ok(e, "expected a refusal"); assert.equal(e.code, code, e.message); };
const blobExists = (id) => gitIn(X.ROOT, ["cat-file", "-e", id]).status === 0;
const PROD_CREDS = (dir, projectId) => { const p = X.writeJsonFile(dir, "fake-credentials.json", { type: "service_account", project_id: projectId, client_email: "fake@example.invalid", private_key: "NOT_A_REAL_KEY" }); chmodSync(p, 0o600); return p; };
const prodApp = (db, m) => ({ options: { databaseURL: m.databaseURL, credential: { getAccessToken: async () => ({ access_token: "fake" }) } }, database: () => ({ ref: db.ref }), delete: async () => {} });
async function cli(db, manifest, command, { env = "emulator", extra = [], app } = {}) {
  const dir = X.tempEvidenceDir();
  const path = X.writeJsonFile(dir, "manifest.json", manifest);
  const result = await X.runCli(X.args(command, path, dir, env, extra), { db, processEnv: env === "production" ? X.PROD_ENV : X.EMU_ENV, app });
  return { result, report: result.summary?.report ? X.readReport(result.summary.report) : null, dir, path };
}

test("RF-06 the fixture boundary: ordinary / candidate / diagnostic constructors; the candidate expectation never leaves its exact scope and is never caller-selected", () => {
  // the ordinary fixture
  const emu = X.manifestFor(), prod = X.manifestFor({ environment: "production" });
  assert.ok(X.isCandidateScope(emu) && emu.approved.rulesBlob === X.CANDIDATE_RULES_BLOB, "the default is the exact candidate-emulator scope");
  assert.equal(prod.approved.rulesBlob, X.APPROVED_RULES_BLOB); assert.equal(prod.projectId, "example-prod-project"); assert.equal(prod.environment, "production");
  for (const over of [{ environment: "production", approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, { projectId: "unapproved-project" }, { databaseURL: "https://example.invalid" }, { databaseURL: "http://127.0.0.1:9001?ns=demo-marjin-rules-default-rtdb" }, { approved: { rulesBlob: "other" } }, { approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, { approved: { rulesBlob: X.APPROVED_RULES_BLOB } }, { environment: "staging" }, { environment: "emulator" }])
    refused(() => X.manifestFor(over), "candidate_scope_refused");
  // the candidate factory (RC-L04 semantics): no scope key at all, frozen exact scope
  const cand = X.candidateManifest({ bizId: "bizB" });
  assert.ok(X.isCandidateScope(cand) && cand.approved.rulesBlob === X.CANDIDATE_RULES_BLOB && cand.bizId === "bizB");
  assert.ok(Object.isFrozen(cand) && Object.isFrozen(cand.approved), "frozen after construction");
  assert.equal(C.validateManifest(cand).ok, true, "the factory's output is a valid manifest");
  for (const over of [{ environment: "production" }, { environment: "emulator" }, { projectId: X.EMU_PROJECT }, { databaseURL: X.EMU_URL }, { approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, { approved: { repoSha: "0".repeat(40) } }])
    refused(() => X.candidateManifest(over), "candidate_scope_refused");
  // the diagnostic constructor: explicit, registered, candidate confined
  refused(() => X.diagnosticManifest({ bizId: "*" }), "diagnostic_reason_required");
  refused(() => X.diagnosticManifest({ bizId: "*" }, "  "), "diagnostic_reason_required");
  const d = X.diagnosticManifest({ approved: { rulesBlob: X.APPROVED_RULES_BLOB } }, "stale release pin");
  assert.ok(X.isDiagnosticManifest(d) && !X.isDiagnosticManifest(emu) && !X.isDiagnosticManifest(cand));
  refused(() => X.diagnosticManifest({ environment: "production", approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, "forcing"), "candidate_pin_selection_refused");
  refused(() => X.diagnosticManifest({ approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, "forcing"), "candidate_pin_selection_refused");
  refused(() => X.diagnosticManifest({ projectId: "unapproved-project" }, "project selector"), "candidate_scope_refused");           // the default pin would leave its scope
  refused(() => X.diagnosticManifest({ databaseURL: "https://example.invalid" }, "url selector"), "candidate_scope_refused");
  refused(() => X.diagnosticManifest({ environment: "staging" }, "wrong environment"), "candidate_scope_refused");
  assert.equal(X.diagnosticManifest({ projectId: "unapproved-project", approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "project selector").approved.rulesBlob, X.DIAGNOSTIC_RULES_BLOB, "a mis-shaped diagnostic carries the sentinel");
  // the sentinel and the judge
  assert.equal(X.DIAGNOSTIC_RULES_BLOB, DIAGNOSTIC_SENTINEL); assert.match(X.DIAGNOSTIC_RULES_BLOB, /^[0-9a-f]{40}$/);
  assert.ok(!blobExists(X.DIAGNOSTIC_RULES_BLOB), "the sentinel is no git object");
  assert.ok(![X.CANDIDATE_RULES_BLOB, X.APPROVED_RULES_BLOB, APPROVED_FENCE_RULES_BLOB, M1_INTEGRATION_RULES_BLOB].includes(X.DIAGNOSTIC_RULES_BLOB));
  refused(() => X.assertCandidateScope({ environment: "production", projectId: "p", databaseURL: "https://x", approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }), "candidate_scope_refused");
  refused(() => X.assertCandidateScope({ environment: "emulator", projectId: "demo-other", databaseURL: X.EMU_URL, approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }), "candidate_scope_refused");
  assert.equal(X.assertCandidateScope(emu), emu);
  // the identities RF1 established are untouched
  assert.equal(X.APPROVED_RULES_BLOB, "32ea32bfc9b70c16c06b1acf87d045c5e28ff1d8"); assert.equal(X.CANDIDATE_RULES_BLOB, "27887d72da5431bd0b6ee69f53e0dfd10cc44caf");
});

test("RF-07 actual CLI, production shape: the release-pin manifest is refused against the checked-out candidate Rules (zero writes); a production-shaped candidate manifest cannot be produced by any fixture path", async () => {
  const restore = X.stubRulesFetch();
  try {
    const m = X.manifestFor({ environment: "production" });
    const db = X.fakeRtdb(); X.seedBusiness(db, { tenantId: m.tenantId, bizId: m.bizId, control: null });
    const dir = X.tempEvidenceDir(), file = X.writeJsonFile(dir, "manifest.json", m), creds = PROD_CREDS(dir, m.projectId), app = prodApp(db, m);
    const plan = await X.runCli([...X.args("plan", file, dir, "production"), "--credentials-file", creds], { db, processEnv: X.PROD_ENV, app });
    assert.equal(plan.exitCode, 14, JSON.stringify(plan.error));
    const planReport = plan.summary?.report ? X.readReport(plan.summary.report) : null;   // a fingerprint mismatch is reported in the plan report (exit 14, executed: false), not as a stderr error
    assert.equal(plan.summary?.executed, false); assert.equal(planReport?.environment?.deployedRulesMatch, "mismatch"); assert.equal(planReport?.environment?.deployedRulesBlob, X.CANDIDATE_RULES_BLOB, "the served (checked-out) Rules are reported by identity, not the manifest's pin");
    const preflight = await X.runCli([...X.args("preflight", file, dir, "production"), "--credentials-file", creds], { db, processEnv: X.PROD_ENV, app });
    const pr = preflight.summary?.report ? X.readReport(preflight.summary.report) : null;
    assert.equal(preflight.exitCode, 10, JSON.stringify(preflight.error));
    assert.equal(pr?.aggregate, "BLOCKER");
    assert.ok(pr.findings.some((f) => f.code === "rules_fingerprint_mismatch"));
    assert.equal(db.writes.length, 0, "zero writes");
    // the RF1 forcing: a production-shaped manifest naming the candidate — no constructor produces it, so the CLI is never entered
    const before = db.writes.length;
    for (const build of [() => X.manifestFor({ environment: "production", approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }), () => X.diagnosticManifest({ environment: "production", approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, "forcing"), () => X.candidateManifest({ environment: "production" })]) {
      let produced = null; try { produced = build(); } catch (e) { assert.match(e.code, /^candidate_(scope|pin_selection)_refused$/); }
      assert.equal(produced, null, "no production-shaped candidate manifest is produced");
    }
    assert.ok(!existsSync(join(dir, "manifest-candidate.json")));
    assert.equal(db.writes.length, before, "nothing written");
    // and the judge refuses a hand-built one before it could reach a file (the only other path: writing JSON by hand, outside every fixture)
    refused(() => X.assertCandidateScope({ ...m, approved: { ...m.approved, rulesBlob: X.CANDIDATE_RULES_BLOB } }), "candidate_scope_refused");
  } finally { restore(); }
});

test("RF-08 actual CLI, selectors: project / URL / caller-pin overrides on the candidate are refused by the fixture; their diagnostic shapes are refused by the CLI with zero writes", async () => {
  const restore = X.stubRulesFetch();
  try {
    const db = X.fakeRtdb(); X.seedBusiness(db);
    for (const [over, code] of [[{ projectId: "unapproved-project" }, "candidate_scope_refused"], [{ databaseURL: "https://example.invalid" }, "candidate_scope_refused"], [{ approved: { rulesBlob: "other" } }, "candidate_scope_refused"], [{ approved: { rulesBlob: X.CANDIDATE_RULES_BLOB } }, "candidate_scope_refused"]])
      refused(() => X.manifestFor(over), code);
    assert.equal(db.writes.length, 0);
    const shapes = [
      ["other project", { projectId: "unapproved-project", approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "manifest_invalid"],
      ["other URL", { databaseURL: "https://example.invalid", approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "manifest_invalid"],
      ["malformed pin", { approved: { rulesBlob: "other" } }, "manifest_invalid"],
      ["exact scope, non-candidate pin", { approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "rules_fingerprint_mismatch"],
      ["exact scope, the release pin", { approved: { rulesBlob: X.APPROVED_RULES_BLOB } }, "rules_fingerprint_mismatch"],
    ];
    for (const [label, over, code] of shapes) {
      const m = X.diagnosticManifest(over, "RF-08 " + label);
      assert.notEqual(m.approved.rulesBlob, X.CANDIDATE_RULES_BLOB, label + ": never the candidate");
      const { result, report } = await cli(db, m, "plan");
      assert.equal(result.exitCode, 14, label + " " + JSON.stringify(result.error));
      if (code === "rules_fingerprint_mismatch") {               // reported in the plan report (executed: false), not as a stderr error
        assert.equal(result.summary?.executed, false, label); assert.equal(report?.environment?.deployedRulesMatch, "mismatch", label);
        assert.equal(report?.environment?.deployedRulesBlob, X.CANDIDATE_RULES_BLOB, label + ": the served Rules are reported by identity");
      } else assert.equal(result.error?.error, code, label + " " + JSON.stringify(result.error));   // the CLI's stderr JSON: { command, error: <code>, detail, exitCode }
      assert.equal(db.writes.length, 0, label + ": zero writes");
    }
    // the ordinary no-selector manifest still runs the real plan on the checked-out Rules (RF-04 retained)
    const ok = await cli(db, X.manifestFor(), "plan");
    assert.equal(ok.result.exitCode, 0, JSON.stringify(ok.result.error)); assert.equal(ok.report.environment.deployedRulesMatch, "byte"); assert.equal(db.writes.length, 0);
    const okc = await cli(db, X.candidateManifest(), "preflight");
    assert.equal(okc.result.exitCode, 0, JSON.stringify(okc.result.error)); assert.ok(okc.report.findings.some((x) => x.code === "rules_fingerprint_match")); assert.equal(db.writes.length, 0);
  } finally { restore(); }
});

test("RF-09 actual CLI, missing / malformed / mis-shaped manifests and an environment mismatch are refused before any plan — zero writes", async () => {
  const restore = X.stubRulesFetch();
  try {
    // [label, manifest file text (undefined = no file), --env, expected exit, expected stderr error code]
    // an unreadable manifest (missing / unparseable) is the CLI's generic error (exit 10, code "error"); a readable but invalid or
    // mis-targeted manifest is a typed environment / manifest refusal (exit 14)
    const cases = [
      ["missing file", undefined, "emulator", 10, "error"],
      ["malformed JSON", "{", "emulator", 10, "error"],
      ["null", "null", "emulator", 14, "manifest_invalid"],
      ["empty object", "{}", "emulator", 14, "manifest_invalid"],
      ["wrong environment", JSON.stringify(X.diagnosticManifest({ environment: "staging", approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "RF-09 wrong environment")), "emulator", 14, null],
      ["environment mismatch (candidate manifest, --env production)", JSON.stringify(X.manifestFor()), "production", 14, "environment_mismatch"],
      ["missing Rules pin", JSON.stringify(X.diagnosticManifest({ approved: { rulesBlob: null } }, "RF-09 missing pin")), "emulator", 14, "manifest_invalid"],
    ];
    const seen = [];
    for (const [label, text, env, exit, code] of cases) {
      const db = X.fakeRtdb(); X.seedBusiness(db);
      const dir = X.tempEvidenceDir(), file = join(dir, "manifest.json");
      if (text !== undefined) writeFileSync(file, text);
      const result = await X.runCli(X.args("plan", file, dir, env), { db, processEnv: env === "production" ? X.PROD_ENV : X.EMU_ENV });
      assert.notEqual(result.exitCode, 0, label);
      assert.equal(result.exitCode, exit, label + " " + JSON.stringify(result.error));
      assert.ok(result.error && typeof result.error.error === "string", label + ": a typed refusal");
      if (code) assert.equal(result.error.error, code, label + " " + JSON.stringify(result.error));
      assert.equal(result.summary?.executed ?? false, false, label + ": nothing executed");
      assert.equal(db.writes.length, 0, label + ": zero writes");
      seen.push(`${label}→${result.exitCode}/${result.error.error}`);
    }
    assert.equal(seen.length, 7);
  } finally { restore(); }
});

test("RF-05' the matrix is unchanged by RF2 (no selector, no environment path, the gate expectation exactly where recorded)", () => {
  const blobAt = (spec) => { const r = gitIn(X.ROOT, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
  assert.equal(blobAt("HEAD:test/emulator/canary-operator-matrix.mjs"), blobAt(`${RF2_PARENT}:test/emulator/canary-operator-matrix.mjs`), "the matrix is RF1's bytes");
  for (const f of ["tools/storage-v2/canary.mjs", "tools/storage-v2/canary-transport.mjs", "tools/storage-v2/canary-contract.mjs", "test/support/rules-authorized-delta.mjs", "database.rules.json", "test/emulator/database.rules.json"])
    assert.equal(blobAt("HEAD:" + f), blobAt(`${RF2_PARENT}:${f}`), f + " is byte-identical to RF1 (and I7)");
});
