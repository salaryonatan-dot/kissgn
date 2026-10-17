import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer } from "../support/server-reader-harness.mjs";

const server = compileServer();
const { yesterdayInIsrael } = await server.import("src/analytics/dailyBuilder.js");
const { daysAgoIso, todayIso } = await server.import("src/utils/dates.js");

function withClock(instant, check) {
  const RealDate = globalThis.Date;
  const at = RealDate.parse(instant);
  assert.ok(Number.isFinite(at), `valid test instant: ${instant}`);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [at])); }
    static now() { return at; }
  };
  try { check(new RealDate(at)); }
  finally { globalThis.Date = RealDate; }
  assert.equal(globalThis.Date, RealDate, "test-local clock restored");
}

for (const [instant, expected] of [
  ["2026-10-24T22:59:59Z", "2026-10-24"],
  ["2026-10-24T23:00:00Z", "2026-10-24"],
  ["2026-10-24T23:00:01Z", "2026-10-24"],
  ["2026-10-24T23:59:59Z", "2026-10-24"],
  ["2026-10-25T00:00:00Z", "2026-10-24"],
  ["2026-10-25T00:30:00Z", "2026-10-24"],
  ["2026-10-25T20:59:59Z", "2026-10-24"],
  ["2026-10-25T21:00:00Z", "2026-10-24"],
  ["2026-10-25T21:30:00Z", "2026-10-24"],
  ["2026-10-25T21:59:59Z", "2026-10-24"],
  ["2026-10-25T22:00:00Z", "2026-10-25"],
  ["2027-03-25T23:59:59Z", "2027-03-25"],
  ["2027-03-26T00:00:00Z", "2027-03-25"],
  ["2027-03-26T00:30:00Z", "2027-03-25"],
  ["2027-03-26T20:59:59Z", "2027-03-25"],
  ["2027-03-26T21:00:00Z", "2027-03-26"],
  ["2027-03-26T21:30:00Z", "2027-03-26"],
  ["2027-03-26T21:59:59Z", "2027-03-26"],
  ["2027-03-26T22:00:00Z", "2027-03-26"],
  ["2026-10-10T20:59:59Z", "2026-10-09"],
  ["2026-10-10T21:00:00Z", "2026-10-10"],
  ["2026-10-31T21:59:59Z", "2026-10-30"],
  ["2026-10-31T22:00:00Z", "2026-10-31"],
  ["2026-12-31T21:59:59Z", "2026-12-30"],
  ["2026-12-31T22:00:00Z", "2026-12-31"],
  ["2026-10-15T12:00:00Z", "2026-10-14"],
]) {
  test(`DT-O1 Israel calendar yesterday at ${instant}`, () => {
    withClock(instant, (now) => {
      assert.equal(yesterdayInIsrael(now), expected);
      assert.equal(daysAgoIso(1), expected);
    });
  });
}

test("DT-O1 daysAgoIso counts calendar dates through both offset changes", () => {
  withClock("2026-10-25T21:30:00Z", () => {
    assert.equal(todayIso(), "2026-10-25");
    assert.equal(daysAgoIso(0), "2026-10-25");
    assert.equal(daysAgoIso(7), "2026-10-18");
    assert.equal(daysAgoIso(28), "2026-09-27");
  });
  withClock("2027-03-26T21:30:00Z", () => {
    assert.equal(todayIso(), "2027-03-27");
    assert.equal(daysAgoIso(7), "2027-03-20");
    assert.equal(daysAgoIso(28), "2027-02-27");
  });
});

test("DT-O1 the optional timezone selects that zone's calendar before stepping", () => {
  withClock("2026-10-25T01:30:00Z", () => {
    assert.equal(todayIso("America/New_York"), "2026-10-24");
    assert.equal(daysAgoIso(1, "America/New_York"), "2026-10-23");
    assert.equal(daysAgoIso(1, "Asia/Jerusalem"), "2026-10-24");
  });
  withClock("2026-11-02T04:30:00Z", () => {
    assert.equal(todayIso("America/New_York"), "2026-11-01");
    assert.equal(daysAgoIso(1, "America/New_York"), "2026-10-31");
  });
});

test("DT-O1 invalid instants and non-finite day counts keep the previous Invalid Date result", () => {
  assert.equal(yesterdayInIsrael(new Date(NaN)), "Invalid Date");
  assert.equal(daysAgoIso(NaN), "Invalid Date");
  assert.equal(daysAgoIso(Infinity), "Invalid Date");
});

test("DT-O1 finite fractional counts preserve the reviewed candidate's calendar-step behavior", () => {
  withClock("2026-10-15T12:00:00Z", () => {
    assert.equal(daysAgoIso(-1.5), "2026-10-17");
    assert.equal(daysAgoIso(1.5), "2026-10-13");
  });
});
