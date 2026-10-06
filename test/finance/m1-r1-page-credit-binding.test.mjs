// M1 R1 — the integrated page's supplier-credit BINDING (independent review: the `page-finsrc-credits-unbound` mutant, which binds
// the credit decode to `currentBizId` instead of the selection, was not detected and its claimed equivalence rested only on
// unchanged figures; the credits tab consumes finSrc.credits directly).
//   PBR1-01  key ⇔ bind coherence, over EVERY combination of selection business and current business (reachable or not):
//            whenever a credit request key exists, the credit decode is bound to EXACTLY the tenant and business that key was
//            built from (the P1 R7 rule "the credit binding is part of creditsKey"). A binding to any other business — the
//            mutant — is refused here, independent of figures.
//   PBR1-02  reachability: every write of currentBizId is preceded, in the same synchronous block, by a selection invalidation
//            with the SAME business; every other invalidation sets the business to null or to the committed currentBizId; the
//            controller is mutated only through invalidateSelection. Hence in every render finSel.bizId === currentBizId, or
//            finSel.bizId is null (no key) — the states in which the two bindings could differ never carry a ready credit node.
//   PBR1-03  the credits tab (monthView over finSrc.credits) for each reachable state class: a ready node of the live
//            selection is a ready tab; with no key it is loading; a node delivered for another key is loading — never another
//            business's rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance } from "../support/c1-seam.mjs";
import { creditNode, spec } from "../support/p1-credit-fixtures.mjs";
import * as SC from "../../lib/supplierCredits.js";

const html = readFileSync(join(REPO, "index.html"), "utf8");
const F = await loadFinance();
const P1 = (() => { const i = html.indexOf("// ── P1 supplier credits browser seam"); const win = {}; vm.runInNewContext(html.slice(i, html.indexOf("</script>", i)), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController }); return win.MarjinP1; })();
const lineOf = (start) => { const i = html.indexOf(start); assert.ok(i > 0 && html.indexOf(start, i + 1) === -1, "unique page line: " + start); return html.slice(i, html.indexOf("\n", i)); };
const KEY_SRC = lineOf("  const creditsKey = finSel && finSel.tenantId && finSel.bizId ?");
const CREDITS_SRC = lineOf("    const credits = window.MarjinP1 ? window.MarjinP1.sourceFor(finF, creditsHeld, creditsKey,");
const T = "tenantA", B = "bizA", B2 = "bizB";

/** Evaluate the page's OWN creditsKey and credits expressions for a selection / current-business state. */
function pageCredits({ finSel, currentBizId, creditsHeld, creditsAttempt = 0, sourceFor = P1.sourceFor }) {
  const calls = [];
  const win = { MarjinP1: { sourceFor: (...a) => { calls.push({ key: a[2], bind: a[3] }); return sourceFor(...a); } } };
  const ctx = { window: win, finF: F, finSel, currentBizId, creditsHeld, creditsAttempt };
  vm.runInNewContext(KEY_SRC.replace("const creditsKey", "this.creditsKey"), ctx);
  vm.runInNewContext(`creditsKey = this.creditsKey; ${CREDITS_SRC.trim().replace("const credits", "this.credits")}`, ctx);
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));   // values cross the vm realm
  return { key: ctx.creditsKey, credits: plain(ctx.credits), calls: calls.map((c) => ({ key: c.key, bind: plain(c.bind) })) };
}

test("PBR1-01 key ⇔ bind coherence over every (selection business × current business) state: the decode is bound to exactly the key's tenant and business", () => {
  let checked = 0;
  for (const selBiz of [null, B, B2]) for (const cur of [null, B, B2]) for (const tenant of [null, T]) {
    const finSel = { tenantId: tenant, bizId: selBiz, gen: 7 };
    const { key, calls } = pageCredits({ finSel, currentBizId: cur, creditsHeld: { state: "loading", key: null } });
    assert.equal(calls.length, 1);
    if (key === null) { assert.ok(!(tenant && selBiz), "no key exactly when the selection has no tenant/business"); continue; }
    const [kt, kb] = key.split("|");
    assert.deepEqual(calls[0].bind, { tenantId: kt, bizId: kb }, `selection ${selBiz} / current ${cur}: bind = the key's context`);
    checked++;
  }
  assert.equal(checked, 6);
  // the mutant's binding (selection tenant + currentBizId) is incoherent whenever the two businesses differ
  const mutated = CREDITS_SRC.replace("{ tenantId: finSel.tenantId, bizId: finSel.bizId }", "{ tenantId: finSel.tenantId, bizId: currentBizId }");
  assert.notEqual(mutated, CREDITS_SRC, "the review's mutant applies to the page line");
});

test("PBR1-02 reachability: currentBizId writes are preceded by a same-business invalidation; other invalidations use null or the committed business; the controller is mutated only there", () => {
  const count = (s) => html.split(s).length - 1;
  assert.equal(count("selectionCtrlRef.current.invalidate("), 1, "the controller is mutated only by invalidateSelection");
  const inv = html.slice(html.indexOf("const invalidateSelection"), html.indexOf("selectionCtrlRef.current.invalidate(") + 80);
  assert.ok(inv.length > 0 && inv.length < 600, "…inside invalidateSelection");
  // every raw currentBizId write, with the invalidation that precedes it in the same synchronous block
  const writes = [...html.matchAll(/setCurrentBizId_\(/g)].map((m) => m.index).filter((i) => !html.slice(i - 40, i).includes("[currentBizId, "));
  const PAIRS = [
    ["invalidateSelection(window._currentTenantId == null ? null : window._currentTenantId, id == null ? null : id);", "setCurrentBizId_(id);"],
    ['invalidateSelection(window._currentTenantId == null ? null : window._currentTenantId, "demo_biz");', 'setCurrentBizId_("demo_biz");'],
    ["invalidateSelection(null, null); // R3: tenant reset/logout invalidates the selection synchronously", "setCurrentBizId_(null);"],
  ];
  assert.equal(writes.length, PAIRS.length, "exactly the three recorded currentBizId writes");
  for (const [invLit, writeLit] of PAIRS) {
    const w = html.indexOf(writeLit), v = html.lastIndexOf(invLit, w);
    assert.ok(w > 0 && v > 0 && writes.includes(w), writeLit);
    const between = html.slice(v + invLit.length, w);
    assert.ok(!/\bawait\b|setTimeout|\.then\(|setCurrentBizId_|invalidateSelection\(/.test(between), "same synchronous block: " + writeLit);
  }
  // every invalidation: null business, or the business assigned right after (above), or the committed currentBizId (reconcile effect)
  const calls = [...html.matchAll(/invalidateSelection\(([^;]*)\);/g)].map((m) => m[1]).filter((a) => !a.startsWith("tenantId, bizId"));
  const allowed = [/, null$/, /^null, null$/, /, id == null \? null : id$/, /, "demo_biz"$/, /, currentBizId == null \? null : currentBizId$/];
  for (const a of calls) assert.ok(allowed.some((re) => re.test(a.trim())), "invalidation business is null / same / committed: " + a);
  assert.equal(calls.length, 8, "the recorded invalidation call sites");
});

test("PBR1-03 the credits tab per reachable state class: live selection ready; no key loading; a node of another key loading — never another business's rows", () => {
  const node = SC.safeNodeView(creditNode([spec(1, "s1", "2026-10-01", "40")], { tenantId: T, bizId: B }));
  const sups = [{ id: "s1", name: "S" }];
  const live = pageCredits({ finSel: { tenantId: T, bizId: B, gen: 3 }, currentBizId: B, creditsHeld: { state: "ready", key: `${T}|${B}|3|0`, node } });
  assert.equal(live.credits.state, "present"); assert.equal(P1.monthView(F, live.credits, "2026-10", sups).status, "ready");
  const nokey = pageCredits({ finSel: { tenantId: T, bizId: null, gen: 4 }, currentBizId: B, creditsHeld: { state: "ready", key: `${T}|${B}|3|0`, node } });
  assert.equal(nokey.key, null); assert.deepEqual(nokey.credits, { state: "loading" });
  const moved = pageCredits({ finSel: { tenantId: T, bizId: B2, gen: 5 }, currentBizId: B2, creditsHeld: { state: "ready", key: `${T}|${B}|3|0`, node } });
  assert.deepEqual(moved.credits, { state: "loading" }, "the bizA node is never shown for bizB");
  assert.equal(P1.monthView(F, moved.credits, "2026-10", sups).status, "loading");
});
