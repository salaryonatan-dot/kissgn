// Daily e-mail subscription UI (owner requirement 2026-10-22; author candidate, pending independent review): the page's pure
// decision seam (window.MarjinDailySubscription) evaluated in a node vm from the working-tree index.html — the SAME script
// block the page runs — plus static checks of the page wiring.
//   DSU-01  label «קבלת דוח יומי במייל»; owner / super_owner with a live selection only; never demo / other roles
//   DSU-02  requests: `action` is always present (a POST without it is a manual send); `enabled` is a strict boolean
//   DSU-03  decide: KNOWN only for 200 ok with a boolean `enabled` for THIS business; everything else UNKNOWN
//   DSU-04  default OFF; the switch is ON only after the server confirmed enabled; an unknown reply never changes the shown
//           state; states are per business
//   DSU-05  wiring: the page never touches the preference path directly; the switch is server-confirmed and address-free
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const START = "// ── Daily e-mail subscription (owner requirement 2026-10-22)";
const NOTICE = "// ── Owner notice: the Daily e-mail cannot be prepared";
const block = (html, start) => { const i = html.indexOf(start); assert.ok(i > 0, "seam found: " + start); return html.slice(i, html.indexOf("</script>", i)); };
/** Both page seams in page order (the notice seam defines the one endpoint); `withNotice: false` = the notice seam is missing. */
function loadSeam(html = HTML, { withNotice = true } = {}) {
  const win = {}, ctx = { window: win, Object, Number, String, Array };
  if (withNotice) vm.runInNewContext(block(html, NOTICE), ctx);
  vm.runInNewContext(block(html, START), ctx);
  return win.MarjinDailySubscription;
}
const RAW = loadSeam();
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const M = { ...RAW, readRequest: (...a) => plain(RAW.readRequest(...a)), setRequest: (...a) => plain(RAW.setRequest(...a)), decide: (...a) => plain(RAW.decide(...a)),
  stateFor: (...a) => plain(RAW.stateFor(...a)), next: (...a) => plain(RAW.next(...a)), busy: (...a) => plain(RAW.busy(...a)) };
const T = "tenantA", B = "bizA", B2 = "bizB";
const ok = (over = {}) => ({ status: "ok", tenantId: T, bizId: B, enabled: true, state: "enabled", explicit: true, version: 1, ...over });

test("DSU-01 label and who may ask", () => {
  assert.equal(M.LABEL_HE, "קבלת דוח יומי במייל"); assert.equal(M.ENDPOINT, "/api/daily-snapshot/run"); assert.deepEqual([...M.OWNER_ROLES], ["owner", "super_owner"]);
  assert.equal(M.shouldAsk("owner", T, B, false), true); assert.equal(M.shouldAsk("super_owner", T, B, false), true);
  for (const role of ["manager", "viewer", "staff", "shift_manager", "", undefined, null, "Owner"]) assert.equal(M.shouldAsk(role, T, B, false), false, String(role));
  for (const [t, b] of [["", B], [T, ""], [null, B], [T, undefined], [1, B]]) assert.equal(M.shouldAsk("owner", t, b, false), false);
  assert.equal(M.shouldAsk("owner", T, B, true), false, "never in demo mode");
  const alone = loadSeam(HTML, { withNotice: false });
  assert.equal(alone.ENDPOINT, null); assert.equal(alone.shouldAsk("owner", T, B, false), false, "without the one endpoint definition nothing is requested");
  assert.ok(HTML.indexOf(NOTICE) < HTML.indexOf(START), "the notice seam (endpoint definition) runs first");
  const own = block(HTML, START);
  assert.ok(!own.includes("daily-snapshot/run"), "the subscription seam names no route of its own");
});

test("DSU-02 requests always carry the action; enabled is a strict boolean", () => {
  assert.deepEqual(M.readRequest(T, B), { tenantId: T, bizId: B, action: "subscription" });
  assert.deepEqual(M.setRequest(T, B, true), { tenantId: T, bizId: B, action: "subscription_set", enabled: true });
  for (const v of [false, "true", 1, null, undefined, {}]) assert.deepEqual(M.setRequest(T, B, v).enabled, false, String(v));
});

test("DSU-03 decide: known only for a confirmed reply for this business", () => {
  assert.deepEqual(M.decide(200, ok(), T, B), { kind: "known", enabled: true });
  assert.deepEqual(M.decide(200, ok({ enabled: false }), T, B), { kind: "known", enabled: false });
  const unknown = [[200, ok({ enabled: "true" })], [200, ok({ enabled: undefined })], [200, ok({ status: "unavailable" })], [200, ok({ tenantId: "other" })],
    [200, ok({ bizId: B2 })], [200, null], [200, []], [200, "ok"], [503, ok()], [400, ok()], [401, ok()], [403, ok()], [404, ok()], [500, ok()], [null, null]];
  for (const [status, body] of unknown) assert.equal(M.decide(status, body, T, B).kind, "unknown", JSON.stringify([status, body]));
});

test("DSU-04 default OFF; only confirmed states change the switch; per business", () => {
  assert.equal(RAW.checked({}, T, B), false, "default OFF before any confirmation");
  assert.deepEqual(M.stateFor({}, T, B), { kind: "idle", enabled: false, busy: false, failed: false });
  let s = RAW.next({}, RAW.decide(200, ok({ enabled: true }), T, B), T, B);
  assert.equal(RAW.checked(s, T, B), true); assert.equal(RAW.checked(s, T, B2), false, "another business is untouched");
  s = RAW.busy(s, T, B); assert.deepEqual([RAW.stateFor(s, T, B).busy, RAW.checked(s, T, B)], [true, true], "busy keeps the confirmed state");
  s = RAW.next(s, RAW.decide(503, { status: "unavailable" }, T, B), T, B);
  assert.deepEqual([RAW.checked(s, T, B), RAW.stateFor(s, T, B).failed, RAW.stateFor(s, T, B).busy], [true, true, false], "a failed change never flips the switch");
  s = RAW.next(s, RAW.decide(200, ok({ enabled: false }), T, B), T, B);
  assert.deepEqual([RAW.checked(s, T, B), RAW.stateFor(s, T, B).failed], [false, false]);
  const fresh = RAW.next({}, RAW.decide(null, null, T, B), T, B);
  assert.deepEqual([RAW.checked(fresh, T, B), RAW.stateFor(fresh, T, B).kind], [false, "idle"], "an unknown first reply confirms nothing");
});

test("DSU-05 wiring: server-confirmed, owner-only, address-free; the preference path is never touched by the page", () => {
  assert.ok(!HTML.includes("email_delivery_subscriptions"), "the page never names the server-only preference path");
  const i = HTML.indexOf("{/* Daily e-mail subscription (owner / super_owner"); assert.ok(i > 0);
  const block = HTML.slice(i, HTML.indexOf("{/* Business Switch Modal */}", i));
  for (const needle of ["!currentUser", "!isDemoMode", "OWNER_ROLES.includes(loggedInUser?.role)", "checked={on}", "disabled={s.kind!==\"known\"||s.busy}",
    "onChange={(e)=>changeDailySubscription(e.target.checked)}", "window.MarjinDailySubscription.LABEL_HE"]) assert.ok(block.includes(needle), needle);
  assert.ok(!/@|recipient|email\b/i.test(block.replace(/LABEL_HE|data-daily-subscription|MarjinDailySubscription|changeDailySubscription|dailySubscription/g, "")), "no address or recipient field in the switch");
  const EFF = "// Daily e-mail subscription: read only when the owner opens the panel";
  const eff = HTML.slice(HTML.indexOf(EFF), HTML.indexOf(EFF) + 3500); assert.ok(HTML.indexOf(EFF) > 0);
  assert.ok(eff.includes("window.MarjinDailySubscription.readRequest(ctx.tenantId, currentBizId)") && eff.includes("window.MarjinDailySubscription.setRequest(ctx.tenantId, bizId, enabled)"));
  assert.ok(eff.includes("if (!live || !isSelectionLive(ctx)) return;"), "a reply for a selection that is no longer live is dropped");
  assert.ok(eff.includes("if (!showDailySubscription || !bound || currentUser"), "nothing is requested on page load: the read waits for the owner to open the panel");
});
