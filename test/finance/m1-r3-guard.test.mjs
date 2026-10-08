// M1 integration R3 — identity, provenance and scope of the successor of the REJECTED R2 candidate (LOCAL; pending independent
// Codex review). Built on M1_R3_PARENT (the R2 candidate d848121d, itself rejected: M1_INTEGRATION_R2_VERDICT CHANGES_REQUIRED).
//   R3G-01  the protected files R3 changes relative to its parent are EXACTLY the recorded set; committed / staged /
//           checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ R2 ⊕ R3, and the S0 reader table) are the pins
//   R3G-02  provenance: each R3 pin is the parent's (R2) bytes + exactly the recorded edits; the parent bytes are the R2 pins
//   R3G-03  scope: the page's registry read / view / setup gate / setup write and the nightly builder's discovery and name
//           lookup only. The ONLY changed page write line is the setup's business-list write (a whole-node set replaced by
//           the compare-and-swap); every page edit lies in the storage transport, the C1 seam helpers, the MarjinC1 export or
//           the App's business-list code; no financial line of the builder is removed; the shared module, the endpoint, Rules,
//           configuration, Core, P1 and e-mail are byte-identical to R2
//   R3G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the R2 page is refused as the R3 page
//   R3G-05  the nightly builder judges the STORED registry node through the shared module (no lenient parse, no re-wrapped
//           `{_v}` of a parsed list), and the page reads the stored node (never the JSON text of a raw array)
// On an M1 R4 tree (the successor of this rejected R3 candidate, test/support/m1-r4-remediation.mjs) R3G-01..05 verify the R3
// commit itself from git objects (M1_R4_PARENT); the HEAD / index / checkout identity is held by the R4 guard (R4G-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { m1EffectivePins, m1EffectivePageVerdict, m1R3Pins, gitBlobId } from "../support/m1-r1-remediation.mjs";
import { isM1R4Tree, M1_R4_PARENT } from "../support/m1-r4-remediation.mjs";
import { M1_R2_PINS, M1_R2_PROTECTED } from "../support/m1-r2-remediation.mjs";
import { M1_R3_PARENT, M1_R3_PINS, M1_R3_NEW_FILES, M1_R3_EDITS, M1_R3_SCOPE, isM1R3Tree, deriveR3, applyR3Edits } from "../support/m1-r3-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, SERVER_READER_APPROVED_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { M1_R2_PINS as R2P } from "../support/m1-r2-remediation.mjs";
import { C1_WRITE_TOKENS } from "../support/c1-index-scope.mjs";

const SKIP = !isM1R3Tree(REPO) && "not an M1 R3 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(M1_R3_PINS).filter((f) => !M1_R3_NEW_FILES.includes(f)).sort();
const LAYERED = isM1R4Tree(REPO);
const R3_TREE = LAYERED ? M1_R4_PARENT : "HEAD";          // the R3 commit itself when the R4 layer is checked out
const read = (f) => (LAYERED ? bytesOf(`${R3_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("R3G-01 the R3 change set vs the rejected R2 parent is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(M1_R3_PARENT, "d848121d2139749502d06329bf6227f84f1f5f30", "R3 is built on the rejected R2 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", R3_TREE + "^"]).stdout.trim(), M1_R3_PARENT, "the R2 candidate is the SOLE parent");
  assert.equal(gitIn(REPO, ["rev-list", "--parents", "-n", "1", R3_TREE]).stdout.trim().split(" ").length, 2, "one parent");
  for (const [f, pin] of Object.entries(M1_R3_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", M1_R3_PARENT, R3_TREE, "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", M1_R3_PARENT, "--"])).filter((f) => M1_R2_PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", M1_R3_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => M1_R2_PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(M1_R3_PINS).sort(), label + ": protected changes vs the R2 parent = the recorded R3 set");
  // the R3 commit's own pin table: on an R4 tree the M1 ⊕ R1 ⊕ R2 ⊕ R3 pins and the approved reader table with the R3 builder pin
  const r3Reader = { ...SERVER_READER_APPROVED_BLOBS };
  for (const f of Object.keys(r3Reader)) { if (R2P[f]) r3Reader[f] = R2P[f]; if (M1_R3_PINS[f]) r3Reader[f] = M1_R3_PINS[f]; }
  const eff = LAYERED ? { ...m1R3Pins(), ...r3Reader } : { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS };
  for (const f of Object.keys(M1_R3_PINS)) assert.equal(eff[f], M1_R3_PINS[f], f + " is held to its R3 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R3_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R3 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], "6b70d03c245d163264f1bad2cefa71c0d85ff761", "the approved B1 pin itself is untouched");
});

test("R3G-02 provenance: each R3 pin is the R2 parent's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...M1_R3_SCOPE].sort());
  assert.deepEqual([...M1_R3_NEW_FILES], [], "R3 adds no protected file");
  assert.deepEqual(Object.keys(M1_R3_EDITS).sort(), MODIFIED, "edits are recorded for exactly the modified files");
  for (const f of MODIFIED) {
    assert.equal(blobId(`${M1_R3_PARENT}:${f}`), M1_R2_PINS[f], f + ": the parent bytes are the R2 pin");
    const d = deriveR3(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), M1_R3_PINS[f], f + " = parent + recorded R3 edits");
  }
});

test("R3G-03 scope: the registry read / view / setup gate / setup write and the nightly registry interpretation only", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", M1_R3_PARENT, R3_TREE, "--"]));
  assert.deepEqual(all.filter((f) => /^(database\.rules\.json|vercel\.json|package(-lock)?\.json|fincore\/|src\/(finance|metrics|policy|presenters|browser|finance-server|snapshot|agent|alerts|services|repositories|forecast|insights)\/|api\/|lib\/|test\/emulator\/database\.rules\.json$)/.test(f)), [], "no Rules / config / Core / P1 / e-mail / route / shared-module change");
  for (const f of ["lib/businessRegistry.js", "lib/businessRegistry.d.ts", "api/analytics/daily-builder.ts"]) assert.equal(blobId(R3_TREE + ":" + f), M1_R2_PINS[f], f + " is the R2 bytes");
  // the page: exactly ONE write line changes — the setup's whole-node business-list write becomes the compare-and-swap
  const writes = (s) => s.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t)));
  const before = writes(bytesOf(`${M1_R3_PARENT}:index.html`).toString("utf8")), after = writes(read("index.html"));
  const minus = (a, b) => { const r = [...a]; for (const x of b) { const i = r.indexOf(x); if (i >= 0) r.splice(i, 1); } return r; };
  assert.deepEqual(minus(before, after), ['    try { await window.storage.set("app-businesses", JSON.stringify(updatedBizList), true); } catch(e){ console.error("[setup] businesses save failed:", e.message); }'], "the only removed write line: the setup's whole-node business-list set");
  assert.deepEqual(minus(after, before), ['      const res = await window.storage.mutateFor(tenantId, "app-businesses", (current) => {'], "the only added write line: the setup's compare-and-swap");
  const page = read("index.html");
  const region = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b, i); assert.ok(i > 0 && j > i, "region " + a.slice(0, 40)); return [i, j]; };
  const REGIONS = [
    region("    window.storage.mutateFor = async (tenantId, key, txnFn) => {", "    // R-V2: RAW-node subscribe."),
    region("    var READ_FAILED = Object.freeze(", "    function ledgerChunks(F, from, to) {"),
    region("    window.MarjinC1 = Object.freeze({", "  })();"),
    region("  const [businesses, setBusinesses] = useState([]);", "  // Setup for this business"),
  ];
  for (const e of M1_R3_EDITS["index.html"]) {
    const at = page.indexOf(e.to);
    assert.ok(at > 0 && REGIONS.some(([i, j]) => at >= i && at + e.to.length <= j), "page edit inside the registry regions: " + e.to.slice(0, 80));
  }
  // the builder: no financial line changes; every edit is a registry / discovery edit
  const removed = (f) => gitIn(REPO, ["diff", "-U0", M1_R3_PARENT, R3_TREE, "--", f]).stdout.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
  assert.deepEqual(removed("src/analytics/dailyBuilder.ts").filter((l) => /canonical|toAnalyticsFinancials|loadCanonicalInputs|fin\b|payroll|purchases|revenue|labor|vat|forecast/i.test(l)), [], "no financial line of the builder is removed or rewritten");
  for (const e of M1_R3_EDITS["src/analytics/dailyBuilder.ts"]) assert.ok(/[Rr]egistry|registered|failure|Failure|discover|business|biz|parseFirebaseData|requireRegistered/.test(e.from + e.to), "builder edit is a registry / discovery edit: " + e.to.slice(0, 80));
});

test("R3G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the R2 page is not the R3 page", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(M1_R3_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveR3(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f + ": changed anchor");
    const dropped = deriveR3(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== M1_R3_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveR3(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== M1_R3_PINS[f], f + ": an altered edit is not the pin");
  }
  assert.equal(applyR3Edits("index.html", "no anchors here").reason, "edit_anchor_not_unique");
  assert.equal(m1EffectivePageVerdict(REPO, bytesOf(`${M1_R3_PARENT}:index.html`)).reason, "not_the_recorded_derivation", "the rejected R2 page is refused on the R3 tree");
  if (LAYERED) assert.equal(gitBlobId(applyR3Edits("index.html", bytesOf(`${M1_R3_PARENT}:index.html`)).bytes), M1_R3_PINS["index.html"], "the R3 commit's page = the R2 page + the recorded R3 edits (on an R4 tree)");
  else assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true }, "positive control");
});

test("R3G-05 the stored registry node is what the nightly builder and the page judge", { skip: SKIP }, () => {
  const b = read("src/analytics/dailyBuilder.ts");
  assert.ok(b.includes('import { classifyRegistryTarget, decodeRegistryNode, isRegistryBizId, resolveRegistryTarget } from "../../lib/businessRegistry.js";'), "the builder imports the shared rule");
  for (const gone of ["parseFirebaseData", "registryTargetOf", "{ _v: JSON.stringify("]) assert.ok(!b.includes(gone), "no lenient parse / re-wrap remains: " + gone);
  assert.ok(b.includes("const decoded = decodeRegistryNode(node);"), "discovery decodes the stored node");
  assert.ok(b.includes("const target = resolveRegistryTarget(businessSnap.val(), bizId);"), "the build resolves the stored node");
  assert.ok(b.includes("buildAnalyticsForBiz(tenantId, bizId, date, { requireRegistered: true })"), "the nightly build re-checks the identity");
  const page = read("index.html");
  assert.equal(page.split('window.storage.getNode("app-businesses")').length - 1, 2, "both page load paths read the stored node");
  assert.equal(page.split('window.storage.get("app-businesses"').length - 1, 0, "no JSON-text registry read remains");
});
