// ENTRIES-ACCESS — a denied / failed / malformed read of the selected business's entries is a visible typed
// state: every financial view (Dashboard, P&L, Purchases, labor, daily revenue list) leaves "loading" and shows
// a Hebrew access / read error with a retry — never figures, zeros or "no entries". Browser harness denied.mjs
// drives the real page over isolated denied reads (no live permission is touched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";

const HTML = readFileSync(join(REPO, "index.html"), "utf8");

test("ENTRIES-ACCESS-01 the failure kind: a Firebase permission error is 'denied'; anything else is 'failed'", () => {
  const src = HTML.slice(HTML.indexOf("  const entriesFailureKind = "), HTML.indexOf("\n", HTML.indexOf("  const entriesFailureKind = ")));
  const fn = vm.runInNewContext(`(${src.replace("  const entriesFailureKind = ", "").replace(/;\s*$/, "")})`);
  assert.equal(fn({ code: "PERMISSION_DENIED", message: "permission_denied at /tenants/T/biz:B:entries" }), "denied");
  assert.equal(fn(new Error("PERMISSION_DENIED: Permission denied")), "denied");
  assert.equal(fn({ code: "NETWORK_ERROR", message: "disconnected" }), "failed");
  assert.equal(fn(null), "failed");
});

test("ENTRIES-ACCESS-02 the listener, the hydration probe and a malformed node all record the failure for THIS selection; the view model surfaces it before anything else; a retry re-runs the selection load", () => {
  assert.match(HTML, /if \(live && isSelectionLive\(ctxAtSetup\)\) setEntriesReadFailure\(\{ gen: ctxAtSetup\.gen, kind: entriesFailureKind\(err\) \}\);/);
  assert.match(HTML, /setEntriesReadFailure\(\{ gen: ctxAtSetup\.gen, kind: "malformed" \}\)/);
  assert.match(HTML, /if \(!entriesWriteCoordRef\.current\.isReady\(\)\) setEntriesReadFailure\(\{ gen: ctxAtSetup\.gen, kind: entriesFailureKind\(failErr\) \}\);/);
  assert.match(HTML, /const entriesFail = entriesReadFailure && entriesReadFailure\.gen === finSel\.gen \? entriesReadFailure\.kind : null;/);
  assert.match(HTML, /entriesFail \? \{ status: "unavailable", reason: "entries_" \+ entriesFail \}/);
  assert.match(HTML, /\},\[currentBizId, entriesReadRetry\]\);/);
});

test("ENTRIES-ACCESS-03 Hebrew texts exist for each failure kind and every financial screen renders the notice", () => {
  for (const k of ["entries_denied", "entries_failed", "entries_malformed"]) assert.match(HTML, new RegExp(k + ': "[^"]*לא מוצגים סכומים ואחוזים'));
  assert.ok((HTML.match(/<EntriesAccessNotice view=\{/g) || []).length >= 5, "Dashboard, Purchases, daily list, P&L, labor");
  assert.match(HTML, /const sorted = entriesFail \? \[\] :/, "no 'missing' day cards from a denied read");
  assert.match(HTML, /\{fcTab==="by_supplier" && !entriesFail && /, "no supplier inputs from a denied read");
});
