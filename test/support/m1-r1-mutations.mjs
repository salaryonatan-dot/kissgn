// Run explicitly: node test/support/m1-r1-mutations.mjs <absolute log directory> [mutant-id]
// M1 R1 remediation — behavioral sensitivity of the R1 changes. Each mutant reintroduces a defect (or weakens a guard) in a
// NEW disposable copy; a targeted COMMITTED test must report `not ok` with a non-zero exit. Registry / page mutants run in a
// copy WITHOUT .git (no identity or pin guard can count as the catch); the Git-output mutants need a repository (their
// targeted tests read the real diff), so they run in a `git clone --shared` of HEAD whose working tree carries the mutant.
// For those, a failure of GO-05 alone (the byte-identity of the VAT guard) is NOT counted: at least one behavioral GO test
// (GO-01…04) must fail. A syntax failure is never counted as detection.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2], only = process.argv[3];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const RR = "test/finance/m1-r1-registry.test.mjs", GO = "test/finance/m1-r1-vat-git-output.test.mjs", PB = "test/finance/m1-r1-page-credit-binding.test.mjs";
const REG = "lib/businessRegistry.js";
const parentOf = (f) => { const r = spawnSync("git", ["-C", root, "cat-file", "blob", "8511d7b2d3e4c89659b1ae006f6bdb1e9670b826:" + f], { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) throw new Error(f); return r.stdout; };
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("region " + a); return s.slice(i, j); };
// [id, file, from, to, tests, needsGit]
const cases = [
  // the shared predicate
  ["r1-unrelated-defect-fatal", REG, "    if (!isRecord(e) || !isRegistryBizId(id) || seen.has(id)) unrelatedDefects += 1;", "    if (!isRecord(e) || !isRegistryBizId(id) || seen.has(id)) return { state: \"unreadable\", reason: \"sibling\" };", [RR]],
  ["r1-collision-ignored", REG, "    if (identifiable && String(id).trim() === bizId.trim()) { collisions += 1; continue; }", "    if (false) { collisions += 1; continue; }", [RR]],
  ["r1-coercion-admits-target", REG, "    if (isRecord(e) && typeof id === \"string\" && id === bizId) { canonical += 1; continue; }", "    if (isRecord(e) && String(id) === bizId) { canonical += 1; continue; }", [RR]],
  ["r1-trim-collision-ignored", REG, "String(id).trim() === bizId.trim()", "String(id) === bizId", [RR]],
  ["r1-duplicate-target-accepted", REG, "  if (canonical > 1) return", "  if (false) return", [RR]],
  ["r1-unreadable-as-not-registered", REG, "  if (!d.ok) return { state: \"unreadable\", reason: d.reason };", "  if (!d.ok) return { state: \"not_registered\" };", [RR]],
  ["r1-colon-id-allowed", REG, " && !v.includes(\":\");", ";", [RR]],
  // the two server consumers
  ["r1-p1-local-strict-validator-restored", "api/admin.js", null, null, [RR, "test/finance/p1-r3-contract.test.mjs"], false,
    (s) => s.replace(between(s, "// M1 R1: the registry decision is the SHARED", "async function scAccess("), between(parentOf("api/admin.js"), "// P1-local registry boundary.", "async function scAccess("))],
  ["r1-core-coercing-validator-restored", "lib/finance/costHistoryWriter.js", null, null, [RR], false,
    (s) => s.replace(between(s, "export async function requireBusinessInTenant(", "const registryStatus ="), between(parentOf("lib/finance/costHistoryWriter.js"), "export async function requireBusinessInTenant(", "const registryStatus ="))],
  ["r1-core-ambiguous-definitive", "lib/finance/costHistoryWriter.js", "  if (t.state === \"ambiguous\") throw { status: 503, msg: \"business registry ambiguous\" };", "  if (t.state === \"ambiguous\") throw { status: 403, msg: \"business_not_in_tenant\" };", [RR]],
  ["r1-p1-ambiguous-definitive", "api/admin.js", "  if (t.state === \"ambiguous\") throw { status: 503, msg: \"business_registry_ambiguous\" };", "  if (t.state === \"ambiguous\") throw { status: 403, msg: \"business_not_in_tenant\" };", [RR]],
  // the page's registry rule
  ["r1-page-coercing-rule-restored", "index.html", "      var registered = registryTargetRegistered(businesses, currentBizId);", "      var registered = Array.isArray(businesses) && businesses.some(function (b) { return !!b && String(b.id) === currentBizId; });", [RR]],
  // the page's credit binding reachability invariant
  ["pb-demo-invalidation-dropped", "index.html", "            invalidateSelection(window._currentTenantId == null ? null : window._currentTenantId, \"demo_biz\"); // R3: raw setter must not bypass synchronous invalidation\n", "", [PB]],
  // the Git-output path of the S0 VAT guard (the shared helper test/support/git-context.mjs; the guard itself is unchanged)
  ["go-subprocess-error-ignored", "test/support/git-context.mjs", "  if (r.error) {", "  if (false) {", [GO], true],
  ["go-explicit-bound-dropped", "test/support/git-context.mjs", "maxBuffer: GIT_OUTPUT_LIMIT, ...opts", "...opts", [GO], true],
  ["go-vat-pattern-weakened", "test/finance/vat-invariant.test.mjs", "|_rtdbSet|storage\\.set|", "|_rtdbSet|", [GO], true],
  ["go-vat-pattern-migrate-dropped", "test/finance/vat-invariant.test.mjs", "(?:migration|migrate|", "(?:migration|", [GO], true],
];
const result = [];
for (const [id, file, from, to, tests, needsGit, fn] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `m1r1-mut-${id}-`));
  if (needsGit) {
    rmSync(dir, { recursive: true, force: true });
    const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    if (spawnSync("git", ["clone", "-q", "--shared", "--no-checkout", root, dir]).status !== 0 || spawnSync("git", ["-C", dir, "checkout", "-q", "--detach", head]).status !== 0) throw new Error("clone");
  } else cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  let after;
  if (fn) after = fn(before);
  else { if (before.split(from).length !== 2) { result.push({ id, verdict: "ANCHOR_MISSING" }); continue; } after = before.replace(from, () => to); }
  if (after === before) { result.push({ id, verdict: "ANCHOR_MISSING" }); continue; }
  writeFileSync(path, after);
  // a Git-copy mutant is COMMITTED in its disposable clone, so nested clones made by the targeted tests (GO-03) carry it too
  if (needsGit && spawnSync("git", ["-C", dir, "-c", "user.name=mutant", "-c", "user.email=mutant@x", "commit", "-qam", "mutant " + id]).status !== 0) throw new Error("commit " + id);
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ - test\/finance\//.test(l) && !/ - GO-05 /.test(l));
  const syntax = /SyntaxError/.test(tap);
  const verdict = run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : "NOT_DETECTED";
  result.push({ id, file, tests, gitCopy: !!needsGit, verdict, failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 140)) });
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(40)} ${r.verdict}  ${(r.failing || []).length} failing`);
if (result.some((r) => r.verdict !== "DETECTED")) process.exitCode = 1;
