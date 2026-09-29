// EV-1 COLLECTOR — offline failure matrix, scope completeness, reconciliation, safe output,
// environment refusal and read-only proof. No network, no Production, no real credential:
// every transport is an in-memory fixture or a fake `fetch`; the credential is a freshly
// generated throwaway RSA key in a temporary 0600 file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, symlinkSync, mkdirSync, statSync, readdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, createVerify } from "node:crypto";
import * as C from "../../tools/finance-core/ev1-collector.mjs";
import * as P from "../../tools/finance-core/ev1-preflight.mjs";
import { createFixtureTransport, createRestTransport } from "../../tools/finance-core/ev1-transport.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AS_OF = "2028-03-10";
const NOW = Date.UTC(2028, 2, 10, 10, 0, 0); // 2028-03-10 12:00 Israel
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const v = (rows) => ({ _v: JSON.stringify(rows) });
const reg = (...ids) => ({ _v: JSON.stringify(ids.map((id) => (typeof id === "string" ? { id, name: "Secret Bistro " + id } : id))) });
const CLEAN_ROW = (n, date = "2028-03-01") => ({ id: U(n), date, sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" });

function tree() {
  return {
    tenants: {
      t1: {
        app: { business: reg("b1", "b2"), users: { _v: JSON.stringify([{ email: "owner@secret.example", name: "Dana Secret" }]) } },
        roles: { uidA: "owner" }, members: { uidA: true },
        "biz:b1:entries": v([CLEAN_ROW(1), CLEAN_ROW(2, "2028-03-02")]),
        "biz:b1:config": { _v: "{}" },
        "biz:b2:entries": v([CLEAN_ROW(3)]),
      },
      t2: {
        app: { business: reg("c1") },
        "biz:c1:entries": v([CLEAN_ROW(4)]),
      },
    },
  };
}
async function run(tr, opts = {}) {
  const transport = createFixtureTransport(tr, opts.faults || {});
  const collected = await C.collect({ transport, asOfBusinessDate: AS_OF, ...(opts.classify ? { classify: opts.classify } : {}) });
  const report = C.buildReport({
    runId: "run-test", startedAt: "s", completedAt: "c",
    identity: { mode: "fixture", project: "fixture", databaseUrl: null, databaseHost: "fixture", asOfBusinessDate: AS_OF, credential: null, grantedPermissions: [], fixtureSha256: null },
    tool: { repoSha: null, treeClean: null, expectedCommit: null, nodeVersion: process.version, sourceDigests: {} },
    collected, requests: transport.requests,
  });
  return { report, transport };
}
const failed = (report) => report.invariants.filter((i) => !i.holds).map((i) => i.id);
const biz = (report, t, b) => report.scope.businesses.find((x) => x.tenantId === t && x.bizId === b);

// ── 1 / 4 / 25 ─────────────────────────────────────────────────────────────────────────────
test("01 all clean scopes ⇒ evidenceComplete true; counters reconcile", async () => {
  const { report } = await run(tree());
  assert.equal(report.evidenceComplete, true, failed(report).join(","));
  assert.equal(report.counters.tenants.discovered, 2);
  assert.equal(report.counters.tenants.attempted, 2);
  assert.equal(report.counters.businesses.discovered, 3);
  assert.equal(report.counters.businesses.attempted, 3);
  assert.equal(report.counters.businesses.readOk + report.counters.businesses.readFailed, 3);
  assert.equal(report.counters.rows.observed, 4);
  assert.equal(report.counters.rows.classified, 4);
  assert.equal(report.counters.rows.unclassifiable, 0);
  assert.ok(report.invariants.length >= 18 && report.invariants.every((i) => i.holds));
});

test("04/25 registered business with NO entries node ⇒ READ_OK_EMPTY, counted empty, evidence still complete", async () => {
  const tr = tree();
  tr.tenants.t1.app.business = reg("b1", "b2", "b3"); // b3 registered, never stored anything
  tr.tenants.t2["biz:c1:entries"] = v([]); // stored empty array
  const { report } = await run(tr);
  assert.equal(report.evidenceComplete, true, failed(report).join(","));
  assert.equal(biz(report, "t1", "b3").read.state, "READ_OK_EMPTY");
  assert.equal(biz(report, "t1", "b3").read.storageMode, "absent");
  assert.equal(biz(report, "t2", "c1").read.state, "READ_OK_EMPTY");
  assert.equal(report.counters.businesses.empty, 2);
  assert.equal(report.counters.businesses.registeredWithoutStoredData, 1);
  assert.equal(report.failures.length, 0);
});

test("25 successful null values: empty tenant root and absent registry are successful, not failures", async () => {
  const empty = await run({ tenants: null });
  assert.equal(empty.report.counters.tenants.discovered, 0);
  assert.equal(empty.report.failures.length, 0);
  assert.equal(empty.report.evidenceComplete, true);
  const tr = tree();
  delete tr.tenants.t2.app; // registry absent; c1 still discovered from stored keys
  const { report } = await run(tr);
  assert.equal(report.evidenceComplete, true, failed(report).join(","));
  assert.equal(report.scope.tenants.find((t) => t.tenantId === "t2").registry.state, "absent");
  assert.equal(biz(report, "t2", "c1").discovery.registered, false);
  assert.equal(report.counters.businesses.storedDataUnregistered, 1);
});

// ── 2 / 3 / 5 / 6 / 7 ──────────────────────────────────────────────────────────────────────
test("02 tenant discovery / tenant keys / registry read failure ⇒ false, failure recorded, never an empty set", async () => {
  for (const [key, code] of [["tenant_list", "http_status"], ["tenant_keys:t1", "unauthorized"], ["business_registry:t2", "timeout"]]) {
    const { report } = await run(tree(), { faults: { [key]: { code, status: code === "unauthorized" ? 401 : 503 } } });
    assert.equal(report.evidenceComplete, false, key);
    assert.ok(report.failures.some((f) => f.code === code), key);
  }
  const { report } = await run(tree(), { faults: { tenant_list: { code: "http_status", status: 500 } } });
  assert.deepEqual(failed(report).sort(), ["I01_tenant_enumeration_ok", "I15_no_failures"].sort());
  assert.equal(report.counters.tenants.discovered, 0, "a failed tenant list discovers nothing and says so");
});

test("03 one business read failure ⇒ false; the other businesses are still read", async () => {
  const { report } = await run(tree(), { faults: { "entries:t1/b2": { code: "http_status", status: 500 } } });
  assert.equal(report.evidenceComplete, false);
  assert.equal(biz(report, "t1", "b2").read.state, "READ_FAILED");
  assert.equal(report.counters.businesses.readFailed, 1);
  assert.equal(report.counters.businesses.readOk, 2);
  assert.ok(failed(report).includes("I08_no_business_read_failed"));
});

test("05 malformed entries node ⇒ typed STRUCTURE_BLOCKED, false", async () => {
  for (const node of [{ _v: "not json" }, { _v: "{\"a\":1}" }, 42, { schemaVersion: 2, generation: 0, rows: {} }, { schemaVersion: 7 }, { rows: {} }]) {
    const tr = tree();
    tr.tenants.t1["biz:b2:entries"] = node;
    const { report } = await run(tr);
    assert.equal(report.evidenceComplete, false, JSON.stringify(node));
    assert.equal(biz(report, "t1", "b2").read.state, "STRUCTURE_BLOCKED");
  }
});

test("06 unparseable HTTP-200 body (transport JSON failure) ⇒ false, never empty", async () => {
  for (const key of ["tenant_list", "tenant_keys:t1", "business_registry:t1", "entries:t2/c1"]) {
    const { report } = await run(tree(), { faults: { [key]: { rawBody: "<html>proxy error</html>" } } });
    assert.equal(report.evidenceComplete, false, key);
    assert.ok(report.failures.some((f) => f.code === "json_parse"), key);
  }
});

test("malformed discovery shapes (non-map shallow responses) ⇒ failure, never an empty scope", async () => {
  for (const [key, body, code] of [["tenant_list", '["t1","t2"]', "tenant_list_malformed"], ["tenant_list", '"t1"', "tenant_list_malformed"], ["tenant_keys:t1", "42", "tenant_keys_malformed"], ["tenant_keys:t2", '[true]', "tenant_keys_malformed"]]) {
    const { report } = await run(tree(), { faults: { [key]: { rawBody: body } } });
    assert.equal(report.evidenceComplete, false, key + " " + body);
    assert.ok(report.failures.some((f) => f.code === code), key + " " + body);
  }
});

test("07 classifier throws or returns unusable output ⇒ CLASSIFIER_FAILED, false", async () => {
  let calls = 0;
  const { classifyBusiness } = await import("../../tools/finance-core/ev1-classifier.mjs");
  const a = await run(tree(), { classify: (rows, asOf) => { calls += 1; if (calls === 2) throw Object.assign(new Error("boom"), { code: "boom" }); return classifyBusiness(rows, asOf); } });
  assert.equal(a.report.evidenceComplete, false);
  assert.equal(a.report.counters.businesses.classifierFailed, 1);
  assert.ok(failed(a.report).includes("I10_no_classifier_failure"));
  for (const bad of [() => null, () => ({ classifier: "EV1/2", rowsTotal: 0, malformedRows: 0 }), () => ({ classifier: "EV1/3", rowsTotal: 1, malformedRows: 0, leak: "Dana" })]) {
    const b = await run(tree(), { classify: bad });
    assert.equal(b.report.evidenceComplete, false);
    assert.ok(b.report.failures.every((f) => f.code === "classifier_output_invalid"));
  }
});

// ── 8 / 9 reconciliation ──────────────────────────────────────────────────────────────────
test("08 a discovered business silently omitted (or never attempted) ⇒ reconciliation fails", async () => {
  const { report } = await run(tree());
  const dropped = JSON.parse(JSON.stringify(report));
  dropped.scope.businesses = dropped.scope.businesses.filter((b) => b.bizId !== "b2");
  dropped.counters = C.computeCounters(dropped);
  dropped.classification.aggregate = C.aggregateClassification(dropped);
  const ev = C.evaluateReport(dropped);
  assert.equal(ev.evidenceComplete, false);
  assert.ok(ev.invariants.find((i) => i.id === "I05_one_business_record_per_discovered_business").holds === false);
  const notAttempted = JSON.parse(JSON.stringify(report));
  const x = notAttempted.scope.businesses.find((b) => b.bizId === "b2");
  x.read = { state: "NOT_ATTEMPTED" }; x.rows = null; x.classification = { state: "NOT_CLASSIFIED" };
  notAttempted.counters = C.computeCounters(notAttempted);
  notAttempted.classification.aggregate = C.aggregateClassification(notAttempted);
  const ev2 = C.evaluateReport(notAttempted);
  assert.equal(ev2.evidenceComplete, false);
  assert.ok(ev2.invariants.find((i) => i.id === "I06_businesses_attempted_eq_discovered").holds === false);
  const oneRead = JSON.parse(JSON.stringify(report));
  oneRead.reads.requests = oneRead.reads.requests.filter((r, i, a) => !(r.kind === "entries" && a.findIndex((q) => q.kind === "entries") === i));
  assert.equal(C.evaluateReport(oneRead).invariants.find((i) => i.id === "I18_exactly_one_entries_read_per_business").holds, false);
  const scopeTamper = JSON.parse(JSON.stringify(report));
  scopeTamper.scope.tenants[0].businessIds.pop();
  scopeTamper.scope.businesses = scopeTamper.scope.businesses.filter((b) => scopeTamper.scope.tenants[0].businessIds.includes(b.bizId) || b.tenantId !== scopeTamper.scope.tenants[0].tenantId);
  assert.equal(C.evaluateReport(scopeTamper).invariants.find((i) => i.id === "I19_scope_digest_matches").holds, false, "a shrunken scope no longer matches the recorded scope digest");
  const tampered = JSON.parse(JSON.stringify(report));
  tampered.counters.rows.observed += 1;
  assert.equal(C.evaluateReport(tampered).invariants.find((i) => i.id === "I13_counters_match_recomputation").holds, false);
});

test("09 duplicate discovery (registry twice + stored keys) merges identity only; a failed read stays visible", async () => {
  const tr = tree();
  tr.tenants.t1.app.business = reg("b1", "b2", "b2");
  const { report } = await run(tr, { faults: { "entries:t1/b2": { code: "http_status", status: 503 } } });
  assert.equal(report.scope.businesses.filter((b) => b.bizId === "b2").length, 1);
  assert.equal(biz(report, "t1", "b2").flags.duplicateRegistration, true);
  assert.equal(report.counters.businesses.duplicateRegistrations, 1);
  assert.equal(report.evidenceComplete, false);
  assert.equal(report.reads.requests.filter((r) => r.kind === "entries").length, report.counters.businesses.attempted);
});

test("discovery: registry entry without an id, non-array registry, unattributable biz: key, entries listed-but-absent ⇒ false", async () => {
  const cases = [
    (tr) => { tr.tenants.t1.app.business = reg("b1", { name: "no id" }); },
    (tr) => { tr.tenants.t1.app.business = { _v: "{\"b1\":true}" }; },
    (tr) => { tr.tenants.t1.app.business = { weird: 1 }; },
    (tr) => { tr.tenants.t1["biz::entries"] = v([]); },
    (tr) => { tr.tenants.t1.app.business = reg("b1", "b2", "x.y"); },
  ];
  for (const mutate of cases) {
    const tr = tree(); mutate(tr);
    const { report } = await run(tr);
    assert.equal(report.evidenceComplete, false, mutate.toString());
  }
  // listed-but-absent (race between listing and read)
  const tr = tree();
  const t = createFixtureTransport(tr);
  const inner = t.readEntries;
  t.readEntries = async (a, b) => (b === "b1" ? { ok: true, status: 200, value: null } : inner(a, b));
  const collected = await C.collect({ transport: t, asOfBusinessDate: AS_OF });
  assert.equal(collected.businesses.find((b) => b.bizId === "b1").read.code, "entries_listed_but_absent");
});

test("scope: unregistered stored data, self-id and explicitly-inactive businesses are censused, never skipped", async () => {
  const tr = tree();
  tr.tenants.t1.app.business = reg("b1", "t1", { id: "b9", active: false });
  tr.tenants.t1["biz:t1:entries"] = v([CLEAN_ROW(7)]);
  tr.tenants.t1["biz:b9:entries"] = v([CLEAN_ROW(8)]);
  const { report } = await run(tr); // b2 is no longer registered but still has stored data
  assert.equal(report.evidenceComplete, true, failed(report).join(","));
  assert.equal(biz(report, "t1", "b2").discovery.registered, false);
  assert.equal(biz(report, "t1", "b2").read.state, "READ_OK");
  assert.equal(biz(report, "t1", "t1").flags.selfId, true);
  assert.equal(biz(report, "t1", "b9").flags.explicitlyInactive, true);
  assert.equal(report.counters.businesses.discovered, 5);
});

// ── 10–22 raw input preserved and classified by EV1/3 ─────────────────────────────────────
test("10–22 every EV1/3 row state reaches the classifier unmodified and is counted", async () => {
  const rows = [
    CLEAN_ROW(1),                                                                      // 10 valid id
    { date: "2028-03-02", sales: "10" },                                               // 11 missing id
    { id: "not-a-uuid", date: "2028-03-02", sales: "10" },                            // 12 malformed id
    { id: U(5), date: "2028-03-03", sales: "10" }, { id: U(5), date: "2028-03-04", sales: "11" }, // 13 duplicate id
    { id: U(6), date: "2027-02-29", sales: "1" },                                       // 14 impossible date
    { id: U(7), date: "03/01/2028", sales: "1" },                                       // bad-shape date
    { id: U(8), date: "2028-03-05", supplier_payments: { s1: "100" }, food_cost: "70" }, // 15 supplier + legacy collision
    { id: U(9), date: "2028-03-05", supplier_payments: { s1: "0" }, sales: "5" },       // 16 supplier zero
    { id: U(10), date: "2028-03-05", supplier_payments: { s1: "skip" }, sales: "5" },   // 17 supplier skip
    { id: U(11), date: "2028-03-05", supplier_payments: { s1: "12,5" }, sales: "5" },   // 18 supplier invalid
    { id: U(12), date: "2028-03-06", food_cost: "0", sales: "5" },                      // 19 legacy food zero
    { id: U(13), date: "2028-03-06", food_cost: "abc", sales: "5" },                    // 19 legacy food invalid
    { id: U(14), date: "2028-03-06", sales: "9", payroll: "5", hourly_payroll: { w1: "7" } }, // 20 payroll + hourly_payroll
    { id: U(15), date: "2028-03-07", notes: "confidential note about Dana" },          // 21 notes-only
    { id: U(16), date: "2028-03-07", sales: "" },                                      // 22 no financial values (empty)
    { id: U(17), date: "2028-03-08", hourly_payroll: { w1: "50" } },                    // legacy hourly only
    { id: U(18), date: "2028-04-01", sales: "1" },                                      // future
    "garbage",                                                                         // unclassifiable (non-object)
  ];
  const tr = { tenants: { t1: { app: { business: reg("b1") }, "biz:b1:entries": v(rows) } } };
  const { report } = await run(tr);
  // R1 (Codex P1): the one non-object row is unclassifiable ⇒ evidence is INCOMPLETE; every other
  // census count is still produced and the unclassifiable row stays counted (never discarded).
  assert.equal(report.evidenceComplete, false);
  assert.deepEqual(failed(report).sort(), ["I15_no_failures", "I20_no_unclassifiable_rows"]);
  assert.deepEqual(report.failures, [{ scope: "classifier", tenantId: "t1", bizId: "b1", code: "rows_unclassifiable", count: 1 }]);
  const s = report.classification.b1Signals;
  assert.equal(report.counters.rows.observed, rows.length);
  assert.equal(report.counters.rows.unclassifiable, 1);
  assert.equal(report.counters.rows.classified, rows.length - 1);
  assert.equal(s.identity.missingIdRows, 1);
  assert.equal(s.identity.malformedIdRows, 1);
  assert.equal(s.identity.duplicateIdValues, 1);
  assert.equal(s.identity.duplicateIdRows, 2);
  assert.equal(s.identity.validIdRows, rows.length - 1 - 2);
  assert.equal(s.dates.impossibleDateRows, 1);
  assert.equal(s.dates.badShapeDateRows, 1);
  assert.equal(s.dates.futureRows, 1);
  assert.equal(s.purchases.supplierAndLegacyFoodCollisionRows, 1);
  assert.equal(s.purchases.supplierExplicitZeroRows, 1);
  assert.equal(s.purchases.supplierSkipRows, 1);
  assert.equal(s.purchases.supplierInvalidRows, 1);
  assert.equal(s.purchases.legacyFoodZeroRows, 1);
  assert.equal(s.purchases.legacyFoodInvalidRows, 1);
  assert.equal(s.labor.payrollAndHourlyPayrollRows, 1);
  assert.equal(s.labor.legacyHourlyPayrollRows, 2);
  assert.equal(s.rowQuality.notesOnlyRows, 1);
  assert.equal(s.rowQuality.emptyRows, 1);
  assert.equal(s.rowQuality.noFinancialValueRows, 3); // notes-only + empty + hourly-only
  assert.equal(s.rowQuality.malformedRows, 1);
  // exclusive equations hold on real classifier output
  assert.ok(report.invariants.find((i) => i.id === "I12_per_business_exclusive_equations").holds);
});

// ── safe output + bundle ───────────────────────────────────────────────────────────────────
function tmpOut() { const base = mkdtempSync(join(tmpdir(), "ev1c-")); return join(base, "run"); }
test("bundle: private modes, COMPLETE.json last binds digests, verify passes; no payload/secret leaks", async () => {
  const tr = tree();
  tr.tenants.t1["biz:b1:entries"] = v([{ ...CLEAN_ROW(1), sales: "987654.32", notes: "call Dana at owner@secret.example", supplier_payments: { s1: "55555.55" } }]);
  const { report } = await run(tr);
  const out = tmpOut();
  C.writeBundle(out, report, {});
  assert.equal(statSync(out).mode & 0o777, 0o700);
  const names = readdirSync(out).sort();
  assert.deepEqual(names, ["COMPLETE.json", "EV1_REPORT.json", "EV1_SUMMARY.md", "PRE_FLIGHT.md"]);
  for (const f of names) assert.equal(statSync(join(out, f)).mode & 0o777, 0o600, f);
  const all = names.map((f) => readFileSync(join(out, f), "utf8")).join("\n");
  for (const leak of ["987654", "55555", "Dana", "owner@secret.example", "Secret Bistro", "call ", U(1), "2028-03-01", "uidA"]) assert.equal(all.includes(leak), false, "leaks " + leak);
  const v1 = C.verifyBundle(out);
  assert.deepEqual(v1, { ok: true, evidenceComplete: true, problems: [] });
  const complete = JSON.parse(readFileSync(join(out, "COMPLETE.json"), "utf8"));
  assert.equal(complete.scopeDigest, report.scope.scopeDigest);
  assert.deepEqual(complete.sourceDigests, report.tool.sourceDigests);
  assert.deepEqual(Object.keys(complete.files).sort(), ["EV1_REPORT.json", "EV1_SUMMARY.md", "PRE_FLIGHT.md"]);
  const cpath = join(out, "COMPLETE.json");
  chmodSync(cpath, 0o600);
  writeFileSync(cpath, JSON.stringify({ ...complete, asOfBusinessDate: "2028-03-09" }));
  assert.ok(C.verifyBundle(out).problems.some((p) => /asOfBusinessDate mismatch/.test(p)));
  writeFileSync(cpath, JSON.stringify(complete));
  // tamper ⇒ verify fails
  chmodSync(join(out, "EV1_SUMMARY.md"), 0o644);
  writeFileSync(join(out, "EV1_SUMMARY.md"), "edited");
  const v2 = C.verifyBundle(out);
  assert.equal(v2.ok, false);
  assert.ok(v2.problems.some((p) => /digest mismatch/.test(p)));
  // an existing output directory is never reused
  assert.throws(() => C.writeBundle(out, report, {}));
});

test("bundle: incomplete evidence is preserved with evidenceComplete false; verify reports incomplete", async () => {
  const { report } = await run(tree(), { faults: { "entries:t1/b1": { code: "http_status", status: 500 } } });
  const out = tmpOut();
  C.writeBundle(out, report, {});
  const complete = JSON.parse(readFileSync(join(out, "COMPLETE.json"), "utf8"));
  assert.equal(complete.evidenceComplete, false);
  const vb = C.verifyBundle(out);
  assert.equal(vb.ok, true);
  assert.equal(vb.evidenceComplete, false);
});

test("secret scan refuses to write credential/token material", async () => {
  const { report } = await run(tree());
  report.failures.push({ scope: "x", code: "Bearer abc" });
  assert.throws(() => C.writeBundle(tmpOut(), report, {}), (e) => e.code === "report_would_leak_secret");
});

// ── 23 / 24 environment refusal before any transport ──────────────────────────────────────
function credFile({ project = "kissgn-1227b", mode = 0o600, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ev1cred-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const p = join(dir, "sa.json");
  writeFileSync(p, JSON.stringify({ type: "service_account", project_id: project, private_key_id: "fixture-key-id-0001", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), client_email: "ev1-reader@fixture.iam.example", token_uri: "https://oauth2.googleapis.com/token", ...extra }));
  chmodSync(p, mode);
  return p;
}
const GOOD_SHA = "a".repeat(40);
function prodArgs(over = {}) {
  const a = { env: "production", project: "kissgn-1227b", "database-url": "https://kissgn-1227b-default-rtdb.firebaseio.com", "credentials-file": credFile(), "as-of": AS_OF, "expected-commit": GOOD_SHA, "out-dir": tmpOut(), ...over };
  return Object.entries(a).filter(([, x]) => x !== null).flatMap(([k, x]) => (x === true ? [`--${k}`] : [`--${k}`, String(x)]));
}
async function mainRun(args, { env = {}, fetchImpl, repo = { headSha: GOOD_SHA, treeClean: true } } = {}) {
  const calls = [];
  const logs = [];
  const f = fetchImpl || (async (url, init) => { calls.push({ url, method: init.method }); throw new Error("network must not be reached"); });
  const code = await C.main(args, { processEnv: env, fetchImpl: async (u, i) => { calls.push({ url: String(u), method: i.method }); return f(u, i); }, nowMs: NOW, repoIdentityImpl: () => repo, log: (s) => logs.push(s), logErr: (s) => logs.push(s) });
  return { code, calls, logs };
}

test("23/24 forbidden or mismatched environment ⇒ refused (exit 2) before any network request", async () => {
  const sym = (() => { const target = credFile(); const l = join(dirname(target), "link.json"); symlinkSync(target, l); return l; })();
  const gitDir = mkdtempSync(join(tmpdir(), "ev1git-")); mkdirSync(join(gitDir, ".git"));
  const cases = [
    ["project mismatch", prodArgs({ project: "other-project" }), {}],
    ["placeholder project", prodArgs({ project: "<project>" }), {}],
    ["database mismatch", prodArgs({ "database-url": "https://other-1-default-rtdb.firebaseio.com" }), {}],
    ["localhost database", prodArgs({ "database-url": "http://localhost:9000" }), {}],
    ["emulator-style ?ns URL", prodArgs({ "database-url": "https://kissgn-1227b-default-rtdb.firebaseio.com/?ns=kissgn-1227b" }), {}],
    ["emulator leakage", prodArgs(), { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" }],
    ["ADC leakage", prodArgs(), { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/other.json" }],
    ["alternate credential var", prodArgs(), { FIREBASE_SA_PRIVATE_KEY: "x" }],
    ["missing credential", prodArgs({ "credentials-file": null }), {}],
    ["nonexistent credential", prodArgs({ "credentials-file": "/nonexistent/sa.json" }), {}],
    ["symlink credential", prodArgs({ "credentials-file": sym }), {}],
    ["broad credential mode", prodArgs({ "credentials-file": credFile({ mode: 0o644 }) }), {}],
    ["credential project mismatch", prodArgs({ "credentials-file": credFile({ project: "someone-else" }) }), {}],
    ["unexpected token_uri", prodArgs({ "credentials-file": credFile({ extra: { token_uri: "https://evil.example/token" } }) }), {}],
    ["as-of missing", prodArgs({ "as-of": null }), {}],
    ["as-of impossible", prodArgs({ "as-of": "2027-02-29" }), {}],
    ["as-of in the future", prodArgs({ "as-of": "2028-03-11" }), {}],
    ["expected commit missing", prodArgs({ "expected-commit": null }), {}],
    ["commit mismatch", prodArgs({ "expected-commit": "b".repeat(40) }), {}],
    ["env flag missing", prodArgs({ env: null }), {}],
    ["fixture flag in production", [...prodArgs(), "--fixture", "x.json"], {}],
    ["out-dir inside git", prodArgs({ "out-dir": join(gitDir, "run") }), {}],
    ["out-dir exists", prodArgs({ "out-dir": tmpdir() }), {}],
  ];
  for (const [name, args, env] of cases) {
    const r = await mainRun(args, { env });
    assert.equal(r.code, 2, name + " → " + r.logs.join(" "));
    assert.equal(r.calls.length, 0, name + " reached the network");
  }
  const dirty = await mainRun(prodArgs(), { repo: { headSha: GOOD_SHA, treeClean: false } });
  assert.equal(dirty.code, 2);
  assert.equal(dirty.calls.length, 0);
});

// ── production transport with a fake fetch: GET-only reads, scope proof, fail-closed ──────
function fakeGoogle(tr, { perms = ["firebasedatabase.instances.get", "firebasedatabase.instances.list"], tokenStatus = 200, iamStatus = 200, rtdb = null } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    seen.push({ method: init.method, host: u.host, path: u.pathname, search: u.search, auth: init.headers && init.headers.Authorization });
    const res = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
    if (u.host === "oauth2.googleapis.com") {
      const assertion = new URLSearchParams(init.body).get("assertion");
      assert.equal(assertion.split(".").length, 3);
      return res(tokenStatus, { access_token: "ya29.fixture-token-value", expires_in: 3600 });
    }
    if (u.host === "cloudresourcemanager.googleapis.com") return res(iamStatus, { permissions: perms });
    assert.equal(u.host, "kissgn-1227b-default-rtdb.firebaseio.com");
    if (rtdb) { const r = rtdb(u); if (r) return res(r.status, r.body); }
    const segs = u.pathname.replace(/\.json$/, "").split("/").filter(Boolean).map(decodeURIComponent);
    let node = tr;
    for (const s of segs) node = node && typeof node === "object" ? node[s] : undefined;
    if (node === undefined) node = null;
    if (u.searchParams.get("shallow") === "true" && node && typeof node === "object") node = Object.fromEntries(Object.keys(node).map((k) => [k, true]));
    return res(200, node);
  };
  return { fetchImpl, seen };
}

test("production path (fake fetch): token + IAM proof, then GET-only reads; complete bundle; no token/key in output", async () => {
  const g = fakeGoogle(tree());
  const out = tmpOut();
  const r = await mainRun(prodArgs({ "out-dir": out }), { fetchImpl: g.fetchImpl });
  assert.equal(r.code, 0, r.logs.join(" "));
  const nonGet = g.seen.filter((x) => x.method !== "GET");
  assert.deepEqual(nonGet.map((x) => x.host), ["oauth2.googleapis.com", "cloudresourcemanager.googleapis.com"]);
  const db = g.seen.filter((x) => x.host.endsWith("firebaseio.com"));
  assert.ok(db.length >= 1 && db.every((x) => x.method === "GET"), "every database request is GET");
  assert.equal(db.filter((x) => /biz%3A.*%3Aentries\.json$/.test(x.path)).length, 3, "exactly one entries read per business");
  const all = readdirSync(out).map((f) => readFileSync(join(out, f), "utf8")).join("\n");
  for (const leak of ["ya29.fixture-token-value", "ev1-reader@fixture.iam.example", "PRIVATE KEY", "fixture-key-id-0001", "Dana"]) assert.equal(all.includes(leak), false, leak);
  const report = JSON.parse(readFileSync(join(out, "EV1_REPORT.json"), "utf8"));
  assert.equal(report.environmentIdentity.mode, "production");
  assert.equal(report.evidenceComplete, true);
  assert.deepEqual(C.verifyBundle(out), { ok: true, evidenceComplete: true, problems: [] });
});

test("production path: broad credential, IAM failure or token failure ⇒ refused before ANY database read", async () => {
  for (const opts of [{ perms: ["firebasedatabase.instances.get", "firebasedatabase.instances.update"] }, { iamStatus: 403 }, { tokenStatus: 400 }, { perms: [] }]) {
    const g = fakeGoogle(tree(), opts);
    const r = await mainRun(prodArgs(), { fetchImpl: g.fetchImpl });
    assert.equal(r.code, 3, JSON.stringify(opts));
    assert.equal(g.seen.filter((x) => x.host.endsWith("firebaseio.com")).length, 0, "no database read: " + JSON.stringify(opts));
  }
});

test("production path: 401/403, 5xx, unparseable body and network errors on reads ⇒ incomplete bundle (exit 10)", async () => {
  const variants = [
    (u) => (u.pathname.includes("biz%3Ab2%3Aentries") ? { status: 401, body: { error: "Permission denied" } } : null),
    (u) => (u.pathname === "/tenants.json" ? { status: 503, body: "unavailable" } : null),
    (u) => (u.pathname.includes("app/business") ? { status: 200, body: "{not json" } : null),
  ];
  for (const rtdb of variants) {
    const g = fakeGoogle(tree(), { rtdb });
    const out = tmpOut();
    const r = await mainRun(prodArgs({ "out-dir": out }), { fetchImpl: g.fetchImpl });
    assert.equal(r.code, 10);
    assert.equal(JSON.parse(readFileSync(join(out, "EV1_REPORT.json"), "utf8")).evidenceComplete, false);
  }
  const g = fakeGoogle(tree());
  const flaky = async (url, init) => { if (String(url).includes("biz%3Ac1%3Aentries")) throw new Error("ECONNRESET"); return g.fetchImpl(url, init); };
  const out = tmpOut();
  const r = await mainRun(prodArgs({ "out-dir": out }), { fetchImpl: flaky });
  assert.equal(r.code, 10);
  const rep = JSON.parse(readFileSync(join(out, "EV1_REPORT.json"), "utf8"));
  assert.ok(rep.failures.some((f) => f.code === "network"));
});

test("JWT assertion is RS256-signed by the credential key with exactly the declared scopes (read-only guarantee comes from the IAM proof)", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { signJwtAssertion, RTDB_SCOPES } = await import("../../tools/finance-core/ev1-transport.mjs");
  const jwt = signJwtAssertion({ client_email: "x@y.example", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }, 1000);
  const [h, c, s] = jwt.split(".");
  const ver = createVerify("RSA-SHA256"); ver.update(h + "." + c);
  assert.ok(ver.verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")));
  const claims = JSON.parse(Buffer.from(c, "base64").toString());
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.deepEqual(claims.scope.split(" "), RTDB_SCOPES);
});

// ── fixture CLI + verify CLI ───────────────────────────────────────────────────────────────
test("CLI: offline fixture run ⇒ exit 0 and a verifiable bundle; --verify exit codes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ev1fx-"));
  const fx = join(dir, "tree.json");
  writeFileSync(fx, JSON.stringify({ tree: tree() }));
  const out = join(dir, "run");
  const r = await mainRun(["--fixture", fx, "--as-of", AS_OF, "--out-dir", out]);
  assert.equal(r.code, 0, r.logs.join(" "));
  assert.equal(r.calls.length, 0, "fixture mode never uses the network");
  const logs = [];
  assert.equal(await C.main(["--verify", out], { log: (s) => logs.push(s) }), 0);
  assert.match(logs[0], /EV1_BUNDLE_VERIFIED_COMPLETE/);
  const fx2 = join(dir, "tree2.json");
  writeFileSync(fx2, JSON.stringify({ tree: tree(), faults: { "entries:t2/c1": { code: "http_status", status: 500 } } }));
  const out2 = join(dir, "run2");
  assert.equal((await mainRun(["--fixture", fx2, "--as-of", AS_OF, "--out-dir", out2])).code, 10);
  assert.equal(await C.main(["--verify", out2], { log: () => {} }), 10);
  assert.equal(await C.main(["--verify", join(dir, "nope")], { log: () => {} }), 10);
  assert.equal((await mainRun(["--fixture", fx, "--as-of", AS_OF, "--out-dir", out2, "--credentials-file", "x"])).code, 2, "fixture never takes production inputs");
});

// ── read-only proof (static) ───────────────────────────────────────────────────────────────
function importGraph(entry) {
  const seen = new Map();
  const visit = (abs) => {
    if (seen.has(abs)) return;
    const src = readFileSync(abs, "utf8");
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const dyn = [...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    const req = [...src.matchAll(/\brequire\s*\(/g)];
    seen.set(abs, { src, specs: [...specs, ...dyn], hasRequire: req.length > 0 });
    for (const s of [...specs, ...dyn]) if (s.startsWith(".")) visit(join(dirname(abs), s));
  };
  visit(entry);
  return seen;
}
test("read-only proof: collector import graph = 5 repo modules + allow-listed node builtins; no write API reachable", () => {
  const g = importGraph(join(REPO, "tools/finance-core/ev1-collector.mjs"));
  const files = [...g.keys()].map((f) => f.slice(REPO.length + 1)).sort();
  assert.deepEqual(files, [...C.SOURCE_FILES].sort());
  const bare = new Set([...g.values()].flatMap((m) => m.specs.filter((s) => !s.startsWith("."))));
  assert.deepEqual([...bare].sort(), ["node:child_process", "node:crypto", "node:fs", "node:path", "node:url"]);
  for (const [f, m] of g) {
    const rel = f.slice(REPO.length + 1);
    assert.equal(m.hasRequire, false, rel + " uses require()");
    assert.doesNotMatch(m.src, /firebase-admin|["']firebase\/|@firebase\/|firebase\/database|admin\.database|\.ref\(|runTransaction|\bset\(ref|\bupdate\(ref|\bremove\(ref|\bpush\(ref/, rel);
    assert.doesNotMatch(m.src, /method:\s*["'](PUT|PATCH|DELETE)["']|x-http-method-override|print=silent/i, rel);
    for (const s of m.specs) assert.doesNotMatch(s, /gate0|remediation|entry-id|canary|upgrade|policy|storage-v2|firebase/i, rel + " imports " + s);
    if (rel !== "tools/finance-core/ev1-transport.mjs") assert.doesNotMatch(m.src, /\bfetch(Impl)?\s*\(/, rel + " performs network I/O outside the transport");
    if (rel !== "tools/finance-core/ev1-collector.mjs") assert.doesNotMatch(m.src, /child_process|spawnSync|execSync|execFile|\bspawn\(|(^|[^.\w])exec\(/, rel);
  }
  const collector = g.get(join(REPO, "tools/finance-core/ev1-collector.mjs")).src;
  const spawns = [...collector.matchAll(/spawnSync\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(spawns, ['"git", GIT_HEAD, { cwd: root, encoding: "utf8" }', '"git", GIT_STATUS, { cwd: root, encoding: "utf8" }']);
  assert.match(collector, /GIT_HEAD = Object\.freeze\(\["--no-optional-locks", "rev-parse", "HEAD"\]\)/);
  assert.match(collector, /GIT_STATUS = Object\.freeze\(\["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"\]\)/);
  const transport = g.get(join(REPO, "tools/finance-core/ev1-transport.mjs")).src;
  const methods = [...transport.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(methods, ["POST", "POST", "GET", "GET"], "token POST, IAM POST, database GET (+ fixture record)");
});

test("fail-open patterns are absent from the collector modules", () => {
  for (const f of ["tools/finance-core/ev1-collector.mjs", "tools/finance-core/ev1-transport.mjs", "tools/finance-core/ev1-preflight.mjs"]) {
    const src = readFileSync(join(REPO, f), "utf8");
    assert.doesNotMatch(src, /catch\s*(\([^)]*\))?\s*\{\s*return\s*(\[\]|\{\}|null|undefined)\s*;?\s*\}/, f + " swallows a failure into an empty value");
    assert.doesNotMatch(src, /\.catch\(\s*\(\)\s*=>\s*(\[\]|\{\}|null)/, f);
    assert.doesNotMatch(src, /catch\s*(\([^)]*\))?\s*\{\s*\}/, f + " has an empty catch");
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// REMEDIATION R1 — Codex re-review findings P1 (unclassifiable rows) and P2 (closed bundle),
// plus the Codex-recommended GCLOUD_* relaxation. Offline only.
// ════════════════════════════════════════════════════════════════════════════════════════════
const sha = (b) => createHash("sha256").update(b).digest("hex");
const holds = (report, id) => report.invariants.find((i) => i.id === id).holds;
async function bundleOf(tr, opts = {}) {
  const { report } = await run(tr, opts);
  const out = tmpOut();
  C.writeBundle(out, report, {});
  return { out, report };
}
/** Rewrite one bundle file and re-bind its digest in COMPLETE.json (an attacker with write access). */
function forge(out, file, mutate, completeMutate = (c) => c) {
  const p = join(out, file);
  const next = mutate(readFileSync(p, "utf8"));
  writeFileSync(p, next);
  const cp = join(out, "COMPLETE.json");
  const complete = JSON.parse(readFileSync(cp, "utf8"));
  if (file !== "COMPLETE.json") complete.files[file] = sha(next);
  writeFileSync(cp, JSON.stringify(completeMutate(complete), null, 2) + "\n");
}

// ── P1 — unclassifiable rows ⇒ evidenceComplete false ─────────────────────────────────────
test("R1-P1-1 clean, fully classifiable evidence ⇒ evidenceComplete true; I20 holds", async () => {
  const { report } = await run(tree());
  assert.equal(report.evidenceComplete, true, failed(report).join(","));
  assert.equal(holds(report, "I20_no_unclassifiable_rows"), true);
  assert.equal(report.invariants.length, 20);
  assert.equal(report.counters.rows.unclassifiable, 0);
});

test("R1-P1-2 exactly one unclassifiable row ⇒ false; counted, typed failure, bundle and --verify incomplete, CLI exit 10", async () => {
  const tr = tree();
  tr.tenants.t1["biz:b1:entries"] = v([CLEAN_ROW(1), "garbage"]);
  const { report } = await run(tr);
  assert.equal(report.evidenceComplete, false);
  assert.deepEqual(failed(report).sort(), ["I15_no_failures", "I20_no_unclassifiable_rows"]);
  assert.deepEqual(report.failures, [{ scope: "classifier", tenantId: "t1", bizId: "b1", code: "rows_unclassifiable", count: 1 }]);
  assert.deepEqual(biz(report, "t1", "b1").rows, { observed: 2, classified: 1, unclassifiable: 1 });
  assert.equal(biz(report, "t1", "b1").classification.state, "CLASSIFIED", "safe aggregate counts are preserved");
  assert.equal(report.counters.rows.unclassifiable, 1);
  const out = tmpOut();
  C.writeBundle(out, report, {});
  assert.equal(readFileSync(join(out, "EV1_REPORT.json"), "utf8").includes("garbage"), false, "row content is never persisted");
  assert.equal(JSON.parse(readFileSync(join(out, "COMPLETE.json"), "utf8")).evidenceComplete, false);
  assert.deepEqual(C.verifyBundle(out), { ok: true, evidenceComplete: false, problems: [] });
  const dir = mkdtempSync(join(tmpdir(), "ev1r1-"));
  const fx = join(dir, "tree.json");
  writeFileSync(fx, JSON.stringify({ tree: tr }));
  const r = await mainRun(["--fixture", fx, "--as-of", AS_OF, "--out-dir", join(dir, "run")]);
  assert.equal(r.code, 10, r.logs.join(" "));
  assert.match(r.logs.join(" "), /EV1_EVIDENCE_INCOMPLETE/);
  const logs = [];
  assert.equal(await C.main(["--verify", join(dir, "run")], { log: (x) => logs.push(x) }), 10);
  assert.match(logs[0], /EV1_BUNDLE_VERIFIED_INCOMPLETE/);
});

test("R1-P1-3 multiple unclassifiable rows across businesses ⇒ false; one failure per business with its count", async () => {
  const tr = tree();
  tr.tenants.t1["biz:b1:entries"] = v([CLEAN_ROW(1), null, 5, [], "x"]);
  tr.tenants.t2["biz:c1:entries"] = v(["y", CLEAN_ROW(4)]);
  const { report } = await run(tr);
  assert.equal(report.evidenceComplete, false);
  assert.equal(holds(report, "I20_no_unclassifiable_rows"), false);
  assert.equal(report.counters.rows.unclassifiable, 5);
  assert.equal(report.counters.rows.observed, report.counters.rows.classified + 5);
  assert.deepEqual(report.failures.filter((f) => f.code === "rows_unclassifiable").map((f) => [f.tenantId, f.bizId, f.count]), [["t1", "b1", 4], ["t2", "c1", 1]]);
  assert.equal(holds(report, "I11_rows_observed_eq_classified_plus_unclassifiable"), true);
  assert.equal(holds(report, "I12_per_business_exclusive_equations"), true);
});

test("R1-P1-4 stored counters/partitions claiming zero unclassifiable while the partitions show otherwise ⇒ recomputation fails", async () => {
  const tr = tree();
  tr.tenants.t1["biz:b1:entries"] = v([CLEAN_ROW(1), "garbage"]);
  const base = (await run(tr)).report;
  const clone = () => JSON.parse(JSON.stringify(base));
  // (a) counters forged to zero; per-business partitions still show 1
  const a = clone(); a.counters.rows.unclassifiable = 0; a.counters.rows.classified += 1; a.failures = []; a.counters.failures = 0;
  const ea = C.evaluateReport(a);
  assert.equal(ea.evidenceComplete, false);
  for (const id of ["I13_counters_match_recomputation", "I20_no_unclassifiable_rows"]) assert.equal(ea.invariants.find((i) => i.id === id).holds, false, id);
  // (b) the business partition forged to zero; the classifier's malformedRows still says 1
  const b = clone(); const bb = b.scope.businesses.find((x) => x.bizId === "b1"); bb.rows.unclassifiable = 0; bb.rows.classified = bb.rows.observed;
  b.failures = []; b.counters = C.computeCounters(b);
  const eb = C.evaluateReport(b);
  assert.equal(eb.evidenceComplete, false);
  for (const id of ["I12_per_business_exclusive_equations", "I20_no_unclassifiable_rows"]) assert.equal(eb.invariants.find((i) => i.id === id).holds, false, id);
  // (c) only the typed failure removed and the boolean flipped: still recomputed as incomplete
  const c = clone(); c.failures = []; c.counters.failures = 0; c.evidenceComplete = true;
  const ec = C.evaluateReport(c);
  assert.equal(ec.evidenceComplete, false);
  assert.equal(ec.invariants.find((i) => i.id === "I20_no_unclassifiable_rows").holds, false);
});

test("R1-P1-5 --verify recomputes: a bundle forged to evidenceComplete:true over unclassifiable rows is rejected", async () => {
  const tr = tree();
  tr.tenants.t1["biz:b1:entries"] = v([CLEAN_ROW(1), "garbage"]);
  const { out } = await bundleOf(tr);
  // forge the report: boolean true, all invariants "holding", failure removed, counters zeroed; re-bind digests
  forge(out, "EV1_REPORT.json", (text) => {
    const r = JSON.parse(text);
    r.evidenceComplete = true; r.failures = []; r.counters.failures = 0;
    r.counters.rows.unclassifiable = 0; r.counters.rows.classified = r.counters.rows.observed;
    r.invariants = r.invariants.map((i) => ({ id: i.id, holds: true }));
    return JSON.stringify(r, null, 2) + "\n";
  }, (c) => ({ ...c, evidenceComplete: true }));
  const vb = C.verifyBundle(out);
  assert.equal(vb.ok, false);
  assert.equal(vb.evidenceComplete, false);
  assert.ok(vb.problems.includes("recorded evidenceComplete conflicts with the recomputed value"), vb.problems.join("; "));
  assert.ok(vb.problems.includes("COMPLETE.json evidenceComplete conflicts with the recomputed value"));
  assert.ok(vb.problems.includes("recomputed invariants differ from the recorded invariants"));
  const logs = [];
  assert.equal(await C.main(["--verify", out], { log: (x) => logs.push(x) }), 10);
  assert.match(logs[0], /EV1_BUNDLE_INVALID/);
  // and COMPLETE.json alone flipped to true (report left honest) is also rejected
  const second = (await bundleOf(tr)).out;
  forge(second, "COMPLETE.json", (t) => t, (c) => ({ ...c, evidenceComplete: true }));
  const v2 = C.verifyBundle(second);
  assert.equal(v2.ok, false);
  assert.ok(v2.problems.includes("COMPLETE.json evidenceComplete conflicts with the recomputed value"));
});

// ── P2 — closed bundle ────────────────────────────────────────────────────────────────────
const unexpected = (vb) => vb.problems.filter((p) => p.startsWith("unexpected bundle entry"));
test("R1-P2-1 valid exact bundle ⇒ passes; COMPLETE.json declares the closed manifest", async () => {
  const { out } = await bundleOf(tree());
  assert.deepEqual(readdirSync(out).sort(), [...C.BUNDLE_MANIFEST]);
  assert.deepEqual(C.BUNDLE_MANIFEST, ["COMPLETE.json", "EV1_REPORT.json", "EV1_SUMMARY.md", "PRE_FLIGHT.md"]);
  const complete = JSON.parse(readFileSync(join(out, "COMPLETE.json"), "utf8"));
  assert.deepEqual(complete.bundleManifest, [...C.BUNDLE_MANIFEST]);
  assert.deepEqual(C.verifyBundle(out), { ok: true, evidenceComplete: true, problems: [] });
});

test("R1-P2-2/3/4 extra text, JSON or hidden files ⇒ fail (no metadata allowance)", async () => {
  for (const [name, body] of [["UNLISTED.txt", "unverified content"], ["EXTRA.json", "{}"], [".DS_Store", "x"], [".hidden", ""], ["notes.md", "# more"]]) {
    const { out } = await bundleOf(tree());
    writeFileSync(join(out, name), body, { mode: 0o600 });
    const vb = C.verifyBundle(out);
    assert.equal(vb.ok, false, name);
    assert.equal(vb.evidenceComplete, false, name);
    assert.equal(unexpected(vb).length, 1, name + ": " + vb.problems.join("; "));
    assert.ok(unexpected(vb)[0].includes(JSON.stringify(name)), vb.problems.join("; "));
  }
});

test("R1-P2-5 unexpected symlink, sub-directory, an expected file replaced by a symlink, or a symlinked bundle dir ⇒ fail", async () => {
  const a = (await bundleOf(tree())).out;
  symlinkSync(join(a, "EV1_REPORT.json"), join(a, "REPORT_LINK.json"));
  assert.equal(unexpected(C.verifyBundle(a)).length, 1);
  const b = (await bundleOf(tree())).out;
  mkdirSync(join(b, "extra-dir"), { mode: 0o700 });
  assert.equal(C.verifyBundle(b).ok, false);
  const c = (await bundleOf(tree())).out;
  const keep = join(dirname(c), "summary-copy.md");
  renameSync(join(c, "EV1_SUMMARY.md"), keep);
  symlinkSync(keep, join(c, "EV1_SUMMARY.md"));
  const vc = C.verifyBundle(c);
  assert.equal(vc.ok, false);
  assert.ok(vc.problems.includes("EV1_SUMMARY.md is a symlink"), vc.problems.join("; "));
  const d = (await bundleOf(tree())).out;
  const link = join(dirname(d), "run-link");
  symlinkSync(d, link);
  assert.deepEqual(C.verifyBundle(link), { ok: false, evidenceComplete: false, problems: ["bundle path is not a real directory"] });
});

test("R1-P2-6 missing expected file (evidence file or COMPLETE.json) ⇒ fail", async () => {
  for (const f of C.BUNDLE_MANIFEST) {
    const { out } = await bundleOf(tree());
    unlinkSync(join(out, f));
    const vb = C.verifyBundle(out);
    assert.equal(vb.ok, false, f);
    assert.ok(vb.problems.includes(`${f} missing`), f + ": " + vb.problems.join("; "));
  }
  assert.equal(C.verifyBundle(join(tmpdir(), "ev1-no-such-bundle-dir")).ok, false);
});

test("R1-P2-7 modified expected file ⇒ digest failure", async () => {
  for (const f of C.BUNDLE_FILES) {
    const { out } = await bundleOf(tree());
    writeFileSync(join(out, f), readFileSync(join(out, f), "utf8") + " ");
    const vb = C.verifyBundle(out);
    assert.equal(vb.ok, false, f);
    assert.ok(vb.problems.includes(`${f} digest mismatch`), vb.problems.join("; "));
  }
});

test("R1-P2-8 secret-like content cannot bypass validation (extra file, or a re-digested expected file)", async () => {
  const a = (await bundleOf(tree())).out;
  writeFileSync(join(a, "token.txt"), "Authorization: Bearer ya29.leaked -----BEGIN PRIVATE KEY-----", { mode: 0o600 });
  const va = C.verifyBundle(a);
  assert.equal(va.ok, false);
  assert.equal(va.evidenceComplete, false);
  assert.equal(va.problems.some((p) => p.includes("ya29") || p.includes("BEGIN")), false, "file content is never echoed");
  const b = (await bundleOf(tree())).out;
  forge(b, "EV1_SUMMARY.md", (t) => t + "\nBearer ya29.leaked\n");
  const vb = C.verifyBundle(b);
  assert.equal(vb.ok, false);
  assert.ok(vb.problems.includes("EV1_SUMMARY.md contains secret-like text"), vb.problems.join("; "));
});

test("R1-P2-9 COMPLETE.json that omits, adds or re-declares a bundle artifact ⇒ fail", async () => {
  const cases = [
    ["omits a bound file", (c) => { const files = { ...c.files }; delete files["EV1_SUMMARY.md"]; return { ...c, files }; }],
    ["binds an extra file", (c) => ({ ...c, files: { ...c.files, "EXTRA.json": "0".repeat(64) } })],
    ["no manifest", (c) => { const x = { ...c }; delete x.bundleManifest; return x; }],
    ["manifest omits a file", (c) => ({ ...c, bundleManifest: c.bundleManifest.filter((f) => f !== "PRE_FLIGHT.md") })],
    ["manifest adds a file", (c) => ({ ...c, bundleManifest: [...c.bundleManifest, "EXTRA.json"].sort() })],
  ];
  for (const [name, mut] of cases) {
    const { out } = await bundleOf(tree());
    forge(out, "COMPLETE.json", (t) => t, mut);
    const vb = C.verifyBundle(out);
    assert.equal(vb.ok, false, name);
    assert.equal(vb.evidenceComplete, false, name);
  }
});

test("R1-P2-10 ambiguous / look-alike entries fail closed wherever the filesystem permits them", async () => {
  // Unicode look-alike (Cyrillic Е), full-width (NFKC-equal to COMPLETE.json), trailing space, zero-width joiner
  for (const name of ["\u0415V1_REPORT.json", "\uFF23\uFF2F\uFF2D\uFF30\uFF2C\uFF25\uFF34\uFF25.json", "EV1_REPORT.json ", "EV1_\u200DREPORT.json"]) {
    const { out } = await bundleOf(tree());
    writeFileSync(join(out, name), "{}", { mode: 0o600 });
    const vb = C.verifyBundle(out);
    assert.equal(vb.ok, false, JSON.stringify(name));
    assert.ok(unexpected(vb).length >= 1, JSON.stringify(name));
  }
  // case variant: on a case-sensitive filesystem it is an extra (ambiguous) entry; on a case-insensitive
  // one it cannot be created next to the real file (exclusive create refuses) — either way no bypass.
  const { out } = await bundleOf(tree());
  let created = true;
  try { writeFileSync(join(out, "complete.json"), "{}", { flag: "wx", mode: 0o600 }); } catch (e) { assert.equal(e.code, "EEXIST"); created = false; }
  const vb = C.verifyBundle(out);
  if (created) {
    assert.equal(vb.ok, false);
    assert.ok(vb.problems.some((p) => p.startsWith("ambiguous bundle entry resembles an expected file")), vb.problems.join("; "));
  } else assert.deepEqual(vb, { ok: true, evidenceComplete: true, problems: [] });
});

test("R1-P2 CLI: --verify of a bundle with an added file ⇒ EV1_BUNDLE_INVALID, exit 10", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ev1r1cli-"));
  const fx = join(dir, "tree.json");
  writeFileSync(fx, JSON.stringify({ tree: tree() }));
  const out = join(dir, "run");
  assert.equal((await mainRun(["--fixture", fx, "--as-of", AS_OF, "--out-dir", out])).code, 0);
  writeFileSync(join(out, "UNLISTED.txt"), "x", { mode: 0o600 });
  const logs = [];
  assert.equal(await C.main(["--verify", out], { log: (x) => logs.push(x) }), 10);
  assert.match(logs[0], /EV1_BUNDLE_INVALID/);
});

// ── GCLOUD_* relaxation (Codex re-review 04: RELAX) ────────────────────────────────────────
test("R1-ENV GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT no longer refuse; identity still comes only from explicit, verified inputs", async () => {
  assert.deepEqual([...P.FORBIDDEN_ENV].sort(), [
    "CLOUDSDK_AUTH_ACCESS_TOKEN", "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_CONFIG",
    "FIREBASE_DATABASE_EMULATOR_HOST", "FIREBASE_EMULATOR_HUB", "FIREBASE_SA_CLIENT_EMAIL", "FIREBASE_SA_JSON", "FIREBASE_SA_PRIVATE_KEY",
    "FIREBASE_TOKEN", "FIRESTORE_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_OAUTH_ACCESS_TOKEN",
  ]);
  const env = { GCLOUD_PROJECT: "someone-elses-project", GOOGLE_CLOUD_PROJECT: "another-project" };
  const g = fakeGoogle(tree());
  const out = tmpOut();
  const r = await mainRun(prodArgs({ "out-dir": out }), { fetchImpl: g.fetchImpl, env });
  assert.equal(r.code, 0, r.logs.join(" "));
  const iam = g.seen.find((x) => x.host === "cloudresourcemanager.googleapis.com");
  assert.equal(iam.path, "/v1/projects/kissgn-1227b:testIamPermissions", "IAM project comes from --project, not the environment");
  assert.ok(g.seen.filter((x) => x.method === "GET").every((x) => x.host === "kissgn-1227b-default-rtdb.firebaseio.com"));
  assert.equal(JSON.parse(readFileSync(join(out, "EV1_REPORT.json"), "utf8")).environmentIdentity.project, "kissgn-1227b");
  // with those variables present, every identity refusal still holds before the network
  for (const [name, args, extra] of [
    ["project mismatch", prodArgs({ project: "someone-elses-project" }), {}],
    ["credential project mismatch", prodArgs({ "credentials-file": credFile({ project: "someone-elses-project" }) }), {}],
    ["database mismatch", prodArgs({ "database-url": "https://other-1-default-rtdb.firebaseio.com" }), {}],
    ["ADC", prodArgs(), { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/x.json" }],
    ["emulator", prodArgs(), { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" }],
  ]) {
    const rr = await mainRun(args, { env: { ...env, ...extra } });
    assert.equal(rr.code, 2, name);
    assert.equal(rr.calls.length, 0, name);
  }
  for (const f of ["tools/finance-core/ev1-collector.mjs", "tools/finance-core/ev1-transport.mjs"]) {
    assert.doesNotMatch(readFileSync(join(REPO, f), "utf8"), /GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT/, f + " must not read the project from the environment");
  }
  assert.doesNotMatch(readFileSync(join(REPO, "tools/finance-core/ev1-preflight.mjs"), "utf8").replace(/\/\/.*$/gm, ""), /GCLOUD_PROJECT|GOOGLE_CLOUD_PROJECT/, "preflight code never reads them");
});
