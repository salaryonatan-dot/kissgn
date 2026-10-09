import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { T, B, asLegacy, entry, env, seedRaw, uid } from "../support/b1-fixtures.mjs";
import { GLOBAL_3000, FIXED_3100 } from "../support/financial-invariants.mjs";
import { spec, creditNode } from "../support/p1-credit-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const JOB = await srv.import("src/agent/proactive/runProactiveJob.js");
const FM = await srv.import("src/agent/financialMonth.js");
const FMS = await srv.import("src/agent/financialMonthSource.js");

test("real analyzer source → trusted detector → ranking → persisted Daily top-three and limitations", async () => {
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-09-29T09:00:00Z");
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  globalThis.Date = FrozenDate;
  try {
    const rows = Array.from({ length: 28 }, (_, i) => entry(uid(i + 200), `2026-09-${String(i + 1).padStart(2, "0")}`, {
      sales: "1000", supplier_payments: { s1: "300" }, payroll: "500", other_expense: "0",
    }));
    const db = installDb(seedRaw(makeDb(), { entries: asLegacy(rows), config: env(GLOBAL_3000), fixed: env(FIXED_3100) }));
    // Extend the harness's query operators; retain the real repository path.
    const originalRef = db.ref.bind(db);
    let pushSeq = 0;
    const wrap = (path, query = {}) => ({ ...originalRef(path),
      child: (name) => wrap(`${path}/${name}`),
      push: async (value) => { await originalRef(`${path}/test-${++pushSeq}`).set(value); },
      orderByChild: (field) => wrap(path, { ...query, field }),
      startAt: (value) => wrap(path, { ...query, start: value }),
      equalTo: (value) => wrap(path, { ...query, equal: value }),
      limitToFirst: (value) => wrap(path, { ...query, first: value }),
      limitToLast: (value) => wrap(path, { ...query, last: value }),
      once: async () => ({ val: () => {
        const node = db.read(path);
        if (!query.field || !node || typeof node !== "object") return node;
        let pairs = Object.entries(node).filter(([, row]) => row && typeof row === "object");
        if ("equal" in query) pairs = pairs.filter(([, row]) => row[query.field] === query.equal);
        if ("start" in query) pairs = pairs.filter(([, row]) => row[query.field] >= query.start);
        if (query.first) pairs = pairs.slice(0, query.first);
        if (query.last) pairs = pairs.slice(-query.last);
        return pairs.length ? Object.fromEntries(pairs) : null;
      } }),
    });
    db.ref = (path) => wrap(path);
    const result = await JOB.runForBiz(T, B);
    assert.deepEqual(result.errors, [], `Daily pipeline errors: ${result.errors.join(", ")}`);
    assert.ok(result.insightsGenerated >= 1);
    const digest = db.read(`tenants/${T}/proactive_digests/${B}/daily/2026-09-29`);
    assert.ok(digest);
    assert.ok(digest.topInsights.length <= 3);
    assert.ok(digest.topInsights.some((i) => i.type === "labor_inefficiency"));
    assert.equal(digest.topInsights.some((i) => i.type === "forecast_risk"), false,
      "the same Actual labor ratio cannot occupy a second ranked slot as forecast risk");
    assert.ok(digest.limitations.includes("purchase_trend_exact_window_source_unavailable"));
    db.seed(`tenants/${T}/biz:${B}:supplier_credits`, creditNode([
      spec(610, "s1", "2026-09-10", "700", { review: "pending" }),
    ]));
    const partial = await JOB.runForBiz(T, B);
    assert.deepEqual(partial.errors, []);
    const partialDigest = db.read(`tenants/${T}/proactive_digests/${B}/daily/2026-09-29`);
    assert.ok(partialDigest.limitations.includes("food_cost_invalid_components"),
      "unresolved supplier credit remains visible in the persisted Daily result");
    const verifiedRef = db.ref;
    const privateError = 'private@example.test token=secret';
    const logged = [];
    const previousError = console.error;
    console.error = (...args) => logged.push(args.map(String).join(' '));
    db.ref = (path) => path.includes("/proactive_digests/")
      ? { ...verifiedRef(path), once: async () => { throw Error(privateError); } }
      : verifiedRef(path);
    try {
      const unreadable = await JOB.runForBiz(T, B);
      assert.ok(unreadable.errors.includes("digest_persistence_failed"), "a failed digest readback is visible in the job result");
      assert.doesNotMatch(logged.join('\n'), /private@example|token=secret/);
    } finally { console.error = previousError; }
    db.ref = (path) => path.includes("/proactive_digests/")
      ? { ...verifiedRef(path), once: async () => ({ val: () => ({ ...db.read(path), limitations: ["tampered_readback"] }) }) }
      : verifiedRef(path);
    const mismatched = await JOB.runForBiz(T, B);
    assert.ok(mismatched.errors.includes("digest_persistence_failed"),
      "a successful write with mismatched digest readback cannot be reported as complete");
    db.ref = verifiedRef;
  } finally {
    globalThis.Date = RealDate;
  }
});

test("equal food and labor ratios remain distinct Daily facts through detector ranking", async () => {
  const RealDate = Date;
  const nowMs = RealDate.parse("2026-09-29T09:00:00Z");
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  globalThis.Date = FrozenDate;
  try {
    const rows = Array.from({ length: 28 }, (_, i) => entry(uid(i + 3400),
      `2026-09-${String(i + 1).padStart(2, "0")}`, {
        sales: "1000", supplier_payments: { s1: "500" }, payroll: "500", other_expense: "0",
      }));
    const db = installDb(seedRaw(makeDb(), { entries: asLegacy(rows),
      config: env({ targets: { foodCostPct: "25", laborCostPct: "25" } }) }));
    const baseRef = db.ref.bind(db);
    let seq = 0;
    const wrap = (path, query = {}) => ({ ...baseRef(path),
      child: (name) => wrap(`${path}/${name}`),
      push: async (value) => { await baseRef(`${path}/test-${++seq}`).set(value); },
      orderByChild: (field) => wrap(path, { ...query, field }),
      startAt: (value) => wrap(path, { ...query, start: value }),
      equalTo: (value) => wrap(path, { ...query, equal: value }),
      limitToFirst: (value) => wrap(path, { ...query, first: value }),
      limitToLast: (value) => wrap(path, { ...query, last: value }),
      once: async () => ({ val: () => {
        const node = db.read(path);
        if (!query.field || !node || typeof node !== "object") return node;
        let pairs = Object.entries(node).filter(([, row]) => row && typeof row === "object");
        if ("equal" in query) pairs = pairs.filter(([, row]) => row[query.field] === query.equal);
        if ("start" in query) pairs = pairs.filter(([, row]) => row[query.field] >= query.start);
        if (query.first) pairs = pairs.slice(0, query.first);
        if (query.last) pairs = pairs.slice(-query.last);
        return pairs.length ? Object.fromEntries(pairs) : null;
      } }),
    });
    db.ref = (path) => wrap(path);
    const result = await JOB.runForBiz(T, B);
    assert.deepEqual(result.errors, []);
    const digest = db.read(`tenants/${T}/proactive_digests/${B}/daily/2026-09-29`);
    assert.ok(digest);
    const month = await FMS.loadAgentFinancialMonth(T, B, nowMs);
    assert.equal(FM.completeRatio(month.report.actual.purchasesPct),
      FM.completeRatio(month.report.actual.labor.employerCostPct),
      JSON.stringify({ food: month.report.actual.purchasesPct, labor: month.report.actual.labor.employerCostPct }));
    assert.ok(digest.topInsights.some((item) => item.type === "labor_inefficiency"), JSON.stringify({ result, digest, food: month.report.actual.purchasesPct, labor: month.report.actual.labor.employerCostPct }));
    assert.ok(digest.topInsights.some((item) => item.type === "forecast_risk"),
      "equal numeric ratios from different metrics must not be deduplicated");
    const stored = Object.values(db.read(`tenants/${T}/proactive_insights/${B}`) ?? {});
    assert.ok(stored.some((item) => item.type === "forecast_risk" && item.metric === "food_cost_pct"));
  } finally { globalThis.Date = RealDate; }
});
