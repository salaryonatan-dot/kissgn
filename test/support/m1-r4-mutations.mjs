// Run explicitly: node test/support/m1-r4-mutations.mjs <absolute log directory> [--emulator] [mutant-id]
// M1 R4 remediation — behavioural sensitivity of the R4 changes (review findings A1 / A2 / S1 / S2) and of the valid-data /
// legitimate-onboarding controls they must keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git,
// so no identity / pin / scope guard can count as the catch (the R4G / R3G / R2G / B2G guards skip or are not run). A
// COMMITTED behavioural test must report `not ok` with a non-zero exit; a syntax / compile failure is never counted. With
// --emulator, the mutants that carry emulator expectations are also run through test/emulator/m1-r4-integration-emulator.mjs
// on the local RTDB emulator (own-PID runner) and are DETECTED there only when one of the listed R4E cases FAILS.
// No network, no hosted access, no e-mail.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const out = args[0], emulator = args.includes("--emulator"), only = args.slice(1).find((a) => !a.startsWith("--"));
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const EP = "api/analytics/daily-builder.ts", NIGHT = "src/analytics/dailyBuilder.ts", PAGE = "index.html", ADMIN = "api/admin.js";
const IP = "test/analytics/m1-r4-identity-parity.test.mjs", RO = "test/analytics/m1-r4-run-outcome.test.mjs";
const SA = "test/finance/m1-r4-setup-add-only.test.mjs", BS = "test/security/m1-r4-bootstrap-self.test.mjs";
const NR3 = "test/analytics/m1-r3-nightly-registry.test.mjs", PR3 = "test/finance/m1-r3-page-registry.test.mjs", RMX = "test/analytics/m1-r3-registry-matrix.test.mjs";
const CLAIM_TXN = "    const r = await db.ref(`tenants/${tenantId}`).transaction((cur) => (cur === null || cur === undefined ? claim : undefined));";
const R3_UPDATE = "    await db.ref().update({ [`tenants/${tenantId}/roles/${uid}`]: \"super_owner\", [`tenants/${tenantId}/members/${uid}`]: true, [`tenants/${tenantId}/access_meta/owner_guard`]: claim.access_meta.owner_guard });";

// [id, defect class, file, [[from, to], …], unit suites, emulator R4E cases expected to FAIL]
const cases = [
  // ── A1: registered exact identities handled differently across nightly / rebuild / backfill ──
  ["a1-endpoint-regex-restored", "rebuild / backfill refuse registered exact ids (the R3 [A-Za-z0-9_-] + no-padding rule)", EP,
    [["  return isRegistryBizId(value);\n}", "  return typeof value === \"string\" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && value === value.trim();\n}"]], [IP, RMX], []],
  ["a1-nightly-padding-refused", "the nightly run refuses a padded registered id (the R3 business_id_not_exact rule)", NIGHT,
    [["  return isRegistryBizId(id);\n}", "  return isRegistryBizId(id) && id === id.trim();\n}"]], [IP, NR3, RMX], []],
  ["a1-nightly-business-trimmed", "discovery trims a business id into another business's id", NIGHT,
    [["    const b = bizId;\n", "    const b = bizId.trim();\n"]], [IP, NR3], []],
  ["a1-nightly-tenant-trimmed", "discovery trims a tenant key into ANOTHER tenant", NIGHT,
    [["    const t = tenantId;\n", "    const t = tenantId.trim();\n"]], [IP], []],
  ["a1-endpoint-tenant-regex-restored", "rebuild / backfill keep the narrower tenant rule than Core / P1", EP,
    [["  return isValidId(value);\n}", "  return typeof value === \"string\" && /^[A-Za-z0-9_-]{1,128}$/.test(value);\n}"]], [IP], []],
  // ── A2: a run with failures reported as completed ──
  ["a2-outcome-always-completed", "a run with failures labelled completed", NIGHT,
    [["  if (failureCount === 0) return \"completed\";", "  if (failureCount >= 0) return \"completed\";"]], [RO, NR3, RMX], []],
  ["a2-http-200-always", "a failed / partial run answered HTTP 200 (the R3 status)", EP,
    [["      return res.status(outcome === \"completed\" && recorded ? 200 : 500).json({", "      return res.status(200).json({"]], [RO, NR3, RMX], []],
  ["a2-insights-failure-counted-success", "a failed insights persistence counted as a built business", NIGHT,
    [["      if (insightsSaved !== false) docs.push(doc);\n      else failures.push({ tenantId, bizId, error: \"insights_persist_failed\" });", "      docs.push(doc);"]], [RO], []],
  ["a2-index-failure-silent", "a failed index read is a clean discovery", NIGHT,
    [["    reportRegistryFailure({ tenantId: null, bizId: null, error: \"business_index_read_failed\" });\n", ""]], [RO], []],
  ["a2-run-record-assumed", "an unrecorded run reported as recorded (HTTP 200)", EP,
    [["      const runRecord = recorded ? \"recorded\" : \"write_failed\";", "      const runRecord = \"recorded\";"], ["outcome === \"completed\" && recorded ? 200 : 500", "outcome === \"completed\" ? 200 : 500"]], [RO], []],
  ["a2-run-record-overwrites-later", "an earlier invocation overwrites the later invocation's state", NIGHT,
    [["      if (!current || Number(current.invocation) === invocation) next.current", "      next.current"]], [RO], []],
  ["a2-run-failures-collapsed", "a failed index read hides a failed tenants read (run-level failures collapsed)", NIGHT,
    [["x.bizId === f.bizId && (f.tenantId !== null || x.error === f.error))", "x.bizId === f.bizId)"]], [RO], []],
  ["a2-backfill-insights-ignored", "a backfill with failed insights answered success", EP,
    [["      if (insightsSaved === false) {", "      if (false) {"]], [RO], []],
  // ── S1: creation replaces an existing business on an id collision ──
  ["s1-cas-replaces-on-collision", "the setup CAS replaces a same-id record (the R3 filter + concat)", PAGE,
    [["      if (registryIdTaken(view.list, record.id)) return { ok: false, reason: \"registry_id_collision\" };\n      return { ok: true, value: { _v: JSON.stringify(view.list.concat([record])) } };",
      "      return { ok: true, value: { _v: JSON.stringify(view.list.filter(function (b) { return !(b !== null && typeof b === \"object\" && b.id === record.id); }).concat([record])) } };"]], [SA, PR3], ["R4E5"]],
  ["s1-collision-exact-only", "a trimmed / coerced spelling of a stored id is not a collision", PAGE,
    [["        if ((rec || eid !== undefined) && String(eid).trim() === want) return true;", "        if (rec && eid === id) return true;"]], [SA], []],
  ["s1-generated-id-not-fresh", "the generated id is not checked against the stored list", PAGE,
    [["      if (!registryIdTaken(list, base)) return base;", "      return base;"]], [SA], []],
  // ── S2: bootstrap authorization effects despite a refused setup ──
  ["s2-bootstrap-roles-only", "a role-less tenant holding data is claimable (the R3 bootstrap)", ADMIN,
    [[CLAIM_TXN, R3_UPDATE + "\n    const r = { committed: true };"]], [BS], ["R4E2", "R4E3"]],
  ["s2-bootstrap-check-then-write", "the empty-tenant check and the claim are not atomic", ADMIN,
    [[CLAIM_TXN, "    const cur0 = (await db.ref(`tenants/${tenantId}`).once(\"value\")).val();\n    let r = { committed: false };\n    if (cur0 === null || cur0 === undefined) { " + R3_UPDATE.trim() + " r = { committed: true }; }"]], [BS], ["R4E3"]],
  ["s2-resume-any-sole-owner", "an established sole owner is 'resumed' (its mapping rewritten)", ADMIN,
    [["    if (unmapped) {", "    if (keys.length === 1 && keys[0] === uid && roles[uid] === \"super_owner\") {"]], [BS], []],
  ["s2-client-proceeds-after-failed-bootstrap", "the page writes the business after a refused / failed bootstrap", PAGE,
    [["      return { proceed: false, reason: \"setup_bootstrap_failed\" };\n    }", "      return { proceed: true, owner: false };\n    }"],
     ["      if (status === 409 && body && body.error === \"tenant_has_data\") return { proceed: false, reason: \"setup_tenant_has_data\" };\n", ""]], [SA], []],
  ["s2-lost-ack-assumed-committed", "an unknown setup write outcome assumed committed", PAGE,
    [["        registryWrite = verdict === \"committed\" ? pending :", "        registryWrite = true ? pending :"]], [SA], []],
  ["s1-create-client-overwrites", "create-client writes over an existing tenant with the generated id", ADMIN,
    [["      const r = await db.ref(`tenants/${candidate}`).transaction((cur) => (cur === null || cur === undefined ? reservation : undefined));", "      const r = { committed: true };"]], [BS], ["R4E6"]],
  // ── controls: the valid data / legitimate onboarding the corrections must keep ──
  ["ctl-registered-exact-id-refused", "control: a registered exact id refused everywhere in analytics", EP,
    [["  return isRegistryBizId(value);\n}", "  return isRegistryBizId(value) && !/[ @]/.test(value);\n}"]], [IP, RMX], []],
  ["ctl-clean-run-500", "control: a clean run no longer HTTP 200", EP,
    [["outcome === \"completed\" && recorded ? 200 : 500", "500"]], [RO, NR3, RMX], []],
  ["ctl-legit-onboarding-refused", "control: an absent tenant can no longer be claimed", ADMIN,
    [[CLAIM_TXN, "    const r = { committed: false };"]], [BS], ["R4E1"]],
  ["ctl-add-business-refused", "control: the add-business setup of an existing tenant stops at the bootstrap answer", PAGE,
    [["      if (status === 409 && body && body.error === \"tenant_already_initialized\") return { proceed: true, owner: false };", ""]], [SA, PR3], []],
  ["ctl-fresh-id-addition-refused", "control: adding a fresh id beside existing records refused", PAGE,
    [["      if (registryIdTaken(view.list, record.id)) return", "      if (view.list.length > 0) return"]], [SA, PR3], ["R4E5"]],
  ["ctl-lost-ack-commit-discarded", "control: a committed setup whose acknowledgement was lost is abandoned", PAGE,
    [["        registryWrite = verdict === \"committed\" ? pending :", "        registryWrite = false ? pending :"]], [SA], []],
];

const result = [];
for (const [id, klass, file, edits, tests, emuCases] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `m1r4-mut-${id}-`));
  cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  if (existsSync(join(root, "test", "historical", ".deps"))) symlinkSync(join(root, "test", "historical", ".deps"), join(dir, "test", "historical", ".deps"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  let after = before, missing = false;
  for (const [from, to] of edits) { if (after.split(from).length !== 2) { missing = true; break; } after = after.replace(from, () => to); }
  if (missing || after === before) { result.push({ id, klass, verdict: "ANCHOR_MISSING" }); rmSync(dir, { recursive: true, force: true }); continue; }
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...tests], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 1500000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ - test\//.test(l));
  const syntax = /SyntaxError|wrapper compile\/import failed|Cannot find module/.test(tap) && notOk.every((l) => /SyntaxError/.test(l));
  const verdict = run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : "NOT_DETECTED";
  const r = { id, klass, file, tests, verdict, failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 140)) };
  if (emulator && emuCases.length) {
    const logs = join(out, `${id}-emulator`);
    const emu = spawnSync("bash", [join(root, "test", "support", "p1-r7-emu-run.sh"), dir, logs, "m1-r4-integration=test/emulator/m1-r4-integration-emulator.mjs"], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
    const log = existsSync(join(logs, "m1-r4-integration.log")) ? readFileSync(join(logs, "m1-r4-integration.log"), "utf8") : "";
    const failed = [...log.matchAll(/^FAIL (R4E\d+)/gm)].map((m) => m[1]);
    r.emulator = { expected: emuCases, failed, verdict: emu.status !== 0 && emuCases.some((c) => failed.includes(c)) ? "DETECTED" : "NOT_DETECTED" };
  }
  result.push(r);
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(44)} ${r.verdict.padEnd(14)} ${(r.failing || []).length} failing${r.emulator ? `  emulator ${r.emulator.verdict} [${r.emulator.failed.join(",")}]` : ""}`);
if (result.some((r) => r.verdict !== "DETECTED" || (r.emulator && r.emulator.verdict !== "DETECTED"))) process.exitCode = 1;
