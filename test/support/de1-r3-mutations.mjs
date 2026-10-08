// Run explicitly: node test/support/de1-r3-mutations.mjs <absolute log directory> [mutant-id]
// Daily Email reliability R3 — behavioural sensitivity of the R3 change (the independent R2 review's blocking finding: a
// contradictory resolved provider result recorded as a definite refusal) and of the controls it must keep, including exact
// re-anchors of the four R2 mutants whose anchors R3 replaced (E2-not-listed-is-refusal, E2-contradiction-accepted,
// K-rejection-unknown, K-acceptance-unknown). Each mutant
// re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin / scope guard can count as the catch). A
// committed behavioural test must report `not ok` with a non-zero exit; a syntax failure is never counted. CONTROL is an exact
// no-op replacement: it must pass every suite. The R2 sweep (test/support/de1-r2-mutations.mjs) is re-run separately.
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
const R3 = "test/delivery/de1-r3-remediation.test.mjs", PC = "test/delivery/de1-r3-provider-contract.test.mjs", R2 = "test/delivery/de1-r2-remediation.test.mjs";
const R1 = "test/delivery/de1-r1-remediation.test.mjs", DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R3, PC, R2, R1, DE, EU];
const FAIL = 'return { outcome: "failed", retryable: false, inRunRetry: false, code: "provider_rejected_recipient", responseCode: rc };';

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  // ── the R2 review blocker and its siblings ──
  ["E2r3-listed-rejection-is-refusal", "a listed rejection is a refusal whatever the other fields say (the R2 rule)", ED,
    [["  if (isRejected) {\n    if (otherRejected || accepted.length > 0) return inconsistent(rc);", "  if (isRejected) {\n    " + FAIL]]],
  ["E2r3-250-reply-refusal", "a rejection beside a 2xx/3xx end-of-DATA reply is a refusal", ED,
    [["    if (!rcNegative) return inconsistent(rc);   // e.g. rejected beside the 250 end-of-DATA reply: impossible for one recipient\n", ""]]],
  ["E2r3-codeless-refusal", "a rejection without any reply code is a refusal", ED,
    [["    if (rc === null) return { outcome: \"unknown\", code: \"provider_result_incomplete\", responseCode: null };", "    if (rc === null) " + FAIL]]],
  ["E2r3-other-accepted-ignored", "another accepted address is ignored", ED,
    [["  if (otherAccepted) return inconsistent(rc);\n", ""]]],
  ["E2r3-other-rejected-with-refusal", "a refusal beside another rejected / accepted address", ED,
    [["    if (otherRejected || accepted.length > 0) return inconsistent(rc);", "    if (false) return inconsistent(rc);"]]],
  ["E2r3-refusal-details-ignored", "refusal details that disagree are ignored", ED,
    [["    for (const e of rejectedErrors)\n", "    for (const e of [])\n"]]],
  ["E2r3-envelope-ignored", "an envelope naming another recipient is ignored", ED,
    [["    if (envTo.length > 0 && (envTo.length !== 1 || envTo[0] !== want)) return inconsistent(rc);\n", ""]]],
  ["E2r3-accepted-r2-rule", "acceptance judged only against the recipient's rejection and a >=300 code (the R2 rule)", ED,
    [["    if (isRejected || otherRejected || rejectedErrors.length > 0 || (rc !== null && !rc2xx)) return inconsistent(rc);", "    if (isRejected || (rc !== null && rc >= 300)) return inconsistent(rc);"]]],
  ["E2r3-malformed-reply-ignored", "a present but code-less reply text is treated as absent", ED,
    [["  if (response !== undefined && rc === null) return malformed(null);\n", ""]]],
  ["E2r3-details-shape-ignored", "non-list refusal details are treated as absent", ED,
    [["      if (!Array.isArray(errs) || errs.length > MAX_LISTED) return malformed(rc);", "      if (!Array.isArray(errs)) throw new Error(\"skip\"); if (errs.length > MAX_LISTED) return malformed(rc);"],
     ["    } catch { return malformed(rc); }\n  }\n  // the envelope", "    } catch { rejectedErrors = []; }\n  }\n  // the envelope"]]],
  // ── re-anchors of the R2 mutants whose anchors R3 replaced ──
  ["E2-not-listed-is-refusal-r3", "recipient listed nowhere ⇒ definitive refusal (the R1 rule; R2 mutant, re-anchored)", ED,
    [["  return { outcome: \"unknown\", code: \"provider_result_indeterminate\", responseCode: rc };\n}", "  " + FAIL + "\n}"]]],
  ["E2-contradiction-accepted-r3", "listed both ways ⇒ accepted (R2 mutant, re-anchored)", ED,
    [["    if (isRejected || otherRejected || rejectedErrors.length > 0 || (rc !== null && !rc2xx)) return inconsistent(rc);", "    if (otherRejected || rejectedErrors.length > 0 || (rc !== null && !rc2xx)) return inconsistent(rc);"]]],
  // ── controls that must keep working ──
  ["K-rejection-unknown-r3", "control: a fully consistent refusal held as unknown (R2 K-rejection-unknown, re-anchored)", ED,
    [["    " + FAIL, "    return { outcome: \"unknown\", code: \"provider_rejected_recipient\", responseCode: rc };"]]],
  ["K-acceptance-unknown-r3", "control: a valid acceptance held as unknown (R2 K-acceptance-unknown, re-anchored)", ED,
    [["    return { outcome: \"accepted\", responseCode: rc };", "    return { outcome: \"unknown\", code: \"provider_result_indeterminate\", responseCode: rc };"]]],
  ["K-transport-refusal-unknown", "control: the adapter's definite RCPT / DATA refusal held as unknown", ED,
    [["    if (reply.responseCode >= 500) return { outcome: \"failed\", retryable: false, inRunRetry: false, code: \"provider_rejected_\" + reply.responseCode };", "    if (reply.responseCode >= 500) return { outcome: \"unknown\", code: \"provider_rejected_\" + reply.responseCode };"]]],
];

const result = [];
for (const [id, klass, file, edits] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `de1r3-mut-${id}-`));
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
