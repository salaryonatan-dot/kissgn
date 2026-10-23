// Daily e-mail subscription UI (owner requirement 2026-10-22; author candidate, pending independent review): the page's pure
// decision seam (window.MarjinDailySubscription) evaluated in a node vm from the working-tree index.html — the SAME script
// block the page runs — plus static checks of the page wiring.
//   DSU-01  label «קבלת דוח יומי במייל»; owner / super_owner with a live selection only; never demo / other roles
//   DSU-02  requests: `action` is always present (a POST without it is a manual send); `enabled` is a strict boolean
//   DSU-03  decide: KNOWN only for 200 ok with a boolean `enabled` for THIS business; everything else UNKNOWN
//   DSU-04  default OFF; the switch is ON only after the server confirmed enabled; an unknown reply never changes the shown
//           state; states are per business
//   DSU-05  wiring: the page never touches the preference path directly; the switch is server-confirmed and address-free
//   DSU-06  ordering (C1): a reply never replaces a confirmed state of a higher version, in any arrival order; pending
//           changes lock the switch until all are settled; a failure shows only when no later request was confirmed
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
  stateFor: (...a) => plain(RAW.stateFor(...a)) };
const view = (st, b = B) => { const x = RAW.stateFor(st, T, b); return { kind: x.kind, enabled: x.enabled, version: x.version, busy: x.busy, failed: x.failed, checked: RAW.checked(st, T, b) }; };
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
  assert.deepEqual(M.decide(200, ok(), T, B), { kind: "known", enabled: true, version: 1 });
  assert.deepEqual(M.decide(200, ok({ enabled: false, version: null }), T, B), { kind: "known", enabled: false, version: 0 }, "no record = version 0");
  for (const version of [undefined, 0, -1, 1.5, "2", NaN]) assert.equal(M.decide(200, ok({ version }), T, B).kind, "unknown", "version " + String(version));
  const unknown = [[200, ok({ enabled: "true" })], [200, ok({ enabled: undefined })], [200, ok({ status: "unavailable" })], [200, ok({ tenantId: "other" })],
    [200, ok({ bizId: B2 })], [200, null], [200, []], [200, "ok"], [503, ok()], [400, ok()], [401, ok()], [403, ok()], [404, ok()], [500, ok()], [null, null]];
  for (const [status, body] of unknown) assert.equal(M.decide(status, body, T, B).kind, "unknown", JSON.stringify([status, body]));
});

test("DSU-04 default OFF; only confirmed states change the switch; per business", () => {
  assert.equal(RAW.checked({}, T, B), false, "default OFF before any confirmation");
  assert.deepEqual(view({}), { kind: "idle", enabled: false, version: -1, busy: false, failed: false, checked: false });
  let s = RAW.settle({}, RAW.decide(200, ok({ enabled: true }), T, B), T, B, 1, false);
  assert.equal(RAW.checked(s, T, B), true); assert.equal(RAW.checked(s, T, B2), false, "another business is untouched");
  s = RAW.begin(s, T, B, true); assert.deepEqual([view(s).busy, view(s).checked], [true, true], "busy keeps the confirmed state");
  s = RAW.settle(s, RAW.decide(503, { status: "unavailable" }, T, B), T, B, 2, true);
  assert.deepEqual([view(s).checked, view(s).failed, view(s).busy], [true, true, false], "a failed change never flips the switch");
  s = RAW.settle(s, RAW.decide(200, ok({ enabled: false, version: 2 }), T, B), T, B, 3, false);
  assert.deepEqual([view(s).checked, view(s).failed], [false, false], "a later confirmed reply clears the failure");
  const fresh = RAW.settle({}, RAW.decide(null, null, T, B), T, B, 1, false);
  assert.deepEqual([RAW.checked(fresh, T, B), view(fresh).kind, view(fresh).failed], [false, "idle", true], "an unknown first reply confirms nothing");
});

test("DSU-06 ordering: versions win over arrival order; pending changes lock; stale failures stay silent", () => {
  const known = (enabled, version) => RAW.decide(200, ok({ enabled, version }), T, B);
  // delayed ON read (v1, request 2) arriving after the confirmed OFF change (v2, request 3)
  let s = RAW.settle({}, known(true, 1), T, B, 1, false);
  s = RAW.begin(s, T, B, true);
  s = RAW.settle(s, known(false, 2), T, B, 3, true);
  s = RAW.settle(s, known(true, 1), T, B, 2, false);
  assert.deepEqual(view(s), { kind: "known", enabled: false, version: 2, busy: false, failed: false, checked: false }, "the stale ON read is ignored");
  // every arrival order of { read v1 ON, change v2 OFF, read v2 OFF, change v3 ON } ends at the highest version
  const replies = [[known(true, 1), 1, false], [known(false, 2), 2, true], [known(false, 2), 3, false], [known(true, 3), 4, true]];
  const perms = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  for (const order of perms(replies)) {
    let st = RAW.begin(RAW.begin({}, T, B, true), T, B, true);
    for (const [d, seq, ch] of order) st = RAW.settle(st, d, T, B, seq, ch);
    assert.deepEqual(view(st), { kind: "known", enabled: true, version: 3, busy: false, failed: false, checked: true }, JSON.stringify(order.map((o) => o[1])));
  }
  // pending changes: the switch stays locked until EVERY change is settled, even when a read confirms meanwhile
  s = RAW.begin(RAW.begin(RAW.settle({}, known(true, 1), T, B, 1, false), T, B, true), T, B, true);
  s = RAW.settle(s, known(false, 2), T, B, 2, true); assert.equal(view(s).busy, true, "one change still pending");
  s = RAW.settle(s, known(true, 3), T, B, 3, false); assert.equal(view(s).busy, true, "a read never unlocks a pending change");
  s = RAW.settle(s, RAW.decide(null, null, T, B), T, B, 4, true); assert.deepEqual([view(s).busy, view(s).checked, view(s).failed], [false, true, true]);
  // a failure of an EARLIER request after a later confirmation shows nothing
  s = RAW.settle(RAW.settle({}, known(false, null), T, B, 5, false), RAW.decide(503, {}, T, B), T, B, 4, false);
  assert.deepEqual([view(s).failed, view(s).checked], [false, false], "a stale failure stays silent");
  // per business: replies settle only their own business
  s = RAW.begin(RAW.settle({}, known(true, 1), T, B, 1, false), T, B, true);
  s = RAW.settle(s, RAW.decide(200, ok({ bizId: B2, enabled: false, version: null }), T, B2), T, B2, 2, false);
  assert.deepEqual([view(s).busy, view(s).checked, view(s, B2).checked, view(s, B2).busy], [true, true, false, false]);
});

test("DSU-05 wiring: server-confirmed, owner-only, address-free; the preference path is never touched by the page", () => {
  assert.ok(!HTML.includes("email_delivery_subscriptions"), "the page never names the server-only preference path");
  const i = HTML.indexOf("{/* Daily e-mail subscription (owner / super_owner"); assert.ok(i > 0);
  const block = HTML.slice(i, HTML.indexOf("{/* Business Switch Modal */}", i));
  for (const needle of ["!currentUser", "!isDemoMode", "OWNER_ROLES.includes(loggedInUser?.role)", "checked={on}", "disabled={s.kind!==\"known\"||s.busy}",
    "onChange={(e)=>changeDailySubscription(e.target.checked)}", "window.MarjinDailySubscription.LABEL_HE"]) assert.ok(block.includes(needle), needle);
  assert.ok(!/@|recipient|email\b/i.test(block.replace(/LABEL_HE|data-daily-subscription|MarjinDailySubscription|changeDailySubscription|dailySubscription/g, "")), "no address or recipient field in the switch");
  const EFF = "// Daily e-mail subscription: read only when the owner opens the panel";
  const eff = HTML.slice(HTML.indexOf(EFF), HTML.indexOf("  const finF = finCoreState", HTML.indexOf(EFF))); assert.ok(HTML.indexOf(EFF) > 0 && eff.length > 1000);
  assert.ok(eff.includes("window.MarjinDailySubscription.readRequest(ctx.tenantId, bizId)") && eff.includes("window.MarjinDailySubscription.setRequest(ctx.tenantId, bizId, enabled)"));
  for (const needle of ["const seq = ++dailySubSeqRef.current;", "const bizId = currentBizId, seq = ++dailySubSeqRef.current;", "window.MarjinDailySubscription.begin(prev, ctx.tenantId, bizId, true)",
    "window.MarjinDailySubscription.settle(prev, decision, ctx.tenantId, bizId, seq, false)", "window.MarjinDailySubscription.settle(prev, decision, ctx.tenantId, bizId, seq, true)"])
    assert.equal(eff.split(needle).length, 2, "C1 ordering wiring: " + needle);
  assert.ok(eff.includes("if (!isLive() || !isSelectionLive(ctx)) return;") && eff.includes("readDailySubscription(ctx, currentBizId, () => live);"), "a read for a closed panel or a selection that is no longer live is dropped");
  assert.ok(eff.includes("if (!showDailySubscription || !bound || currentUser"), "nothing is requested on page load: the read waits for the owner to open the panel");
});
