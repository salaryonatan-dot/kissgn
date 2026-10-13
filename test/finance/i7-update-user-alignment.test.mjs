// Agent/Daily integration I7 — update-user Auth/RTDB alignment (independent I6 review I6-R-04; I5 NEXT_WORK "Auth and RTDB must remain
// aligned"; T-I7-AUTH-ALIGN, PROPOSED for the user-access / admin-API owners). The REAL api/admin.js handler of this checkout runs over the
// reference-recording database of test/support/i4-boundary-harness.mjs with a STATEFUL fake Auth (updateUser moves — or, per fault, does
// not move — the stored e-mail; getUser returns it or fails). Simultaneous e-mail + scope change for sub1. Not hosted evidence.
//   UA-01  outcomes the handler can ESTABLISH are left aligned before it answers: Auth applied-then-error (I6-R-04 a) is undone; a
//          revert that answered an error but applied is recognised; a rejected (unapplied) change is left alone — 500 with the existing
//          bodies, records unchanged, no "UNCONFIRMED" line; an identical request afterwards succeeds once
//   UA-02  outcomes it CANNOT establish or undo (the revert is refused — I6-R-04 b; Auth unreadable; Auth holding neither e-mail; no
//          previous e-mail) are not hidden: same 500 body, an
//          "UNCONFIRMED … manual repair required" line naming tenant and uid, and the true state is recorded (split where Auth moved).
//          Their recovery is the owner decision D-I7-01 (UPDATE_USER_FAILURE_SEMANTICS.md) — this test claims none
//   UA-03  an INTERRUPTED invocation (process lost while the Auth or the final database call is in flight) leaves Auth moved and the
//          records unchanged, with no answer at all: characterised, not resolved (D-I7-01)
//   UA-04  authorization is unchanged and the compensation acts only on the target: non-owner / foreign tenant / unauthenticated are
//          refused before any Auth call; the success path makes exactly one Auth call (no read-back)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { adminHarness, observe, seed, closeSdk, clone } from "../support/i4-boundary-harness.mjs";

let H = null;
const head = async () => (H ??= await adminHarness());
after(async () => { await closeSdk(); });
const OLD = "sub1@example.test", NEW = "changed@example.test";
const UU = { tenantId: "tenantA", firebaseUid: "sub1", email: NEW, allowedBizIds: ["bizB"] };
const AUTH_ERR = { error: "שגיאה בעדכון Firebase Auth" }, WRITE_ERR = { error: "שגיאה בשמירת המשתמש — פנה לתמיכה" };
const never = () => new Promise(() => {});

/** A stateful Auth for one scenario; restores the harness Auth afterwards. */
function authModel(h, F) {
  const orig = { updateUser: h.auth.updateUser, getUser: h.auth.getUser };
  const state = { sub1: F.authInitial ?? OLD };
  const err = (m, code = "auth/internal-error") => Object.assign(new Error(m), { code });
  h.auth.updateUser = async (uid, o) => {
    h.auth.calls.push(["updateUser", uid, clone(o)]);
    const toNew = o.email === NEW, toOld = o.email === OLD;
    if (toNew && F.newMode === "reject") throw err("injected rejection");
    if (toNew && F.newMode === "hang-after-apply") { state[uid] = o.email; return never(); }
    if (toOld && F.revertMode === "reject") throw err("injected revert rejection");
    state[uid] = o.email;
    if (toNew && F.newMode === "applied-then-error") throw err("deadline exceeded", "ETIMEDOUT");
    if (toOld && F.revertMode === "applied-then-error") throw err("revert deadline exceeded", "ETIMEDOUT");
    return { uid };
  };
  h.auth.getUser = async (uid) => { h.auth.calls.push(["getUser", uid]); if (F.getUser === "fail") throw err("injected getUser failure"); return { uid, email: state[uid] }; };
  return { state, restore: () => Object.assign(h.auth, orig) };
}
function failWrite(h, mode) {
  const base = h.db.ref;
  h.db.ref = (p) => { const r = base(p); if (p === undefined) r.update = mode === "hang" ? () => never() : async () => { throw new Error("local injected write failure"); }; return r; };
  return () => { h.db.ref = base; };
}
const stored = (h) => ({ users: h.db.read("tenants/tenantA/users/sub1/email"), appUsers: (JSON.parse(h.db.read("tenants/tenantA/app/users")?._v || "[]").find((u) => u.firebaseUid === "sub1") || {}).email ?? null });
async function scenario(F, run) {
  const h = await head(); const before = seed(); if (F.mutate) F.mutate(before); h.reset(clone(before));
  const model = authModel(h, F); const restoreWrite = F.write ? failWrite(h, F.write) : () => {};
  const lines = []; const prevErr = console.error; console.error = (...a) => lines.push(a.map(String).join(" "));
  try { return await run({ h, before, model, lines }); }
  finally { console.error = prevErr; restoreWrite(); model.restore(); }
}
const N = ["updateUser", "sub1", { email: NEW }], O = ["updateUser", "sub1", { email: OLD }], G = ["getUser", "sub1"];
const ALIAS = "sub1@temp.marjin.app", OTHER = "elsewhere@example.test";
const NO_PREV = (st) => { delete st.tenants.tenantA.users.sub1.email; };
const unconfirmed = (lines) => lines.filter((l) => /UNCONFIRMED/.test(l));

test("UA-01 an outcome the handler can establish is left ALIGNED before it answers; an identical request afterwards succeeds once", async () => {
  const cases = [
    ["Auth rejected (not applied)", { newMode: "reject" }, AUTH_ERR, [N, G]],
    ["I6-R-04 (a): Auth applied, then answered an error", { newMode: "applied-then-error" }, AUTH_ERR, [N, G, O]],
    ["Auth applied-then-error; the revert also applied-then-error", { newMode: "applied-then-error", revertMode: "applied-then-error" }, AUTH_ERR, [N, G, O, G]],
    ["final RTDB write failure; revert succeeds", { write: "fail" }, WRITE_ERR, [N, O]],
    ["final RTDB write failure; revert applied-then-error", { write: "fail", revertMode: "applied-then-error" }, WRITE_ERR, [N, O, G]],
  ];
  for (const [label, F, body, calls] of cases) await scenario(F, async ({ h, before, model, lines }) => {
    const o = observe(h, await h.call("update-user", clone(UU), "own"));
    assert.deepEqual([o.status, o.body], [500, body], label);
    assert.deepEqual(o.auth, calls, label + ": Auth calls");
    assert.deepEqual(o.state, before, label + ": records unchanged");
    assert.deepEqual([model.state.sub1, stored(h).users, stored(h).appUsers], [OLD, OLD, OLD], label + ": Auth = users = app/users (aligned)");
    assert.deepEqual(unconfirmed(lines), [], label + ": nothing left unconfirmed");
  });
  // the retry, separately (a clean model): exactly one Auth change, everything aligned
  await scenario({}, async ({ h, model }) => {
    const r = observe(h, await h.call("update-user", clone(UU), "own"));
    assert.equal(r.status, 200); assert.deepEqual(r.auth, [N], "success path: exactly one Auth call, no read-back");
    assert.deepEqual([model.state.sub1, stored(h).users, stored(h).appUsers], [NEW, NEW, NEW]);
  });
});

test("UA-02 an outcome it cannot establish or undo is NOT hidden: same 500, an UNCONFIRMED line naming tenant and uid, the true state recorded (D-I7-01 decides recovery)", async () => {
  const cases = [
    ["Auth applied-then-error; the revert is refused", { newMode: "applied-then-error", revertMode: "reject" }, AUTH_ERR, [N, G, O, G], NEW, "revert_not_applied"],
    ["Auth applied-then-error; Auth unreadable", { newMode: "applied-then-error", getUser: "fail" }, AUTH_ERR, [N, G], NEW, "auth_unreadable"],
    ["Auth rejected; Auth unreadable (in fact unchanged)", { newMode: "reject", getUser: "fail" }, AUTH_ERR, [N, G], OLD, "auth_unreadable"],
    ["I6-R-04 (b): final RTDB write failure; the revert is refused", { write: "fail", revertMode: "reject" }, WRITE_ERR, [N, O, G], NEW, "revert_not_applied"],
    ["final RTDB write failure; revert refused; Auth unreadable", { write: "fail", revertMode: "reject", getUser: "fail" }, WRITE_ERR, [N, O, G], NEW, "auth_unreadable"],
    // Auth holds NEITHER e-mail (a pre-existing divergence): the change did not apply, but Auth ≠ records — never claimed aligned
    ["Auth rejected; Auth holds another e-mail (pre-existing divergence)", { newMode: "reject", authInitial: OTHER }, AUTH_ERR, [N, G], OTHER, "auth_diverged"],
    // a legacy record with NO previous e-mail (Auth holds a temp alias): there is nothing the existing compensation can restore
    ["no previous e-mail in the record; final RTDB write failure", { write: "fail", mutate: NO_PREV, authInitial: ALIAS }, WRITE_ERR, [N], NEW, "no_previous_email"],
    ["no previous e-mail in the record; Auth applied-then-error", { newMode: "applied-then-error", mutate: NO_PREV, authInitial: ALIAS }, AUTH_ERR, [N, G], NEW, "no_previous_email"],
  ];
  for (const [label, F, body, calls, authAfter, why] of cases) await scenario(F, async ({ h, before, model, lines }) => {
    const o = observe(h, await h.call("update-user", clone(UU), "own"));
    assert.deepEqual([o.status, o.body], [500, body], label + ": the answer is unchanged");
    assert.deepEqual(o.auth, calls, label + ": Auth calls");
    assert.deepEqual(o.state, before, label + ": records unchanged");
    assert.equal(model.state.sub1, authAfter, label + ": the true Auth state");
    const u = unconfirmed(lines);
    assert.equal(u.length, 1, label + ": one UNCONFIRMED line"); assert.match(u[0], /tenant tenantA uid sub1/, label);
    assert.ok(u[0].includes("unconfirmed:" + why), label + ": " + u[0]);
  });
});

test("UA-03 an interrupted invocation (process lost with the Auth or the final database call in flight) leaves Auth moved, records unchanged, no answer — characterised, not resolved", async () => {
  for (const [label, F] of [["Auth call in flight after applying", { newMode: "hang-after-apply" }], ["final RTDB write in flight", { write: "hang" }]]) await scenario(F, async ({ h, before, model }) => {
    const res = await Promise.race([h.call("update-user", clone(UU), "own"), new Promise((x) => setTimeout(() => x(null), 150))]);
    assert.equal(res, null, label + ": no answer");
    assert.deepEqual(h.db.value(), before, label + ": records unchanged");
    assert.equal(model.state.sub1, NEW, label + ": Auth moved — the split D-I7-01 must govern");
  });
});

test("UA-04 authorization unchanged; the compensation acts only on the target; the success path makes exactly one Auth call", async () => {
  for (const [actor, status] of [["mgr", 403], ["view", 403], ["sub1", 403], ["foreign", 403], [null, 401]]) await scenario({ newMode: "applied-then-error" }, async ({ h, before }) => {
    const o = observe(h, await h.call("update-user", clone(UU), actor));
    assert.equal(o.status, status, String(actor)); assert.deepEqual(o.auth, [], String(actor) + ": no Auth call"); assert.deepEqual(o.state, before);
  });
  await scenario({ newMode: "applied-then-error" }, async ({ h }) => {
    const o = observe(h, await h.call("update-user", clone(UU), "own"));
    assert.ok(o.auth.every((c) => c[1] === "sub1"), "only the target uid is read or changed");
    assert.ok(o.auth.every((c) => c[0] === "updateUser" || c[0] === "getUser"), "no create / delete");
  });
  await scenario({}, async ({ h }) => {
    const o = observe(h, await h.call("update-user", { tenantId: "tenantA", firebaseUid: "sub1", name: "Renamed" }, "own"));
    assert.equal(o.status, 200); assert.deepEqual(o.auth, [], "no e-mail change: no Auth call at all");
  });
});
