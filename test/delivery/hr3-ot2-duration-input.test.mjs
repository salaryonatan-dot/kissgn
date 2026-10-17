// HR3 OT2 — the drain report's C4 duration input as the REAL interface parses it (LOCAL successor of OT1 0576cfda; pending
// independent Codex review; T-OT2-*). Every row goes through Tool.parseArgs (the CLI's own argv parser) and Tool.runCommand
// (the CLI's own command runner) over an in-memory store; only firebase-admin initialisation and target verification, which
// precede both and are unchanged, are not exercised here.
// Finding OT2-F1 (Claude, 2026-10-17): on OT1 `--max-duration-ms 300000` (space) and a bare `--max-duration-ms` are parsed as
// `true`, which Number() turns into 1 ms; a repeated flag keeps its LAST value; exponent / hex / decimal / padded forms are
// accepted. Each can make C4 met far earlier than the effective maximum duration allows (the review's OT1-RB-01 hazard).
//   OT2-01  bare, space-separated and repeated forms leave C4 not_evaluable (ABORT_D, exit 5) where OT1 met it and completed
//   OT2-02  every non-canonical value is rejected the same way; nothing is coerced
//   OT2-03  canonical values keep their exact OT1/S3 meaning: the bound is tHold + value + 60 s + 600 s + 60 s
//   OT2-04  the parser change is confined to the duration flag; attestation flags still take no value
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { sdkTransactions, releasedHoldRecord } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const P = "demo-marjin-rules";
const T_HOLD = Date.UTC(2026, 9, 17, 6, 0);
const FIXED = Tool.SEND_DEADLINE_MS + E.CLAIM_LEASE_MS + Tool.DRAIN_MARGIN_MS;           // 60 s + 600 s + 60 s
const ATTEST = ["--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"];
const held = () => ({ ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "incident", at: T_HOLD } } });
const db = () => { const d = makeDb(); sdkTransactions(d, ""); d.seed(E.DELIVERY_HOLD_PATH, held()); return d; };
// the evidence command exactly as main() runs it: argv → parseArgs → runCommand(command = argv[0])
const evidence = async (flags, nowMs) => { const args = Tool.parseArgs(["evidence", ...flags]); return Tool.runCommand(db(), args._[0], args, { project: P, nowMs }); };
// 1 ms past the bound a 1 ms "duration" would give; 5 min short of the bound a 300000 ms cap gives
const EARLY = T_HOLD + 1 + FIXED + 1;

test("OT2-01 bare, space-separated and repeated duration flags leave C4 not_evaluable instead of a 1 ms / last-value bound", async () => {
  for (const flags of [["--max-duration-ms", "300000"], ["--max-duration-ms"], ["--max-duration-ms=300000", "--max-duration-ms=1"], ["--max-duration-ms=1", "--max-duration-ms=300000"]]) {
    const r = await evidence([...flags, ...ATTEST], EARLY);
    assert.deepEqual([r.exitCode, r.result.verdict, r.result.criteria.C4_time_bound_passed, r.result.timeBound.maxDurationMs, r.result.timeBound.earliestMs],
      [Tool.EXIT.ABORT_D, "ABORT_D", "not_evaluable", null, null], JSON.stringify(flags));
  }
  // the supported form at the same instant: the 300000 ms cap is not over yet
  const ok = await evidence(["--max-duration-ms=300000", ...ATTEST], EARLY);
  assert.deepEqual([ok.exitCode, ok.result.criteria.C4_time_bound_passed, ok.result.timeBound.maxDurationMs], [Tool.EXIT.ABORT_D, "not_met", 300000]);
});

test("OT2-02 non-canonical values are rejected, never coerced: C4 not_evaluable, ABORT_D", async () => {
  const far = T_HOLD + 10 * 86_400_000;                                                   // any accepted value would be met by then
  for (const v of ["1e5", "0x10", "300000.0", " 300000", "300000 ", "+300000", "-5", "0", "00300000", "5m", "300s", "", "300_000", "true",
    "Infinity", "NaN", "9007199254740993", "３００"]) {
    const r = await evidence([`--max-duration-ms=${v}`, ...ATTEST], far);
    assert.deepEqual([r.exitCode, r.result.verdict, r.result.criteria.C4_time_bound_passed, r.result.timeBound.maxDurationMs], [Tool.EXIT.ABORT_D, "ABORT_D", "not_evaluable", null], JSON.stringify(v));
  }
});

test("OT2-03 canonical values keep their meaning: earliest = tHold + value + 60 s + 600 s + 60 s; met exactly from that instant", async () => {
  for (const v of [1, 60000, 300000, 900000]) {
    const before = await evidence([`--max-duration-ms=${v}`, ...ATTEST], T_HOLD + v + FIXED - 1);
    const at = await evidence([`--max-duration-ms=${v}`, ...ATTEST], T_HOLD + v + FIXED);
    assert.deepEqual([before.result.timeBound.earliestMs, before.result.criteria.C4_time_bound_passed, before.exitCode], [T_HOLD + v + FIXED, "not_met", Tool.EXIT.ABORT_D], String(v));
    assert.deepEqual([at.result.criteria.C4_time_bound_passed, at.result.verdict, at.exitCode], ["met", "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", Tool.EXIT.OK], String(v));
  }
  // without attestations the same met C4 is still ABORT_D: the duration never completes the report on its own
  const bare = await evidence(["--max-duration-ms=300000"], T_HOLD + 300000 + FIXED);
  assert.deepEqual([bare.result.criteria.C4_time_bound_passed, bare.result.verdict, bare.exitCode], ["met", "ABORT_D", Tool.EXIT.ABORT_D]);
});

test("OT2-04 only the duration flag changes: parseArgs output otherwise identical; attestation flags still take no value", async () => {
  assert.deepEqual(Tool.parseArgs(["hold", "--project=x", "--expect-version=3", "--logs-attested"]), { _: ["hold"], project: "x", "expect-version": "3", "logs-attested": true });
  assert.equal(Tool.parseArgs(["evidence", "--max-duration-ms=300000"]).ambiguousDuration, undefined, "a single flag is not ambiguous");
  assert.equal(Tool.parseArgs(["evidence", "--max-duration-ms=300000", "--max-duration-ms=300000"]).ambiguousDuration, true, "even an identical repeat is refused");
  // `--logs-attested=true` is the string "true", not the attestation: fail closed, as on S3 / OT1
  const r = await evidence(["--max-duration-ms=300000", "--inventory-attested=true", "--logs-attested=true", "--invocation-receipt-attested=true", "--provider-attested=true"], T_HOLD + 10 * 86_400_000);
  assert.deepEqual([r.result.criteria.C5_every_reachable_deployment_gated, r.result.criteria.C6_hosted_logs_complete, r.result.verdict], ["not_evaluable", "not_evaluable", "ABORT_D"]);
});
