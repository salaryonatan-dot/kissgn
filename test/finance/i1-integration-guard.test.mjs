// Agent/Daily integration I1 guard — identity, provenance and scope of the integrated candidate (LOCAL; pending independent
// Codex review). Nothing here is an approval: it proves what the candidate IS, so that the named owners can confirm it.
//   I1G-01  the candidate's sole parent is the recorded merge commit, whose parents are EXACTLY the Builder CF5-01 successor
//           690a07d9 and the delivery R8 candidate 3d48398; the protected files I1 changes relative to that merge are EXACTLY
//           { api/daily-snapshot/run.ts, index.html }; every effective pin (M1 ⊕ R1..R5 ⊕ DE1..R8 ⊕ I1, the reader table, the
//           ADB-06 layer) holds committed / staged / checked out
//   I1G-02  provenance: the route pin is the merge-commit bytes (= the R8 pin) + exactly the recorded edits; the page pin is the
//           merge-commit page (= the approved M1 R5 page) + exactly the four owner-notice UI edits (= the UI candidate's blob)
//   I1G-03  scope of the route change: the authorization section is the approved P0 bytes; the manual path, the notice branch,
//           builderRefusal and everything outside the scheduled branch are the R8 bytes; no library, builder, Rules, schedule
//           or configuration byte changes relative to the merge
//   I1G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R8 route is not the I1 route
//   I1G-05  the integration rule in the source: ONE buildSnapshotRun call with ONE clock read, never the array adapter; every
//           expected identity becomes one row; a failed build is a failed row with receipt "not_written" and no delivery call;
//           a missing name records the notice; a failed discovery and the builder's own status decide completion
//   I1G-06  the whole later layer on the approved M1 R5 entry base (the M1 successor proof, CF-04): the protected changes
//           cfa7e801 → HEAD are EXACTLY the ADB-06 Builder / Agent files ∪ the DE1 delivery files ∪ the I1 files, each held to
//           its literal pin; no other M1-pinned file, Rules, page or schedule byte moves
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R5Pins } from "../support/m1-r1-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { de1EffectivePins, DE1_SCOPE } from "../support/de1-daily-email.mjs";
import { DE1R8_PINS } from "../support/de1-r8-provenance.mjs";
import { OWNUI_PINS } from "../support/owner-notice-ui.mjs";
import { ADB06_PINS, ADB06_FILES } from "../support/adb06-builder-layer.mjs";
import { I1_PARENT, I1_ENTRY, I1_BUILDER, I1_DELIVERY, I1_UI, I1_PINS, I1_NEW_FILES, I1_EDITS, I1_SCOPE, isI1Tree, deriveI1 } from "../support/i1-integration.mjs";

const SKIP = !isI1Tree(REPO) && "not an I1 tree";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const RT = "api/daily-snapshot/run.ts", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(I1_PINS).filter((f) => !I1_NEW_FILES.includes(f)).sort();

test("I1G-01 identity: sole parent the recorded merge (Builder ⊕ delivery R8); I1 changes exactly the route and the page; every effective pin holds", { skip: SKIP }, () => {
  assert.deepEqual([I1_ENTRY, I1_BUILDER, I1_DELIVERY, I1_UI], ["cfa7e8016e9d1b7440485de7911d133d9340f1e6", "690a07d9e3aabc82821975e097e1135417eb20c1", "3d48398818f064fce68184092e8003586f33d3fc", "2a9df535b5a0c94940724158cf24c905f4cd17b6"]);
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), I1_PARENT, "the recorded merge commit is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  assert.deepEqual(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I1_PARENT]))[0].split(" ").slice(1), [I1_BUILDER, I1_DELIVERY], "the merge's parents: first the Builder successor, then delivery R8");
  assert.equal(gitIn(REPO, ["merge-base", "--is-ancestor", I1_ENTRY, I1_BUILDER]).status, 0, "the Builder successor descends from the approved entry base");
  assert.equal(gitIn(REPO, ["merge-base", I1_BUILDER, I1_DELIVERY]).stdout.trim(), "45e760c893f682b71d8e8e8e962528c385206609", "the two lineages meet at M1 R1: no earlier layer is merged again");
  for (const [f, pin] of Object.entries(I1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I1_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", I1_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", I1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), [...I1_SCOPE].sort(), label + ": protected changes vs the merge = { route, page }");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS };
  for (const f of I1_SCOPE) assert.equal(eff[f], I1_PINS[f], f + " is held to its I1 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("I1G-02 provenance: the route = the R8 bytes + the recorded edits; the page = the M1 R5 page + the four UI edits (the UI candidate's blob)", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...I1_SCOPE].sort()); assert.deepEqual([...I1_NEW_FILES], []);
  assert.deepEqual(Object.keys(I1_EDITS), [RT], "the route's edits are recorded here; the page's are the owner-notice UI record");
  assert.equal(blobId(`${I1_PARENT}:${RT}`), DE1R8_PINS[RT], "the merge-commit route is the delivery R8 pin");
  assert.equal(blobId(`${I1_PARENT}:${RT}`), blobId(`${I1_DELIVERY}:${RT}`));
  const d = deriveI1(REPO, RT); assert.ok(d.ok, JSON.stringify(d));
  assert.equal(gitBlobId(d.bytes), I1_PINS[RT], "R8 + recorded I1 edits = the route pin");
  assert.equal(blobId(`${I1_PARENT}:${PG}`), "a5b7c4dba5e87584a3c61659042711d24c9beea5", "the merge-commit page is the approved M1 R5 page");
  const p = deriveI1(REPO, PG); assert.ok(p.ok, JSON.stringify(p));
  assert.equal(gitBlobId(p.bytes), I1_PINS[PG], "M1 R5 page + the four UI edits = the page pin");
  assert.equal(I1_PINS[PG], OWNUI_PINS[PG], "the page pin is the UI record's pin");
  assert.equal(blobId(`${I1_UI}:${PG}`), I1_PINS[PG], "…and the UI candidate commit's own page blob");
});

test("I1G-03 scope: only the scheduled branch of the route changes; auth = P0; manual / notice / attribution = R8; no library, builder, Rules or config byte", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I1_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I1_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f) && !/^docs\//.test(f)), [], "outside tests and docs nothing else changes");
  for (const f of ["lib/emailDelivery.js", "lib/emailDelivery.d.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "lib/securityContext.js", "lib/businessRegistry.js", "lib/bizAccess.js", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/daily-email-harness.mjs"])
    assert.equal(blobId("HEAD:" + f), blobId(`${I1_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  const run = readFileSync(join(REPO, RT), "utf8"), r8 = bytesOf(`${I1_PARENT}:${RT}`).toString("utf8");
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  assert.equal(section(run), section(bytesOf(`${P0}:${RT}`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate = the approved P0 bytes");
  const manual = (src) => src.slice(src.indexOf("    // POST = manual trigger for single business"));
  assert.equal(manual(run), manual(r8), "the manual path, the notice branch and the outer catch are the R8 bytes");
  const before = (src) => src.slice(src.indexOf("\n", src.indexOf("snapshotBuilder.js\";")), src.indexOf("export default async function handler"));
  assert.equal(before(run), before(r8), "recipient resolution, settle, errorClass, the gate tables, builderRefusal and the notice tables are the R8 bytes");
  assert.equal(run.split("\n")[2], 'import { buildSnapshotForBiz, buildSnapshotRun } from "../../src/snapshot/snapshotBuilder.js";', "the import swaps the array adapter for the structured run");
});

test("I1G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R8 route is not the I1 route", { skip: SKIP }, () => {
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(I1_EDITS)); fn(e[RT]); return e; };
  assert.equal(deriveI1(REPO, RT, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  const dropped = deriveI1(REPO, RT, tamper((l) => { l.pop(); })); assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== I1_PINS[RT]);
  const altered = deriveI1(REPO, RT, tamper((l) => { l[l.length - 1].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I1_PINS[RT]);
  assert.notEqual(I1_PINS[RT], DE1R8_PINS[RT]); assert.notEqual(I1_PINS[PG], m1R5Pins()[PG]);
  const eff = m1EffectivePins(REPO);
  assert.equal(eff[RT], I1_PINS[RT]); assert.equal(eff[PG], I1_PINS[PG]);
  for (const f of Object.keys(de1EffectivePins(REPO)).filter((x) => x !== RT)) assert.equal(eff[f], de1EffectivePins(REPO)[f], f + " keeps its DE1 pin");
});

test("I1G-05 the integration rule in the source", { skip: SKIP }, () => {
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  const r = code(readFileSync(join(REPO, RT), "utf8"));
  const get = r.slice(r.indexOf('if (req.method === "GET") {\n      const run'), r.indexOf("    if (req.method === \"POST\" && snapshotCtx)"));
  assert.ok(get.length > 1000, "the scheduled branch is located");
  assert.equal((r.match(/buildSnapshotRun\(/g) || []).length, 1, "ONE structured run per invocation");
  assert.ok(get.includes("const run = await buildSnapshotRun({ nowMs: Date.now() });"), "one clock read fixes the run");
  assert.ok(!r.includes("buildSnapshotForAll"), "the lossy array adapter is never consumed (G1)");
  assert.ok(get.includes("for (const expected of run.expectedBusinesses) {"), "every expected identity becomes one row");
  const failedLoop = get.slice(get.indexOf("for (const expected of run.expectedBusinesses) {"), get.indexOf("for (const snapshot of snapshots) {"));
  assert.ok(failedLoop.includes('outcome: "failed", code,') && failedLoop.includes('settlement: "failed", receipt: "not_written" };'), "a failed build is a failed row, receipt not_written (G3 / G6)");
  assert.ok(!/deliverWithReceipt|deliverWithoutReceipt|sendSnapshotEmail|resolveOwnerRecipient/.test(failedLoop), "no delivery, no recipient, no claim for a failed build");
  assert.ok(failedLoop.includes('if (code === "business_name_unavailable") row.notice = await recordMissingNameNotice(db, '), "a missing name records the owner notice (D-G4)");
  assert.ok(get.includes('const discoveryFailed = run.discovery.status !== "complete";') && get.includes("|| discoveryFailed;"), "a failed discovery breaks the run (G2)");
  assert.ok(get.includes('const complete = !broken && run.status === "complete" &&'), "the builder's own status must be complete (G1)");
  assert.ok(get.includes("discovery: { status: run.discovery.status, failures: run.discovery.failures.map((f) => ({ source: f.source, code: f.code })) },"), "the discovery accounting is reported, bounded");
  assert.ok(!/console\.(warn|error)\([^)]*error\.(message|stack)/.test(get), "nothing of a thrown value is logged");
});

test("I1G-06 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1, each held to its literal pin (M1 successor proof)", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the three recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS };
  for (const f of expected) assert.equal(blobId("HEAD:" + f), pins[f], f + ": the literal layer pin");
  // every other M1-pinned file of the entry base (Core, P1, page lineage, registry, analytics builder, admin API) is untouched
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId("HEAD:" + f), pin, f + " is the approved M1 R5 pin");
});
