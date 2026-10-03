// F1 R1 guard layer (consolidated core/F1 remediation — CANDIDATE, pending independent Codex review).
//   R1G-01 fixed identities: the F1 page base, the R1 page scope contract and the literal R1 pins
//   R1G-02 page mutations (capability, review reason, VD-50 presentation order, write path) fail scope or identity
//   R1G-03 runtime pins: exactly the R1 runtime files differ from the F1 candidate; each equals its R1 blob
//   R1G-04 codec mutants (pending / flagged gate, review-shape binding) are each caught by a targeted check
//   R1G-05 writer mutants (pending-in-commit, unresolved refusal, transition table, digest identity,
//          failure-to-pending) are each caught by a targeted check over the REAL writer
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { reviewEntry, DIGEST } from "../support/f1-history-fixtures.mjs";
import { F1_INDEX_BASE, f1IndexVerdict } from "../support/f1-index-scope.mjs";
import { F1_COMMIT, F1_INDEX_PIN } from "../support/f1-candidate-pin.mjs";
import { VD50_INDEX_PIN } from "../support/vd50-candidate-pin.mjs";
import { R1_INDEX_BASE, r1IndexVerdict } from "../support/r1-index-scope.mjs";
import { R1_COMMIT, R1_INDEX_PIN, R1_RUNTIME } from "../support/r1-candidate-pin.mjs";
import { R2_INDEX_PIN, R2_RUNTIME_BLOBS } from "../support/r2-candidate-pin.mjs";
import { r2IndexVerdict } from "../support/r2-index-scope.mjs";
import { F2_PARENT, F2_INDEX_PIN, F2_RUNTIME_BLOBS } from "../support/f2-candidate-pin.mjs";
import { f2IndexVerdict } from "../support/f2-index-scope.mjs";

const show = (spec) => gitIn(REPO, ["show", spec]).stdout;
const hash = (s) => spawnSync("git", ["hash-object", "--stdin"], { input: s, encoding: "utf8" }).stdout.trim();
const f1Page = show(`${R1_INDEX_BASE}:index.html`);
const page = show(`${R1_COMMIT}:index.html`);
const r2Page = show(`${F2_PARENT}:index.html`);
const f2Page = readFileSync(join(REPO, "index.html"), "utf8");

test("R1G-01 R1 starts at the fixed F1 page; narrow page scope; literal pending identities", () => {
  assert.equal(R1_INDEX_BASE, F1_COMMIT);
  assert.equal(hash(show(`${F1_INDEX_BASE}:index.html`)), VD50_INDEX_PIN.blob, "F1 base is the VD-50 identity");
  assert.deepEqual(f1IndexVerdict(show(`${F1_INDEX_BASE}:index.html`), f1Page), { ok: true }, "the R1 base satisfies F1 scope");
  assert.equal(hash(f1Page), F1_INDEX_PIN.blob, "the R1 base is the F1 identity");
  assert.deepEqual(r1IndexVerdict(f1Page, page), { ok: true });
  assert.equal(hash(page), R1_INDEX_PIN.blob);
  assert.deepEqual(r2IndexVerdict(page, r2Page), { ok: true }, "historical R2 page stays within its narrow scope");
  assert.equal(hash(r2Page), R2_INDEX_PIN.blob, "historical R2 page has a fixed identity");
  assert.deepEqual(f2IndexVerdict(r2Page,f2Page),{ok:true},"F2 page stays within its bounded scope");
  assert.equal(hash(f2Page),F2_INDEX_PIN.blob,"F2 checked-out page has a fixed identity");
  assert.equal(gitIn(REPO, ["rev-parse", ":index.html"]).stdout.trim(), F2_INDEX_PIN.blob, "current F2 staged page has the same identity");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD:index.html"]).stdout.trim(), F2_INDEX_PIN.blob, "current F2 committed page has the same identity");
  assert.match(R1_INDEX_PIN.status, /pending independent Codex review/);
  assert.match(R1_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(gitIn(REPO, ["merge-base", "--is-ancestor", R1_COMMIT, "HEAD"]).status, 0, "R1_COMMIT is in this lineage");
  const pinSource = readFileSync(join(REPO, "test/support/r1-candidate-pin.mjs"), "utf8");
  assert.doesNotMatch(pinSource, /hash-object|readFileSync|rev-parse|spawnSync/);
});

test("R1G-02 page mutations fail the R1 scope contract or the R1 identity pin", () => {
  const otherRow = page.slice(page.indexOf('{pv.showOther && <PnLRow c1="pnl-other"'), page.indexOf("\n", page.indexOf('{pv.showOther && <PnLRow c1="pnl-other"')) + 1);
  const grossAt = page.indexOf('          {/* VD-50 — revenue less food');
  const reordered = page.replace(otherRow, "").slice(0, grossAt) + otherRow + page.replace(otherRow, "").slice(grossAt);
  const cases = [
    ["capability back to /1 (bootstrap)", page.replace('v.costHistory !== "MARJIN_COSTH/2"', 'v.costHistory !== "MARJIN_COSTH/1"')],
    ["capability back to /1 (C1 seam)", page.replace('api.versions.costHistory !== "MARJIN_COSTH/2"', 'api.versions.costHistory !== "MARJIN_COSTH/1"')],
    ["review reason collapsed", page.replace('/^authorization_review_/.test(String(src.costHistory.reason)) ? "cost_history_" + src.costHistory.reason : "cost_history_unreadable"', '"cost_history_unreadable"')],
    ["unreadable history ignored", page.replace('if (src.costHistory && src.costHistory.state === "unreadable") return', 'if (false) return')],
    ["other expenses back above gross", reordered],
    ["gross formula in the page", page.replace("text={pv.gross.text}", "text={pv.rows.net.text}")],
  ];
  for (const [label, changed] of cases) {
    assert.notEqual(changed, page, label + ": mutation applied");
    const v = r1IndexVerdict(f1Page, changed);
    assert.ok(!v.ok || hash(changed) !== R1_INDEX_PIN.blob, label);
    if (label.startsWith("capability")) assert.ok(!v.ok, label + ": refused by the contract itself");
    if (label.startsWith("other expenses")) assert.ok(!v.ok, label + ": refused by the contract itself (" + JSON.stringify(v) + ")");
  }
});

test("R1G-03 runtime pins: exactly the R1 runtime files differ from the F1 candidate, each byte-identical to its R1 blob", () => {
  const rev = (spec) => gitIn(REPO, ["rev-parse", spec]).stdout.trim();
  const changed = gitIn(REPO, ["diff", "--name-only", F1_COMMIT, R1_COMMIT, "--"]).stdout.trim().split("\n")
    .filter((f) => /^(src\/|fincore\/|lib\/|api\/|database\.rules\.json$|index\.html$)/.test(f));
  assert.deepEqual(changed.sort(), [...R1_RUNTIME, "index.html"].sort(), "R1 protected delta over the F1 candidate");
  assert.equal(rev(`${F1_COMMIT}:database.rules.json`), rev(`${R1_COMMIT}:database.rules.json`), "R1 does not change the Rules");
  for (const f of R1_RUNTIME) {
    assert.equal(hash(show(`${R1_COMMIT}:${f}`)), rev(`${R1_COMMIT}:${f}`), f + " historical R1 bytes");
    const currentPin=F2_RUNTIME_BLOBS[f]||R2_RUNTIME_BLOBS[f];
    assert.equal(rev(`${F2_PARENT}:${f}`),R2_RUNTIME_BLOBS[f],f+" historical R2 identity");
    assert.equal(rev("HEAD:" + f), currentPin, f + " committed F2 identity");
    assert.equal(rev(":" + f), currentPin, f + " staged F2 identity");
    assert.equal(hash(readFileSync(join(REPO, f), "utf8")), currentPin, f + " checked-out F2 identity");
  }
});

// ── codec mutants ───────────────────────────────────────────────────────────────────────────────
const CODEC = "fincore/v1/finance/costHistory.js";
const A = "00000000-0000-4000-8000-0000000000a1";
const NOW = Date.parse("2026-10-02T09:00:00Z");
const ver = (id) => ({ versionId: id, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: NOW, recordedBy: "u_mgr", basis: "recorded", predecessorVersionId: "none", globalEmployeesCount: 0, fixedItemsCount: 1, fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } });
const hist = (state, over = {}) => { const v = ver(A); return { head: { revision: 1, headVersionId: A }, versions: { [A]: v }, review: { [A]: reviewEntry(v, state, over) } }; };
const codecOf = async (mutations) => (await loadWriter(REPO, { mutations, entry: CODEC })).costHistoryCodec;
/** The targeted checks every codec must pass (each returns a failure label or null). */
function codecChecks(c) {
  const dec = (v) => c.decodeHistory({ exists: true, value: v });
  const out = [];
  if (dec(hist("pending")).reason !== "authorization_review_pending") out.push("pending_withheld");
  if (dec(hist("flagged", { resolvedAt: NOW + 1, resolution: "revoked_during_commit" })).reason !== "authorization_review_flagged") out.push("flagged_withheld");
  const CLR = { resolvedAt: NOW + 10, resolution: "post_commit_authorized" };
  if (dec(hist("cleared", { ...CLR, actor: "u_other" })).state !== "unreadable") out.push("review_bound_to_actor");
  if (dec(hist("cleared", { ...CLR, committedAt: NOW + 5 })).state !== "unreadable") out.push("review_bound_to_recordedAt");
  const noReview = hist("cleared", { resolvedAt: NOW + 1, resolution: "post_commit_authorized" }); delete noReview.review;
  if (dec(noReview).state !== "unreadable") out.push("review_required");
  if (dec(hist("cleared", { resolvedAt: NOW + 1, resolution: "post_commit_authorized" })).state !== "present") out.push("cleared_authoritative");
  return out;
}
test("R1G-04 codec: the committed codec passes every targeted check; each mutant is caught", async () => {
  assert.deepEqual(codecChecks(await codecOf([])), []);
  for (const [label, from, to, expected] of [
    ["no pending gate", "if (h.unresolved.pending.length)", "if (false)", "pending_withheld"],
    ["no flagged gate", "if (h.unresolved.flagged.length)", "if (false)", "flagged_withheld"],
    ["actor not bound", "e.actor !== v.recordedBy", "false", "review_bound_to_actor"],
    ["committedAt not bound", "e.committedAt !== v.recordedAt", "false", "review_bound_to_recordedAt"],
  ]) {
    let c;
    try { c = await codecOf([[CODEC, from, to]]); } catch (e) { assert.fail(label + ": " + e.message); }
    assert.ok(codecChecks(c).includes(expected), label + " must fail " + expected + " (got " + JSON.stringify(codecChecks(c)) + ")");
  }
});

// ── writer mutants ──────────────────────────────────────────────────────────────────────────────
const WRITER = "lib/finance/costHistoryWriter.js";
const T = "tenantA", B = "bizA", NODE = `tenants/${T}/biz:${B}:cost_history`;
const Bv = "00000000-0000-4000-8000-0000000000b2";
const body = (id = A, expectedHead = null) => ({ versionId: id, expectedHead, effectiveFrom: "2026-10-02", basis: "recorded", globalEmployees: [], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } });
function world() {
  const db = makeDb();
  for (const [u, r] of [["u_mgr", "manager"], ["u_owner", "owner"]]) { db.seed(`tenants/${T}/members/${u}`, true); db.seed(`tenants/${T}/roles/${u}`, r); }
  db.seed(`tenants/${T}/biz_access/${B}/u_mgr`, true);
  globalThis.__DB = db; globalThis.__CLAIMS = { uid: "u_mgr", email: "m@x" };
  return db;
}
function hook(db, match, wrap) { const orig = db.ref; db.ref = (p) => { const r = orig(p); return match(p) ? { ...r, ...wrap(r) } : r; }; return () => { db.ref = orig; }; }
/** Targeted writer checks (each returns failure labels). */
async function writerChecks(W) {
  const out = [];
  // (a) the commit itself carries a PENDING review; post-commit verification unavailable ⇒ still pending
  {
    const db = world(); const w = W.createCostHistoryWriter({ db, clock: () => NOW });
    const seen = []; let committed = false;
    hook(db, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const o = await r.transaction(fn, ...a); committed = committed || o.committed; seen.push(JSON.parse(JSON.stringify(db.read(NODE)))); return o; } }));
    const restore = hook(db, (p) => committed && p === `tenants/${T}/biz_access/${B}/u_mgr`, () => ({ get: async () => { throw new Error("transport"); } }));
    const r = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
    if (!seen[0] || !seen[0].review || seen[0].review[A].state !== "pending") out.push("pending_in_commit");
    const st = db.read(NODE);
    if (r.review !== "pending" || !st || !st.review || st.review[A].state !== "pending") out.push("unavailable_stays_pending");
    restore();
    // (b) a later version is refused while the earlier review is unresolved
    const later = await W.createCostHistoryWriter({ db, clock: () => NOW + 500 }).saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body(Bv, { revision: 1, headVersionId: A }) });
    if (later.status !== "review_unresolved") out.push("unresolved_refuses_later");
  }
  // (c) cleared cannot be acknowledged (transition table) and (d) a different payload digest cannot resolve
  {
    const db = world(); const w = W.createCostHistoryWriter({ db, clock: () => NOW });
    const saved = await w.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
    if (!db.read(NODE)) { out.push("setup_save:" + saved.status); return out; }
    const d = db.read(NODE).review[A].intentDigest;
    globalThis.__CLAIMS = { uid: "u_owner", email: "o@x" };
    if ((await w.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: d, operationId: A })).status !== "review_already_resolved:cleared") out.push("transition_table");
    const db2 = world(); const w2 = W.createCostHistoryWriter({ db: db2, clock: () => NOW });
    let done = false;
    hook(db2, (p) => p === NODE, (r) => ({ transaction: async (fn, ...a) => { const o = await r.transaction(fn, ...a); if (o.committed && !done) { done = true; db2.seed(`tenants/${T}/members/u_mgr`, false); } return o; } }));
    await w2.saveCostVersion({ headers: {} }, { tenantId: T, bizId: B, body: body() });
    globalThis.__CLAIMS = { uid: "u_owner", email: "o@x" };
    if ((await w2.acknowledgeFlaggedVersion({ headers: {} }, { tenantId: T, bizId: B, versionId: A, intentDigest: DIGEST("b"), operationId: A })).status !== "review_identity_mismatch") out.push("digest_identity");
  }
  return out;
}
test("R1G-05 writer: the committed writer passes every targeted check; each mutant is caught", async () => {
  assert.deepEqual(await writerChecks(await loadWriter(REPO)), []);
  for (const [label, from, to, expected] of [
    ["commit writes cleared instead of pending", 'state: "pending", intentDigest: auditIntent.intentDigest', 'state: "cleared", resolvedAt: wire.recordedAt, resolution: "post_commit_authorized", intentDigest: auditIntent.intentDigest', "pending_in_commit"],
    ["unavailable treated as authorized", '} else r.postCommitAccess = "verification_unavailable";', '} else { r.postCommitAccess = "verification_unavailable"; decision = { to: "cleared", resolution: "post_commit_authorized" }; }', "unavailable_stays_pending"],
    ["no unresolved refusal (pre-read + transaction)", 'if (h.state === "present" && (h.unresolved.pending.length || h.unresolved.flagged.length)) { reason = "review_unresolved"; return; }', "", "unresolved_refuses_later"],
    ["transition table bypassed", 'if (!TRANSITIONS[to].includes(e.state)) return { o: "review_already_resolved:" + e.state };', "", "transition_table"],
    ["digest identity bypassed", 'if (e.intentDigest !== intentDigest || digest(intentOf(v)) !== intentDigest) return { o: "review_identity_mismatch" };', "", "digest_identity"],
  ]) {
    const muts = [[WRITER, from, to]];
    // the commit-state mutant must ALSO remove the writer's own defence-in-depth check (else that check refuses it)
    if (label.startsWith("commit writes cleared")) muts.push([WRITER, "chk.unresolved.pending.join() !== wire.versionId || ", ""]);
    if (label.startsWith("no unresolved refusal")) muts.push([WRITER, 'if (initial.state === "present" && (initial.unresolved.pending.length || initial.unresolved.flagged.length)) return { status: "review_unresolved", unresolved: initial.unresolved };', ""]);
    let W;
    try { W = await loadWriter(REPO, { mutations: muts }); } catch (e) { assert.fail(label + ": " + e.message); }
    const got = await writerChecks(W);
    assert.ok(got.includes(expected), label + " must fail " + expected + " (got " + JSON.stringify(got) + ")");
  }
});
