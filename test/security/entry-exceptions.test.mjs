// Focused tests for the structured entry-exceptions domain + transaction body.
//   Run: node test/security/entry-exceptions.test.mjs
// PURE — no network / Firebase / external calls. The RTDB transaction body is the
// pure applyOperation(); a tiny in-memory envelope models the transaction node.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION, EXCEPTION_REASONS, isValidBusinessDate, isValidOperationId, isValidExpectedRevision,
  normalizeReasonText, validateSetInput, categoryForReason, activeEffects, buildSetState, buildClearState,
  canonicalRequest, requestHash, applyOperation, safeStateView, resolveEffectiveException,
  buildEffectiveRecord, shouldRebuildDecision, dateRangeDays, MAX_LIST_RANGE_DAYS,
  MANAGER_OPERATION_SOFT_LIMIT, OWNER_OPERATION_HARD_LIMIT, hashState,
} from "../../lib/entryExceptions.js";
import { revenueChanged, shouldRebuild, stripOrPreserveException, REVENUE_MATERIAL_FIELDS } from "../../lib/entryDelta.js";

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── Domain / validation ──
T("D1 valid Israel business dates", () => { assert.ok(isValidBusinessDate("2026-07-13")); assert.ok(isValidBusinessDate("2024-02-29")); });
T("D2 invalid format rejected", () => { assert.ok(!isValidBusinessDate("2026-7-13")); assert.ok(!isValidBusinessDate("13/07/2026")); assert.ok(!isValidBusinessDate("2026-07-13T00:00")); });
T("D3 impossible calendar date rejected", () => { assert.ok(!isValidBusinessDate("2026-02-30")); assert.ok(!isValidBusinessDate("2025-02-29")); assert.ok(!isValidBusinessDate("2026-13-01")); assert.ok(!isValidBusinessDate("2026-00-10")); });
T("D4 RTDB-forbidden / out-of-bounds rejected", () => { assert.ok(!isValidBusinessDate("2026-07-1$")); assert.ok(!isValidBusinessDate("1899-07-13")); });
T("D5 unsupported reasonCode rejected", () => assert.throws(() => validateSetInput({ reasonCode: "made_up" }), (e) => e.code === "invalid_reason_code"));
T("D6 reasonText trimmed; oversize REJECTED not truncated", () => {
  assert.strictEqual(normalizeReasonText("  hi  "), "hi");
  assert.strictEqual(normalizeReasonText("   "), undefined);
  assert.throws(() => normalizeReasonText("x".repeat(501)), (e) => e.code === "reason_too_long");
});
T("D7 category is server-derived from reasonCode", () => {
  assert.strictEqual(categoryForReason("closure"), "closure");
  assert.strictEqual(categoryForReason("partial_hours"), "reduced_ops");
  assert.strictEqual(validateSetInput({ reasonCode: "holiday" }).category, "special_event");
});
T("D8 effects are server-derived (client cannot choose)", () => {
  const n = validateSetInput({ reasonCode: "closure" });
  assert.deepStrictEqual(n.effects, { excludeFromForecastBaseline: true, excludeFromInsightComparison: true });
  // client-supplied effects/category/status are ignored — validateSetInput only reads reasonCode/reasonText
  const n2 = validateSetInput({ reasonCode: "closure", reasonText: "x", category: "special_event", effects: { excludeFromForecastBaseline: false }, status: "cleared" });
  assert.deepStrictEqual(n2.effects, { excludeFromForecastBaseline: true, excludeFromInsightComparison: true });
  assert.strictEqual(n2.category, "closure");
});
T("D9 operationId + expectedRevision validation", () => {
  assert.ok(isValidOperationId("op-12345678")); assert.ok(!isValidOperationId("short")); assert.ok(!isValidOperationId("bad/id/xxxxx"));
  assert.ok(isValidExpectedRevision(0)); assert.ok(isValidExpectedRevision(3)); assert.ok(!isValidExpectedRevision(-1)); assert.ok(!isValidExpectedRevision(1.5)); assert.ok(!isValidExpectedRevision("0"));
});
T("D10 buildSetState stamps server metadata; client cannot spoof it", () => {
  const st = buildSetState({ prevState: null, tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", reasonText: "storm", actorUid: "u1", now: 111, nextRevision: 1 });
  assert.strictEqual(st.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(st.status, "active"); assert.strictEqual(st.source, "manual");
  assert.strictEqual(st.createdBy, "u1"); assert.strictEqual(st.createdAt, 111); assert.strictEqual(st.updatedBy, "u1"); assert.strictEqual(st.revision, 1);
  assert.deepStrictEqual(st.effects, activeEffects());
});
T("D11 clear state → cleared, effects false, createdAt preserved", () => {
  const prev = buildSetState({ prevState: null, tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", actorUid: "u1", now: 100, nextRevision: 1 });
  const cl = buildClearState({ prevState: prev, tenantId: "t", bizId: "b", businessDate: "2026-07-13", actorUid: "u2", now: 200, nextRevision: 2 });
  assert.strictEqual(cl.status, "cleared"); assert.strictEqual(cl.effects.excludeFromForecastBaseline, false);
  assert.strictEqual(cl.createdAt, 100); assert.strictEqual(cl.createdBy, "u1"); assert.strictEqual(cl.updatedBy, "u2"); assert.strictEqual(cl.revision, 2);
});
T("D12 requestHash deterministic over canonical authorized command", () => {
  const c = { action: "set", tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", reasonText: null, actorUid: "u1", actorRole: "manager", expectedRevision: 0 };
  assert.strictEqual(requestHash(c), requestHash({ ...c }));
  assert.notStrictEqual(requestHash(c), requestHash({ ...c, businessDate: "2026-07-14" }));
  assert.ok(typeof canonicalRequest(c) === "string");
});
T("D13 safeStateView never exposes operations ledger", () => {
  const st = buildSetState({ prevState: null, tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", actorUid: "u1", now: 1, nextRevision: 1 });
  const v = safeStateView(st);
  assert.ok(!("operations" in v)); assert.strictEqual(v.status, "active");
});

// ── Transaction body (applyOperation) — atomicity / revision / idempotency ──
const cmd = (o) => ({ action: "set", tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", reasonText: null, actorUid: "u1", actorRole: "manager", now: 1, ...o, requestHash: undefined, });
const withHash = (c) => ({ ...c, requestHash: requestHash(c) });

T("A1 create at revision 0 → applied; state+operation written TOGETHER", () => {
  const c = withHash(cmd({ expectedRevision: 0, operationId: "op-aaaaaaaa" }));
  const r = applyOperation(null, c);
  assert.strictEqual(r.outcome, "applied");
  assert.strictEqual(r.state.revision, 1);
  assert.ok(r.envelope.state && r.envelope.operations["op-aaaaaaaa"], "state and operation both present in the committed envelope");
  assert.strictEqual(r.envelope.operations["op-aaaaaaaa"].revisionTo, 1);
});
T("A2 update at current revision → applied, revision++", () => {
  const env1 = applyOperation(null, withHash(cmd({ expectedRevision: 0, operationId: "op-aaaaaaaa" }))).envelope;
  const r = applyOperation(env1, withHash(cmd({ expectedRevision: 1, operationId: "op-bbbbbbbb", reasonCode: "holiday" })));
  assert.strictEqual(r.outcome, "applied"); assert.strictEqual(r.state.revision, 2); assert.strictEqual(r.state.reasonCode, "holiday");
});
T("A3 stale expectedRevision → conflict, NO envelope written", () => {
  const env1 = applyOperation(null, withHash(cmd({ expectedRevision: 0, operationId: "op-aaaaaaaa" }))).envelope;
  const r = applyOperation(env1, withHash(cmd({ expectedRevision: 0, operationId: "op-cccccccc" }))); // stale (current is 1)
  assert.strictEqual(r.outcome, "conflict"); assert.strictEqual(r.code, "revision_conflict"); assert.ok(!r.envelope);
});
T("A4 idempotent replay (same operationId+hash) → replayed, no new op, no revision bump", () => {
  const c = withHash(cmd({ expectedRevision: 0, operationId: "op-dddddddd" }));
  const env1 = applyOperation(null, c).envelope;
  const r = applyOperation(env1, c);
  assert.strictEqual(r.outcome, "replayed"); assert.strictEqual(r.revision, 1);
  assert.strictEqual(Object.keys(env1.operations).length, 1); // no duplicate operation
});
T("A5 operationId reuse with DIFFERENT payload → idempotency_conflict", () => {
  const c1 = withHash(cmd({ expectedRevision: 0, operationId: "op-eeeeeeee" }));
  const env1 = applyOperation(null, c1).envelope;
  const c2 = withHash(cmd({ expectedRevision: 0, operationId: "op-eeeeeeee", reasonCode: "holiday" })); // same id, diff payload
  const r = applyOperation(env1, c2);
  assert.strictEqual(r.outcome, "conflict"); assert.strictEqual(r.code, "idempotency_conflict");
});
T("A6 failed validation writes neither (conflict returns no envelope/state change)", () => {
  const env1 = applyOperation(null, withHash(cmd({ expectedRevision: 0, operationId: "op-ffffffff" }))).envelope;
  const before = JSON.stringify(env1);
  applyOperation(env1, withHash(cmd({ expectedRevision: 9, operationId: "op-gggggggg" }))); // conflict; env1 must be untouched
  assert.strictEqual(JSON.stringify(env1), before);
});
T("A7 clear transitions to cleared and returns to normal semantics", () => {
  const env1 = applyOperation(null, withHash(cmd({ expectedRevision: 0, operationId: "op-hhhhhhhh" }))).envelope;
  const clearCmd = withHash({ action: "clear", tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: null, reasonText: null, actorUid: "u1", actorRole: "manager", expectedRevision: 1, operationId: "op-iiiiiiii", now: 2 });
  const r = applyOperation(env1, clearCmd);
  assert.strictEqual(r.outcome, "applied"); assert.strictEqual(r.state.status, "cleared");
});

// ── Effective resolution (structured-first) ──
const activeEnv = { state: buildSetState({ prevState: null, tenantId: "t", bizId: "b", businessDate: "2026-07-13", reasonCode: "closure", actorUid: "u1", now: 1, nextRevision: 1 }) };
const clearedEnv = { state: buildClearState({ prevState: activeEnv.state, tenantId: "t", bizId: "b", businessDate: "2026-07-13", actorUid: "u1", now: 2, nextRevision: 2 }) };
T("R1 structured active wins", () => { const r = resolveEffectiveException(activeEnv, { is_exception: false }); assert.ok(r.isException && r.origin === "structured"); });
T("R2 structured cleared → normal, blocks legacy fallback", () => { const r = resolveEffectiveException(clearedEnv, { is_exception: true }); assert.ok(!r.isException && r.origin === "structured"); });
T("R3 structured absent → legacy fallback", () => { const r = resolveEffectiveException(null, { is_exception: true }); assert.ok(r.isException && r.origin === "legacy"); });
T("R4 missing everywhere → normal", () => { const r = resolveEffectiveException(null, { is_exception: false }); assert.ok(!r.isException && r.origin === "none"); });
T("R5 reasons enum matches current UI enum", () => assert.deepStrictEqual(EXCEPTION_REASONS[0], "closure"));

// ── Rules (JSON parse only; Emulator matrix is a separate later phase) ──
const RULES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "database.rules.json"), "utf8"));
T("RULES entry_exceptions node denies direct client read AND write", () => {
  const node = RULES.rules.tenants.$tenantId.entry_exceptions;
  assert.ok(node, "named entry_exceptions node present (overrides the permissive $dataKey wildcard)");
  assert.strictEqual(node[".read"], false);
  assert.strictEqual(node[".write"], false);
});


// ═══ REVIEW BLOCKER FIXES ═══

// Part 7 — safe-integer revision validation
T("P7 expectedRevision accepts only safe non-negative integers", () => {
  assert.ok(isValidExpectedRevision(0)); assert.ok(isValidExpectedRevision(7)); assert.ok(isValidExpectedRevision(Number.MAX_SAFE_INTEGER));
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, "0", null, undefined, Number.MAX_SAFE_INTEGER + 1])
    assert.ok(!isValidExpectedRevision(bad), "reject " + String(bad));
});

// Part 5 — idempotent replay returns the ORIGINAL operation result, not current state
function seq(env, cmdObj) { const c = withHash(cmd(cmdObj)); const r = applyOperation(env, c); return { r, env: r.outcome === "applied" ? r.envelope : env, cmd: c }; }
T("P5 replay of op A AFTER a later clear returns A's original after/revisionTo (state unchanged)", () => {
  let a = seq(null, { action: "set", expectedRevision: 0, operationId: "op-AAAAAAAA", reasonCode: "closure" });     // A: active rev1
  let b = seq(a.env, { action: "clear", expectedRevision: 1, operationId: "op-BBBBBBBB", reasonCode: null });        // B: cleared rev2
  assert.strictEqual(b.env.state.status, "cleared"); assert.strictEqual(b.env.state.revision, 2);
  const replayA = applyOperation(b.env, a.cmd);                                                                       // retry A
  assert.strictEqual(replayA.outcome, "replayed");
  assert.strictEqual(replayA.state.status, "active");   // A's ORIGINAL result, not current cleared
  assert.strictEqual(replayA.revision, 1);              // A's original revisionTo
  assert.strictEqual(b.env.state.status, "cleared");   // envelope state NOT changed by the replay
});
T("P5 replay of op A AFTER a later set returns A's original result", () => {
  let a = seq(null, { action: "set", expectedRevision: 0, operationId: "op-CCCCCCCC", reasonCode: "closure" });
  let b = seq(a.env, { action: "set", expectedRevision: 1, operationId: "op-DDDDDDDD", reasonCode: "holiday" });
  const replayA = applyOperation(b.env, a.cmd);
  assert.strictEqual(replayA.outcome, "replayed");
  assert.strictEqual(replayA.revision, 1);
  assert.strictEqual(replayA.state.reasonCode, "closure");
});

// Part 6 — bounded, compact operations ledger
// Two-tier ledger: manager soft limit 32, owner hard limit 128.
function fillOps(count, role) {
  let env = null, rev = 0, firstCmd = null;
  for (let i = 0; i < count; i++) {
    const c = withHash(cmd({ action: "set", expectedRevision: rev, operationId: "op-" + String(1e7 + i), reasonCode: "closure", actorRole: role || "manager" }));
    if (i === 0) firstCmd = c;
    const r = applyOperation(env, c);
    assert.strictEqual(r.outcome, "applied", "fill op " + i); env = r.envelope; rev = r.state.revision;
  }
  return { env, rev, firstCmd };
}
T("P6 constants: soft 32 / hard 128", () => { assert.strictEqual(MANAGER_OPERATION_SOFT_LIMIT, 32); assert.strictEqual(OWNER_OPERATION_HARD_LIMIT, 128); });
T("P6 manager ops 1..32 allowed; op 33 rejected operation_owner_required (writes nothing)", () => {
  const { env, rev } = fillOps(32, "manager");
  assert.strictEqual(Object.keys(env.operations).length, 32);
  const over = applyOperation(env, withHash(cmd({ action: "set", expectedRevision: rev, operationId: "op-MGR33", reasonCode: "holiday", actorRole: "manager" })));
  assert.strictEqual(over.outcome, "conflict"); assert.strictEqual(over.code, "operation_owner_required");
  assert.ok(!over.envelope); assert.strictEqual(Object.keys(env.operations).length, 32); // no pruning/overwrite
});
T("P6 owner op 33 allowed; owner continues through 128; op 129 rejected operation_hard_limit_reached for EVERYONE", () => {
  const { env, rev } = fillOps(32, "manager");
  const r33 = applyOperation(env, withHash(cmd({ action: "set", expectedRevision: rev, operationId: "op-OWN33", reasonCode: "holiday", actorRole: "owner" })));
  assert.strictEqual(r33.outcome, "applied");
  // build a 128-op ledger with owner
  const big = fillOps(128, "super_owner");
  assert.strictEqual(Object.keys(big.env.operations).length, 128);
  const ownerOver = applyOperation(big.env, withHash(cmd({ action: "set", expectedRevision: big.rev, operationId: "op-OWN129", reasonCode: "holiday", actorRole: "owner" })));
  assert.strictEqual(ownerOver.code, "operation_hard_limit_reached"); assert.ok(!ownerOver.envelope);
  const superOver = applyOperation(big.env, withHash(cmd({ action: "set", expectedRevision: big.rev, operationId: "op-SO129", reasonCode: "holiday", actorRole: "super_owner" })));
  assert.strictEqual(superOver.code, "operation_hard_limit_reached");
});
T("P6 replay succeeds at soft AND hard limits (checked before limits)", () => {
  const soft = fillOps(32, "manager");
  assert.strictEqual(applyOperation(soft.env, soft.firstCmd).outcome, "replayed");
  const hard = fillOps(128, "owner");
  assert.strictEqual(applyOperation(hard.env, hard.firstCmd).outcome, "replayed");
});
T("P6 actorRole from the COMMAND (server-set) governs the soft limit — a 'manager' cmd cannot pass 32", () => {
  const { env, rev } = fillOps(32, "manager");
  // even if a client tried to claim a higher role, the server sets cmd.actorRole; a manager cmd is blocked
  const asManager = applyOperation(env, withHash(cmd({ action: "set", expectedRevision: rev, operationId: "op-SPOOF", reasonCode: "holiday", actorRole: "manager" })));
  assert.strictEqual(asManager.code, "operation_owner_required");
});
T("P6 operation record is COMPACT: beforeHash (not a full before snapshot) + after", () => {
  const env = applyOperation(null, withHash(cmd({ action: "set", expectedRevision: 0, operationId: "op-COMPACT1", reasonCode: "closure" }))).envelope;
  const env2 = applyOperation(env, withHash(cmd({ action: "clear", expectedRevision: 1, operationId: "op-COMPACT2", reasonCode: null })));
  const op = env2.envelope.operations["op-COMPACT2"];
  assert.ok(!("before" in op), "no full before snapshot");
  assert.ok("beforeHash" in op, "compact beforeHash present");
  assert.ok(op.after && op.after.status === "cleared");
  assert.strictEqual(op.beforeHash, hashState(env.state)); // integrity of the prior state
});

// Part 1 — normalized effective record shapes
T("P1 buildEffectiveRecord: structured active / cleared / legacy / none", () => {
  const active = { state: { status: "active", reasonCode: "closure", reasonText: "x", revision: 3 } };
  const cleared = { state: { status: "cleared", revision: 4 } };
  assert.deepStrictEqual(buildEffectiveRecord("2026-07-13", active, null), { businessDate: "2026-07-13", source: "structured", status: "active", reasonCode: "closure", reasonText: "x", revision: 3, structured: true });
  assert.deepStrictEqual(buildEffectiveRecord("2026-07-13", cleared, { is_exception: true }), { businessDate: "2026-07-13", source: "structured", status: "cleared", reasonCode: null, reasonText: null, revision: 4, structured: true });
  assert.deepStrictEqual(buildEffectiveRecord("2026-07-13", null, { is_exception: true, exception_reason: "holiday", exception_note: "n" }), { businessDate: "2026-07-13", source: "legacy", status: "active", reasonCode: "holiday", reasonText: "n", revision: 0, structured: false });
  assert.deepStrictEqual(buildEffectiveRecord("2026-07-13", null, { is_exception: false }), { businessDate: "2026-07-13", source: "none", status: "normal", reasonCode: null, reasonText: null, revision: 0, structured: false });
});
T("P1 malformed structured state fails SAFE to cleared/normal (never spurious active)", () => {
  assert.strictEqual(buildEffectiveRecord("2026-07-13", { state: {} }, { is_exception: true }).status, "cleared"); // no status => not active
  assert.strictEqual(buildEffectiveRecord("2026-07-13", {}, { is_exception: true }).source, "legacy"); // no state => legacy fallback
});

// Part 4 — rebuild decision
T("P4 shouldRebuildDecision", () => {
  assert.strictEqual(shouldRebuildDecision(true, null), true);                                   // revenue changed
  assert.strictEqual(shouldRebuildDecision(false, { applied: true, rebuildRequired: true }), true);
  assert.strictEqual(shouldRebuildDecision(false, { applied: false, rebuildRequired: false }), false); // replay
  assert.strictEqual(shouldRebuildDecision(false, { applied: true, rebuildRequired: false }), false);
  assert.strictEqual(shouldRebuildDecision(false, null), false);
});

// Part 8 — range helpers
T("P8 dateRangeDays: forward positive, reversed negative, cap = 400", () => {
  assert.strictEqual(MAX_LIST_RANGE_DAYS, 400);
  assert.strictEqual(dateRangeDays("2026-07-01", "2026-07-01"), 0);
  assert.strictEqual(dateRangeDays("2026-07-01", "2026-07-11"), 10);
  assert.ok(dateRangeDays("2026-07-11", "2026-07-01") < 0); // reversed
  assert.strictEqual(dateRangeDays("2026-01-01", "2027-02-05"), 400); // exactly 400
  assert.ok(dateRangeDays("2026-01-01", "2027-02-06") > MAX_LIST_RANGE_DAYS); // over cap
});


// ═══ REVENUE DELTA (lib/entryDelta.js) ═══
T("DELTA material field set is exactly the analytics-affecting fields", () => {
  assert.deepStrictEqual(REVENUE_MATERIAL_FIELDS, ["sales","deliveries","other_income","food_cost","payroll","hourly_payroll","other_expense"]);
});
T("DELTA new entry (no prev) is always changed", () => assert.strictEqual(revenueChanged(null, { sales: 0 }), true));
T("DELTA identical entry ⇒ not changed", () => assert.strictEqual(revenueChanged({ sales: 100, deliveries: 5 }, { sales: 100, deliveries: 5 }), false));
T("DELTA numeric string vs number compare equal", () => assert.strictEqual(revenueChanged({ sales: "100" }, { sales: 100 }), false));
T("DELTA missing vs zero normalize equal", () => assert.strictEqual(revenueChanged({ sales: "" }, { sales: 0 }), false));
T("DELTA a material change is detected", () => assert.strictEqual(revenueChanged({ sales: 100 }, { sales: 101 }), true));
T("DELTA supplier_payments change detected by key union; 'skip' ignored; order-independent", () => {
  assert.strictEqual(revenueChanged({ supplier_payments: { s1: 10, s2: "skip" } }, { supplier_payments: { s2: "skip", s1: 10 } }), false);
  assert.strictEqual(revenueChanged({ supplier_payments: { s1: 10 } }, { supplier_payments: { s1: 12 } }), true);
  assert.strictEqual(revenueChanged({ supplier_payments: {} }, { supplier_payments: { s3: 5 } }), true);
});
T("DELTA exception + UI-only fields are IGNORED", () => {
  assert.strictEqual(revenueChanged(
    { sales: 100, is_exception: false, exception_reason: "", notes: "a", weather_impact: "x", security_event: false },
    { sales: 100, is_exception: true, exception_reason: "closure", notes: "b", weather_impact: "y", security_event: true }
  ), false);
});
T("DELTA shouldRebuild: revenueChanged OR (applied && rebuildRequired)", () => {
  assert.strictEqual(shouldRebuild(true, null), true);
  assert.strictEqual(shouldRebuild(false, { applied: true, rebuildRequired: true }), true);
  assert.strictEqual(shouldRebuild(false, { applied: false, rebuildRequired: false }), false); // replay + unchanged
  assert.strictEqual(shouldRebuild(false, { applied: true, rebuildRequired: false }), false);
});

// ═══ LEGACY EXCEPTION DEFENSIVE PRESERVATION (lib/entryDelta.js stripOrPreserveException) ═══
const legacyPrev = { date: "2026-07-13", sales: 100, is_exception: true, exception_reason: "holiday", exception_note: "n", exception_set_at: 5, exception_set_by: "u1" };
T("LEGACY non-editor (strip=false) PRESERVES pre-existing legacy exception fields", () => {
  const out = stripOrPreserveException({ ...legacyPrev, sales: 120 }, false, legacyPrev);
  assert.strictEqual(out.is_exception, true);
  assert.strictEqual(out.exception_reason, "holiday");
  assert.strictEqual(out.exception_set_by, "u1");
});
T("LEGACY editor with confirmed structured success (strip=true) STRIPS legacy fields", () => {
  const out = stripOrPreserveException({ ...legacyPrev, sales: 120 }, true, legacyPrev);
  assert.ok(!("is_exception" in out) && !("exception_reason" in out) && !("exception_set_by" in out));
});
T("LEGACY no new governance dual-written: strip=false but prev NOT exceptional ⇒ no exception fields", () => {
  const out = stripOrPreserveException({ sales: 100, is_exception: true, exception_reason: "closure" }, false, { sales: 100 });
  assert.ok(!("is_exception" in out), "form's UI exception not written when prev wasn't exceptional");
});
T("LEGACY structured-cleared prev (is_exception not true) ⇒ nothing preserved (normal)", () => {
  const out = stripOrPreserveException({ sales: 100 }, false, { sales: 100, is_exception: false });
  assert.ok(!("is_exception" in out));
});

// ═══ CLIENT WIRING (static-src on index.html) ═══
const IDX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.html"), "utf8");
T("CLIENT saveEntry uses the real revenue delta (not hardcoded true)", () => {
  assert.ok(!IDX.includes("const __revenueChanged = true;"), "hardcoded true removed");
  assert.ok(IDX.includes("const __revenueChanged = __revenueMaterialChanged(__prevEntry, netForm);"));
});
T("CLIENT strip decision preserves legacy unless structured governs/succeeds", () => {
  assert.ok(IDX.includes("const __stripException = __structuredGoverns || (__exResponse != null);"));
  assert.ok(IDX.includes("__applyExc(netForm, __stripException, __prevEntry)"));
});
T("CLIENT ledger errors have dedicated (non-generic) messages", () => {
  assert.ok(IDX.includes('__ec === "operation_owner_required"'));
  assert.ok(IDX.includes('__ec === "operation_hard_limit_reached"'));
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
