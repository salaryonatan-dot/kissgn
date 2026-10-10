// ADB-06 successor layer guard (Agent/Daily integration I1; PROPOSED transition, NOT an approval). It proves what the carried
// Builder / Agent layer IS, so the B2/Builder, Agent D-E, S0 scope and M1 integration owners can confirm it on this exact SHA.
//   ADB6G-01  the record holds against git OBJECTS (chain cfa7e801 → eb9f9008 → 02575273 → 690a07d9; every pin = the blob at
//             690a07d9; every entry blob = the blob at cfa7e801, never equal to the pin) and every pin holds committed / staged /
//             checked out on this tree
//   ADB6G-02  negative controls of the layer verdict: an altered Agent file, a missing one, a forged record pin, a pin equal to
//             the entry blob and a stray Agent file outside the record are each refused for their own reason; the reader table
//             alone never authorizes an Agent file
//   ADB6G-03  scope of the Builder chain on the entry base: it changes no M1-pinned file, no route, no library, no page, no Rules
//             and no configuration; its runtime set is exactly the record's
//   ADB6G-04  the AMEND-02 consumer records travel unchanged: test/finance/core-consumers/d.json and e.json are the chain's own
//             blobs (structure validated by GUARD-02 / G-B2; the D/E package owner's confirmation of S23 stays PENDING)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1R5Pins } from "../support/m1-r1-remediation.mjs";
import { collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";
import { ADB06_ENTRY, ADB06_SOURCE, ADB06_CHAIN, ADB06_PINS, ADB06_ENTRY_BLOBS, ADB06_FILES, ADB06_AGENT_FILES, isADB06Tree, adb06RecordVerdict, adb06Projection } from "../support/adb06-builder-layer.mjs";

const SKIP = !isADB06Tree(REPO) && "not an ADB-06 layer tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const AGENT = "src/agent/proactive/detectors/detectForecastRisk.ts";

test("ADB6G-01 the record holds against git objects; every layer pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.deepEqual([ADB06_ENTRY, ADB06_SOURCE], ["cfa7e8016e9d1b7440485de7911d133d9340f1e6", "690a07d9e3aabc82821975e097e1135417eb20c1"]);
  assert.deepEqual([...ADB06_CHAIN], ["eb9f90085c8b54b931d23003c7d62bf8c77d7e61", "02575273e4bdd5e63d18b68a8404950ad8f4fb65", ADB06_SOURCE]);
  assert.deepEqual(adb06RecordVerdict(REPO), { ok: true });
  assert.equal(ADB06_FILES.length, 26); assert.equal(ADB06_AGENT_FILES.length, 19);
  for (const f of ADB06_FILES) {
    assert.equal(blobId("HEAD:" + f), ADB06_PINS[f], f + " committed");
    assert.equal(blobId(":" + f), ADB06_PINS[f], f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), ADB06_PINS[f], f + " checked out");
  }
  assert.equal(ADB06_PINS["src/snapshot/snapshotBuilder.ts"], "81ba88caecd432b0982e0badb32407f413413c4b", "the builder is the CF5-01 successor's (refusal marker included)");
  const c = collectServerReaderScopeInputs(REPO);
  assert.equal(c.adb06.ok, true, JSON.stringify(c.adb06)); assert.deepEqual(c.adb06.validated, [...ADB06_AGENT_FILES].sort(), "the collector's layer verdict validated exactly the Agent files");
  assert.deepEqual(c.changedProtectedPaths.filter((x) => /^src\/agent\//.test(x)), [], "…and projected exactly those out");
});

test("ADB6G-02 negative controls: altered / missing / stray Agent files, forged or base-equal pins are each refused for their own reason", { skip: SKIP }, () => {
  // a disposable copy of the working tree (no .git: the verdicts read git objects of REPO through a pointer file)
  const dir = mkdtempSync(join(tmpdir(), "adb6g-"));
  try {
    for (const f of [...ADB06_AGENT_FILES]) { mkdirSync(dirname(join(dir, f)), { recursive: true }); cpSync(join(REPO, f), join(dir, f)); }
    writeFileSync(join(dir, ".git"), "gitdir: " + gitIn(REPO, ["rev-parse", "--absolute-git-dir"]).stdout.trim() + "\n");
    const changed = [...ADB06_AGENT_FILES];
    assert.equal(adb06Projection(dir, changed).ok, true, "the copy is the layer");
    appendFileSync(join(dir, AGENT), "\n// edit\n");
    const altered = adb06Projection(dir, changed);
    assert.deepEqual([altered.ok, altered.reason, altered.detail.file], [false, "layer_content_mismatch", AGENT], "an altered Agent file");
    rmSync(join(dir, AGENT));
    assert.deepEqual([adb06Projection(dir, changed).ok, adb06Projection(dir, changed).reason], [false, "layer_file_missing"], "a missing Agent file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // the collector projects FAIL-CLOSED: a failed layer verdict projects nothing, so the reader verdict refuses every Agent path
  const collector = readFileSync(join(REPO, "test/support/server-reader-authorized-delta.mjs"), "utf8");
  assert.ok(collector.includes("const changedProtectedPaths = adb06.ok ? adb06.projected : changedProtectedPathsUnprojected;"), "fail-closed projection in the collector");
  // a stray Agent file outside the record is never validated: the reader layer refuses it by name
  const raw = collectServerReaderScopeInputs(REPO);
  const stray = "src/agent/proactive/detectors/detectNewThing.ts";
  const p = adb06Projection(REPO, [...raw.changedProtectedPathsUnprojected, stray]);
  assert.ok(p.ok && p.projected.includes(stray), "a non-layer Agent path is left for the reader layer");
  const v = serverReaderScopeVerdict({ ...raw, changedProtectedPaths: p.projected.filter((x) => x !== "database.rules.json") });
  assert.deepEqual([v.ok, v.reason, v.detail], [false, "unauthorized_protected_path", [stray]], "…which refuses it");
  // the reader table alone (no layer verdict) never authorizes an Agent file
  const alone = serverReaderScopeVerdict({ ...raw, changedProtectedPaths: raw.changedProtectedPathsUnprojected.filter((x) => x !== "database.rules.json") });
  assert.deepEqual([alone.ok, alone.reason, alone.detail], [false, "unauthorized_protected_path", [...ADB06_AGENT_FILES].sort()]);
  // record forgeries are refused against the git objects, each for its own reason (the module's own verdict, forged inputs)
  const forged = (fn) => { const rec = { entryBase: ADB06_ENTRY, source: ADB06_SOURCE, chain: [...ADB06_CHAIN], pins: { ...ADB06_PINS }, entryBlobs: { ...ADB06_ENTRY_BLOBS } }; fn(rec); return adb06RecordVerdict(REPO, rec); };
  assert.deepEqual(forged(() => {}), { ok: true });
  assert.deepEqual(forged((r) => { r.pins[AGENT] = "0".repeat(40); }), { ok: false, reason: "pin_not_source_blob", detail: AGENT }, "a forged pin");
  assert.deepEqual(forged((r) => { r.pins[AGENT] = "*"; }), { ok: false, reason: "pin_shape", detail: AGENT }, "a pin that is not a blob id");
  assert.deepEqual(forged((r) => { r.entryBlobs[AGENT] = r.pins[AGENT]; }), { ok: false, reason: "entry_blob", detail: AGENT }, "a forged entry blob");
  assert.deepEqual(forged((r) => { delete r.pins[AGENT]; }).reason, "file_set", "a dropped layer file");
  assert.deepEqual(forged((r) => { r.pins["src/agent/extra.ts"] = ADB06_PINS[AGENT]; }).reason, "file_set", "an extra layer file");
  assert.deepEqual(forged((r) => { r.chain.pop(); }).reason, "chain", "a truncated chain");
  assert.deepEqual(forged((r) => { r.source = "02575273e4bdd5e63d18b68a8404950ad8f4fb65"; }).reason, "source", "the pre-CF5-01 successor is not the recorded source");
  assert.deepEqual(forged((r) => { r.entryBase = "6d4600275bb8a80dc147880c5776cacfd4c0090c"; }).reason, "entry_base", "the rejected R4 is not the entry base");
});

test("ADB6G-03 scope of the Builder chain on the entry base: no M1-pinned file, route, library, page, Rules or configuration byte", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", ADB06_ENTRY, ADB06_SOURCE, "--"]));
  assert.deepEqual(all.filter((f) => /^(api\/|lib\/|fincore\/|index\.html$|database\.rules\.json$|vercel\.json$|package(-lock)?\.json$|test\/emulator\/database\.rules\.json$)/.test(f)), [], "no route / library / Core / page / Rules / configuration change");
  assert.deepEqual(all.filter((f) => /^src\//.test(f)).sort(), [...ADB06_FILES], "the runtime set is exactly the record's");
  for (const [f, pin] of Object.entries(m1R5Pins())) assert.equal(blobId(`${ADB06_SOURCE}:${f}`), pin, f + " is the approved M1 R5 pin at the Builder successor");
});

test("ADB6G-04 the AMEND-02 consumer records travel unchanged (owner confirmation of the D/E split stays pending)", { skip: SKIP }, () => {
  for (const f of ["test/finance/core-consumers/d.json", "test/finance/core-consumers/e.json"]) {
    assert.ok(blobId(`${ADB06_SOURCE}:${f}`), f + " exists at the Builder successor");
    assert.equal(blobId("HEAD:" + f), blobId(`${ADB06_SOURCE}:${f}`), f + " is the Builder successor's blob");
  }
  assert.equal(blobId("HEAD:test/finance/core-consumers/d.json"), "06ac3d15ec5a98fd01a4f10ac6069eec9f91f619");
  assert.equal(blobId("HEAD:test/finance/core-consumers/e.json"), "0b2390aa18bfe3442cfe579cebabd102ec10fa0b");
  assert.equal(blobId("HEAD:src/finance-server/consumerBoundary.ts"), null, "the removed facade stays removed (ADB-05)");
});
