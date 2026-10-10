// Owner-notice UI R1 — the page's pure decision seam (window.MarjinDailyNotice) evaluated in a node vm from the working-tree
// index.html: the SAME script block the page runs. Owner decision D-G4 (2026-10-09) and the delivery R7 notice contract.
//   ON-01  shouldAsk: owner / super_owner with a live (tenantId, bizId) selection only; never a viewer / manager / staff, an
//          empty or non-string id, or demo mode
//   ON-02  noticeRequest: exactly { tenantId, bizId, action: "notice" } — `action` is never omitted (a POST without it is a send)
//   ON-03  decide: ACTIVE only for 200 ok / deliverable false / business_name_unavailable for THIS business; CLEAR only for
//          200 ok / deliverable true for THIS business; everything else UNKNOWN (503 unavailable — registry / store / failed
//          clear —, 401 / 403, 400, 500, no reply, a non-record body, another tenant / business, a reply without the R7
//          fields, another business state); a stored record decorates an active decision but never decides; a synthesized
//          record (runs: 0) decorates nothing
//   ON-04  next / visible: an unknown decision NEVER hides a visible alert and never shows one; a clear hides; states are kept
//          per business (a switch away and back keeps what was confirmed); a decision for one business never touches another
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";

const START = "// ── Owner notice: the Daily e-mail cannot be prepared";
export function loadDailyNoticeSeam(html = readFileSync(join(REPO, "index.html"), "utf8")) {
  const i = html.indexOf(START); assert.ok(i > 0, "seam found");
  const src = html.slice(i, html.indexOf("</script>", i));
  const win = {};
  vm.runInNewContext(src, { window: win, Object, Number, String, Array });
  return win.MarjinDailyNotice;
}
const RAW = loadDailyNoticeSeam();
// objects built inside the vm realm carry that realm's prototypes: compare them as plain data
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const N = { ...RAW, OWNER_ROLES: RAW.OWNER_ROLES, noticeRequest: (...a) => plain(RAW.noticeRequest(...a)), decide: (...a) => plain(RAW.decide(...a)), next: (...a) => plain(RAW.next(...a)), stateFor: (...a) => plain(RAW.stateFor(...a)) };
const T = "tenantA", B = "bizA", B2 = "bizB";
const HE = "לא ניתן להכין את הסיכום היומי כי חסר שם העסק. נדרש תיקון פרטי העסק.";
const ok = (over = {}) => ({ status: "ok", tenantId: T, bizId: B, deliverable: false, code: "business_name_unavailable", notice: null, noticeState: "none", clearState: "not_applicable", ...over });
const stored = { code: "business_name_unavailable", message: HE, tenantId: T, bizId: B, businessDate: "2026-10-08", firstSeenAt: 1, lastSeenAt: 2, runs: 3 };

test("ON-01 shouldAsk: owners with a live selection only", () => {
  assert.equal(N.MESSAGE_HE, HE); assert.equal(N.NOTICE_ENDPOINT, "/api/daily-snapshot/run"); assert.deepEqual([...N.OWNER_ROLES], ["owner", "super_owner"]);
  assert.equal(N.shouldAsk("owner", T, B, false), true); assert.equal(N.shouldAsk("super_owner", T, B, false), true);
  for (const role of ["manager", "viewer", "staff", "shift_manager", "", undefined, null, "Owner", "owner "]) assert.equal(N.shouldAsk(role, T, B, false), false, String(role));
  for (const [t, b] of [["", B], [T, ""], [null, B], [T, null], [undefined, B], [T, undefined], [1, B], [T, 1]]) assert.equal(N.shouldAsk("owner", t, b, false), false, JSON.stringify([t, b]));
  assert.equal(N.shouldAsk("owner", T, B, true), false, "demo mode never asks");
});

test("ON-02 noticeRequest: the exact authorized read body", () => {
  assert.deepEqual(N.noticeRequest(T, B), { tenantId: T, bizId: B, action: "notice" });
  assert.deepEqual(Object.keys(N.noticeRequest(T, B)).sort(), ["action", "bizId", "tenantId"]);
});

test("ON-03 decide: active / clear only on the confirmed business state; everything else unknown", () => {
  assert.deepEqual(N.decide(200, ok(), T, B), { kind: "active", businessDate: null, runs: null }, "nothing stored: active from the business state, no decoration");
  assert.deepEqual(N.decide(200, ok({ notice: stored, noticeState: "active" }), T, B), { kind: "active", businessDate: "2026-10-08", runs: 3 }, "a stored record decorates");
  assert.deepEqual(N.decide(200, ok({ notice: { ...stored, runs: 0, businessDate: null } }), T, B), { kind: "active", businessDate: null, runs: null }, "a runs: 0 / dateless record decorates nothing");
  assert.deepEqual(N.decide(200, ok({ notice: { code: "other", businessDate: "2026-01-01", runs: 9 } }), T, B), { kind: "active", businessDate: null, runs: null }, "a foreign record never decorates");
  assert.deepEqual(N.decide(200, ok({ deliverable: true, code: null, noticeState: "none", clearState: "cleared" }), T, B), { kind: "clear" });
  assert.deepEqual(N.decide(200, ok({ deliverable: true, code: null, noticeState: "none", clearState: "not_needed" }), T, B), { kind: "clear" });
  const unknown = [
    ["503 registry unavailable", 503, { ...ok({ deliverable: null, code: "registry_unavailable", noticeState: "unavailable", clearState: "not_attempted" }), status: "unavailable", error: "x" }],
    ["503 store unreadable (name missing)", 503, { ...ok({ noticeState: "unavailable", clearState: "not_attempted" }), status: "unavailable", error: "x" }],
    ["503 clear failed (name present)", 503, { ...ok({ deliverable: true, code: null, notice: stored, noticeState: "stale", clearState: "failed" }), status: "unavailable", error: "x" }],
    ["200 but status unavailable", 200, { ...ok(), status: "unavailable" }],
    ["401", 401, { error: "unauthorized" }], ["403 viewer", 403, { error: "insufficient role" }], ["403 manager", 403, { error: "owner_role_required" }],
    ["400 invalid action", 400, { error: "invalid_action" }], ["500", 500, { error: "x" }], ["no reply", null, null], ["200 null body", 200, null], ["200 array body", 200, [ok()]], ["200 string body", 200, "ok"],
    ["another tenant", 200, ok({ tenantId: "tenantB" })], ["another business", 200, ok({ bizId: B2 })],
    ["the R5 shape (no noticeState / clearState)", 200, { status: "ok", tenantId: T, bizId: B, deliverable: false, code: "business_name_unavailable", notice: { ...stored, runs: 0 } }],
    ["a manual-send reply (an older route)", 200, { status: "success", snapshot: { tenantId: T, bizId: B } }],
    ["not registered", 200, ok({ code: "business_not_registered", noticeState: "stale", notice: stored })],
    ["ambiguous", 200, ok({ code: "ambiguous_business_identity" })], ["registry unreadable", 200, ok({ code: "registry_unreadable" })],
    ["deliverable null with 200", 200, ok({ deliverable: null, code: "registry_unavailable" })],
    ["deliverable as a string", 200, ok({ deliverable: "false" })],
  ];
  for (const [label, status, body] of unknown) assert.equal(N.decide(status, body, T, B).kind, "unknown", label);
});

test("ON-04 next / visible: unknown never hides or shows; clear hides; per-business states", () => {
  const active = { kind: "active", businessDate: "2026-10-08", runs: 3 }, clear = { kind: "clear" }, unknown = { kind: "unknown", reason: "http_503" };
  let s = N.next({}, unknown, T, B);
  assert.equal(N.visible(s, T, B), false, "unknown on nothing shows nothing"); assert.deepEqual(N.stateFor(s, T, B), { kind: "idle" });
  s = N.next(s, active, T, B);
  assert.equal(N.visible(s, T, B), true); assert.deepEqual(N.stateFor(s, T, B), active);
  s = N.next(s, unknown, T, B);
  assert.equal(N.visible(s, T, B), true, "a failed read never hides a visible alert"); assert.equal(N.stateFor(s, T, B).lastReadFailed, true); assert.equal(N.stateFor(s, T, B).businessDate, "2026-10-08");
  s = N.next(s, clear, T, B2);
  assert.equal(N.visible(s, T, B), true, "a decision for another business never touches this one"); assert.equal(N.visible(s, T, B2), false); assert.deepEqual(N.stateFor(s, T, B2), clear);
  s = N.next(s, active, T, B2);
  assert.equal(N.visible(s, T, B2), true); assert.equal(N.visible(s, T, B), true);
  s = N.next(s, clear, T, B);
  assert.equal(N.visible(s, T, B), false, "a confirmed clear hides"); assert.deepEqual(N.stateFor(s, T, B), clear); assert.equal(N.visible(s, T, B2), true, "the other business keeps its alert");
  s = N.next(s, unknown, T, B);
  assert.equal(N.visible(s, T, B), false, "unknown after clear stays hidden"); assert.equal(N.stateFor(s, T, B).lastReadFailed, true);
  assert.equal(N.visible(s, "tenantB", B), false, "another tenant: nothing"); assert.equal(N.visible(null, T, B), false); assert.equal(N.visible(undefined, T, B), false);
  assert.deepEqual(N.next(null, { kind: "weird" }, T, B), {}, "an unexpected decision kind changes nothing");
  const before = N.next({}, active, T, B); const after = N.next(before, unknown, T, B);
  assert.notEqual(before, after); assert.deepEqual(N.stateFor(before, T, B), active, "the previous map is not mutated");
});
