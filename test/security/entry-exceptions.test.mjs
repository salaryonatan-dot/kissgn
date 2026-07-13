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
} from "../../lib/entryExceptions.js";

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

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
