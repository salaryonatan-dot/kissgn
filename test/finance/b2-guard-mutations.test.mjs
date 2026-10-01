// Financial Core B2 successor — CD-AT30 / B2-G30 / B2-G31: the narrow guard changes accept ONLY
// the reviewed B2 ownership and bytes. Mutants of the REAL repository inputs: an unauthorized
// consumer, a cross-category duplicate, globs / directories / stray paths, stale or altered
// snapshot bytes (including the never-approved checkpoint blobs) and an edited B1 pin all fail;
// Layer A and the four B1 reader pins are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles } from "../support/b1-fixtures.mjs";
import { SERVER_READER_APPROVED_BLOBS, collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";

const SB = "src/snapshot/snapshotBuilder.ts", SE = "src/snapshot/snapshotEmail.ts";
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const real = () => loadConsumerFiles(REPO).map((f) => ({ name: f.name, json: JSON.parse(JSON.stringify(f.json)) }));
const b2Of = (files) => files.find((f) => f.name === "b2.json");
const errors = (files) => validateConsumerFiles(files, repoKindOf(REPO)).errors;

test("B2G-01 the committed B2 ownership: e-mail = the ONLY B2 core consumer, builder = the ONLY B2 server-API consumer; no finance-server helper", () => {
  assert.deepEqual(b2Of(real()).json, { slice: "B2", consumers: [SE], serverApiConsumers: [SB] });
  assert.deepEqual(errors(real()), []);
  assert.equal(repoKindOf(REPO)("src/finance-server/canonicalSnapshot.ts"), null, "B2-R01: the broad helper is gone");
});

test("B2G-02 mutants of b2.json fail: cross-category duplicate, glob, directory, stray/missing path, a B1 path claimed by B2", () => {
  const cases = [
    [(b) => { b.json.serverApiConsumers.push(SE); }, /duplicate serverApiConsumers entry src\/snapshot\/snapshotEmail\.ts/],
    [(b) => { b.json.consumers.push(SB); }, /duplicate serverApiConsumers entry src\/snapshot\/snapshotBuilder\.ts \(also in b2\.json:consumers\)/],
    [(b) => { b.json.consumers = ["src/snapshot/*.ts"]; }, /glob/],
    [(b) => { b.json.consumers = ["src/snapshot"]; }, /directory/],
    [(b) => { b.json.consumers = ["src/snapshot/"]; }, /not_exact_path/],
    [(b) => { b.json.consumers = ["src/finance-server/canonicalSnapshot.ts"]; }, /missing_file/],
    [(b) => { b.json.serverApiConsumers = ["src/analytics/dailyBuilder.ts"]; }, /duplicate serverApiConsumers entry src\/analytics\/dailyBuilder\.ts/],
  ];
  for (const [mut, re] of cases) {
    const files = real(); mut(b2Of(files));
    assert.ok(errors(files).some((e) => re.test(e)), re + " → " + JSON.stringify(errors(files)));
  }
});

test("B2G-03 importer mutants fail: the builder importing the core, the e-mail importing the server API, an unlisted snapshot helper", () => {
  const v = validateConsumerFiles(real(), repoKindOf(REPO));
  const sources = { [SB]: read(SB), [SE]: read(SE) };
  assert.deepEqual(importerVerdict(sources, v), { ok: true, unlistedCore: [], unlistedServer: [] });
  const withCore = { ...sources, [SB]: read(SB) + '\nimport { ratioOfTotals } from "../metrics/report.js";\n' };
  assert.deepEqual(importerVerdict(withCore, v).unlistedCore, [SB]);
  const withServer = { ...sources, [SE]: read(SE) + '\nimport type { ServerProvenance } from "../finance-server/canonicalMetrics.js";\n' };
  assert.deepEqual(importerVerdict(withServer, v).unlistedServer, [SE]);
  const helper = { ...sources, "src/snapshot/snapshotView.ts": 'import { ratioOfTotals } from "../metrics/report.js";' };
  assert.deepEqual(importerVerdict(helper, v).unlistedCore, ["src/snapshot/snapshotView.ts"]);
});

test("B2G-04 pins: the reviewed builder/e-mail bytes pass; stale (pre-B2, checkpoint c16ac110) or altered bytes fail; the four B1 pins are the approved ones", () => {
  assert.deepEqual([SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/dailyMetricsRepo.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/laborRepo.ts"], SERVER_READER_APPROVED_BLOBS["src/repositories/analytics/purchasesRepo.ts"]].map((h) => h.slice(0, 8)), ["6b70d03c", "4a5cb8f8", "14eff463", "7916308f"]);
  const inputs = collectServerReaderScopeInputs(REPO);
  const fence = (raw) => ({ ...raw, changedProtectedPaths: raw.changedProtectedPaths.filter((r) => r !== "database.rules.json") });
  assert.deepEqual(serverReaderScopeVerdict(fence(inputs)), { ok: true });
  const CHECKPOINT = "c16ac110e29913bcab9e6c598fa4b508c8f9fc63";
  for (const rev of ["4675eb20a97e8750429fad3e2ebda94f42f187b5", CHECKPOINT]) {
    for (const f of [SB, SE]) {
      const blob = gitIn(REPO, ["rev-parse", `${rev}:${f}`]);
      if (blob.status !== 0) continue; // the checkpoint object may be absent from a shallow review clone
      const m = fence({ ...inputs, blobs: { ...inputs.blobs, [f]: blob.stdout.trim() } });
      assert.equal(serverReaderScopeVerdict(m).reason, "approved_content_mismatch", `${f} @ ${rev.slice(0, 8)}`);
    }
  }
  const stray = fence({ ...inputs, changedProtectedPaths: [...inputs.changedProtectedPaths, "src/snapshot/snapshotView.ts"] });
  assert.deepEqual(serverReaderScopeVerdict(stray), { ok: false, reason: "unauthorized_protected_path", detail: ["src/snapshot/snapshotView.ts"] }, "a stray protected snapshot file fails");
  const altered = fence({ ...inputs, blobs: { ...inputs.blobs, [SE]: "0".repeat(40) } });
  assert.equal(serverReaderScopeVerdict(altered).reason, "approved_content_mismatch");
});

test("B2G-05 Layer A / Rules / delivery surface unchanged relative to the approved CD-M1 predecessor; B2 edits no core, fincore, productFinance or server API (B2-G27/G28)", () => {
  const BASE = "6d54e36752a5e04891127e2f62c8ea2571c61511";
  const B2 = "3fd28e7c6b7001004ebd25b0dd92eb3ffe1cddac";
  const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
  const names = (args) => gitIn(REPO, args).stdout.trim().split("\n").filter(Boolean);
  const untracked = names(["ls-files", "--others", "--exclude-standard"]);
  // RC 1.0 integration: when the approved B2 commit is an ANCESTOR of HEAD (an integrated tree),
  // B2's own scope is checked on B2's exact approved commit delta, and the rest of the tree may
  // carry ONLY the separately approved CD-M2 R1 runtime surface. On a standalone B2 tree (B2 not
  // an ancestor, or B2 itself) the original whole-tree check below applies unchanged.
  const integrated = gitIn(REPO, ["merge-base", "--is-ancestor", B2, "HEAD"]).status === 0 && names(["rev-parse", "HEAD"])[0] !== B2;
  const b2Delta = integrated ? names(["diff", "--name-only", BASE, B2, "--"]) : [...names(["diff", "--name-only", BASE, "--"]), ...untracked];
  for (const f of b2Delta) assert.doesNotMatch(f, PROTECTED, "B2 must not touch " + f);
  const runtime = b2Delta.filter((f) => /^src\//.test(f));
  assert.deepEqual(runtime.sort(), [SB, SE], "B2 runtime edits: exactly the two snapshot files");
  if (integrated) {
    // the ONLY protected paths the integrated tree may change: CD-M2 R1's approved client + repository fix
    const CDM2_APPROVED = ["index.html", "lib/repositories/entryExceptionsRepo.js"];
    const whole = [...names(["diff", "--name-only", BASE, "--"]), ...untracked].filter((f) => PROTECTED.test(f));
    assert.deepEqual([...new Set(whole)].sort(), CDM2_APPROVED, "integrated tree: protected changes are exactly CD-M2 R1's approved runtime files");
    assert.equal(gitIn(REPO, ["merge-base", "--is-ancestor", "38af03c207010de2045b101c7d012d8de78a8b5a", "HEAD"]).status, 0, "…and they come from the approved CD-M2 R1 lineage");
    for (const f of CDM2_APPROVED) assert.equal(gitIn(REPO, ["rev-parse", "HEAD:" + f]).stdout.trim(), gitIn(REPO, ["rev-parse", "38af03c207010de2045b101c7d012d8de78a8b5a:" + f]).stdout.trim(), f + " is byte-identical to approved CD-M2 R1");
  }
});
