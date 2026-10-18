// DP1 guard (LOCAL successor of accepted OT4 f34eec92; pending independent Codex review; T-DP1-GUARD). Nothing here is an
// approval: it proves what the candidate IS. Behaviour: test/delivery/dp1-manual-delivery-policy.test.mjs (DP1-01..09) and the
// author emulator gate test/emulator/dp1-manual-policy-emulator.mjs (DPE-01..05).
//   DP1G-01  OT4 is the sole parent; the committed delta is exactly the fixed scope + its record; every scoped file is pinned in
//            HEAD, index, checkout and the effective overlay; without this layer the overlay describes OT4; clean tree
//   DP1G-02  every edited file re-derives from the literal OT4 blob by the recorded edits; the new files are new; the OT4 guard
//            is layered on the literal OT4 object
//   DP1G-03  nothing outside the scope moves; in the runtime only deliverManualDaily (and the new pure decision) change — the
//            receipt state machine, the scheduled send, deliverWithoutReceipt, the gates, the hold writer and the outcome
//            classification are OT4 bytes; the route's authorization and scheduled sections are OT4 bytes and its manual section
//            gains only the refusal mapping; P7: no code path writes an unknown / sending / handing_off record except the
//            existing finalization of its own hand-off, and no reconciliation / settlement / clearing entry point exists
//   DP1G-04  regression control: the literal OT4 runtime hands a manual repeat and a held day to the provider; DP1 refuses both
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "079fe656779eb6f922d2e3bfe3a567a6a73545ef", "test/finance/dp1-daily-policy-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DP1_PARENT, DP1_SCOPE, DP1_EDITED, DP1_PINS, isDP1Tree, deriveDP1 } from "../support/dp1-daily-policy.mjs";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { releasedHoldRecord } from "../support/daily-email-harness.mjs";

const SKIP = !isDP1Tree(REPO) && "not a DP1 successor";
// DP2 (T-DP2-LAYERING): on a successor of DP1 this guard judges the literal, immutable DP1 object; HEAD / index / checkout /
// overlay move to the successor's own guard (the OT4-on-DP1 pattern one layer up).
const DP1 = "b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6";
const LAYERED = gitIn(REPO, ["merge-base", "--is-ancestor", DP1, "HEAD"]).status === 0 && gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim() !== DP1;
const SOURCE = LAYERED ? DP1 : "HEAD";
const src = (f) => LAYERED ? gitIn(REPO, ["cat-file", "blob", `${SOURCE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8");
const OT3 = "770c065946ebbce77ade4a80950698f9572526ff", S3 = "7fa1b6e130dd0cdd24e02657d69a073e93a3f767";
const RECORD = "test/support/dp1-daily-policy.json";
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts";
const git = (args) => { const r = gitIn(REPO, args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const names = (args) => { const r = gitIn(REPO, [args[0], "-z", ...args.slice(1)]); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\0").filter(Boolean); };
const parentBlob = (f) => { const r = gitIn(REPO, ["cat-file", "blob", `${DP1_PARENT}:${f}`]); assert.equal(r.status, 0, f); return r.stdout; };
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, "anchor: " + a.slice(0, 60)); const j = b === null ? s.length : s.indexOf(b, i + a.length); assert.ok(j >= 0, "end: " + String(b).slice(0, 60)); return s.slice(i, j); };
const fn = (s, name) => between(s, `function ${name}(`, "\n}\n");
const code = (s) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));

test("DP1G-01 OT4 sole parent, fixed scope, HEAD / index / checkout / overlay pins, clean tree", { skip: SKIP }, () => {
  assert.deepEqual(git(["rev-list", "--parents", "-n1", SOURCE]).split(" ").slice(1), [DP1_PARENT]);
  assert.equal(git(["rev-parse", `${DP1_PARENT}^`]), OT3, "OT4 is the sole child of OT3");
  git(["merge-base", "--is-ancestor", S3, DP1_PARENT]);   // accepted S3 is an ancestor (status 0)
  assert.deepEqual(names(["diff", "--name-only", DP1_PARENT, SOURCE, "--"]).sort(), [...DP1_SCOPE, RECORD].sort());
  assert.deepEqual(Object.keys(DP1_PINS).sort(), [...DP1_SCOPE].sort());
  if (!LAYERED) for (const args of [["diff", "--cached", "--name-only", "HEAD", "--"], ["diff", "--name-only", "HEAD", "--"],
    ["ls-files", "--others", "--", ":(exclude)node_modules", ":(exclude)test/historical/.deps"]]) assert.deepEqual(names(args), [], args.join(" "));
  const without = m1EffectivePins(REPO, { withDP1: false });
  for (const f of DP1_SCOPE) {
    assert.match(DP1_PINS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), DP1_PINS[f], f + " HEAD");
    if (LAYERED) assert.equal(m1EffectivePins(REPO, { withDP2: false })[f], DP1_PINS[f], f + " overlay without the successor layer");
    else {
    assert.equal(git(["rev-parse", `:${f}`]), DP1_PINS[f], f + " index");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), DP1_PINS[f], f + " checkout");
    assert.equal(m1EffectivePins(REPO)[f], DP1_PINS[f], f + " overlay");
    }
    if (without[f] !== undefined) assert.equal(without[f], git(["rev-parse", `${DP1_PARENT}:${f}`]), f + " overlay without this layer = the OT4 bytes");
  }
});

test("DP1G-02 edited files re-derive from literal OT4 by the recorded edits; new files are new; the OT4 guard is layered", { skip: SKIP }, () => {
  for (const f of DP1_EDITED) {
    const r = deriveDP1(REPO, f); assert.ok(r.ok, f + ": " + r.reason);
    assert.equal(gitBlobId(r.bytes), DP1_PINS[f], f + " re-derived");
    assert.equal(deriveDP1(REPO, f, { [f]: [{ from: "\u0000anchor absent from every source file\u0000", to: "" }] }).reason, "edit_anchor_not_unique");
  }
  for (const f of DP1_SCOPE.filter((x) => !DP1_EDITED.includes(x)))
    assert.notEqual(gitIn(REPO, ["cat-file", "-e", `${DP1_PARENT}:${f}`]).status, 0, f + " is new in DP1");
  const g = src("test/finance/hr3-ot4-daily-hold-guard.test.mjs");
  assert.ok(g.includes(`const OT4 = '${DP1_PARENT}';`) && g.includes("const SOURCE = LAYERED ? OT4 : 'HEAD';"));
});

test("DP1G-03 scope, runtime delta and the P7 invariant", { skip: SKIP }, () => {
  for (const f of ["lib/sendEmail.js", "lib/sendEmail.d.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js",
    "lib/securityContext.d.ts", "lib/businessRegistry.js", "lib/bizAccess.js", "lib/helpers.js", "lib/verifyToken.js", "lib/adminSdk.js", "api/admin.js",
    "database.rules.json", "test/emulator/database.rules.json", "test/support/rules-authorized-delta.mjs", "vercel.json", "package.json", "package-lock.json",
    "index.html", "tools/daily-delivery/hold.mjs", "test/support/hr3-ot4-daily-hold.json", "test/support/hr3-ot4-daily-hold.mjs", "fincore/v1/MANIFEST.json"])
    assert.equal(git(["rev-parse", `${SOURCE}:${f}`]), git(["rev-parse", `${DP1_PARENT}:${f}`]), f + " is OT4 bytes");
  assert.deepEqual(names(["diff", "--name-only", DP1_PARENT, SOURCE, "--", "src", "fincore", "scripts", "migrations", "tools"]), []);
  assert.deepEqual(names(["diff", "--name-only", DP1_PARENT, SOURCE, "--", "lib", "api"]).sort(), [RT, "lib/emailDelivery.d.ts", ED].sort());
  // the runtime: everything but the manual send is OT4 bytes
  const ed = src(ED), ot4 = parentBlob(ED);
  for (const name of ["decideClaim", "attemptOutcome", "classifyTransportError", "classifyTransportInfo", "classifyHoldRecord", "decideScheduledGate",
    "readDailyDeliveryGate", "makeDailyDeliveryGate", "readManualDeliveryGate", "changeDeliveryHold", "recordHeldDate", "receiptPath", "manualAttemptPath",
    "transact", "readBounded", "callGate", "deliveryInventoryView", "confirmDeliveryInventory"])
    assert.equal(fn(ed, name), fn(ot4, name), name + " is OT4 bytes");
  for (const [a, b] of [["export async function deliverWithReceipt(", "\nexport async function deliverWithoutReceipt("], ["export async function deliverWithoutReceipt(", "\n}\n"]])
    assert.equal(between(ed, a, b), between(ot4, a, b), a + " is OT4 bytes");
  const prefix = (x) => x.slice(0, x.indexOf("export async function deliverManualDaily("));
  const dp1Block = between(ed, "// ── DP1: the P4 evidence of one delivery identity", "\n/**\n * HR1 — the manual");
  assert.deepEqual(code(prefix(ed).replace(dp1Block, "")), code(prefix(ot4)), "before the manual send only comments and the pure P4 decision are added");
  assert.ok(code(dp1Block).every((l) => !/\b(db|transact|ref|readBounded)\b/.test(l)), "the P4 decision is pure (no database access)");
  // the manual send: the E4 gate default, the P4 read and the collection transaction, all before the hand-off flag
  const manual = between(ed, "export async function deliverManualDaily(", null);
  assert.ok(manual.includes("gate = () => readDailyDeliveryGate(db, businessDate),"), "E4: the default final gate is the scheduled gate of the business date");
  const bt = between(manual, "async beforeTransport() {", "\n    },\n  };");
  const order = (s, ...xs) => { let i = -1; for (const x of xs) { const j = s.indexOf(x, i + 1); assert.ok(j > i, "order: " + x.slice(0, 60)); i = j; } };
  order(bt, 'const g = await callGate(gate, "g3");', "if (!g.open) { ctx.held = g.code;", "const receiptRead = await readBounded(db, rcptPath, HOLD_READ_TIMEOUT_MS);",
    "if (!receiptRead.ok) refuse(\"delivery_history_unavailable\");", "r = await transact(db, `${MANUAL_ATTEMPT_ROOT}/${tenantId}/${bizId}`, (cur) => {",
    "const code = decideManualRepeat({ receipt, records: cur, tenantId, bizId, businessDate, nowMs: clock() });", 'state: "handing_off"',
    'if (r && r.committed && typeof r.result === "string") refuse(r.result);', "ctx.handedToProvider = true;");
  assert.ok(manual.includes('if (ctx.refused !== null && !ctx.handedToProvider) return { outcome: "refused", code: ctx.refused, attemptId, record: "not_written" };'));
  // P7 invariant: the only writes to receipts / manual records are the existing ones; nothing reconciles, settles or clears
  const edCode = code(ed).join("\n");
  assert.equal((edCode.match(/transact\(db, `\$\{MANUAL_ATTEMPT_ROOT\}/g) || []).length, 1, "one collection transaction (create only)");
  assert.equal((edCode.match(/transact\(db, path, \(cur\) => \(cur && cur\.attemptId === attemptId && cur\.state === "handing_off"/g) || []).length, 1, "finalization only of its own handing_off record");
  assert.deepEqual(edCode.match(/\.ref\([^)]*\)\.(set|update|remove|push)\(/g), [".ref(path).remove("], "no direct write but the owner-notice removal");
  assert.equal(between(ed, "export async function clearDeliveryNotice(", "\n}\n"), between(ot4, "export async function clearDeliveryNotice(", "\n}\n"), "the notice removal is OT4 bytes");
  assert.ok(!/export (async )?function \w*(reconcil|settle|clear(?!DeliveryNotice)|resolve(?!DeliveryTarget))/i.test(ed), "no reconciliation / settlement / clearing entry point");
  // the route: authorization and scheduled sections are OT4 bytes; the manual section gains only the refusal mapping
  const rt = src(RT), rt4 = parentBlob(RT);
  const auth = (s) => between(s, "export default async function handler(req: VercelRequest, res: VercelResponse) {", "  try {\n    // GET = cron trigger");
  assert.equal(auth(rt), auth(rt4), "authorization section");
  const get = (s) => between(s, "    if (req.method === \"GET\") {\n      // Agent/Daily integration", "    // POST = manual trigger");
  assert.equal(get(rt), get(rt4), "scheduled section");
  const before = code(rt4), after = code(rt);
  assert.deepEqual(before.filter((l) => !after.includes(l)), [], "no route line is removed");
  const added = after.filter((l) => !before.includes(l));
  assert.deepEqual(added.filter((l) => !/^(held_day|legacy_evidence_unresolved|held_day_unverifiable|manual_repeat_not_permitted|delivery_outcome_unresolved|delivery_in_progress|delivery_history_unreadable|delivery_history_unavailable):\s+\{ status: (409|422|503), error: "[^"]+" \},$/.test(l)), [
    "const MANUAL_POLICY_REFUSALS: Record<string, { status: number; error: string }> = {", "};",
    'const policyCode = boundedCode(r.code) ?? "";',
    'if ((r.outcome === "held" || r.outcome === "refused") && Object.prototype.hasOwnProperty.call(MANUAL_POLICY_REFUSALS, policyCode)) {',
    'console.warn("[daily-snapshot] manual send refused by delivery policy", { tenantId, bizId, code: policyCode });',
    "return res.status(MANUAL_POLICY_REFUSALS[policyCode].status).json({ error: MANUAL_POLICY_REFUSALS[policyCode].error, code: policyCode, tenantId, bizId });",
    'if (r.outcome === "refused") return res.status(503).json({ error: "Manual delivery refused; email not sent", code: boundedCode(r.code), tenantId, bizId });',
  ].filter((l) => !before.includes(l)));
  assert.equal(added.filter((l) => /^\w+:\s+\{ status:/.test(l)).length, 8, "eight bounded refusal codes");
});

test("DP1G-04 regression control: literal OT4 hands a manual repeat and a held day to the provider; DP1 refuses both", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dp1-ot4-"));
  cpSync(join(REPO, "lib"), join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "emailDelivery.js"), parentBlob(ED));
  const OT4 = await import(pathToFileURL(join(dir, "lib", "emailDelivery.js")).href);
  // on a successor the literal DP1 runtime is judged (written beside the copied library)
  if (LAYERED) { mkdirSync(join(dir, "dp1", "lib"), { recursive: true }); cpSync(join(REPO, "lib"), join(dir, "dp1", "lib"), { recursive: true }); writeFileSync(join(dir, "dp1", "lib", "emailDelivery.js"), src(ED)); }
  const DP1 = await import(pathToFileURL(LAYERED ? join(dir, "dp1", "lib", "emailDelivery.js") : join(REPO, ED)).href);
  const T = "tenantA", B = "bizA", D = "2026-09-08", NOW = Date.UTC(2026, 8, 8, 4, 5);
  const world = (seed) => { const db = makeDb(); db.seed("delivery_control/daily_snapshot", releasedHoldRecord()); seed(db); return db; };
  const accepted = (db) => db.seed(`email_delivery/daily_snapshot/${T}/${B}/${D}`, { v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: T, bizId: B,
    businessDate: D, state: "accepted", claimId: "c", attempt: 1, recipientHash: "0".repeat(64), history: [] });
  const heldDay = (db) => db.seed(`delivery_control/daily_snapshot_held_dates/${D}`, { businessDate: D, committedRefusal: { decision: "committed_hold_refusal",
    generation: "00000000-0000-4000-8000-000000000001", intent: "00000000-0000-4000-8000-000000000002", holdVersion: 1 } });
  const run = async (M, seed) => { let handed = 0; const db = world(seed);
    const r = await M.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: D, recipient: "o@example.test", clock: () => NOW,
      send: async () => { const a = M.currentDeliveryAttempt(); await a.beforeTransport(); handed++; a.info = { accepted: ["o@example.test"], rejected: [], response: "250 OK" }; } });
    return [r.outcome, r.code, handed]; };
  assert.deepEqual(await run(OT4, accepted), ["accepted", null, 1], "OT4: a manual repeat of an accepted scheduled Daily reaches the provider");
  assert.deepEqual(await run(OT4, heldDay), ["accepted", null, 1], "OT4: a held day is delivered by a manual send");
  assert.deepEqual(await run(DP1, accepted), ["refused", "manual_repeat_not_permitted", 0]);
  assert.deepEqual(await run(DP1, heldDay), ["held", "held_day", 0]);
  assert.deepEqual(await run(DP1, () => {}), ["accepted", null, 1], "an ordinary first-time manual send is unchanged");
});
