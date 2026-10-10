// DE1 R7 guard — identity, provenance and scope of the notice-integrity candidate (LOCAL; pending independent review).
//   DE1R7G-01  the protected runtime files R7 changes relative to R6 are EXACTLY { api/daily-snapshot/run.ts,
//              lib/emailDelivery.d.ts, lib/emailDelivery.js }; committed / staged / checked out bytes equal the effective pins
//              (M1 ⊕ DE1 ⊕ R1 … ⊕ R7); R7 has exactly one parent, R6
//   DE1R7G-02  provenance: each R7 pin is the R6 bytes (= the R6 pin) + exactly the recorded edits
//   DE1R7G-03  scope: the manual refusal attribution and the notice action of the route, one added read-state function of the
//              receipt module and its declaration; the authorization section, the scheduled path, the SMTP wrapper, the
//              builder, the predicates, Rules and schedule are byte-identical to R6 (and the resolved-result classifier to R6)
//   DE1R7G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R6 modules are not the R7 ones
//   DE1R7G-05  the decision rules in the source: no classification by exception class (the SyntaxError inference is gone; the
//              builder-attributed bounded set is the only mapping), no manufactured notice in the route (the Hebrew constant
//              is not imported by it), the store state is read through readDeliveryNoticeState (never throws), the three
//              states are distinct fields, 503 is the only status when a step failed, "cleared" follows an acknowledged removal
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { de1EffectivePins, de1R6Pins, de1R7Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { DE1R7_PARENT, DE1R7_PINS, DE1R7_NEW_FILES, DE1R7_EDITS, DE1R7_SCOPE, isDE1R7Tree, deriveDE1R7 } from "../support/de1-r7-notice.mjs";
import { isDE1R8Tree, DE1R8_PARENT } from "../support/de1-r8-provenance.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R7Tree(REPO) && "not a DE1 R7 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R7_PINS).filter((f) => !DE1R7_NEW_FILES.includes(f)).sort();
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts", DT = "lib/emailDelivery.d.ts";
const LAYERED = isDE1R8Tree(REPO);
const R7_TREE = LAYERED ? DE1R8_PARENT : "HEAD";          // the R7 commit itself when the R8 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R7_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R7G-01 the R7 change set vs R6 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R7_PARENT, "ee52b1def011913c58cb5cb2115163f20241833a", "R7 is built on the R6 candidate (under independent review)");
  assert.equal(gitIn(REPO, ["rev-parse", R7_TREE + "^"]).stdout.trim(), DE1R7_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R7_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R7_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R7_PARENT, R7_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R7_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R7_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R7_PINS).sort(), label + ": protected changes vs R6 = the recorded R7 set");
  // the R7 commit's own pins: on an R8 tree the effective table without the R8 overlay
  const eff = LAYERED ? { ...m1EffectivePins(REPO), ...de1R7Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R7_PINS)) assert.equal(eff[f], pin, f + ": the R7 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R7_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R7 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R7G-02 provenance: each R7 pin is the R6 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R7_NEW_FILES, [], "R7 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R7_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R7_PARENT}:${f}`), de1R6Pins()[f], f + ": the parent bytes are the R6 pin");
    const d = deriveDE1R7(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R7_PINS[f], f + " = R6 + recorded R7 edits");
  }
});

test("DE1R7G-03 scope: the manual route attribution / notice action and one added store-state read; everything else is byte-identical to R6", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R7_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R7_PARENT, R7_TREE, "--"]));
  const outside = all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && !DE1R7_SCOPE.includes(f));
  assert.deepEqual(outside, [], "no runtime / config / tool / emulator / Rules change outside the delivery files");
  for (const f of ["lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/securityContext.d.ts", "lib/verifyToken.js", "lib/businessRegistry.js", "lib/bizAccess.js",
    "test/support/canary-fixtures.mjs", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json", "index.html"])
    assert.equal(blobId(R7_TREE + ":" + f), blobId(`${DE1R7_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R7_PARENT, R7_TREE, "--", "src", "fincore", "tools", "index.html", "lib/securityContext.js", "lib/businessRegistry.js", "lib/sendEmail.js"])), [], "no src / fincore / tools / page / predicate / SMTP change");
  assert.equal(blobId(R7_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  // the route: the authorization section is byte-identical to the approved P0 route; the scheduled (GET) path is byte-identical to R6
  const run = readAt(RT), run6 = bytesOf(`${DE1R7_PARENT}:${RT}`).toString("utf8");
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  assert.equal(section(run), section(bytesOf(`${P0}:${RT}`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate unchanged");
  const getPath = (src) => { const a = src.indexOf('    if (req.method === "GET") {\n      const snapshots'), b = src.indexOf('    // POST = manual trigger for single business'); assert.ok(a > 0 && b > a, "GET path located"); return src.slice(a, b); };
  assert.equal(getPath(run), getPath(run6), "the scheduled path is the R6 bytes");
  const sendTail = (src) => { const a = src.indexOf("      if (target.state !== \"deliverable\") return refuse(target.code);"); assert.ok(a > 0, "manual send tail located"); return src.slice(a).replace("// the error is untrusted (D4): only its class is logged; the refusal is the code the builder attributed, else a build failure", "// the error is untrusted (D4): only its class is read; a registry SyntaxError is a malformed registry, the rest a build failure"); };
  assert.equal(sendTail(run), sendTail(run6), "after the notice branch the manual send is the R6 bytes (one comment line reworded)");
  for (const lit of ["await buildSnapshotForAll()", "await buildSnapshotForBiz(tenantId, bizId)", "sendSnapshotEmail(recipient.email, snapshot)", "sendSnapshotEmail(ownerEmail, snapshot)"]) assert.ok(run.includes(lit), lit);
  // the receipt module: R6 bytes plus ONE appended function after readDeliveryNotice; nothing before or after it changes
  const ed = readAt(ED), ed6 = bytesOf(`${DE1R7_PARENT}:${ED}`).toString("utf8");
  const marker = "/** Pseudonymous recipient reference (never the address itself). */";
  const [head7, tail7] = [ed.slice(0, ed.indexOf(marker)), ed.slice(ed.indexOf(marker))];
  const [head6, tail6] = [ed6.slice(0, ed6.indexOf(marker)), ed6.slice(ed6.indexOf(marker))];
  assert.equal(tail7, tail6, "from recipientHash on (the R6 classifier, the claim protocol, the finalization) the receipt module is the R6 bytes");
  const added = head7.slice(head6.length - 1);
  assert.ok(head7.startsWith(head6.slice(0, -1)) && added.includes("export async function readDeliveryNoticeState"), "R7 only appends readDeliveryNoticeState to the notice section");
  assert.ok(!added.includes("export function") && added.split("export async function").length === 2, "exactly one function added");
  // the declarations: R6 plus the added type and function
  const dt = readAt(DT), dt6 = bytesOf(`${DE1R7_PARENT}:${DT}`).toString("utf8");
  assert.equal(dt.replace(/\/\*\* R7: the notice store state[^\n]*\n[^\n]*DeliveryNoticeState = [^\n]*\n[^\n]*readDeliveryNoticeState[^\n]*\n/, ""), dt6, "the declarations are R6 + the R7 lines");
});

test("DE1R7G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R6 modules are not the R7 ones", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R7_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R7(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R7(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R7_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R7(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R7_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R7_PINS[f], de1R6Pins()[f], f + ": the R7 pin differs from the R6 pin");
  }
  const eff = LAYERED ? de1R7Pins() : de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R7_PINS[f]);
  for (const f of Object.keys(de1R6Pins()).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], de1R6Pins()[f], f + " keeps its R6 pin");
});

test("DE1R7G-05 the decision rules in the source", { skip: SKIP }, () => {
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  const r = code(readAt(RT)), e = code(readAt(ED));
  // OD-01: no classification by exception class; the builder-attributed bounded set is the only mapping, by exact equality
  assert.ok(!r.includes('errorClass(error) === "SyntaxError"') && !/SyntaxError[^\n]*registry_unreadable|registry_unreadable[^\n]*SyntaxError/.test(r), "the class inference is gone");
  assert.ok(r.includes('const BUILDER_ATTRIBUTED_CODES: ReadonlySet<string> = new Set<DeliveryTargetCode>(["invalid_business_identity", "business_not_registered",\n  "ambiguous_business_identity", "registry_unreadable", "business_name_unavailable", "registry_unavailable"]);'), "the bounded set the builder may attribute (contract §3); snapshot_build_failed is never attributed, it is the default");
  const br = r.slice(r.indexOf("function builderRefusal"), r.indexOf("\n}\n", r.indexOf("function builderRefusal")));
  assert.ok(br.includes("try { message = (error as { message?: unknown } | null)?.message; } catch { message = undefined; }"), "the message is read defensively (untrusted value)");
  assert.ok(br.includes('return typeof message === "string" && BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : "snapshot_build_failed";'), "exact equality against the bounded set, else a build failure");
  assert.ok(!br.includes("errorClass(") && !br.includes(".name") && !br.includes("instanceof"), "no class, name or instanceof in the attribution");
  assert.ok(!/console\.(warn|error)\([^)]*(message|error\.message)/.test(r), "no error message is logged");
  assert.ok(r.includes("console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);") && r.includes("return refuse(builderRefusal(error));"), "the class is logged; the attributed refusal is returned");
  // OD-02: no manufactured notice; the store state is read, never thrown; the three states are distinct fields; 503 on any failed step
  assert.ok(!r.includes("MISSING_NAME_NOTICE_HE") && !r.includes("firstSeenAt: 0") && !r.includes("runs: 0"), "the route never synthesizes a notice");
  assert.ok(!r.includes("readDeliveryNotice(") && r.includes("await readDeliveryNoticeState(db, tenantId, bizId)"), "the store state is read through the never-throwing read");
  assert.ok(r.includes('type NoticeState = "active" | "stale" | "none" | "unavailable";') && r.includes('type ClearState = "cleared" | "failed" | "not_needed" | "not_attempted" | "not_applicable";'));
  assert.ok(r.includes("tenantId, bizId, deliverable, code: target.code, notice, noticeState, clearState });"), "the reply carries the business state, the stored record, the store state and the clear state as distinct fields");
  assert.ok(r.includes('return res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "unavailable", ...(error === null ? {} : { error }),'), "200 only when every step succeeded; 503 unavailable otherwise");
  const nb = r.slice(r.indexOf('if (action === "notice") {'), r.indexOf('if (target.state !== "deliverable") return refuse(target.code);'));
  assert.ok(nb.includes('if (target.state === "unavailable") return reply(false, NOTICE_UNAVAILABLE.registry, "unavailable", "not_attempted", null);'), "an unreadable registry: unknown, the store not consulted");
  assert.ok(nb.indexOf('target.state === "unavailable"') < nb.indexOf("readDeliveryNoticeState("), "the registry state is decided before the store is read");
  assert.ok(nb.includes('if (stored.state === "unavailable") return reply(false, NOTICE_UNAVAILABLE.read, "unavailable", "not_attempted", null);'), "a failed read is reported as unavailable, with nothing manufactured");
  assert.ok(nb.includes('if (stored.state === "absent") return reply(true, null, "none", "not_needed", null);'), "nothing stored, name present: nothing to clear, nothing written");
  assert.ok(nb.includes('const cleared = await clearDeliveryNotice(db, tenantId, bizId);') && nb.includes('return cleared ? reply(true, null, "none", "cleared", null) : reply(false, NOTICE_UNAVAILABLE.clear, "stale", "failed", record);'), "cleared only after an acknowledged removal; a failed removal is 503 with the record still reported as stored");
  assert.ok(nb.indexOf("readDeliveryNoticeState(") < nb.indexOf("clearDeliveryNotice("), "read before clear: no removal on an unknown store state");
  assert.ok(nb.includes('if (target.state === "name_unavailable") return reply(true, null, stored.state === "present" ? "active" : "none", "not_applicable", record);'), "the cause persists: active / none, never cleared");
  // the receipt module: the store state read never throws and never manufactures
  const fn = e.slice(e.indexOf("export async function readDeliveryNoticeState"), e.indexOf("export function recipientHash"));
  assert.ok(fn.includes('try { v = (await db.ref(path).once("value")).val(); } catch { return { state: "unavailable" }; }'), "a read failure is a state, not a throw and not an absence");
  assert.ok(fn.includes('if (v === null || v === undefined) return { state: "absent" };') && fn.includes('return { state: "present", record: isRecord(v) && v.code === "business_name_unavailable" ? v : null };'));
  assert.ok(!fn.includes("MISSING_NAME_NOTICE_HE") && !fn.includes("runs:"), "nothing is manufactured");
});
