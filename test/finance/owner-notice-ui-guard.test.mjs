// Owner-notice UI R1 guard — identity, provenance, scope and the decision rules of the page patch (LOCAL; pending independent
// review and the page owner's M1 layer transition).
//   UIG-01  the protected files changed relative to the approved M1 R5 commit are EXACTLY { index.html }; committed / staged /
//           checked-out bytes equal the recorded pin; the candidate has exactly one parent, cfa7e801
//   UIG-02  provenance: the pin is the M1 R5 index.html + exactly the four recorded edits, each purely ADDITIVE (every line
//           of `from` survives, in order, in `to`)
//   UIG-03  scope: nothing else changes (route, libraries, Rules, schedule, pins, guards, generated assets byte-identical);
//           the page never names the notice store, never reads it through window.storage, never calls the route without
//           action: "notice", never gains a repair action of its own (the control opens the EXISTING settings wizard)
//   UIG-04  the decision rules in the source: owner / super_owner only; selection-bound; the alert is shown by the server-
//           confirmed business state (never by a stored message); a failed read changes nothing; per-business states
//   UIG-05  the backend dependency: the route of THIS tree must implement the delivery R7 notice contract (noticeState /
//           clearState / action: "notice") — on the M1 R5 base it does NOT (no DE1 layer is carried): reported as TODO,
//           never as a pass; it passes only on the integrated SHA that carries delivery R7 (d5e1f301…)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId } from "../support/m1-r1-remediation.mjs";
import { isI1Tree, I1_UI } from "../support/i1-integration.mjs";
import { OWNUI_PARENT, OWNUI_PINS, OWNUI_NEW_FILES, OWNUI_EDITS, OWNUI_SCOPE, isOwnerNoticeUiTree, deriveOwnerNoticeUi } from "../support/owner-notice-ui.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isOwnerNoticeUiTree(REPO) && "not an owner-notice UI tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const PAGE = "index.html";
const R7_DELIVERY = "d5e1f30102ff88db985a6ff60392cfbdbafd856b";
// INTEGRATION I1 (page-owner transition, PROPOSED): the UI R1 delta is CARRIED onto the integrated tree together with the route
// it depends on (never onto the M1 R5 route alone — H-UI-01). On an I1 tree UIG-01 / UIG-03 verify the UI candidate commit
// itself (2a9df535: sole parent the M1 R5 commit, change set { index.html }) from git objects, and the checked-out page is the
// same pin; the HEAD identity of the integrated tree is held by I1G-01 and the page derivation by m1EffectivePageVerdict.
const LAYERED = isI1Tree(REPO);
const UI_TREE = LAYERED ? I1_UI : "HEAD";          // the UI candidate commit itself when it is carried by I1

test("UIG-01 the change set vs the approved M1 R5 commit is exactly { index.html }; the pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(OWNUI_PARENT, "cfa7e8016e9d1b7440485de7911d133d9340f1e6", "built on the approved M1 R5 commit (APPROVED_FOR_AGENT_DAILY_ENTRY)");
  if (LAYERED) assert.equal(UI_TREE, "2a9df535b5a0c94940724158cf24c905f4cd17b6", "the carried UI candidate");
  assert.equal(gitIn(REPO, ["rev-parse", UI_TREE + "^"]).stdout.trim(), OWNUI_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", UI_TREE]))[0].split(" ").length, 2, "exactly one parent");
  assert.match(OWNUI_PINS[PAGE], /^[0-9a-f]{40}$/, "literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", OWNUI_PARENT, UI_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", OWNUI_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", OWNUI_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  if (LAYERED) assert.equal(blobId(UI_TREE + ":" + PAGE), OWNUI_PINS[PAGE], "the UI candidate commit carries the pinned page");
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [PAGE], label + ": protected changes vs M1 R5 = { index.html }");
  assert.equal(blobId("HEAD:" + PAGE), OWNUI_PINS[PAGE], "committed");
  assert.equal(blobId(":" + PAGE), OWNUI_PINS[PAGE], "staged");
  assert.equal(gitBlobId(readFileSync(join(REPO, PAGE))), OWNUI_PINS[PAGE], "checked out");
});

test("UIG-02 provenance: the pin is the M1 R5 page + exactly the recorded, purely additive edits", { skip: SKIP }, () => {
  assert.deepEqual(OWNUI_NEW_FILES, []); assert.deepEqual(Object.keys(OWNUI_EDITS), [PAGE]);
  assert.equal(blobId(`${OWNUI_PARENT}:${PAGE}`), "a5b7c4dba5e87584a3c61659042711d24c9beea5", "the parent page is the approved M1 R5 page blob");
  const d = deriveOwnerNoticeUi(REPO, PAGE); assert.ok(d.ok, JSON.stringify(d));
  assert.equal(gitBlobId(d.bytes), OWNUI_PINS[PAGE], "M1 R5 page + recorded edits = the pin");
  assert.equal(OWNUI_EDITS[PAGE].length, 4, "four insertion points: the seam script, the state, the effect, the banner");
  for (const [k, e] of OWNUI_EDITS[PAGE].entries()) {
    // additive: every line of `from` is present in `to`, in order
    let at = 0;
    for (const line of e.from.split("\n")) { const i = e.to.indexOf(line, at); assert.ok(i >= 0, `edit #${k}: a parent line was removed: ${line.slice(0, 60)}`); at = i + line.length; }
    assert.ok(e.to.length > e.from.length, `edit #${k} adds`);
  }
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(OWNUI_EDITS)); fn(e[PAGE]); return e; };
  assert.equal(deriveOwnerNoticeUi(REPO, PAGE, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  const dropped = deriveOwnerNoticeUi(REPO, PAGE, tamper((l) => { l.pop(); })); assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== OWNUI_PINS[PAGE]);
  const altered = deriveOwnerNoticeUi(REPO, PAGE, tamper((l) => { l[l.length - 1].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== OWNUI_PINS[PAGE]);
});

test("UIG-03 scope: nothing but the page; no store path, no read without action: \"notice\", no repair action of its own", { skip: SKIP }, () => {
  assert.deepEqual([...OWNUI_SCOPE], [PAGE]);
  const all = lines(gitIn(REPO, ["diff", "--name-only", OWNUI_PARENT, UI_TREE, "--"]));
  assert.deepEqual(all.filter((f) => !/^test\/(finance|support|emulator)\//.test(f) && f !== PAGE), [], "no runtime / config / tool / Rules change outside the page and its tests");
  for (const f of ["api/daily-snapshot/run.ts", "api/admin.js", "lib/securityContext.js", "lib/businessRegistry.js", "database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json",
    "test/support/m1-integration-pin.mjs", "test/support/m1-index-scope.mjs", "test/support/m1-r1-remediation.json"].filter((f) => blobId(`${OWNUI_PARENT}:${f}`) !== null))
    assert.equal(blobId(UI_TREE + ":" + f), blobId(`${OWNUI_PARENT}:${f}`), f + " unchanged");
  const page = readFileSync(join(REPO, PAGE), "utf8"), parent = gitIn(REPO, ["cat-file", "blob", `${OWNUI_PARENT}:${PAGE}`]).stdout;
  const added = OWNUI_EDITS[PAGE].map((e) => e.to).join("\n");
  const code = added.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(l)).join("\n");    // comments (and JSX comments) stripped
  assert.ok(!code.includes("email_delivery") && !code.includes("daily_snapshot_notices"), "the page never names the server-only store");
  assert.ok(!/storage\.(get|getNode|subscribeNode|subscribe)\([^)]*notice/i.test(added), "no client read of a notice node through window.storage");
  assert.equal((code.match(/daily-snapshot\/run/g) || []).length, 1, "the endpoint is named exactly once by the patch's code (NOTICE_ENDPOINT)");
  assert.equal((page.match(/daily-snapshot\/run/g) || []).length - (parent.match(/daily-snapshot\/run/g) || []).length, (added.match(/daily-snapshot\/run/g) || []).length, "every new mention is inside the recorded edits");
  assert.ok(added.includes('window.apiFetch(window.MarjinDailyNotice.NOTICE_ENDPOINT, { method: "POST", body: JSON.stringify(window.MarjinDailyNotice.noticeRequest(ctx.tenantId, currentBizId)) })'), "the only call: the authorized read with noticeRequest (action: \"notice\")");
  assert.ok(added.includes('function noticeRequest(tenantId, bizId) { return { tenantId: tenantId, bizId: bizId, action: "notice" }; }'), "the request always carries action: \"notice\"");
  assert.ok(!/fetch\(\s*["'`]\/api\/daily-snapshot/.test(added), "no raw fetch of the route");
  assert.ok(added.includes('<button data-daily-notice="settings" onClick={()=>setShowSetup(true)}'), "the repair control opens the EXISTING settings wizard");
  assert.ok(!/update-client|app-businesses|storage\.(set|setFor|mutateFor)/.test(added), "no repair / registry write of its own");
});

test("UIG-04 the decision rules in the source", { skip: SKIP }, () => {
  const added = OWNUI_EDITS[PAGE].map((e) => e.to).join("\n");
  assert.ok(added.includes('var MESSAGE_HE = "לא ניתן להכין את הסיכום היומי כי חסר שם העסק. נדרש תיקון פרטי העסק.";'), "the decided sentence, verbatim");
  assert.ok(added.includes('var OWNER_ROLES = Object.freeze(["owner", "super_owner"]);') && added.includes("return OWNER_ROLES.indexOf(role) >= 0 &&"), "owner / super_owner only");
  assert.ok(added.includes('&& window.MarjinDailyNotice.OWNER_ROLES.includes(loggedInUser?.role) &&'), "the banner is gated by the role as well");
  assert.ok(added.includes("const ctx = captureSelectionCtx();") && added.includes("if (!live || !isSelectionLive(ctx)) return;"), "selection-bound: a reply for a selection no longer live is dropped");
  assert.ok(added.includes('if (body.deliverable === true) return { kind: "clear" };') && added.includes('if (body.deliverable === false && body.code === "business_name_unavailable") {'), "the business state decides");
  assert.ok(added.includes('if (status !== 200 || !isRecord(body)) return { kind: "unknown"') && added.includes('if (typeof body.noticeState !== "string" || typeof body.clearState !== "string") return { kind: "unknown"'), "anything but a 200 R7 reply is unknown");
  assert.ok(added.includes('if (!isRecord(decision) || decision.kind === "unknown") { if (cur.kind !== "idle") out[key(tenantId, bizId)] = Object.assign({}, cur, { lastReadFailed: true }); return out; }'), "unknown never hides and never shows");
  assert.ok(added.includes("<span data-daily-notice=\"message\">{window.MarjinDailyNotice.MESSAGE_HE}</span>"), "the fixed sentence is rendered — never body.notice.message");
  assert.ok(!/notice\.message|\.message\}/.test(added), "no stored / synthesized message is rendered");
  assert.ok(added.includes("window.MarjinDailyNotice.shouldAsk(dailyNoticeRole, ctx.tenantId, currentBizId, isDemoMode)"), "never in demo mode");
  assert.ok(added.includes('return stateFor(states, tenantId, bizId).kind === "active";'), "visible only in the active state of the selected business");
});

test("UIG-05 the backend dependency: the route of this tree implements the delivery R7 notice contract", { skip: SKIP }, (t) => {
  const route = readFileSync(join(REPO, "api", "daily-snapshot", "run.ts"), "utf8");
  const r7 = route.includes('if (action === "notice") {') && route.includes("noticeState") && route.includes("clearState") && route.includes("readDeliveryNoticeState(");
  if (!r7) { t.todo(`PENDING by design on this base: the route of this tree does not serve action: "notice" with the R7 contract — the page must be carried onto the integrated SHA that holds delivery R7 (${R7_DELIVERY}); on an older route an owner POST is a manual Daily send (H-UI-01)`); return; }
  assert.ok(r7, "the R7 notice contract is served by this tree's route");
});
