// HR3 OT4 — the duration option's complete grammar: exactly `--max-duration-ms=<positive decimal integer>` (LOCAL successor of
// OT3 770c0659; pending independent Codex review; T-OT4-*). parseArgs + runCommand over an in-memory store with a well-formed
// held record and all four attestation flags, at tHold + 720002 ms (past a 1 ms bound, before a 300000 ms one).
// Finding OT3-R-01 (Codex, OT3 review): OT3's raw recogniser kept ANY suffix as the value, so `--max-duration-ms1` (no `=`)
// became duration 1 → C4 met, report complete, exit 0; `--max-duration-ms300000` became an evaluable 300000.
//   OT4-01  the exact missing-separator bypass
//   OT4-02  missing / wrong / repeated separators, suffix-derived values and unconsumed bytes — alone and beside a valid
//           occurrence in both orders: C4 not_evaluable
//   OT4-03  the earlier newline (OT2-R-01) and duplicate regressions still refuse
//   OT4-04  preserved: one canonical value and the numeric bounds; programmatic calls; the accepted evidence-only stray rule;
//           a differently named option stays a different option (the boundary Codex accepted for OT3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { sdkTransactions, releasedHoldRecord } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const T_HOLD = Date.UTC(2026, 9, 17, 6, 0);
const FIXED = Tool.SEND_DEADLINE_MS + E.CLAIM_LEASE_MS + Tool.DRAIN_MARGIN_MS;
const NOW = T_HOLD + 1 + FIXED + 1;
const ATTEST = ["--inventory-attested", "--logs-attested", "--invocation-receipt-attested", "--provider-attested"];
const held = () => ({ ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "op", reason: "incident", at: T_HOLD } } });
const db = () => { const d = makeDb(); sdkTransactions(d, ""); d.seed(E.DELIVERY_HOLD_PATH, held()); return d; };
const evidence = async (flags, nowMs = NOW) => { const a = Tool.parseArgs(["evidence", ...flags, ...ATTEST]); return Tool.runCommand(db(), a._[0], a, { project: "demo-marjin-rules", nowMs }); };
const refused = (r, label) => assert.deepEqual([r.exitCode, r.result.verdict, r.result.criteria.C4_time_bound_passed, r.result.timeBound.maxDurationMs],
  [Tool.EXIT.ABORT_D, "ABORT_D", "not_evaluable", null], label);
const VALID = "--max-duration-ms=300000";

// every token below starts with the exact option name and is NOT the grammar `--max-duration-ms=<positive decimal integer>`
const MALFORMED = [
  "--max-duration-ms1", "--max-duration-ms300000", "--max-duration-ms9007199254740991", "--max-duration-ms0300000",   // missing `=`
  "--max-duration-ms:300000", "--max-duration-ms 300000", "--max-duration-ms\t300000", "--max-duration-ms_300000",     // wrong separator
  "--max-duration-ms==300000", "--max-duration-ms=300000=1", "--max-duration-ms= 300000", "--max-duration-ms==1",  // repeated / misplaced `=`
  "--max-duration-ms=1ms", "--max-duration-ms=300000s", "--max-duration-ms=1 ", "--max-duration-ms=300000\n",         // unconsumed suffix bytes
  "--max-duration-ms=300000\r\n", "--max-duration-ms=300000 ", "--max-duration-ms\n=300000", "--max-duration-msX=1",
];

test("OT4-01 the exact missing-separator bypass `--max-duration-ms1` leaves C4 not_evaluable", async () => {
  const a = Tool.parseArgs(["evidence", "--max-duration-ms1", ...ATTEST]);
  assert.deepEqual([a["max-duration-ms"], a.malformedDuration, a._], ["1", true, ["evidence"]], "recognised, bytes kept, marked malformed");
  refused(await evidence(["--max-duration-ms1"]), "--max-duration-ms1");
  refused(await evidence(["--max-duration-ms300000"]), "--max-duration-ms300000");
  assert.equal(Tool.maxDurationInput({ "max-duration-ms": "300000", malformedDuration: true }), null, "the malformed mark refuses even a canonical-looking value");
});

test("OT4-02 missing / wrong / repeated separators and unconsumed bytes, alone and beside a valid occurrence in both orders", async () => {
  for (const bad of MALFORMED) {
    refused(await evidence([bad]), JSON.stringify(bad) + " alone");
    refused(await evidence([bad, VALID]), JSON.stringify(bad) + " then valid");
    refused(await evidence([VALID, bad]), "valid then " + JSON.stringify(bad));
  }
});

test("OT4-03 the earlier newline (OT2-R-01) and duplicate regressions still refuse", async () => {
  for (const flags of [["--max-duration-ms=300000\n", "--max-duration-ms=1"], ["--max-duration-ms=1", "--max-duration-ms=300000\n"],
    ["--max-duration-ms=300000 ", "--max-duration-ms=1"], [VALID, VALID], ["--max-duration-ms=1", VALID], ["--max-duration-ms", VALID],
    ["--max-duration-ms", "300000"], ["--max-duration-ms=5m", "--max-duration-ms=1"]])
    refused(await evidence(flags), JSON.stringify(flags));
});

test("OT4-04 preserved: canonical values and numeric bounds, programmatic calls, the stray rule, other option names", async () => {
  for (const v of [1, 60000, 300000]) {
    const at = await evidence([`--max-duration-ms=${v}`], T_HOLD + v + FIXED);
    assert.deepEqual([at.result.timeBound.maxDurationMs, at.result.criteria.C4_time_bound_passed, at.exitCode], [v, "met", Tool.EXIT.OK], String(v));
    const before = await evidence([`--max-duration-ms=${v}`], T_HOLD + v + FIXED - 1);
    assert.equal(before.result.criteria.C4_time_bound_passed, "not_met", String(v));
  }
  assert.equal((await evidence(["--max-duration-ms=9007199254740991"])).result.timeBound.maxDurationMs, 9007199254740991, "the safe maximum is accepted");
  for (const v of ["9007199254740992", "9007199254740993", "0", "01", "+1", "-1", "1.0", "1e3", "0x10", ""]) refused(await evidence([`--max-duration-ms=${v}`]), v);
  // programmatic calls (no parseArgs, no `_`) keep their meaning
  assert.equal(Tool.maxDurationInput({ "max-duration-ms": "300000" }), 300000);
  // the accepted evidence-only stray rule is unchanged
  refused(await evidence([VALID, "extra"]), "stray positional");
  // a differently named option is not the duration option (accepted boundary): it is parsed generically, not counted
  assert.deepEqual(Tool.parseArgs(["hold", "--max-duration-ms-x=1"]), { _: ["hold"], "max-duration-ms-x": "1" });
  assert.deepEqual(Tool.parseArgs(["hold", "--project=x", "--expect-version=3", "--logs-attested"]), { _: ["hold"], project: "x", "expect-version": "3", "logs-attested": true });
});
