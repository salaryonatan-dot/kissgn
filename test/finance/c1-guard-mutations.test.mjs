// WP-C1 — guard changes: the C1 consumer allowlist (G-B2) and the C1 index.html contract used by
// B2G-05 (test/support/c1-index-scope.mjs), with negative controls proving that unrelated edits
// stay detectable. The APPROVED page is read from git objects (the release-assembly commit), never
// from the working tree; the committed-clone variants live in b2-guard-mutations.test.mjs (M5/M6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { importerVerdict, loadConsumerFiles, repoKindOf, validateConsumerFiles } from "../support/b1-fixtures.mjs";
import { C1_ASSEMBLY, C1_PROTECTED, C1_ZONES, c1IndexVerdict, diffHunks } from "../support/c1-index-scope.mjs";
import { C1_INDEX_PIN } from "../support/c1-candidate-pin.mjs";

const approved = (() => { const r = gitIn(REPO, ["cat-file", "blob", C1_ASSEMBLY + ":index.html"], { encoding: "buffer" }); assert.equal(r.status, 0); return r.stdout.toString("utf8"); })();
const candidate = readFileSync(join(REPO, "index.html"), "utf8");
const once = (src, from, to) => { assert.equal(src.split(from).length, 2, "mutation anchor unique: " + from.slice(0, 70)); return src.replace(from, to); };
const reason = (b) => c1IndexVerdict(approved, b).reason;

test("C1G-01 consumer allowlist: c1.json lists exactly index.html; the page is a listed core consumer; mutants fail", () => {
  const files = loadConsumerFiles(REPO);
  const c1 = files.find((f) => f.name === "c1.json");
  assert.deepEqual(c1.json, { slice: "C1", consumers: ["index.html"] });
  const v = validateConsumerFiles(files, repoKindOf(REPO));
  assert.deepEqual(v.errors, []);
  assert.deepEqual(importerVerdict({ "index.html": candidate }, v).unlistedCore, []);
  const without = validateConsumerFiles(files.filter((f) => f.name !== "c1.json"), repoKindOf(REPO));
  assert.deepEqual(importerVerdict({ "index.html": candidate }, without).unlistedCore, ["index.html"], "without c1.json the page is an unlisted consumer");
  const clone = () => files.map((f) => ({ name: f.name, json: JSON.parse(JSON.stringify(f.json)) }));
  const mut = (fn) => { const fs = clone(); fn(fs.find((f) => f.name === "c1.json").json, fs); return validateConsumerFiles(fs, repoKindOf(REPO)).errors; };
  assert.ok(mut((j) => j.consumers.push("src/snapshot/snapshotEmail.ts")).some((e) => /duplicate/.test(e)), "a B2 file claimed by C1");
  assert.ok(mut((j) => { j.consumers = ["*.html"]; }).some((e) => /glob/.test(e)));
  assert.ok(mut((j, fs) => { fs.find((f) => f.name === "b2.json").json.consumers.push("index.html"); }).some((e) => /index\.html may be listed only by a slice >= C1|duplicate/.test(e)), "B2 may not list the page");
});

test("C1G-02 the contract anchors: every zone and protected anchor is unique in the APPROVED page; every protected region lies inside a zone", () => {
  for (const [name, s] of C1_ZONES) assert.equal(approved.split(s).length, 2, "zone anchor unique: " + name);
  for (const [name, s] of C1_PROTECTED) {
    assert.equal(approved.split(s).length, 2, "protected anchor unique (approved): " + name);
    assert.equal(candidate.split(s).length, 2, "protected anchor unique (candidate): " + name);
  }
});

test("C1G-03 positive control: the C1 candidate satisfies the contract, and every one of its changed hunks lies in a named zone", () => {
  assert.deepEqual(c1IndexVerdict(approved, candidate), { ok: true });
  assert.ok(diffHunks(approved, candidate).length > 50, "the candidate is a real migration, not a no-op");
});

test("C1G-04 not tautological: the approved page compared with itself FAILS (the contract requires the C1 bootstrap and seam)", () => {
  assert.equal(reason(approved), "fincore_bootstrap_shape");
});

test("C1G-05 negative controls OUTSIDE the zones are detected (HF-1, CD-M2 closure panel, storage transport, CSP, P0 seams, unrelated screens, trailing edit)", () => {
  const cases = [
    ["HF-1 config preservation", "// ── HF-1: Setup Wizard config preservation", "// ── HF-1: Setup Wizard config preservation (x)"],
    ["CD-M2 closure panel", '{/* CD-M2: explicit "Business closed" action', '{/* CD-M2 (x): explicit "Business closed" action'],
    ["storage transport", "    window.storage.subscribeNode = (key, callback, onError) => {", "    window.storage.subscribeNode = (key, callback, onError, x) => {"],
    ["CSP meta", "default-src 'self'; script-src 'self'", "default-src 'self'; script-src 'self' https://evil.example"],
    ["P0 entries identity seam", "// ── P0-DATA-01: canonical daily-entries identity", "// ── P0-DATA-01 (x): canonical daily-entries identity"],
    ["petty cash screen", "  const fmtPetty = (n) => '₪' + (Number(n) || 0)", "  const fmtPetty = (n) => '₪ ' + (Number(n) || 0)"],
    ["v1 forecast mirror (E-owned)", 'FORMULA_ID:"REV_FORECAST/v1"', 'FORMULA_ID:"REV_FORECAST/v1x"'],
  ];
  for (const [label, from, to] of cases) assert.equal(reason(once(candidate, from, to)), "change_outside_c1_zones", label);
  assert.equal(reason(candidate + "\n<!-- trailing -->\n"), "change_outside_c1_zones", "a trailing edit");
});

test("C1G-06 negative controls INSIDE the zones: protected write regions and write calls are detected", () => {
  const prot = [
    ["setSupPayDate", "              const token = supplierResultOwnershipRef.current.begin(captureSelectionCtx());", "              const token = supplierResultOwnershipRef.current.begin(null);"],
    ["history clear-all", "                  const __res = await entriesWriteCoordRef.current.submitClearAll({", "                  const __res = await entriesWriteCoordRef.current.submitClearAll({ force: true,"],
    ["duplicate collection", "	                  if(!head || head._idx === i) return;", "	                  if(!head) return;"],
    ["openEntry edit identity", "		                    setEditingId(isMissing ? null : i);", "		                    setEditingId(i);"],
    ["setDailyLabor", '    if (st === "committed" || st === "committed_idempotent") { setLaborSaveError(""); return res; }', '    if (st) { setLaborSaveError(""); return res; }'],
    ["employee save", "      : [...employees, {...form, id:Date.now(), type:\"global\"}];", "      : [...employees, {...form, id:Date.now(), type:\"hourly\"}];"],
  ];
  for (const [label, from, to] of prot) assert.match(reason(once(candidate, from, to)), /protected_region_changed|write_path_lines_changed/, label);
  assert.equal(reason(once(candidate, "            const dv = finDash;", "            const dv = finDash; saveBusinessConfig({ ...businessConfig });")), "write_path_lines_changed", "a write call added in the dashboard zone");
  assert.equal(reason(once(candidate, "  const finImpact = React.useMemo(", "  persistFixed([], null); const finImpact = React.useMemo(")), "write_path_lines_changed", "a write call added in the finance-inputs zone");
  assert.equal(reason(once(candidate, '      const mod = await import("/fincore/v1/browser/marjinFinanceGlobal.js");', "      const mod = { default: window.MarjinFinance };")), "fincore_import_shape", "bootstrap import replaced");
  assert.equal(reason(once(candidate, "  // ── C1 browser financial view models", "  // ── view models")), "c1_seam_shape", "seam marker removed");
});

test("C1G-07 scope layer, by design: a non-protected edit INSIDE a zone is accepted by the SCOPE contract alone; content identity is the separate C1_INDEX_PIN layer of B2G-05 (B2G-05-M6/M7)", () => {
  assert.deepEqual(c1IndexVerdict(approved, once(candidate, '<div className="chart-label">הכנסות יומיות</div>', '<div className="chart-label">הכנסות</div>')), { ok: true });
});

test("C1G-08 identity layer: the pinned C1 blob is a fixed literal equal to the candidate page, and every in-zone mutation (label, financial calculation) changes the blob, so B2G-05 refuses it", () => {
  assert.match(C1_INDEX_PIN.blob, /^[0-9a-f]{40}$/);
  assert.match(C1_INDEX_PIN.status, /pending independent review/);
  const blobOf = (buf) => { const r = spawnSync("git", ["hash-object", "--stdin"], { input: buf, encoding: "utf8" }); assert.equal(r.status, 0); return r.stdout.trim(); };
  assert.equal(blobOf(candidate), C1_INDEX_PIN.blob, "candidate index.html is the pinned blob");
  const fin = once(candidate, "var target = D(F).serializeRat(D(F).ratMul(amt(F, lySales), growthFactor));", 'var target = "1";');
  assert.deepEqual(c1IndexVerdict(approved, fin), { ok: true }, "scope alone accepts the financial mutation");
  assert.notEqual(blobOf(fin), C1_INDEX_PIN.blob, "the identity pin refuses it");
  // the pin is a source literal, not derived from HEAD or the working tree at run time
  const pinSrc = readFileSync(new URL("../support/c1-candidate-pin.mjs", import.meta.url), "utf8");
  assert.ok(!/rev-parse|hash-object|readFileSync|execSync|spawnSync/.test(pinSrc), "pin module computes nothing");
});
