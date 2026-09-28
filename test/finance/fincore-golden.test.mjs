// Financial Core Slice A — hand-authored golden cases (R1.2 G-01…G-32, R1.3 G-07a…n,
// G-18 revised, G-40…G-51 revised by owner decision BD-1). Expected values in
// test/finance/golden/financial-core-goldens.json are written by hand and are never
// produced by calling the core. Every case runs against BOTH the freshly compiled source
// and the committed browser artifact fincore/v1, with exact string equality.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, bothCores } from "../support/fincore-load.mjs";

const FIX = JSON.parse(readFileSync(join(REPO, "test", "finance", "golden", "financial-core-goldens.json"), "utf8"));
const cores = await bothCores();

function expandRows(c, F) {
  const rows = [...(c.rows || [])];
  for (const e of c.expand || []) {
    for (const d of F.finance.businessDate.datesInRange(e.from, e.to)) rows.push({ ...e.row, id: `${e.prefix}-${d}`, date: d });
  }
  return rows;
}

function timelineOf(c, F) {
  if (c.timeline) return { versions: c.timeline, timelineSource: "persisted", vatBasis: "net_of_vat", laborCostBasis: "full_employer_cost_as_recorded" };
  return F.metrics.adapters.configCompat.costTimelineFromCurrentConfig("config" in c ? c.config : {}, c.fixed || []);
}

function run(c, F) {
  const { normalize, businessDate } = F.finance;
  const rows = expandRows(c, F);
  const n = normalize.normalizeRows(rows, { asOfBusinessDate: c.asOf });
  const { first, last } = businessDate.monthBounds(c.window.month);
  const to = c.asOf < last ? c.asOf : last;
  const days = c.asOf < first ? [] : normalize.groupByDate(n.rows, { from: first, to, exceptionsByDate: c.exceptionsByDate });
  const basis = c.basis === undefined ? F.policy.purchaseBasis.productPurchaseBasis() : c.basis;
  const window = { ...c.window, asOfBusinessDate: c.asOf };
  const tl = timelineOf(c, F);
  const report = c.basis === "__OMIT__"
    ? F.metrics.report.computePeriodReport(days, tl, undefined, window)
    : F.metrics.report.computePeriodReport(days, tl, basis, window, { quarantine: n.quarantine, flags: n.flags });
  return { n, days, report, basis };
}

function get(obj, path) {
  let cur = obj;
  for (const part of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part];
  }
  return cur;
}

function resolve(key, ctx, F) {
  const [kind, ...rest] = key.split(".");
  const { report, days, n, basis } = ctx;
  const plain = (v) => JSON.parse(F.metrics.report.serializeReport(v));
  if (kind === "report") return get(plain(report), rest);
  if (kind === "q") return get(plain(n.quarantine), rest);
  if (kind === "latest") return F.finance.normalize.latestPresentDate(days);
  const date = rest[0];
  const day = days.find((d) => d.date === date);
  if (kind === "day") {
    // keys may contain dots only in the date; map keys like "supplier:s1" are dot-free
    return get(plain(F.finance.normalize.dayToJson(day)), rest.slice(1));
  }
  if (kind === "dm") {
    const pb = F.finance.purchaseBasis.resolvePurchaseBasis(day.purchases.presence === "present" ? [day.date] : [], basis);
    return get(plain(F.metrics.adapters.legacyNumber.toDailyMetric(day, pb)), rest.slice(1));
  }
  if (kind === "fd") return F.metrics.adapters.legacyNumber.toForecastDay(day);
  throw new Error("unknown expectation kind " + kind);
}

const matchesFlag = (f, want) => Object.entries(want).every(([k, v]) => f[k] === v);

for (const c of FIX.cases) {
  for (const [label, F] of cores) {
    test(`${c.id} [${label}] ${c.desc}`, () => {
      if (c.type === "cells") {
        for (const [raw, allowSkip, state, second, thousands] of c.items) {
          const cell = F.finance.cells.parseAmount(raw, { allowSkip });
          assert.equal(cell.state, state, `state of ${JSON.stringify(raw)}`);
          if (state === "present") {
            assert.equal(F.finance.decimal.serializeDec(cell.value), second, `value of ${JSON.stringify(raw)}`);
            assert.equal(cell.thousands === true, thousands === true, `thousands flag of ${JSON.stringify(raw)}`);
          }
          if (state === "invalid") assert.equal(cell.reason, second, `reason of ${JSON.stringify(raw)}`);
        }
        return;
      }
      if (c.type === "presenters") {
        for (const [fn, input, out] of c.items) {
          const got = fn === "money" ? F.presenters.money.formatShekel(input) : F.presenters.percent.formatPercent(input);
          assert.equal(got, out, `${fn}(${input})`);
        }
        return;
      }
      if (c.type === "error") {
        assert.throws(() => run(c, F), (err) => err && err.name === "FinanceContractError" && err.code === c.expectError);
        return;
      }
      const ctx = run(c, F);
      for (const [key, want] of Object.entries(c.expect || {})) {
        const got = resolve(key, ctx, F);
        assert.deepEqual(got === undefined ? "__undefined__" : got, want, key);
      }
      const flags = JSON.parse(F.metrics.report.serializeReport(ctx.report.flags));
      for (const want of c.expectFlags || []) assert.ok(flags.some((f) => matchesFlag(f, want)), "missing flag " + JSON.stringify(want));
      for (const not of c.expectNoFlags || []) assert.ok(!flags.some((f) => matchesFlag(f, not)), "unexpected flag " + JSON.stringify(not));
    });
  }
}
