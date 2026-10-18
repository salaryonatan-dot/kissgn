// DP4 — correction of the independent DP3 review (Codex, DP3_VERDICT: CHANGES_REQUIRED; DP3-R01, the remaining DP2-R02 path):
// a failed manual record whose business date cannot be read was excused as "another delivery" BEFORE its failure was checked for
// completeness, so an incomplete failure with a missing / unreadable date permitted a provider hand-off on both routes, also beside
// a valid failed admission. Since DP4 an unreadable date is excused only by the complete definitive failure that a same-date record
// needs (the established DP1 I-5 contract: "a record with an unreadable date blocks unless it is a definitive failure"). Scope is
// the established one: the manual records of the exact tenant and business (one malformed record blocks that business, never
// another business or tenant); a VALID other date is another delivery whatever its state. Nothing is repaired, defaulted or
// deleted. Through the REAL route (GET cron / POST manual) with the existing harness; every case counts provider hand-offs.
//   DP4-01  unreadable date (absent, non-date string, impossible calendar date, non-string) + incomplete failure ⇒ no hand-off on
//           either route; the record is left byte-identical
//   DP4-02  the same beside a VALID failed admission (the R01 reconciliation path): no hand-off; admission and record untouched
//   DP4-03  each required field of a definitive failure missing (code, settledAt, startedAt, messageIdHeader) with an absent date
//   DP4-04  positive controls: a COMPLETE definitive failure with an unreadable date (with and without a failed admission), a
//           valid other date (incomplete failure / accepted), absence — one hand-off each, on both routes
//   DP4-05  scope: the refused business blocks only itself — the other business of the tenant and the other tenant are delivered
//           in the same scheduled run; a malformed record of another business does not block this one
//   DP4-06  preserved: accepted / unknown / handing_off with an unreadable date stay unreadable (DP1 behaviour unchanged)
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, RECEIPTS, REPO, T, B, B2, B3, T2 } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const E = await import(pathToFileURL(REPO + "/lib/emailDelivery.js").href);
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", OTHER = "2026-09-07";   // 07:05 Israel, business date 2026-09-08
const ADM = "email_delivery_admission/daily_snapshot";
const MID = "a0000000-0000-4000-8000-000000000051";
const db = () => globalThis.__DB;
async function at(ms, fn) { const restore = freezeClock(ms); try { return await fn(); } finally { restore(); } }
const cron = () => at(AT, () => runCron(route));
const manual = () => at(AT, () => runManual(route));
const rowOf = (res, b = B, t = T) => res.body.results.find((x) => x.tenantId === t && x.bizId === b);
const clone = (x) => JSON.parse(JSON.stringify(x));
const one = () => seedWorld({ withSecondBiz: false, withSecondTenant: false });

/** the complete settled failed record the manual writer produces (deliverManualDaily: start, Message-ID, settlement, code) */
const failedRecord = (extra = {}) => ({ v: E.MANUAL_ATTEMPT_VERSION, attemptId: MID, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE,
  state: "failed", messageIdHeader: `<manual.${MID}@delivery.marjin.app>`, startedAt: AT - 30_000, updatedAt: AT - 29_000, settledAt: AT - 29_000,
  code: "provider_rejected_550", ...extra });
const without = (x, ...keys) => { const y = clone(x); for (const k of keys) delete y[k]; return y; };
/** a settled failed admission of the identity (decideAdmission's admit + settleAdmission), a definitive non-acceptance */
const failedAdmission = () => ({ v: E.ADMISSION_VERSION, kind: "daily_snapshot", tenantId: T, bizId: B, businessDate: DATE, state: "failed", route: "scheduled",
  ref: "b0000000-0000-4000-8000-000000000051", attempt: 1, messageIdHeader: "<daily_snapshot.1.b0000000-0000-4000-8000-000000000051@delivery.marjin.app>",
  since: AT - 20_000, code: "provider_rejected_550", settledAt: AT - 19_000, updatedAt: AT - 19_000 });
const recordPath = (t = T, b = B) => `email_delivery_manual/${t}/${b}/${MID}`;
const seedRecord = (x, t = T, b = B) => db().seed(recordPath(t, b), x);

// the unreadable dates (each is "no readable business date"; RTDB drops a null, so absence is the stored form of a null)
const UNREADABLE = [["absent", (x) => without(x, "businessDate")], ["non-date string", (x) => ({ ...x, businessDate: "unreadable" })],
  ["impossible calendar date", (x) => ({ ...x, businessDate: "2026-02-30" })], ["non-string", (x) => ({ ...x, businessDate: 20260908 })]];
const incomplete = (x) => without(x, "code");   // Codex's DP3-R01 shape: a failure that does not name its refusal

async function expectRefused(via, rec, admission = null) {
  one(); seedRecord(rec); if (admission) db().seed(`${ADM}/${T}/${B}/${DATE}`, admission);
  const smtp = installSmtp([SMTP.accept()]);
  const res = via === "manual" ? await manual() : await cron();
  if (via === "manual") assert.deepEqual([res.statusCode, res.body.code], [422, "delivery_history_unreadable"], JSON.stringify(res.body));
  else assert.deepEqual([rowOf(res).outcome, rowOf(res).code], ["skipped", "delivery_history_unreadable"], JSON.stringify(rowOf(res)));
  assert.equal(smtp.calls.length, 0, "nothing handed over");
  assert.deepEqual(db().read(recordPath()), rec, "the record is left exactly as it was (nothing repaired, defaulted or deleted)");
  assert.deepEqual(db().read(`${ADM}/${T}/${B}/${DATE}`) ?? null, admission, "the admission is left exactly as it was");
  if (via === "manual") assert.equal(db().read(`${RECEIPTS}/${T}/${B}/${DATE}`) ?? null, null, "the manual send writes no scheduled receipt");
}
async function expectOneHandOff(via, seed) {
  one(); seed();
  const smtp = installSmtp([SMTP.accept()]);
  const res = via === "manual" ? await manual() : await cron();
  assert.equal(smtp.calls.length, 1, JSON.stringify(via === "manual" ? res.body : rowOf(res)));
  if (via === "manual") assert.equal(res.statusCode, 200); else assert.equal(rowOf(res).outcome, "accepted");
}

test("DP4-01 DP3-R01: an unreadable date with an incomplete failure is not 'another delivery' — no hand-off on either route", { timeout: 60_000 }, async () => {
  for (const via of ["scheduled", "manual"]) for (const [name, date] of UNREADABLE) {
    await assert.doesNotReject(expectRefused(via, date(incomplete(failedRecord()))), `${via} ${name}`);
  }
});

test("DP4-02 DP3-R01 beside a valid failed admission: the reader now supplies the blocking verdict, so the admission does not re-admit", { timeout: 60_000 }, async () => {
  for (const via of ["scheduled", "manual"]) for (const [name, date] of UNREADABLE) {
    await assert.doesNotReject(expectRefused(via, date(incomplete(failedRecord())), failedAdmission()), `${via} ${name}`);
  }
});

test("DP4-03 every field of a definitive failure is required to excuse an unreadable date", { timeout: 60_000 }, async () => {
  for (const via of ["scheduled", "manual"]) for (const missing of ["code", "settledAt", "startedAt", "messageIdHeader"]) {
    await assert.doesNotReject(expectRefused(via, without(failedRecord(), "businessDate", missing)), `${via} without ${missing}`);
    await assert.doesNotReject(expectRefused(via, without(failedRecord(), "businessDate", missing), failedAdmission()), `${via} without ${missing}, failed admission`);
  }
  // a wrongly typed field is not the writer's value either
  for (const via of ["scheduled", "manual"]) await expectRefused(via, { ...without(failedRecord(), "businessDate"), code: 550 });
});

test("DP4-04 positive controls: complete definitive failure, valid other date, absence — one hand-off on each route", { timeout: 60_000 }, async () => {
  for (const via of ["scheduled", "manual"]) {
    for (const [name, date] of UNREADABLE) {
      await assert.doesNotReject(expectOneHandOff(via, () => seedRecord(date(failedRecord()))), `${via} complete failure, ${name}`);
      await assert.doesNotReject(expectOneHandOff(via, () => { seedRecord(date(failedRecord())); db().seed(`${ADM}/${T}/${B}/${DATE}`, failedAdmission()); }),
        `${via} complete failure, ${name}, failed admission (the ordinary retry after a definitive non-acceptance)`);
    }
    await expectOneHandOff(via, () => seedRecord(incomplete(failedRecord({ businessDate: OTHER }))));          // Codex's known-other-date controls
    await expectOneHandOff(via, () => seedRecord({ ...without(failedRecord({ businessDate: OTHER }), "code"), state: "accepted" }));
    await expectOneHandOff(via, () => { seedRecord(incomplete(failedRecord({ businessDate: OTHER }))); db().seed(`${ADM}/${T}/${B}/${DATE}`, failedAdmission()); });
    await expectOneHandOff(via, () => {});                                                                       // ordinary first-time delivery
  }
});

test("DP4-05 scope: one malformed record blocks its own business only — never another business or tenant", { timeout: 60_000 }, async () => {
  // the scheduled run of the whole tenant set: B refused, B2 (same tenant) and B3 (other tenant) delivered
  seedWorld(); const bad = incomplete(without(failedRecord(), "businessDate")); seedRecord(bad);
  let smtp = installSmtp([SMTP.accept(), SMTP.accept(), SMTP.accept()]);
  const c = await cron();
  assert.deepEqual([rowOf(c).outcome, rowOf(c).code], ["skipped", "delivery_history_unreadable"]);
  assert.deepEqual([rowOf(c, B2).outcome, rowOf(c, B3, T2).outcome], ["accepted", "accepted"]);
  assert.equal(smtp.calls.length, 2, "exactly the two unrelated businesses are handed over");
  // a malformed record of ANOTHER business (B2) does not block B: its collection is another business's evidence
  seedWorld(); seedRecord({ ...bad, bizId: B2 }, T, B2); smtp = installSmtp([SMTP.accept()]);
  const m = await manual();
  assert.deepEqual([m.statusCode, smtp.calls.length], [200, 1]);
  // nor a malformed record filed under the same business id in another tenant
  seedWorld(); seedRecord({ ...bad, tenantId: T2 }, T2, B); smtp = installSmtp([SMTP.accept()]);
  assert.deepEqual([(await manual()).statusCode, smtp.calls.length], [200, 1]);
});

test("DP4-06 preserved: a non-failed record with an unreadable date stays unreadable (DP1 I-5 unchanged)", { timeout: 60_000 }, async () => {
  for (const via of ["scheduled", "manual"]) for (const state of ["accepted", "unknown", "handing_off"]) {
    const rec = without({ ...failedRecord(), state }, "businessDate", ...(state === "handing_off" ? ["settledAt", "code"] : state === "accepted" ? ["code"] : []));
    await assert.doesNotReject(expectRefused(via, rec), `${via} ${state}`);
  }
});
