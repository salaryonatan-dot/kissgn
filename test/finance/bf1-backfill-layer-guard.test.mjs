// BF1 component identity and protected-layer transition. Candidate pins are not independent acceptance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, appendFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { isProtectedPath, collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";
import { BF1_FILE, BF1_PIN, BF1_PARENT, BF1_PARENT_BLOB, bf1RecordVerdict, bf1Projection } from "../support/bf1-backfill-layer.mjs";
// BF2 layering (corrected T-BF1-LAYER, independent BF1 review BF1-R-03): on a BF2 tree BF1G-01 judges the IMMUTABLE BF1 commit from git
// objects; HEAD / index / working tree (every path not in the index, ignored or not) are held by BF2G-01.
import { isBF2Tree, BF2_PARENT } from "../support/bf2-backfill-layer.mjs";
const LAYERED = isBF2Tree(REPO);
const BF1_TREE = LAYERED ? BF2_PARENT : "HEAD";
const rev = (s) => gitIn(REPO, ["rev-parse", s]).stdout.trim();
const lines = (r) => r.stdout.split("\n").filter(Boolean);
const protectedPath = (p) => /^(src\/|fincore\/|api\/|lib\/|index\.html$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$)/.test(p) || isProtectedPath(p);

test("BF1G-01 sole-parent I7 child; exactly one protected runtime delta and every inherited pin retained", () => {
  assert.equal(rev(`${BF1_TREE}^`), BF1_PARENT);
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", BF1_TREE]))[0].split(" ").length, 2);
  const committed = lines(gitIn(REPO, ["diff", "--name-only", BF1_PARENT, BF1_TREE])).filter(protectedPath);
  const staged = LAYERED ? committed : lines(gitIn(REPO, ["diff", "--name-only", "--cached", BF1_PARENT])).filter(protectedPath);
  const working = LAYERED ? committed : [...lines(gitIn(REPO, ["diff", "--name-only", BF1_PARENT])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard", "--", "scripts", "src", "lib", "api", "fincore"]))].filter(protectedPath);
  for (const paths of [committed, staged, working]) assert.deepEqual([...new Set(paths)].sort(), [BF1_FILE]);
  assert.equal(rev(`${BF1_TREE}:${BF1_FILE}`), BF1_PIN);
  if (!LAYERED) { assert.equal(rev(`:${BF1_FILE}`), BF1_PIN); assert.equal(gitBlobId(readFileSync(join(REPO, BF1_FILE))), BF1_PIN); }
  for (const [f, pin] of Object.entries(m1EffectivePins(REPO))) {
    assert.equal(rev(`${BF1_TREE}:${f}`), pin, f);
    if (LAYERED) continue;
    assert.equal(rev(`:${f}`), pin, f);
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f);
  }
});

test("BF1G-02 exact record; no reader allowlist or protected root widened; script projection fails closed", () => {
  assert.equal(BF1_PARENT_BLOB, "ae14356c0326d94da935c334e3d00ac6132797fc");
  assert.equal(BF1_PIN, "672365e20a388db42f3e127741e0f5a9ca4d5967");
  assert.deepEqual(bf1RecordVerdict(REPO), { ok: true });
  const record = JSON.parse(readFileSync(join(REPO, "test/support/bf1-backfill-layer.json")));
  assert.equal(bf1RecordVerdict(REPO, { ...record, pin: "0".repeat(40) }).ok, false);
  assert.equal(bf1RecordVerdict(REPO, { ...record, file: "scripts/other.mjs" }).ok, false);
  const raw = collectServerReaderScopeInputs(REPO);
  assert.ok(raw.bf1.ok && raw.bf1.layered);
  assert.ok(raw.changedProtectedPathsUnprojected.includes(BF1_FILE));
  assert.ok(!raw.changedProtectedPaths.includes(BF1_FILE));
  assert.deepEqual(serverReaderScopeVerdict({ ...raw, changedProtectedPaths: [BF1_FILE] }), { ok: false, reason: "unauthorized_protected_path", detail: [BF1_FILE] }, "the reader table alone still refuses the stored-data script");
  const stray = "scripts/unreviewed.mjs";
  assert.ok(bf1Projection(REPO, [BF1_FILE, stray]).projected.includes(stray));
  const verdict = serverReaderScopeVerdict({ ...raw, changedProtectedPaths: [stray] });
  assert.deepEqual(verdict, { ok: false, reason: "unauthorized_protected_path", detail: [stray] });
});

test("BF1G-03 altered, missing, staged and committed script substitutions cannot project", () => {
  const dir = mkdtempSync(join(tmpdir(), "bf1-guard-"));
  try {
    const clone = gitIn(REPO, ["clone", "--quiet", "--shared", REPO, dir]); assert.equal(clone.status, 0, clone.stderr);
    const p = join(dir, BF1_FILE), bytes = readFileSync(p);
    assert.ok(bf1Projection(dir, [BF1_FILE]).ok);
    appendFileSync(p, "\n// mutation\n"); assert.equal(bf1Projection(dir, [BF1_FILE]).reason, "script_content_mismatch");
    assert.equal(gitIn(dir, ["add", BF1_FILE]).status, 0); writeFileSync(p, bytes);
    assert.equal(bf1Projection(dir, [BF1_FILE]).reason, "script_history_mismatch", "staged altered bytes despite clean working bytes");
    assert.equal(gitIn(dir, ["-c", "user.name=Local Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "mutation"]).status, 0);
    assert.equal(gitIn(dir, ["add", BF1_FILE]).status, 0);
    assert.equal(bf1Projection(dir, [BF1_FILE]).reason, "script_history_mismatch", "committed altered bytes despite restored index and working bytes");
    rmSync(p); assert.equal(bf1Projection(dir, [BF1_FILE]).reason, "script_missing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
