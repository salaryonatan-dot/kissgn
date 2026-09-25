// Marjin — CANARY TOOLING contract: manifests (CT-01), digests (CT-07), enhanced preflight over
// fixtures (CT-02…CT-06, CT-35), expected-V2 + structural/logical comparison mutants (CT-14/15/17),
// classification (CT-24), confirmation tokens (CT-26), window arithmetic + row-count equation
// (CT-23/34), drain verdict vocabulary (CT-11), live-check diffs (CT-20), reconciliation (CT-32).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import { loadProductionWindow } from "../../tools/storage-v2/production-window.mjs";
import * as X from "../support/canary-fixtures.mjs";
import { malformedNodes } from "../support/entries-fixtures.mjs";

const H = C.helpersFrom(loadProductionWindow());
const m = X.manifestFor();
const ENV = { mode: "emulator", repoSha: m.approved.repoSha, treeClean: true, deployedRulesBlob: m.approved.rulesBlob };
const ctx = (name = X.NAME) => ({ config: { _v: JSON.stringify({ businessName: name }) }, fixed: { _v: "[]" }, suppliers: null });
const pre = (raw, over = {}) => C.enhancedPreflight({ raw, control: X.POLICY(), exceptions: null, context: ctx(), manifest: m, H, environment: ENV, ...over });
const codes = (r) => r.findings.map((f) => f.code);

test("manifest validation: exact ids, no wildcards, environment-shaped URLs, placeholder ids refused in production (CT-01)", () => {
  assert.equal(C.validateManifest(m).ok, true);
  const bad = (over, field) => { const v = C.validateManifest(X.manifestFor(over)); assert.equal(v.ok, false, JSON.stringify(over)); assert.ok(v.errors.some((e) => e.field === field), field + " " + JSON.stringify(v.errors)); };
  bad({ bizId: "*" }, "bizId"); bad({ bizId: "biz/A" }, "bizId"); bad({ tenantId: " tenantA" }, "tenantId"); bad({ bizId: "" }, "bizId");
  bad({ environment: "staging" }, "environment");
  bad({ environment: "production", databaseURL: "http://127.0.0.1:9000?ns=demo-x" }, "databaseURL");
  bad({ environment: "production", tenantId: "tenantA" }, "tenantId");
  bad({ databaseURL: "https://example-prod-project-default-rtdb.firebaseio.com" }, "databaseURL");
  bad({ approved: { rulesBlob: "short" } }, "approved.rulesBlob"); bad({ approved: { repoSha: "zz" } }, "approved.repoSha");
  bad({ operation: { id: "" } }, "operation"); bad({ operation: { operator: "alice", observer: "alice" } }, "operation.observer");
  bad({ expectedIdentity: { businessName: "" } }, "expectedIdentity.businessName");
  bad({ liveWrite: { date: "20-09-2026" } }, "liveWrite");
  assert.throws(() => C.assertManifest(X.manifestFor({ bizId: "*" })), (e) => e.code === "manifest_invalid" && e.exitCode === 14);
  const p = C.derivePaths(m); assert.equal(p.entries, "tenants/tenantA/biz:bizA:entries"); assert.equal(p.control, "storage_v2_control/tenantA/bizA"); assert.equal(p.exceptions, "tenants/tenantA/entry_exceptions/bizA");
});

test("digestV1 is deterministic, order-independent for objects, and distinguishes types (CT-07)", () => {
  assert.equal(C.digestV1({ a: 1, b: "x" }), C.digestV1({ b: "x", a: 1 }));
  assert.notEqual(C.digestV1({ a: 1 }), C.digestV1({ a: "1" }));
  assert.notEqual(C.digestV1([1, 2]), C.digestV1([2, 1]));
  assert.notEqual(C.digestV1(null), C.digestV1({})); assert.notEqual(C.digestV1(true), C.digestV1("true")); assert.notEqual(C.digestV1(1), C.digestV1(1.0000000001));
  assert.equal(C.digestV1("שלום 🙂"), C.digestV1("שלום 🙂")); assert.notEqual(C.digestV1("שלום"), C.digestV1("שלום "));
  assert.throws(() => C.digestV1({ a: NaN }), /unsupported_value/); assert.throws(() => C.digestV1({ a: undefined }), /unsupported_value/);
  assert.equal(C.rawVSha256("[]"), C.sha256Hex(Buffer.from("[]")));
});

test("enhanced preflight: clean legacy ⇒ PASS/ELIGIBLE with expected V2 digest (CT-02, CT-35)", () => {
  const raw = X.asLegacy(X.LEGACY_ROWS()); const r = pre(raw);
  assert.equal(r.aggregate, "PASS", JSON.stringify(r.findings)); assert.equal(r.eligibility, "ELIGIBLE");
  assert.equal(r.storage.mode, "legacy"); assert.equal(r.storage.rawVSha256, C.rawVSha256(raw._v)); assert.equal(r.legacy.rowCount, 3);
  assert.equal(r.expectedV2.digest, C.computeExpectedV2(raw, H).digest); assert.equal(r.ids.rowCount, 3); assert.equal(r.ids.latestDate, "2026-09-03");
  for (const k of ["identity_match", "rules_fingerprint_match", "policy_legacy", "legacy_parse", "representable", "exceptions_shape"]) assert.ok(codes(r).includes(k), k);
  assert.ok(!r.findings.some((f) => /repair|dedup|fix/.test(JSON.stringify(f.remedy || "")) && f.classification === "PASS"));
});

test("enhanced preflight: malformed, duplicate id, duplicate date, numeric maps, absent, V2, siblings, non-finite, size (CT-03…CT-06)", () => {
  for (const [name, node] of Object.entries(malformedNodes())) { const r = pre(node); assert.equal(r.aggregate, "BLOCKER", name); assert.equal(r.eligibility, "NOT_ELIGIBLE", name); }
  const dupId = X.LEGACY_ROWS(); dupId[2].id = dupId[0].id;
  const r1 = pre(X.asLegacy(dupId)); assert.equal(r1.aggregate, "BLOCKER"); assert.ok(codes(r1).includes("duplicate_entry_id"));
  const dupDate = X.LEGACY_ROWS(); dupDate[2].date = dupDate[0].date;
  const r2 = pre(X.asLegacy(dupDate)); assert.equal(r2.aggregate, "OPERATOR_ACTION_REQUIRED"); assert.ok(codes(r2).includes("duplicate_dates") && codes(r2).includes("duplicate_dates_acceptance"));
  const r2b = pre(X.asLegacy(dupDate), { resolvedActions: ["duplicate_dates_acceptance"] }); assert.equal(r2b.aggregate, "WARNING"); assert.equal(r2b.eligibility, "ELIGIBLE_WITH_WARNING");
  const maps = X.LEGACY_ROWS(); maps[0].supplier_payments = { 0: { name: "a", amount: "1" }, 1: { name: "b", amount: "2" } };
  const r3 = pre(X.asLegacy(maps)); assert.ok(codes(r3).includes("numeric_key_maps")); assert.equal(r3.aggregate, "WARNING"); assert.equal(r3.normalization.numericKeyMaps.rows.length, 1);
  const r4 = pre(null); assert.equal(r4.eligibility, "NOT_ELIGIBLE"); assert.ok(codes(r4).includes("absent_not_first_canary"));
  const r5 = pre(X.asV2(X.LEGACY_ROWS(), { keepV: true })); assert.equal(r5.aggregate, "BLOCKER"); assert.ok(codes(r5).includes("already_v2"));
  const r6 = pre({ _v: "[]", extra: 1 }); assert.ok(codes(r6).includes("unexpected_envelope_siblings")); assert.equal(r6.aggregate, "BLOCKER");
  const nf = X.LEGACY_ROWS(); nf[0].sales = "Infinity"; const r7 = pre(X.asLegacy(nf)); assert.ok(codes(r7).includes("non_finite_numeric"));
  const big = Array.from({ length: 501 }, (_, i) => X.row("b" + i, "2026-01-01")); const r8 = pre(X.asLegacy(big)); assert.ok(codes(r8).includes("above_rehearsed_cap")); assert.equal(r8.aggregate, "OPERATOR_ACTION_REQUIRED");
  const r9 = pre(X.asLegacy(X.LEGACY_ROWS()), { control: { contractVersion: 1, phase: "quiesced", policyRevision: 2, allowV2Initialization: false, minStorageProtocol: 1, operation: { id: "someone-else", kind: "cutover", owner: "eve", startedAt: 1 } } });
  assert.ok(codes(r9).includes("policy_quiesced_foreign_operation")); assert.equal(r9.aggregate, "BLOCKER");
  const r10 = pre(X.asLegacy(X.LEGACY_ROWS()), { control: X.ACTIVE() }); assert.ok(codes(r10).includes("policy_phase_not_migratable"));
  const r11 = pre(X.asLegacy(X.LEGACY_ROWS()), { context: ctx("Someone Else") }); assert.ok(codes(r11).includes("identity_mismatch")); assert.equal(r11.aggregate, "BLOCKER");
  const r12 = pre(X.asLegacy(X.LEGACY_ROWS()), { environment: { ...ENV, deployedRulesBlob: "0".repeat(40) } }); assert.ok(codes(r12).includes("rules_fingerprint_mismatch")); assert.equal(r12.aggregate, "BLOCKER");
  const r13 = pre(X.asLegacy(X.LEGACY_ROWS()), { environment: { ...ENV, deployedRulesBlob: null } }); assert.ok(codes(r13).includes("rules_fingerprint_unknown")); assert.equal(r13.aggregate, "OPERATOR_ACTION_REQUIRED");
  const r14 = pre(X.asLegacy(X.LEGACY_ROWS()), { environment: { ...ENV, mode: "production", repoSha: "f".repeat(40) } }); assert.ok(r14.findings.some((f) => f.code === "tool_identity_mismatch" && f.classification === "BLOCKER"));
  const r15 = pre(X.asLegacy(X.LEGACY_ROWS()), { environment: { ...ENV, repoSha: "f".repeat(40) } }); assert.ok(r15.findings.some((f) => f.code === "tool_identity_mismatch" && f.classification === "WARNING"));
  const r16 = pre(X.asLegacy(X.LEGACY_ROWS()), { readErrors: { entries: "permission_denied" } }); assert.ok(codes(r16).includes("read_failed")); assert.equal(r16.aggregate, "BLOCKER");
  const r17 = pre(X.asLegacy(X.LEGACY_ROWS()), { held: true, control: X.QUIESCED(), drain: null }); assert.ok(codes(r17).includes("final_preflight_conditions"));
  const r18 = pre(X.asLegacy(X.LEGACY_ROWS()), { held: true, control: X.QUIESCED(), drain: { verdict: "DRAIN_EVIDENCE_COMPLETE", binding: { status: "BOUND", mismatches: [] } } }); assert.ok(codes(r18).includes("final_held_conditions")); assert.equal(r18.aggregate, "PASS");
  const r19 = pre(X.asLegacy(X.LEGACY_ROWS()), { held: true, control: X.QUIESCED(), drain: { verdict: "DRAIN_EVIDENCE_COMPLETE" } }); assert.ok(codes(r19).includes("final_preflight_conditions"), "an unbound drain verdict is not enough");
});

function bundleFor(raw) {
  const exp = C.computeExpectedV2(raw, H); const ids = C.rowSummaries(exp.report.rows, H);
  return { source: raw, rawV: { present: true, sha256: C.rawVSha256(raw._v), bytes: C.utf8Bytes(raw._v) }, expectedV2: { digest: exp.digest }, sourceManifest: { rowCount: ids.rowCount, sortedIds: ids.sortedIds, dateGroups: ids.dateGroups, sourceDigest: C.digestV1(raw), normalization: exp.report.normalization }, node: exp.node, rows: exp.report.rows };
}
test("structural + logical comparison: expected node passes; every mutant fails (CT-14/15/17)", () => {
  const raw = X.asLegacy(X.LEGACY_ROWS()); const b = bundleFor(raw); const ctl = X.QUIESCED({ conversionAttempted: true });
  const ok = C.compareStructural({ bundle: b, actual: b.node, actualControl: ctl, manifest: m, H }); assert.deepEqual(ok.map((f) => f.code), ["structural_checkpoint"]);
  const lok = C.compareLogical({ sourceRows: b.rows, actual: b.node, H, normalization: b.sourceManifest.normalization }); assert.deepEqual(lok.map((f) => f.code), ["logical_checkpoint"]);
  const mut = (fn, expectCode, logical = false) => { const n = JSON.parse(JSON.stringify(b.node)); fn(n); const f = logical ? C.compareLogical({ sourceRows: b.rows, actual: n, H, normalization: b.sourceManifest.normalization }) : C.compareStructural({ bundle: b, actual: n, actualControl: ctl, manifest: m, H }); assert.ok(f.some((x) => x.code === expectCode && x.level === "STOP"), expectCode + " " + JSON.stringify(f.map((x) => x.code))); };
  const [id1, id2] = b.sourceManifest.sortedIds;
  mut((n) => { delete n.rows[id1]; }, "row_loss"); mut((n) => { n.rows.extra = { ...n.rows[id1], id: "extra" }; }, "unexplained_new_row");
  mut((n) => { n.rows[id1].sales = "999"; }, "expected_node_digest_mismatch"); mut((n) => { n.rows[id1].sales = "999"; }, "row_content_changed", true);
  mut((n) => { n.rows[id1].notes = "יום שקט"; }, "row_content_changed", true);
  mut((n) => { const a = n.rows[id1], c = n.rows[id2]; n.rows[id1] = { ...c, id: id1 }; n.rows[id2] = { ...a, id: id2 }; }, "date_group_changed");
  mut((n) => { n.rows[id1].unknown_field = "x"; }, "row_content_changed", true);
  mut((n) => { n.rows[id1].sales = 100; }, "row_content_changed", true);          // type change (string → number) is a change
  mut((n) => { n._v = n._v + " "; }, "frozen_v_changed"); mut((n) => { delete n._v; }, "frozen_v_missing"); mut((n) => { n.generation = 2; }, "generation_unexpected");
  mut((n) => { n.rows[id1]._gen = 2; }, "row_gen_mismatch"); mut((n) => { n.rows[id1].id = "other"; }, "row_key_id_mismatch");
  const wrongPhase = C.compareStructural({ bundle: b, actual: b.node, actualControl: X.ACTIVE(), manifest: m, H }); assert.ok(wrongPhase.some((f) => f.code === "unexpected_policy_change"));
  const noMarker = C.compareStructural({ bundle: b, actual: b.node, actualControl: X.QUIESCED(), manifest: m, H }); assert.ok(noMarker.some((f) => f.code === "conversion_marker_missing"));
  const active = C.compareStructural({ bundle: b, actual: b.node, actualControl: X.ACTIVE(), manifest: m, H, expectedPhase: "v2_active" }); assert.deepEqual(active.map((f) => f.code), ["structural_checkpoint"]);
  // a normalisation the core reported (null value dropped) is accepted; an unreported drop is not
  const rows = X.LEGACY_ROWS(); rows[0].weather_impact = null; const raw2 = X.asLegacy(rows); const b2 = bundleFor(raw2);
  const l2 = C.compareLogical({ sourceRows: b2.rows, actual: b2.node, H, normalization: b2.sourceManifest.normalization }); assert.deepEqual(l2.map((f) => f.code), ["logical_checkpoint"]);
  const l3 = C.compareLogical({ sourceRows: b2.rows, actual: b2.node, H, normalization: { rows: [] } }); assert.ok(l3.some((f) => f.code === "unreported_normalization"));
});

test("reader comparison: full-precision numbers, typed diff paths; classification order and recommendations (CT-24)", () => {
  const base = { daily: [{ date: "2026-09-01", revenue: 100.1 }], latestDate: "2026-09-01" };
  assert.deepEqual(C.compareReaders({ baseline: base, post: JSON.parse(JSON.stringify(base)) }).map((f) => f.code), ["reader_parity"]);
  const d = C.compareReaders({ baseline: base, post: { daily: [{ date: "2026-09-01", revenue: 100.10000000001 }], latestDate: "2026-09-01" } });
  assert.ok(d.some((f) => f.code === "financial_drift" && f.level === "STOP"), JSON.stringify(d));
  assert.deepEqual(C.deepDiff({ a: [1, "1"] }, { a: ["1", 1] }).length, 2);
  assert.equal(C.classify([{ code: "x", level: "OK" }]).level, "OK");
  const s = C.classify([{ code: "x", level: "WARNING" }, { code: "y", level: "STOP" }], { phase: "v2_active" }); assert.equal(s.level, "STOP"); assert.equal(s.recommendation, "RECOVERY_HOLD_RECOMMENDED"); assert.equal(s.exitCode, 12); assert.equal(s.automaticTransition, false);
  assert.equal(C.classify([{ code: "y", level: "STOP" }], { phase: "quiesced" }).recommendation, "REMAIN_QUIESCED");
  assert.equal(C.classify([{ code: "y", level: "REVIEW_REQUIRED" }]).recommendation, "INVESTIGATE_BEFORE_NEXT_BUSINESS");
  assert.equal(C.aggregateClassification([{ classification: "PASS" }, { classification: "OPERATOR_ACTION_REQUIRED", resolved: true }]), "PASS");
  assert.equal(C.aggregateClassification([{ classification: "WARNING" }, { classification: "BLOCKER" }]), "BLOCKER");
});

test("confirmation tokens bind identity, command, revision and source digest (CT-26)", () => {
  const t = C.confirmationToken({ manifest: m, command: "migrate", expectedRevision: 2, sourceDigest: "abc" });
  assert.match(t, /^[0-9a-f]{16}$/);
  assert.notEqual(t, C.confirmationToken({ manifest: m, command: "migrate", expectedRevision: 3, sourceDigest: "abc" }));
  assert.notEqual(t, C.confirmationToken({ manifest: m, command: "activate", expectedRevision: 2, sourceDigest: "abc" }));
  assert.notEqual(t, C.confirmationToken({ manifest: m, command: "migrate", expectedRevision: 2, sourceDigest: "abd" }));
  assert.notEqual(t, C.confirmationToken({ manifest: X.manifestFor({ bizId: "bizB" }), command: "migrate", expectedRevision: 2, sourceDigest: "abc" }));
  assert.notEqual(t, C.confirmationToken({ manifest: X.manifestFor({ operation: { id: "other" } }), command: "migrate", expectedRevision: 2, sourceDigest: "abc" }));
  assert.equal(C.checkConfirmation({ manifest: m, command: "migrate", expectedRevision: 2, sourceDigest: "abc", provided: t }).ok, true);
  assert.equal(C.checkConfirmation({ manifest: m, command: "migrate", expectedRevision: 2, sourceDigest: "abc", provided: "" }).reason, "confirmation_missing");
  assert.equal(C.checkConfirmation({ manifest: m, command: "migrate", expectedRevision: 2, sourceDigest: "abc", provided: t.toUpperCase() }).reason, "confirmation_mismatch");
});

test("R1-F4 monitoring calendar: 7 clean COMPLETE cycles on 7 ADJACENT business dates AND ≥168 h; missing day / INCOMPLETE / STOP / UNKNOWN break the streak; corrections count once; DST-neutral (CT-23)", () => {
  const rec = (date, cycle = "COMPLETE", level = "OK") => ({ cycleId: date, anchorDate: date, cycle, classification: { level } });
  const days = (from, n) => { const out = []; let d = from; for (let i = 0; i < n; i++) { out.push(d); d = C.nextBusinessDate(d); } return out; };
  const W = (records, hours = 200) => C.windowArithmetic({ records, liveWriteCleanupAt: "2026-09-01T05:00:00Z", now: new Date(Date.parse("2026-09-01T05:00:00Z") + hours * 3600000).toISOString() });
  assert.equal(C.nextBusinessDate("2026-09-30"), "2026-10-01"); assert.equal(C.nextBusinessDate("2026-12-31"), "2027-01-01"); assert.equal(C.nextBusinessDate("2028-02-28"), "2028-02-29");
  // A: Sep 1–7 complete + ≥168 h ⇒ pass
  const A = W(days("2026-09-01", 7).map((d) => rec(d)), 168); assert.equal(A.cleanStreak, 7); assert.equal(A.hoursMet, true); assert.equal(A.streakMet, true); assert.equal(A.windowMet, true);
  // B: Sep 1,2,4,5,6,7,8 (Sep 3 missing) ⇒ streak breaks at the gap: 5, not 7
  const B = W(["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"].map((d) => rec(d)), 200); assert.equal(B.cleanStreak, 5); assert.equal(B.streakStart, "2026-09-04"); assert.equal(B.windowMet, false, "missing calendar day breaks the streak");
  // C: 7 adjacent clean days but only 160 h ⇒ fail window (hours gate alone)
  const Cc = W(days("2026-09-01", 7).map((d) => rec(d)), 160); assert.equal(Cc.streakMet, true); assert.equal(Cc.hoursMet, false); assert.equal(Cc.windowMet, false);
  // D: ≥168 h but only 6 consecutive clean days ⇒ fail (streak gate alone)
  const D = W(days("2026-09-01", 6).map((d) => rec(d)), 300); assert.equal(D.hoursMet, true); assert.equal(D.streakMet, false); assert.equal(D.windowMet, false);
  // E / F / G: day 4 INCOMPLETE / STOP / UNKNOWN evidence ⇒ streak resets (later 4 days count from day 5)
  for (const [cycle, level] of [["INCOMPLETE", "REVIEW_REQUIRED"], ["INCOMPLETE", "STOP"], ["INCOMPLETE", "OK"]]) {
    const recs = days("2026-09-01", 8).map((d, i) => (i === 3 ? rec(d, cycle, level) : rec(d)));
    const r = W(recs, 300); assert.equal(r.cleanStreak, 4, cycle + "/" + level); assert.equal(r.streakStart, "2026-09-05"); assert.equal(r.windowMet, false);
  }
  const unknown = C.buildCycleRecord({ cycleId: "2026-09-04", anchorDate: "2026-09-04", manifest: m, now: "t", versions: { policy: { phase: "v2_active" }, storageMode: "v2" }, source: {}, mutations: { rowsStart: 3, creates: 0, deletes: 0, rowsEnd: 3 }, ui: {}, counters: {}, derived: { analyticsDaily: { status: "UNKNOWN" } }, reconciliation: { drift: [] } });
  assert.equal(C.isCleanCompleteCycle(unknown), false, "UNKNOWN derived evidence never counts as a clean complete day");
  // H: a corrected date is exactly one effective cycle (the correction supersedes; a duplicate never counts twice)
  const H = W([...days("2026-09-01", 7).map((d) => rec(d)), { ...rec("2026-09-04", "INCOMPLETE", "STOP"), correction: 1 }], 300); assert.equal(H.cycles, 7); assert.equal(H.cleanStreak, 3); assert.equal(H.windowMet, false);
  const H2 = W([...days("2026-09-01", 7).map((d) => rec(d)), { ...rec("2026-09-04"), correction: 1 }], 300); assert.equal(H2.cycles, 7); assert.equal(H2.cleanStreak, 7); assert.equal(H2.windowMet, true);
  const dup = W([...days("2026-09-01", 6).map((d) => rec(d)), rec("2026-09-06")], 300); assert.equal(dup.cycles, 6); assert.equal(dup.cleanStreak, 6, "a duplicate record for one date is one day");
  // I: DST transition (Israel leaves DST on 2026-10-25) across seven adjacent calendar dates ⇒ adjacency intact
  const I = C.windowArithmetic({ records: days("2026-10-22", 7).map((d) => rec(d)), liveWriteCleanupAt: "2026-10-21T05:00:00Z", now: "2026-10-29T05:00:00Z" }); assert.equal(I.cleanStreak, 7); assert.equal(I.windowMet, true);
  const before = C.slotMapping("2026-10-20", "Asia/Jerusalem"), after = C.slotMapping("2026-10-27", "Asia/Jerusalem");
  assert.equal(before.analytics.utc, "2026-10-20T23:00:00Z"); assert.match(before.analytics.local, /GMT\+3/); assert.match(after.analytics.local, /GMT\+2/);
  // seven records that are not adjacent at all never meet the streak, however many there are
  const sparse = W(["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07", "2026-09-09", "2026-09-11", "2026-09-13", "2026-09-15"].map((d) => rec(d)), 400); assert.equal(sparse.cleanStreak, 1); assert.equal(sparse.windowMet, false);
  // last cycle a STOP ⇒ not met even with an earlier 7-day streak
  const stopped = W([...days("2026-09-01", 7).map((d) => rec(d)), rec("2026-09-08", "INCOMPLETE", "STOP")], 300); assert.equal(stopped.windowMet, false); assert.deepEqual(stopped.stops, ["2026-09-08"]);
  assert.deepEqual(C.rowCountEquation({ rowsStart: 10, creates: 2, deletes: 1, rowsEnd: 11 }).ok, true); assert.equal(C.rowCountEquation({ rowsStart: 10, creates: 0, deletes: 0, rowsEnd: 9 }).ok, false);
  const r = C.buildCycleRecord({ cycleId: "2026-10-01", anchorDate: "2026-10-01", manifest: m, now: "2026-10-02T06:00:00Z", versions: { policy: { phase: "v2_active" }, generation: 1, generationPrev: 1, storageMode: "v2" }, source: { startDigest: "a", previousDigest: "a", rawVSha: "v", rawVShaPrev: "v" }, mutations: { rowsStart: 3, creates: 0, deletes: 0, rowsEnd: 3 }, ui: {}, counters: { oldClientWriteSucceeded: { value: 0 } }, derived: { analyticsDaily: { status: "PRESENT" }, snapshotEmail: { status: "UNKNOWN" } }, reconciliation: { drift: [] } });
  assert.equal(r.cycle, "INCOMPLETE"); assert.deepEqual(r.incompleteReasons, ["snapshotEmail"]); assert.ok(r.findings.some((f) => f.code === "derived_output_unknown"));
  const r2 = C.buildCycleRecord({ ...r, manifest: m, derived: { analyticsDaily: { status: "PRESENT" } }, counters: { oldClientWriteSucceeded: { value: 1 } } }); assert.equal(r2.classification.level, "STOP"); assert.ok(r2.findings.some((f) => f.code === "old_client_write_succeeded"));
  const r3 = C.buildCycleRecord({ ...r, manifest: m, derived: { analyticsDaily: { status: "PRESENT" } }, counters: {} }); assert.equal(r3.cycle, "COMPLETE"); assert.equal(r3.classification.level, "OK"); assert.equal(typeof r3.bodyDigest, "string");
});

test("R1-F3 drain binding helpers: start/mid/end + accepted digests + policy state; BOUND only on full agreement", () => {
  const s = (i, over = {}) => ({ at: `t${i}`, entries: "e", exceptions: "x", context: "c", control: "k", derived: "d", ...over });
  const b = C.drainBinding({ samples: [s(0), s(1), s(2)], control: X.QUIESCED(), manifest: m, derivedDate: "2026-09-25" });
  assert.deepEqual(b.accepted, { entries: "e", exceptions: "x", context: "c", control: "k", derived: "d" }); assert.equal(b.policyRevision, 2); assert.equal(b.phase, "quiesced"); assert.deepEqual(b.operation, { id: "canary-op-1", kind: "cutover", owner: "alice" });
  assert.equal(C.drainBinding({ samples: [s(0), s(1, { entries: "e2" }), s(2)], control: X.QUIESCED(), manifest: m }).accepted, null, "unstable ⇒ nothing accepted");
  const drain = { verdict: "DRAIN_EVIDENCE_COMPLETE", bound: b };
  const cur = { entries: "e", exceptions: "x", context: "c", control: "k" };
  assert.equal(C.checkDrainBinding({ drain, current: cur, control: X.QUIESCED(), manifest: m }).status, "BOUND");
  for (const k of ["entries", "exceptions", "context", "control"]) { const r = C.checkDrainBinding({ drain, current: { ...cur, [k]: "changed" }, control: X.QUIESCED(), manifest: m }); assert.equal(r.status, "STALE", k); assert.ok(r.mismatches.some((x) => x.key === k)); }
  assert.ok(C.checkDrainBinding({ drain, current: cur, control: X.QUIESCED({ policyRevision: 3 }), manifest: m }).mismatches.some((x) => x.key === "policyRevision"));
  assert.ok(C.checkDrainBinding({ drain, current: cur, control: X.QUIESCED({ operation: { id: "canary-op-1", kind: "cutover", owner: "eve", startedAt: 1 } }), manifest: m }).mismatches.some((x) => x.key === "operation"));
  assert.ok(C.checkDrainBinding({ drain, current: cur, control: X.POLICY(), manifest: m }).mismatches.some((x) => x.key === "phase"));
  assert.equal(C.checkDrainBinding({ drain, current: { ...cur, derived: "d2", derivedDate: "2026-09-25" }, control: X.QUIESCED(), manifest: m }).status, "STALE", "derived on the same day is bound");
  assert.equal(C.checkDrainBinding({ drain, current: { ...cur, derived: "d2", derivedDate: "2026-09-26" }, control: X.QUIESCED(), manifest: m }).status, "BOUND", "derived on another day is not comparable");
  assert.equal(C.checkDrainBinding({ drain: { verdict: "STABLE_INTERVAL", bound: b }, current: cur, control: X.QUIESCED(), manifest: m }).status, "UNPROVEN");
  assert.equal(C.checkDrainBinding({ drain: null, current: cur, control: X.QUIESCED(), manifest: m }).status, "MISSING");
  assert.ok(C.checkDrainBinding({ drain, current: cur, control: X.QUIESCED(), manifest: X.manifestFor({ bizId: "bizB" }) }).mismatches.some((x) => x.key === "target"));
  // held preflight: a STALE binding is an unresolved operator action and the held conditions are not met
  const H = C.helpersFrom(loadProductionWindow());
  const stale = { verdict: "DRAIN_EVIDENCE_COMPLETE", bound: b, binding: { status: "STALE", mismatches: [{ key: "entries" }] } };
  const pre = C.enhancedPreflight({ raw: X.asLegacy(X.LEGACY_ROWS()), control: X.QUIESCED(), exceptions: null, context: ctx(), manifest: m, H, environment: ENV, held: true, drain: stale });
  assert.ok(pre.findings.some((f) => f.code === "drain_evidence_stale" && f.classification === "OPERATOR_ACTION_REQUIRED")); assert.ok(pre.findings.some((f) => f.code === "final_preflight_conditions")); assert.equal(pre.aggregate, "OPERATOR_ACTION_REQUIRED");
  const ok = C.enhancedPreflight({ raw: X.asLegacy(X.LEGACY_ROWS()), control: X.QUIESCED(), exceptions: null, context: ctx(), manifest: m, H, environment: ENV, held: true, drain: { ...stale, binding: { status: "BOUND", mismatches: [] } } });
  assert.ok(ok.findings.some((f) => f.code === "final_held_conditions"));
});

test("drain verdict vocabulary: STABLE_INTERVAL / ATTESTED / DRAIN_EVIDENCE_COMPLETE, never 'proof' (CT-11)", () => {
  const s = (i, entries = "e") => ({ at: `2026-09-25T10:0${i}:00Z`, entries, exceptions: "x", context: "c", control: "k", derived: "d" });
  const base = { manifest: X.manifestFor({ environment: "production" }), control: X.QUIESCED(), writerBoundSeconds: 30, intervalSeconds: 120 };
  const full = C.drainVerdict({ ...base, samples: [s(0), s(1), s(2)], attestation: X.ATTESTATION() }); assert.equal(full.verdict, "DRAIN_EVIDENCE_COMPLETE"); assert.equal(full.proven, true); assert.equal(full.floorSeconds, 120);
  assert.equal(C.drainVerdict({ ...base, samples: [s(0), s(1), s(2)], attestation: null }).verdict, "STABLE_INTERVAL");
  const un = C.drainVerdict({ ...base, samples: [s(0), s(1, "e2"), s(2)], attestation: X.ATTESTATION() }); assert.equal(un.stable, false); assert.equal(un.proven, false); assert.ok(un.findings.some((f) => f.code === "unstable_fingerprint" && f.level === "STOP"));
  assert.equal(C.drainVerdict({ ...base, samples: [s(0), s(1)], attestation: X.ATTESTATION() }).stable, false, "fewer than 3 samples");
  assert.equal(C.drainVerdict({ ...base, writerBoundSeconds: NaN, samples: [s(0), s(1), s(2)], attestation: X.ATTESTATION() }).proven, false, "unknown W");
  assert.equal(C.drainVerdict({ ...base, intervalSeconds: 100, samples: [s(0), s(1), s(2)], attestation: X.ATTESTATION() }).proven, false, "below floor");
  assert.equal(C.drainVerdict({ ...base, control: X.POLICY(), samples: [s(0), s(1), s(2)], attestation: X.ATTESTATION() }).verdict, "INCOMPLETE");
  assert.equal(C.drainFloorSeconds(30), 120); assert.equal(C.drainFloorSeconds(100), 160); assert.equal(C.drainFloorSeconds(0, "emulator"), 1);
  assert.ok(!/proof|proves\b|mathematic/i.test(full.verdict + full.honesty.replace("proves nothing", "")));
});

test("live-check diffs: create/edit/delete reconcile; generation change and _v change are STOP (CT-20)", () => {
  const node = X.asV2(X.LEGACY_ROWS(), { keepV: true }); const ids = Object.keys(node.rows);
  const added = JSON.parse(JSON.stringify(node)); const nid = X.uuid("n"); added.rows[nid] = { ...X.LIVE_ROW(), id: nid, _gen: 1 };
  const c = C.liveCheckFindings({ action: "create", before: node, after: added, plannedRow: X.LIVE_ROW(), H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() });
  assert.deepEqual(c.diff.added, [nid]); assert.equal(C.classify(c.findings).level, "OK", JSON.stringify(c.findings));
  const edited = JSON.parse(JSON.stringify(added)); edited.rows[nid].sales = "34";
  const e = C.liveCheckFindings({ action: "edit", before: added, after: edited, editField: "sales", editValue: "34", liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() });
  assert.deepEqual(e.diff.changed.map((x) => x.id), [nid]); assert.equal(C.classify(e.findings).level, "OK", JSON.stringify(e.findings));
  const wrongRow = JSON.parse(JSON.stringify(added)); wrongRow.rows[ids[0]].sales = "34";
  const e2 = C.liveCheckFindings({ action: "edit", before: added, after: wrongRow, editField: "sales", editValue: "34", liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() }); assert.equal(C.classify(e2.findings).level, "STOP");
  const deleted = JSON.parse(JSON.stringify(edited)); delete deleted.rows[nid];
  const d = C.liveCheckFindings({ action: "delete", before: edited, after: deleted, liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() }); assert.deepEqual(d.diff.removed, [nid]); assert.equal(C.classify(d.findings).level, "OK", JSON.stringify(d.findings));
  const gen = { ...deleted, generation: 2, rows: undefined }; delete gen.rows;
  const g = C.liveCheckFindings({ action: "delete", before: edited, after: gen, liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() }); assert.ok(g.findings.some((f) => f.code === "generation_changed_without_clear" && f.level === "STOP"));
  const v = { ...deleted, _v: "[]" }; const vf = C.liveCheckFindings({ action: "delete", before: edited, after: v, liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE() }); assert.ok(vf.findings.some((f) => f.code === "frozen_v_changed"));
  const pol = C.liveCheckFindings({ action: "delete", before: edited, after: deleted, liveRowId: nid, H, policyBefore: X.ACTIVE(), policyAfter: X.ACTIVE({ policyRevision: 5 }) }); assert.ok(pol.findings.some((f) => /policy/.test(f.code) && f.level === "STOP"));
});

test("reconciliation states after an unknown outcome (CT-32)", () => {
  const raw = X.asLegacy(X.LEGACY_ROWS()); const b = bundleFor(raw);
  const st = (node, control) => C.reconcileStatus({ raw: node, control, bundle: b, manifest: m, H });
  assert.equal(st(raw, X.QUIESCED()).state, "A1_SOURCE_INTACT"); assert.equal(st(raw, X.QUIESCED({ conversionAttempted: true })).state, "A2_SOURCE_INTACT_AFTER_ATTEMPT");
  assert.equal(st(b.node, X.QUIESCED({ conversionAttempted: true })).state, "B_CONVERTED_HELD"); assert.equal(st(b.node, X.ACTIVE()).state, "C_ACTIVE_EXPECTED_V2");
  const h = st({ ...b.node, generation: 2 }, X.QUIESCED({ conversionAttempted: true })); assert.equal(h.state, "HOLD_UNRECOGNISED_STATE"); assert.equal(h.level, "STOP"); assert.equal(h.recommendation, "REMAIN_QUIESCED_AND_ESCALATE"); assert.equal(h.automaticTransition, false);
  assert.equal(st({ ...b.node, generation: 2 }, X.ACTIVE()).recommendation, "RECOVERY_HOLD_RECOMMENDED");
  assert.equal(C.reconcileStatus({ raw, control: X.QUIESCED({ conversionAttempted: true }), bundle: null, manifest: m, H }).state, "A2_ATTEMPTED_NO_EVIDENCE");
});
