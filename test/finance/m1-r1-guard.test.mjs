// M1 integration R1 remediation (LOCAL; pending independent Codex review) — identity and provenance of the successor of the
// REJECTED M1 candidate (test/support/m1-r1-remediation.mjs + m1-r1-remediation.json).
//   R1G-01  the protected runtime files the R1 tree changes relative to the rejected parent are EXACTLY the recorded R1 set;
//           their committed / staged / checked-out bytes are the literal R1 pins; every other protected file keeps its M1
//           pin (committed / staged / checked out).
//   R1G-02  provenance: every R1 pin of a changed file is re-derived from the parent's git objects by the recorded exact
//           edits (each anchor unique); the parent bytes are the M1 pins; a new file is absent at the parent.
//   R1G-03  boundedness: R1 changes only the registry decision — the two server consumers, the page's registry rule and the
//           new shared module; every edit is a registry edit; the page edits stay inside the C1 seam's binding helpers.
//   R1G-04  non-vacuity: a changed anchor, a dropped or altered edit, the unremediated parent page or either input page
//           alone are refused by the derivation, the pin or the effective page contract.
//   R1G-05  the shared predicate is THE registry decision of both server consumers (static import graph of the routes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { M1_PINS, M1_CORE_COMMIT, M1_P1_COMMIT } from "../support/m1-integration-pin.mjs";
import { M1_R1_PARENT, M1_R1_PINS, M1_R1_NEW_FILES, M1_R1_EDITS, isM1R1Tree, m1EffectivePins, m1R1Pins, deriveR1, applyR1Edits, m1EffectivePageVerdict, gitBlobId } from "../support/m1-r1-remediation.mjs";
// A later layer (DE1, daily e-mail delivery) built on the R1 commit: R1G-01 then verifies the R1 commit from git objects, and the
// HEAD / index / checkout identity is held by the layer's own guard (test/delivery/de1-daily-email-guard.test.mjs DE1G-01).
import { isDE1Tree, DE1_PARENT } from "../support/de1-daily-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
const SKIP = !isM1R1Tree(REPO) && "not an M1 R1 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const R1_MODIFIED = Object.keys(M1_R1_PINS).filter((f) => !M1_R1_NEW_FILES.includes(f)).sort();

test("R1G-01 the R1 change set relative to the rejected parent is exactly the recorded set; committed / staged / checked-out bytes are the effective pins", { skip: SKIP }, () => {
  assert.equal(M1_R1_PARENT, "8511d7b2d3e4c89659b1ae006f6bdb1e9670b826", "the R1 parent is the rejected M1 candidate");
  for (const [f, pin] of Object.entries(M1_R1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const layered = isDE1Tree(REPO);
  const R1_TREE = layered ? DE1_PARENT : "HEAD";            // the R1 commit itself when a later layer is checked out
  const committed = lines(gitIn(REPO, ["diff", "--name-only", M1_R1_PARENT, R1_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!layered) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", M1_R1_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", M1_R1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(M1_R1_PINS).sort(), label + ": protected changes vs the rejected parent = the recorded R1 set");
  const eff = layered ? m1R1Pins() : m1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), [...new Set([...Object.keys(M1_PINS.blobs), ...Object.keys(M1_R1_PINS)])].sort());
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R1_TREE + ":" + f), pin, f + " committed" + (layered ? " (at the R1 commit)" : ""));
    if (layered) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("R1G-02 provenance: each R1 pin is the parent's M1 bytes + exactly the recorded edits; new files are absent at the parent", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(M1_R1_EDITS).sort(), R1_MODIFIED, "edits are recorded for exactly the modified files");
  for (const f of R1_MODIFIED) {
    assert.equal(blobId(`${M1_R1_PARENT}:${f}`), M1_PINS.blobs[f], f + ": the parent bytes are the M1 pin");
    const d = deriveR1(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), M1_R1_PINS[f], f + " = parent + recorded R1 edits");
  }
  for (const f of M1_R1_NEW_FILES) {
    assert.equal(blobId(`${M1_R1_PARENT}:${f}`), null, f + " is new in R1");
    assert.equal(M1_PINS.blobs[f], undefined, f + " has no M1 pin");
  }
});

test("R1G-03 boundedness: R1 changes only the registry decision (two server consumers, the page registry rule, the shared module)", { skip: SKIP }, () => {
  assert.deepEqual(R1_MODIFIED, ["api/admin.js", "index.html", "lib/finance/costHistoryWriter.js"]);
  assert.deepEqual([...M1_R1_NEW_FILES], ["lib/businessRegistry.js"]);
  for (const f of R1_MODIFIED) for (const [k, e] of M1_R1_EDITS[f].entries())
    assert.match(e.from + e.to, /[Rr]egistry/, `${f} edit #${k} is a registry edit`);
  // the page edits stay inside the C1 seam, between the READ_FAILED sentinel and the ledger chunker (the binding helpers)
  const page = readFileSync(join(REPO, "index.html"), "utf8"), lo = page.indexOf("    var READ_FAILED = Object.freeze("), hi = page.indexOf("    function ledgerChunks(F, from, to) {");
  assert.ok(lo > 0 && hi > lo);
  for (const e of M1_R1_EDITS["index.html"]) { const at = page.indexOf(e.to); assert.ok(at > lo && at + e.to.length < hi, "page edit inside the binding helpers"); }
  // the Core writer's and the P1 route's ONLY registry reads are the shared predicate
  for (const f of ["lib/finance/costHistoryWriter.js", "api/admin.js"]) {
    const src = readFileSync(join(REPO, f), "utf8");
    assert.ok(src.includes("readRegistryTarget(db, tenantId, bizId)"), f + " uses the shared predicate");
  }
  assert.ok(!/app\/business`\)\.get\(\)/.test(readFileSync(join(REPO, "lib/finance/costHistoryWriter.js"), "utf8")), "no inline Core registry read");
  const admin = readFileSync(join(REPO, "api/admin.js"), "utf8"), fn = admin.slice(admin.indexOf("async function scRequireRegisteredBusiness("), admin.indexOf("async function scAccess("));
  assert.ok(fn.length > 0 && !/JSON\.parse|app\/business/.test(fn), "no inline P1 registry parse");
});

test("R1G-04 non-vacuity: changed anchors, dropped or altered edits, the parent page and either input page are refused", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(M1_R1_EDITS)); fn(e[f]); return e; };
  for (const f of R1_MODIFIED) {
    assert.equal(deriveR1(REPO, f, tamper(f, (l) => { l[0].from = l[0].from + "\u0000"; })).reason, "edit_anchor_not_unique", f + ": changed anchor");
    const dropped = deriveR1(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== M1_R1_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveR1(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== M1_R1_PINS[f], f + ": an altered edit is not the pin");
  }
  const parentPage = bytesOf(`${M1_R1_PARENT}:index.html`);
  assert.equal(m1EffectivePageVerdict(REPO, parentPage).reason, "not_the_recorded_derivation", "the unremediated M1 page is refused on the R1 tree");
  assert.equal(m1EffectivePageVerdict(REPO, bytesOf(`${M1_CORE_COMMIT}:index.html`)).ok, false, "Core page alone");
  assert.equal(m1EffectivePageVerdict(REPO, bytesOf(`${M1_P1_COMMIT}:index.html`)).ok, false, "P1 page alone");
  const half = applyR1Edits("index.html", parentPage, { "index.html": M1_R1_EDITS["index.html"].slice(0, 1) });
  assert.ok(half.ok); assert.equal(m1EffectivePageVerdict(REPO, half.bytes).ok, false, "the helper without its use is refused");
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true }, "positive control");
});

/** relative static imports reachable from `entry` (ESM `import … from "./x.js"`), repository paths */
function importClosure(entry) {
  const seen = new Set(), stack = [entry];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(join(REPO, f), "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      const p = normalize(join(dirname(f), m[1])); if (existsSync(join(REPO, p))) stack.push(p);
    }
  }
  return seen;
}
test("R1G-05 the shared predicate is in the import closure of both server consumers' routes", { skip: SKIP }, () => {
  for (const route of ["api/admin.js", "api/cost-history.js"]) assert.ok(importClosure(route).has("lib/businessRegistry.js"), route + " → lib/businessRegistry.js");
  assert.ok(importClosure("api/cost-history.js").has("lib/finance/costHistoryWriter.js"));
});
