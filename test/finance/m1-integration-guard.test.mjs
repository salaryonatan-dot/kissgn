// M1 integration candidate (LOCAL; pending independent Codex review) — the identity and provenance of the integrated tree.
//   M1G-01  the literal M1 pins cover EXACTLY the integrated protected runtime set, and the committed / staged / checked-out
//           bytes of every pinned file are the pin.
//   M1G-02  provenance: every pinned blob is (i) the Core/F1 R4 blob of a file only Core changed, (ii) the P1 R7 blob of a
//           file only P1 changed, (iii) the recorded 3-way derivation of a file both changed, or (iv) the deterministic
//           regeneration of fincore from the integrated sources. Nothing else.
//   M1G-03  combined Rules: the integrated Rules are EXACTLY the Core/F1 R4 Rules + the P1 legacy-credits denial, AND
//           EXACTLY the P1 R7 Rules + the F1 cost_history delta (the two reviewed deltas commute); the blob is the M1
//           candidate identity (not a deployment / canary pin); the approved deployment pin is unchanged.
//   M1G-04  the integrated page keeps both lines' reviewed invariants (m1-index-scope.mjs).
//   M1G-05  non-vacuity: a recorded resolution that drops either side, or a resolution applied to changed conflict sides,
//           is refused (by the page invariants, by the derivation binding, or by the pin).
// M1 R1 (successor of the REJECTED candidate): on an R1 tree the M1 pins are held at the rejected parent M1_R1_PARENT (git
// objects), and the tree under test is held to the M1 pins overlaid with the recorded R1 pins
// (test/finance/m1-r1-guard.test.mjs, R1G-01…05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { generate } from "../../tools/finance-core/gen-browser.mjs";
import { M1_CORE_COMMIT, M1_P1_COMMIT, M1_MERGE_BASE, M1_MERGED, M1_GENERATED, M1_PINS } from "../support/m1-integration-pin.mjs";
import { deriveMerged, mergeFile, M1_RESOLUTIONS } from "../support/m1-derivation.mjs";
import { m1PageVerdict } from "../support/m1-index-scope.mjs";
import { M1_R1_PARENT, isM1R1Tree, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import {
  APPROVED_FENCE_RULES_BLOB, F1_RULES_CANDIDATE_BLOB, P1_R2_RULES_BLOB, M1_INTEGRATION_RULES_BLOB,
  authorizedF1CostHistoryRulesDelta, authorizedLegacyCreditsDenialDelta, F1_COST_HISTORY_READ_PREFIX, F1_COST_HISTORY_WRITE_PREFIX,
} from "../support/rules-authorized-delta.mjs";
import { SERVER_READER_BASE } from "../support/server-reader-authorized-delta.mjs";

const B2_BASE = "6d54e36752a5e04891127e2f62c8ea2571c61511";
const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
// separately approved protected changes that keep their own B2G-05 checks (CD-M2 R1, P0 Scheduled Auth, C2-03 retirement)
const SEPARATELY_PINNED = ["lib/repositories/entryExceptionsRepo.js", "api/analytics/daily-builder.ts", "api/daily-snapshot/run.ts", "api/proactive/run.ts", "lib/entryDelta.js"];
const isM1 = gitIn(REPO, ["merge-base", "--is-ancestor", M1_CORE_COMMIT, "HEAD"]).status === 0 && gitIn(REPO, ["merge-base", "--is-ancestor", M1_P1_COMMIT, "HEAD"]).status === 0;
const SKIP = !isM1 && "not an M1 integration tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const hash = (buf) => { const r = gitIn(REPO, ["hash-object", "--stdin"], { input: buf }); assert.equal(r.status, 0); return r.stdout.trim(); };
const pins = M1_PINS.blobs;
// R1: the reviewed M1 tree is the rejected parent (git objects); otherwise HEAD (and its index / checkout) is the M1 tree.
const R1 = isM1 && isM1R1Tree(REPO);
const M1_TREE = R1 ? M1_R1_PARENT : "HEAD";

test("M1G-01 the literal M1 pins cover exactly the integrated protected runtime set; committed, staged and checked-out bytes are the pins", { skip: SKIP }, () => {
  for (const [f, pin] of Object.entries(pins)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const changed = gitIn(REPO, ["diff", "--name-only", B2_BASE, M1_TREE, "--"]).stdout.trim().split("\n").filter((f) => PROTECTED.test(f));
  assert.deepEqual(Object.keys(pins).sort(), changed.filter((f) => !SEPARATELY_PINNED.includes(f)).sort(), "M1 pins = the integrated protected runtime set");
  const core = gitIn(REPO, ["diff", "--name-only", B2_BASE, M1_CORE_COMMIT, "--"]).stdout.trim().split("\n").filter((f) => PROTECTED.test(f));
  const p1 = gitIn(REPO, ["diff", "--name-only", B2_BASE, M1_P1_COMMIT, "--"]).stdout.trim().split("\n").filter((f) => PROTECTED.test(f));
  assert.deepEqual([...new Set(changed)].sort(), [...new Set([...core, ...p1])].sort(), "the integrated protected set is exactly the union of both approved lines");
  for (const [f, pin] of Object.entries(pins)) {
    assert.equal(blobId(M1_TREE + ":" + f), pin, f + " committed" + (R1 ? " (at the R1 parent)" : ""));
    if (R1) continue;                                   // the R1 tree's index / checkout are held by R1G-01 (M1 ⊕ R1 pins)
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(hash(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("M1G-02 provenance: each pin is the Core-only blob, the P1-only blob, the recorded derivation, or the regeneration", { skip: SKIP }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "m1-fincore-"));
  const kinds = {};
  try {
    generate({ repo: REPO, outDir: tmp });              // R1 changes no src/ file: the integrated sources regenerate the M1 fincore
    for (const [f, pin] of Object.entries(pins)) {
      const c = blobId(`${M1_CORE_COMMIT}:${f}`), p = blobId(`${M1_P1_COMMIT}:${f}`), b = blobId(`${M1_MERGE_BASE}:${f}`);
      if (f.startsWith("fincore/v1/")) {
        const regen = join(tmp, f.slice("fincore/v1/".length));
        assert.ok(existsSync(regen), f + " is produced by the generator");
        assert.equal(hash(readFileSync(regen)), pin, f + " = deterministic regeneration from the integrated sources");
      }
      if (M1_MERGED.includes(f)) {
        assert.ok(c !== b && p !== b, f + " is changed on BOTH sides");
        const d = deriveMerged(REPO, f);
        assert.ok(d.ok, f + ": " + JSON.stringify(d));
        assert.equal(hash(d.bytes), pin, f + " = the recorded 3-way derivation");
        assert.ok(pin !== c && pin !== p, f + ": the derivation is neither input alone");
        kinds[f] = "derived";
      } else if (M1_GENERATED.includes(f)) {
        assert.ok(pin !== c && pin !== p, f + ": generated from merged sources, neither input alone");
        kinds[f] = "regenerated";
      } else if (pin === c) {
        assert.equal(p, b, f + ": Core-owned — P1 left it at the merge base");
        assert.notEqual(c, b, f + ": Core changed it");
        kinds[f] = "core";
      } else if (pin === p) {
        assert.equal(c, b, f + ": P1-owned — Core left it at the merge base");
        assert.notEqual(p, b, f + ": P1 changed it");
        kinds[f] = "p1";
      } else assert.fail(f + ": the pin has no recorded provenance");
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const count = (k) => Object.values(kinds).filter((v) => v === k).length;
  assert.deepEqual([count("core"), count("p1"), count("derived"), count("regenerated")], [8, 8, 8, 4], JSON.stringify(kinds));
  assert.deepEqual(Object.keys(M1_RESOLUTIONS).sort(), [...M1_MERGED].sort(), "every both-sides file has exactly one recorded derivation");
});

test("M1G-03 combined Rules: Core Rules + the exact P1 denial == P1 Rules + the exact F1 delta; candidate identity only; deployment pin unchanged", { skip: SKIP }, () => {
  const live = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
  const core = JSON.parse(bytesOf(`${M1_CORE_COMMIT}:database.rules.json`)), p1 = JSON.parse(bytesOf(`${M1_P1_COMMIT}:database.rules.json`));
  const base = JSON.parse(bytesOf(`${SERVER_READER_BASE}:database.rules.json`));
  assert.equal(blobId(`${M1_CORE_COMMIT}:database.rules.json`), F1_RULES_CANDIDATE_BLOB);
  assert.equal(blobId(`${M1_P1_COMMIT}:database.rules.json`), P1_R2_RULES_BLOB);
  assert.equal(pins["database.rules.json"], M1_INTEGRATION_RULES_BLOB);
  assert.deepEqual(authorizedLegacyCreditsDenialDelta(core, live), { ok: true }, "M1 = Core/F1 Rules + exactly the P1 legacy-credits denial");
  assert.deepEqual(authorizedF1CostHistoryRulesDelta(base, live), { ok: true }, "M1 = approved fence + exactly the F1 cost_history delta (+ the P1 denial the fence guard tolerates)");
  // the other order: strip the F1 prefixes from M1 → exactly the P1 Rules
  const head = "auth !== null && ( ";
  const stripped = JSON.parse(JSON.stringify(live)), d = stripped.rules.tenants["$tenantId"]["$dataKey"];
  assert.ok(d[".read"].startsWith(head + F1_COST_HISTORY_READ_PREFIX) && d[".write"].startsWith(head + F1_COST_HISTORY_WRITE_PREFIX));
  d[".read"] = head + d[".read"].slice((head + F1_COST_HISTORY_READ_PREFIX).length);
  d[".write"] = head + d[".write"].slice((head + F1_COST_HISTORY_WRITE_PREFIX).length);
  assert.deepEqual(stripped, p1, "M1 minus the F1 delta is exactly the P1 R7 Rules");
  // single-side Rules are refused as the integrated Rules
  assert.notDeepEqual(authorizedLegacyCreditsDenialDelta(core, core), { ok: true }, "Core Rules alone lack the P1 denial");
  assert.notDeepEqual(authorizedF1CostHistoryRulesDelta(base, p1), { ok: true }, "P1 Rules alone lack the cost_history delta");
  assert.ok(readFileSync(join(REPO, "test/emulator/database.rules.json")).equals(readFileSync(join(REPO, "database.rules.json"))), "emulator mirror byte-identical");
  assert.equal(APPROVED_FENCE_RULES_BLOB, "1e5dea2f9b1eac037c766b325b927c20285c0eec", "the approved deployment pin is unchanged");
  assert.notEqual(M1_INTEGRATION_RULES_BLOB, APPROVED_FENCE_RULES_BLOB, "the M1 Rules are NOT the approved deployment Rules (publication requires a separate approval)");
});

test("M1G-04 the integrated page keeps both approved lines' invariants and is exactly the recorded derivation", { skip: SKIP }, () => {
  if (R1) assert.deepEqual(m1PageVerdict(REPO, bytesOf(`${M1_R1_PARENT}:index.html`)), { ok: true }, "the R1 parent page is the M1 page");
  else assert.deepEqual(m1PageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true });
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true }, "the page under test satisfies the effective (M1, or M1 ⊕ recorded R1 edits) contract");
  assert.equal(m1PageVerdict(REPO, bytesOf(`${M1_CORE_COMMIT}:index.html`)).reason, "not_the_recorded_derivation");
  assert.equal(m1PageVerdict(REPO, bytesOf(`${M1_P1_COMMIT}:index.html`)).reason, "not_the_recorded_derivation");
});

/** the two sides of every conflict block of `file` (from git objects) */
function sidesOf(file) {
  const lines = mergeFile(REPO, file).bytes.toString("utf8").split("\n"), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< core")) continue;
    const ours = [], theirs = [];
    for (i++; !lines[i].startsWith("======="); i++) ours.push(lines[i]);
    for (i++; !lines[i].startsWith(">>>>>>> p1"); i++) theirs.push(lines[i]);
    out.push({ ours: ours.join("\n") + "\n", theirs: theirs.join("\n") + "\n" });
  }
  return out;
}
const withResolution = (file, k, resolution) => { const r = JSON.parse(JSON.stringify(M1_RESOLUTIONS)); r[file].blocks[k].resolution = resolution; return r; };

test("M1G-05 non-vacuity: dropping either side of any page conflict is refused by the page invariants; every one-sided resolution of any merged file leaves the pin", { skip: SKIP }, () => {
  const pageSides = sidesOf("index.html");
  assert.equal(pageSides.length, 3);
  for (let k = 0; k < 3; k++) for (const side of ["ours", "theirs"]) {
    const res = withResolution("index.html", k, pageSides[k][side]);
    const d = deriveMerged(REPO, "index.html", res);
    assert.ok(d.ok, "the altered resolution still applies to the bound sides");
    const v = m1PageVerdict(REPO, d.bytes, res);          // the derivation now MATCHES the altered bytes: only the invariants can refuse
    assert.equal(v.ok, false, `page block ${k + 1} resolved as ${side === "ours" ? "Core" : "P1"} only must violate an invariant`);
  }
  for (const f of M1_MERGED) {
    const sides = M1_RESOLUTIONS[f].conflicts ? sidesOf(f) : [];
    sides.forEach((s, k) => { for (const side of ["ours", "theirs"]) {
      const d = deriveMerged(REPO, f, withResolution(f, k, s[side]));
      assert.ok(d.ok);
      assert.notEqual(hash(d.bytes), pins[f], `${f} block ${k + 1} resolved one-sided (${side}) is not the pin`);
    } });
  }
});

test("M1G-06 a recorded resolution is bound to its exact conflict: changed sides, counts or blocks are refused", { skip: SKIP }, () => {
  const tamper = (fn) => { const r = JSON.parse(JSON.stringify(M1_RESOLUTIONS)); fn(r); return r; };
  assert.equal(deriveMerged(REPO, "index.html", tamper((r) => { r["index.html"].blocks[1].ours_sha256 = "0".repeat(64); })).reason, "conflict_sides_changed");
  assert.equal(deriveMerged(REPO, "index.html", tamper((r) => { r["index.html"].blocks[2].theirs_lines += 1; })).reason, "conflict_sides_changed");
  assert.equal(deriveMerged(REPO, "database.rules.json", tamper((r) => { r["database.rules.json"].conflicts = 0; })).reason, "conflict_count_changed");
  assert.equal(deriveMerged(REPO, "src/finance-server/canonicalInputs.ts", tamper((r) => { r["src/finance-server/canonicalInputs.ts"].blocks.pop(); })).reason, "unexpected_conflict_block");
  assert.equal(deriveMerged(REPO, "src/finance/labor.ts").reason, "no_recorded_derivation", "a one-sided file has no derivation");
});
