// HR3 OT3 — malformed duration tokens can no longer vanish beside a valid one (LOCAL successor of OT2 c8fc3f83; pending
// independent Codex review; T-OT3-*). Every row goes through Tool.parseArgs (the CLI's argv parser) and Tool.runCommand (its
// command runner) over an in-memory store holding a well-formed held record; all four attestation flags are supplied, so C4
// alone decides whether the report could complete.
// Finding OT2-R-01 (Codex, OT2 review): the generic token regex's `.` stops at a line terminator, so `--max-duration-ms=300000\n`
// fell into the positionals and the valid `--max-duration-ms=1` beside it was used: C4 met, report complete, exit 0.
//   OT3-01  the reviewer's case and its line-terminator variants, in BOTH orders: C4 not_evaluable, ABORT_D, exit 5
//   OT3-02  a malformed occurrence is kept whole as the duration value (not dropped), and alone still fails closed
//   OT3-03  stray tokens in `evidence` (mis-spelt / mis-cased / mis-prefixed durations, a separated value) make C4 not_evaluable
//   OT3-04  preserved: one canonical value keeps its exact meaning (1 ms is still syntactically accepted — syntax is not proof
//           of the configured cap); recognised repeats and OT2's malformed forms still refuse; other options and commands unchanged
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { sdkTransactions, releasedHoldRecord } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const P = "demo-marjin-rules";
const T_HOLD = Date.UTC(2026, 9, 17, 6, 0);
const FIXED = Tool.SEND_DEADLINE_MS + E.CLAIM_LEASE_MS + Tool.DRAIN_MARGIN_MS;
const NOW = T_HOLD + 1 + FIXED + 1;                       // tHold + 720002: past a 1 ms bound, before a 300000 ms one
const ATTEST = ["--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"];
const held = () => ({ ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "incident", at: T_HOLD } } });
const db = () => { const d = makeDb(); sdkTransactions(d, ""); d.seed(E.DELIVERY_HOLD_PATH, held()); return d; };
const run = async (command, flags, nowMs = NOW) => { const a = Tool.parseArgs([command, ...flags]); return { args: a, r: await Tool.runCommand(db(), a._[0], a, { project: P, nowMs }) }; };
const refused = (r, label) => assert.deepEqual([r.exitCode, r.result.verdict, r.result.criteria.C4_time_bound_passed, r.result.timeBound.maxDurationMs, r.result.timeBound.earliestMs],
  [Tool.EXIT.ABORT_D, "ABORT_D", "not_evaluable", null, null], label);

// raw tokens the generic matcher could not read: line terminators after the value, inside it, before `=`, and NUL
const MALFORMED = ["--max-duration-ms=300000\n", "--max-duration-ms=300000\r", "--max-duration-ms=300000\r\n", "--max-duration-ms=300000\nignored",
  "--max-duration-ms=300000 ignored", "--max-duration-ms=300000 ", "--max-duration-ms=\n300000", "--max-duration-ms\n=300000",
  "--max-duration-ms\n", "--max-duration-ms\u0000=300000"];

test("OT3-01 the reviewer's case and every line-terminator variant, beside a valid duration in either order: C4 not_evaluable", async () => {
  const exact = await run("evidence", ["--max-duration-ms=300000\n", "--max-duration-ms=1", ...ATTEST]);
  refused(exact.r, "the reviewer's exact argv");
  assert.equal(exact.args.ambiguousDuration, true);
  for (const bad of MALFORMED) for (const order of ["malformed-first", "valid-first"]) {
    const flags = order === "malformed-first" ? [bad, "--max-duration-ms=1"] : ["--max-duration-ms=1", bad];
    const { args, r } = await run("evidence", [...flags, ...ATTEST]);
    refused(r, JSON.stringify(bad) + " " + order);
    assert.equal(args.ambiguousDuration, true, JSON.stringify(bad) + " " + order + ": counted as a repeat");
    assert.deepEqual(args._, ["evidence"], "the malformed occurrence did not fall into the positionals");
  }
});

test("OT3-02 a malformed occurrence is kept whole as the value, and alone still fails closed", async () => {
  for (const [bad, value] of [["--max-duration-ms=300000\n", "300000\n"], ["--max-duration-ms=300000\nignored", "300000\nignored"],
    ["--max-duration-ms=300000 ignored", "300000 ignored"], ["--max-duration-ms\n=300000", "\n=300000"], ["--max-duration-ms\u0000=300000", "\u0000=300000"]]) {
    const { args, r } = await run("evidence", [bad, ...ATTEST]);
    assert.equal(args["max-duration-ms"], value, JSON.stringify(bad));
    assert.equal(args.ambiguousDuration, undefined, "a single occurrence is not a repeat");
    refused(r, JSON.stringify(bad) + " alone");
  }
});

test("OT3-03 stray tokens in `evidence` make the duration unverifiable: mis-spelt, mis-cased, mis-prefixed or separated values", async () => {
  for (const stray of [" --max-duration-ms=300000", "--MAX-DURATION-MS=300000", "-max-duration-ms=300000", "—max-duration-ms=300000",
    "--max_duration_ms=300000", "300000", "--inventory-attested\n"]) {
    for (const flags of [[stray, "--max-duration-ms=1"], ["--max-duration-ms=1", stray]]) {
      const { args, r } = await run("evidence", [...flags, ...ATTEST]);
      assert.ok(args._.length > 1, JSON.stringify(stray) + " is a positional");
      refused(r, JSON.stringify(flags));
    }
  }
});

test("OT3-04 preserved: canonical meaning, OT2 refusals, other options and commands", async () => {
  for (const v of [1, 300000]) {
    const at = await run("evidence", [`--max-duration-ms=${v}`, ...ATTEST], T_HOLD + v + FIXED);
    assert.deepEqual([at.r.result.timeBound.maxDurationMs, at.r.result.criteria.C4_time_bound_passed, at.r.result.verdict, at.r.exitCode],
      [v, "met", "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW", Tool.EXIT.OK], String(v));
  }
  // canonical 1 ms is still accepted at tHold + 720002: the parser checks syntax, never that the value is the configured cap
  const one = await run("evidence", ["--max-duration-ms=1", ...ATTEST]);
  assert.deepEqual([one.r.result.timeBound.maxDurationMs, one.r.result.criteria.C4_time_bound_passed], [1, "met"]);
  for (const flags of [["--max-duration-ms"], ["--max-duration-ms", "300000"], ["--max-duration-ms=300000", "--max-duration-ms=300000"],
    ["--max-duration-ms=5m", "--max-duration-ms=1"], ["--max-duration-ms=1", "--max-duration-ms=5m"], ["--max-duration-ms=1e5"], ["--max-duration-ms="]])
    refused((await run("evidence", [...flags, ...ATTEST])).r, JSON.stringify(flags));
  // other options parse exactly as before (the generic matcher still handles them)
  assert.deepEqual(Tool.parseArgs(["hold", "--project=x", "--expect-version=3", "--logs-attested"]), { _: ["hold"], project: "x", "expect-version": "3", "logs-attested": true });
  assert.equal(Tool.parseArgs(["status", "--project=a", "--project=b"]).ambiguousTarget, true);
  assert.deepEqual(Tool.parseArgs(["hold", "--max-duration-ms-x=1"]), { _: ["hold"], "max-duration-ms-x": "1" }, "a longer option name is a different option");
  assert.deepEqual(Tool.parseArgs(["hold", "--reason=a\nb"])._, ["hold", "--reason=a\nb"], "non-duration tokens keep the generic behaviour");
  // the stray-token rule is the duration's only: status / inventory still answer with an extra positional
  for (const command of ["status", "inventory"]) {
    const { r } = await run(command, ["extra"]);
    assert.equal(r.exitCode, Tool.EXIT.OK, command);
  }
});
