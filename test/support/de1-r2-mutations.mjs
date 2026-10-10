// Run explicitly: node test/support/de1-r2-mutations.mjs <absolute log directory> [mutant-id]
// Daily Email reliability R2 — behavioural sensitivity of the R2 changes (review findings E1 / E2) and of the controls they must
// keep. Each mutant re-introduces one defect in a NEW disposable copy WITHOUT .git (no identity / pin / scope guard can count
// as the catch: those guards skip there). A committed behavioural test must report `not ok` with a non-zero exit; a syntax
// failure is never counted. CONTROL is an exact no-op replacement: it must pass every suite. No network, no real e-mail.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2], only = process.argv[3];
if (!out || !out.startsWith("/")) throw new Error("absolute log directory required");
mkdirSync(out, { recursive: true });
const ED = "lib/emailDelivery.js", SE = "lib/sendEmail.js";
const R2 = "test/delivery/de1-r2-remediation.test.mjs", R1 = "test/delivery/de1-r1-remediation.test.mjs";
const DE = "test/delivery/daily-email-delivery.test.mjs", EU = "test/delivery/email-delivery-unit.test.mjs";
const SUITES = [R2, R1, DE, EU];

// [id, defect class, file, [[from, to], …]]
const cases = [
  ["CONTROL", "no-op (identical bytes)", ED, [["export const HISTORY_KEEP = 10;", "export const HISTORY_KEEP = 10;"]]],
  // ── E1: an uncertain send turned into a retry ──
  ["E1-marker-trusted", "provider marker trusted as phase evidence", ED,
    [["  if (ctx.multipleHandoffs) return { outcome: \"unknown\", code: \"multiple_provider_handoffs\" };",
      "  if (ctx.multipleHandoffs) return { outcome: \"unknown\", code: \"multiple_provider_handoffs\" };\n  if (safeRead(ctx.error, \"deliveryPhase\") === \"before_transport\") return { outcome: \"failed\", retryable: true, inRunRetry: false, code: \"claim_lost\" };"]]],
  ["E1-timeout-text-trusted", "'Connection timeout' text trusted as never-connected", ED,
    [["  if (code === \"EDEADLINE\") return", "  if (code === \"ETIMEDOUT\" && /^(Connection timeout|Greeting never received)/.test(String(safeRead(err, \"message\")))) return { outcome: \"failed\", retryable: true, inRunRetry: true, code: \"provider_unreachable\" };\n  if (code === \"EDEADLINE\") return"]]],
  ["E1-syscall-trusted", "connect syscall trusted as never-connected", ED,
    [["  if (code === \"EDEADLINE\") return", "  if ((code === \"ESOCKET\" || code === \"ECONNECTION\") && safeRead(err, \"syscall\") === \"connect\") return { outcome: \"failed\", retryable: true, inRunRetry: true, code: \"provider_unreachable\" };\n  if (code === \"EDEADLINE\") return"]]],
  ["E1-dns-code-trusted", "an EDNS code alone trusted as never-sent", ED,
    [["  if (code === \"EDEADLINE\") return", "  if (code === \"EDNS\") return { outcome: \"failed\", retryable: true, inRunRetry: true, code: \"provider_unreachable\" };\n  if (code === \"EDEADLINE\") return"]]],
  ["E1-handoff-ignored", "a thrown error classified as before the hand-off whatever our attempt state", ED,
    [["  if (!ctx.handedToProvider) {\n    if (!threw)", "  if (!ctx.handedToProvider || (threw && ctx.info === null)) {\n    if (!threw)"]]],
  // (an in-run retry of an unknown outcome ALONE is an equivalent mutant: the next round's claim finds the stored `unknown` and
  // stops — the claim state machine is the second layer; this mutant breaks the recorded state itself)
  ["E1-unknown-recorded-retryable", "an unknown outcome recorded as a retryable failure (and retried in the run)", ED,
    [["        : { state: \"unknown\", code: outcome.code };", "        : { state: \"failed\", retryable: attempt < maxAttempts, code: outcome.code };"],
     ["const retryNow = outcome.outcome === \"failed\" && outcome.inRunRetry === true", "const retryNow = (outcome.outcome === \"unknown\" || (outcome.outcome === \"failed\" && outcome.inRunRetry === true))"]]],
  ["E1-unknown-reclaimed", "a later invocation re-claims an unknown receipt", ED,
    [["  if (s === \"unknown\") return { next: undefined, result: { action: \"skip\", code: \"unknown_requires_reconciliation\" } };", "  if (s === \"unknown\") return fresh((Number(current.attempt) || 1) + 1, historyOf(current));"]]],
  ["E1-reply-text-unchecked", "a reply code without matching reply text accepted as a refusal", ED,
    [["  return responseTextCode(safeRead(err, \"response\")) === rc ? { code, command, responseCode: rc } : null;", "  return { code, command, responseCode: rc };"]]],
  ["E1-reply-command-unchecked", "a reply shape under any command accepted as a refusal", ED,
    [["  if (!shapes || !shapes.has(command)) return null;", "  if (!shapes) return null;"]]],
  // ── E2: an indeterminate result recorded as a definitive refusal ──
  ["E2-not-listed-is-refusal", "recipient listed nowhere ⇒ definitive refusal (the R1 rule)", ED,
    [["  if (!isAccepted) return { outcome: \"unknown\", code: \"provider_result_indeterminate\", responseCode: rc };", "  if (!isAccepted) return { outcome: \"failed\", retryable: false, inRunRetry: false, code: \"provider_rejected_recipient\", responseCode: rc };"]]],
  ["E2-contradiction-accepted", "listed both ways ⇒ accepted", ED,
    [["  if ((isAccepted && isRejected) || (isAccepted && rc !== null && rc >= 300))", "  if (isAccepted && rc !== null && rc >= 300)"],
     ["  if (isRejected) return { outcome: \"failed\"", "  if (isRejected && !isAccepted) return { outcome: \"failed\""]]],
  // ── timeout / late completion, receipt write, concurrency ──
  ["T-deadline-removed", "no provider deadline (a late answer decides the outcome)", SE,
    [["  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));", "  return promise.finally(() => clearTimeout(timer));"]]],
  ["W-write-failure-ignored", "a failed receipt finalization reported as recorded", ED,
    [["      if (!fin.committed || fin.result !== true) receipt = \"write_failed\";\n    } catch { receipt = \"write_failed\"; }", "      if (!fin.committed || fin.result !== true) receipt = \"write_failed\";\n    } catch { receipt = \"recorded\"; }"]]],
  ["C-lease-ignored", "an active claim of another invocation is taken over", ED,
    [["  if ((s === \"claimed\" || s === \"sending\") && Number(current.leaseUntil) > nowMs)", "  if (false && (s === \"claimed\" || s === \"sending\") && Number(current.leaseUntil) > nowMs)"]]],
  // ── controls that must keep working ──
  ["K-claim-loss-unknown", "control: a confirmed pre-call failure held as unknown (never re-sent)", ED,
    [["    if (ctx.claimLost) return { outcome: \"failed\", retryable: true, inRunRetry: false, code: \"claim_lost\" };", "    if (ctx.claimLost) return { outcome: \"unknown\", code: \"claim_lost\" };"]]],
  ["K-rejection-unknown", "control: a listed rejection held as unknown", ED,
    [["  if (isRejected) return { outcome: \"failed\", retryable: false, inRunRetry: false, code: \"provider_rejected_recipient\", responseCode: rc };", "  if (isRejected) return { outcome: \"unknown\", code: \"provider_rejected_recipient\", responseCode: rc };"]]],
  ["K-deferral-not-retried", "control: a confirmed 4xx deferral no longer retried in the run", ED,
    [["    return { outcome: \"failed\", retryable: true, inRunRetry: true, code: \"provider_deferred_\" + reply.responseCode };", "    return { outcome: \"failed\", retryable: true, inRunRetry: false, code: \"provider_deferred_\" + reply.responseCode };"]]],
  ["K-acceptance-unknown", "control: a valid acceptance held as unknown", ED,
    [["  return { outcome: \"accepted\", responseCode: rc };\n}", "  return { outcome: \"unknown\", code: \"provider_result_indeterminate\", responseCode: rc };\n}"]]],
];

const result = [];
for (const [id, klass, file, edits] of cases.filter((c) => !only || c[0] === only)) {
  const dir = mkdtempSync(join(tmpdir(), `de1r2-mut-${id}-`));
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
