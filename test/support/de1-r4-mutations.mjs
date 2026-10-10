// Run explicitly: node test/support/de1-r4-mutations.mjs <absolute log directory> [mutant-id]
// Daily Email reliability R4 — behavioural sensitivity of the R4 change (the independent R3 review's blocking finding: a PRESENT
// but empty / null / unreadable field of a resolved provider result read as if it were absent) and of the controls it must
// keep, including exact re-anchors of the eight R3 mutants whose anchors R4 replaced (suffix -r4). Each mutant re-introduces
// one defect in a NEW disposable copy WITHOUT .git (no identity / pin / scope guard can count as the catch). A committed
// behavioural test must report `not ok` with a non-zero exit; a syntax failure is never counted. CONTROL is an exact no-op
// replacement: it must pass every suite. The R3 / R2 sweeps (test/support/de1-r3-mutations.mjs, de1-r2-mutations.mjs) are
// re-run separately.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2], only = process.argv[3];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const ED = "lib/emailDelivery.js";
const R4 = "test/delivery/de1-r4-remediation.test.mjs", R3 = "test/delivery/de1-r3-remediation.test.mjs", PC = "test/delivery/de1-r3-provider-contract.test.mjs", R2 = "test/delivery/de1-r2-remediation.test.mjs";
const R1 = "test/delivery/de1-r1-remediation.test.mjs", DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R4, R3, PC, R2, R1, DE, EU];
const FAIL = 'return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_recipient", responseCode: rc };';

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  // ── the R3 review blocker and its siblings (present but empty / null / unreadable read as absent) ──
  ["E2r4-empty-envelope-ignored", "a present EMPTY envelope.to is ignored (the R3 rule: only a non-empty mismatch counts)", ED,
    [["    if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);", "    if (envTo.length > 0 && (envTo.length !== 1 || envTo[0] !== want)) return inconsistent(rc);"]]],
  ["E2r4-envelope-to-optional", "a present envelope without `to` is treated as no envelope", ED,
    [["    if (envToRaw === undefined) return malformed(rc);    // the adapter always reports the envelope's recipients\n", "    if (envToRaw === undefined) {} else {\n"],
     ["    if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);   // empty, another or more than one recipient\n  }", "    if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);\n  }}"]]],
  ["E2r4-null-envelope-absent", "envelope: null is treated as absent", ED,
    [["  if (envelope !== undefined) {\n", "  if (envelope !== undefined && envelope !== null) {\n"]]],
  ["E2r4-unreadable-is-absent", "a throwing getter reads as absent (the safeRead semantics)", ED,
    [["    try { return obj[k]; } catch { return UNREADABLE; }", "    try { return obj[k]; } catch { return undefined; }"]]],
  ["E2r4-null-detail-skipped", "a null / non-object refusal detail is skipped", ED,
    [["        if (e === null || typeof e !== \"object\") return malformed(rc);", "        if (e === null || typeof e !== \"object\") continue;"]]],
  ["E2r4-detail-recipient-optional", "a refusal detail without a readable recipient is accepted as a detail", ED,
    [["        if (erc === null || who === null || who === \"\") return malformed(rc);", "        if (erc === null) return malformed(rc);"]]],
  ["E2r4-empty-details-confirm", "present but empty refusal details are treated as agreeing", ED,
    [["      if (details.length === 0) return inconsistent(rc);                 // present but empty refusal details\n", ""]]],
  ["E2r4-duplicate-accepted", "a repeated accepted recipient is accepted", ED,
    [["  if (accepted.length > 0 && !onlyWant(accepted)) return inconsistent(rc);", "  if (accepted.some((a) => a !== want)) return inconsistent(rc);"]]],
  ["E2r4-empty-address-entry", "an empty address entry is readable", ED,
    [["        if (n === null || n === \"\") return null;", "        if (n === null) return null;"]]],
  // ── re-anchors of the R3 mutants whose anchors R4 replaced ──
  ["E2r3-listed-rejection-is-refusal-r4", "a listed rejection is a refusal whatever the other fields say (the R2 rule)", ED,
    [["  if (isRejected) {\n    if (!onlyWant(rejected)) return inconsistent(rc);", "  if (isRejected) {\n    " + FAIL]]],
  ["E2r3-other-accepted-ignored-r4", "another accepted address is ignored", ED,
    [["  if (accepted.length > 0 && !onlyWant(accepted)) return inconsistent(rc);\n", ""]]],
  ["E2r3-other-rejected-with-refusal-r4", "a refusal beside another rejected address", ED,
    [["    if (!onlyWant(rejected)) return inconsistent(rc);", "    if (false) return inconsistent(rc);"]]],
  ["E2r3-refusal-details-ignored-r4", "refusal details that disagree are ignored", ED,
    [["      for (const d of details) if (d.recipient !== want || d.responseCode !== rc) return inconsistent(rc);", "      for (const d of []) if (d.recipient !== want || d.responseCode !== rc) return inconsistent(rc);"]]],
  ["E2r3-envelope-ignored-r4", "an envelope naming another recipient is ignored", ED,
    [["    if (envTo.length !== 1 || envTo[0] !== want) return inconsistent(rc);   // empty, another or more than one recipient\n", ""]]],
  ["E2r3-accepted-r2-rule-r4", "acceptance judged only against the recipient's rejection and a >=300 code (the R2 rule)", ED,
    [["    if (rejected.length > 0 || (details !== null && details.length > 0) || (rc !== null && !rc2xx)) return inconsistent(rc);", "    if (isRejected || (rc !== null && rc >= 300)) return inconsistent(rc);"]]],
  ["E2r3-details-shape-ignored-r4", "non-list refusal details are treated as absent", ED,
    [["      if (!Array.isArray(errsRaw) || errsRaw.length > MAX_LISTED) return malformed(rc);", "      if (!Array.isArray(errsRaw)) throw new Error(\"skip\"); if (errsRaw.length > MAX_LISTED) return malformed(rc);"],
     ["    } catch { return malformed(rc); }\n  }\n  // the envelope", "    } catch { details = null; }\n  }\n  // the envelope"]]],
  ["E2-contradiction-accepted-r4", "listed both ways ⇒ accepted (R2 mutant, re-anchored)", ED,
    [["    if (rejected.length > 0 || (details !== null && details.length > 0) || (rc !== null && !rc2xx)) return inconsistent(rc);", "    if ((rejected.length > 0 && !isRejected) || (details !== null && details.length > 0) || (rc !== null && !rc2xx)) return inconsistent(rc);"]]],
  // ── controls that must keep working ──
  ["K-rejection-unknown-r4", "control: a fully consistent refusal held as unknown", ED,
    [["    " + FAIL, "    return { outcome: \"unknown\", code: \"provider_rejected_recipient\", responseCode: rc };"]]],
  ["K-acceptance-unknown-r4", "control: a valid acceptance held as unknown", ED,
    [["    return { outcome: \"accepted\", responseCode: rc };", "    return { outcome: \"unknown\", code: \"provider_result_indeterminate\", responseCode: rc };"]]],
  ["K-envelope-acceptance-refused", "control: an acceptance with a matching envelope held as unknown", ED,
    [["  if (envelope !== undefined) {\n", "  if (envelope !== undefined) {\n    return inconsistent(rc);\n"]]],
  ["K-transport-refusal-unknown-r4", "control: the adapter's definite RCPT / DATA refusal held as unknown", ED,
    [["    if (reply.responseCode >= 500) return { outcome: \"failed\", retryable: false, inRunRetry: false, code: \"provider_rejected_\" + reply.responseCode };", "    if (reply.responseCode >= 500) return { outcome: \"unknown\", code: \"provider_rejected_\" + reply.responseCode };"]]],
];

const result = [];
for (const [id, klass, file, edits] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `de1r4-mut-${id}-`));
  cpSync(root, dir, { recursive: true, filter: (p) => ![".git", "node_modules", ".deps"].includes(p.split("/").at(-1)) });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  if (existsSync(join(root, "test", "historical", ".deps"))) symlinkSync(join(root, "test", "historical", ".deps"), join(dir, "test", "historical", ".deps"), "dir");
  const path = join(dir, file), before = readFileSync(path, "utf8");
  let after = before, missing = false;
  for (const [from, to] of edits) { if (after.split(from).length !== 2) { missing = true; break; } after = after.replace(from, () => to); }
  if (missing || (id !== "CONTROL" && after === before)) { result.push({ id, klass, verdict: "ANCHOR_MISSING" }); rmSync(dir, { recursive: true, force: true }); continue; }
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...SUITES], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, timeout: 900000 });
  const tap = run.stdout + run.stderr;
  writeFileSync(join(out, `${id}.tap`), tap);
  const notOk = (tap.match(/^not ok \d+ - .*/gm) || []).filter((l) => !/ # TODO/.test(l) && !/ - test\//.test(l));
  const syntax = /SyntaxError/.test(tap) && notOk.length === 0;
  const verdict = id === "CONTROL"
    ? (notOk.length === 0 && run.status === 0 ? "CLEAN" : "CONTROL_FAILED")
    : run.status !== 0 && notOk.length > 0 && !syntax ? "DETECTED" : syntax ? "SYNTAX (not counted)" : "NOT_DETECTED";
  result.push({ id, klass, file, verdict, failing: notOk.map((l) => l.replace(/^not ok \d+ - /, "").slice(0, 120)) });
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 1));
for (const r of result) console.log(`${r.id.padEnd(30)} ${r.verdict.padEnd(14)} ${(r.failing || []).length} failing  ${(r.failing || []).slice(0, 3).map((x) => x.slice(0, 14)).join(" | ")}`);
if (result.some((r) => (r.id === "CONTROL" ? r.verdict !== "CLEAN" : r.verdict !== "DETECTED"))) process.exitCode = 1;
