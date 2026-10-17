// Agent/Daily integration I6 guard — identity, provenance and scope of the registry-binding successor (LOCAL; pending independent
// Codex review). Nothing here is an approval: it proves what the candidate IS, so that the M1 identity, user-access, admin-API, P0,
// P1, audit and consumer owners can confirm it. Behaviour is proven separately (test/finance/i6-registry-binding.test.mjs RB-01..10,
// the emulator gate test/emulator/i6-registry-binding-emulator.mjs, and the earlier contracts still on this tree).
//   I6G-01  sole parent the I5 candidate 59b87a6a; the protected files I6 changes relative to I5 are EXACTLY api/admin.js,
//           lib/securityContext.js (+ .d.ts) and the three consumer routes; every effective pin holds committed / staged / checked
//           out; the page is still the I3 page
//   I6G-02  provenance: each pin is the I5 bytes + exactly the recorded edits; the I5 lines that disappear are exactly the
//           enumerated ones (everything else the record moves reappears byte for byte); non-vacuity
//   I6G-03  the rule in the source: requireBizContext judges the business slot by isRegistryBizId and the tenant slot by isValidId;
//           requireRegisteredBizContext reads the registry through the approved readRegistryTarget; EVERY production caller of the
//           shared gate is either the registered variant or a consumer that applies the same registry rule itself; every grant
//           writer classifies the registry before it writes; update-user / create-user read and validate before the Auth mutation
//   I6G-04  scope: no predicate module, registry reader, helper, core, page, route outside the three, delivery, Builder, Core cost
//           history, backfill script, Rules, schedule or configuration byte moves
//   I6G-05  the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6, each at its literal pin
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7b1d3061c1a42b2d05d7702fbe376f98916e2ce6", "test/finance/i6-integration-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1R5Pins, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import { serverReaderEffectiveBlobs } from "../support/server-reader-authorized-delta.mjs";
import { de1EffectivePins, DE1_SCOPE } from "../support/de1-daily-email.mjs";
import { ADB06_PINS, ADB06_FILES } from "../support/adb06-builder-layer.mjs";
import { I1_ENTRY, I1_PINS, I1_SCOPE } from "../support/i1-integration.mjs";
import { I2_PINS } from "../support/i2-integration.mjs";
import { I3_PINS, I3_SCOPE } from "../support/i3-integration.mjs";
import { I4_PINS, I4_SCOPE } from "../support/i4-integration.mjs";
import { I5_PINS, I5_SCOPE } from "../support/i5-integration.mjs";
import { I6_PARENT, I6_PINS, I6_NEW_FILES, I6_EDITS, I6_SCOPE, isI6Tree, deriveI6 } from "../support/i6-integration.mjs";
// DT-O1 R2 layering (candidate technical transition; historical I6 proof remains scoped to the I6 object): on a tree that
// carries the DT-O1 successor on top of the I6 candidate, I6G-01..05 verify the I6 commit ITSELF (224a00a6) from git objects — sole parent
// I5, protected change set the six I6 files, pins the I6 pins, the I6 source rules — and the HEAD / index / checkout identity of the
// later tree is held by its own guard (DTO1G-01). Nothing is skipped.
import { isDTO1Tree, DT_O1_I6 } from "../support/dt-o1-runtime.mjs";

const SKIP = !isI6Tree(REPO) && "not an I6 tree";
const LAYERED = isDTO1Tree(REPO);
const I6_TREE = LAYERED ? DT_O1_I6 : "HEAD";          // the I6 commit itself when the DT-O1 layer is checked out
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const AD = "api/admin.js", SC = "lib/securityContext.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => (LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I6_TREE}:${f}`]).stdout : readFileSync(join(REPO, f), "utf8"));
const parentText = (f) => gitIn(REPO, ["cat-file", "blob", `${I6_PARENT}:${f}`]).stdout;
// every I5 line that does NOT survive into I6 (multiset, trimmed); all other lines the record touches are moved byte for byte
const REMOVED = {
  [AD]: [
    'import { readRegistryTarget, isRegistryBizId } from "../lib/businessRegistry.js";',   // + classifyRegistryTarget
    "//   A malformed existing blob stops the create rather than guessing.",                  // create-user: the app/users read moved before Auth
    "try { await auth.deleteUser(firebaseUid); } catch (_) {}",                              //   … so its Auth rollback is gone (nothing to roll back)
    "//   validated ABOVE (before Auth creation); clients never write biz_access.",           // comment extended (registry)
    "// Phase 5 — RTDB atomic update",                                                       // update-user: Phase 3b / Phase 5 comments
    "// Best-effort revert auth email and bail",                                             // update-user: the app/users merge now runs
    "if (emailChanged && oldEmail) {",                                                       //   before Phase 4 — its revert is gone
    "try { await auth.updateUser(firebaseUid, { email: oldEmail }); }",
    'catch (revErr) { console.error("[update-user] Auth revert failed:", revErr.message); }',
  ],
  "api/agent/ask.ts": ['import { requireBizContext } from "../../lib/securityContext.js";', "const out = await handleAgentAsk(req, { requireBizContext, routeQuestion, rateLimit, logError });"],
  "api/alerts/run.ts": ['import { requireCron, requireBizContext } from "../../lib/securityContext.js";', "const out = await handleAlerts(req, { requireCron, requireBizContext, repos, logError });"],
  "api/proactive/run.ts": ['import { requireBizContext, requireCron } from "../../lib/securityContext.js";', "requireBizContext,", "ctx = await requireBizContext(req, {"],
  "lib/securityContext.d.ts": [],
  [SC]: ['if (!isValidId(bizId))    throw { status: 400, msg: "invalid bizId" };'],
};
const removedLines = (before, after) => {
  const count = (t) => t.split("\n").map((l) => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const a = count(before), b = count(after), out = [];
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) || 0); i++) out.push(l);
  return out.sort();
};

test("I6G-01 identity: sole parent the I5 candidate; I6 changes exactly the six recorded files; every effective pin holds", { skip: SKIP }, () => {
  assert.equal(I6_PARENT, "59b87a6a9c77af80637ad5fb7f5a2f92560f5ef5", "built on the rejected I5 candidate");
  if (LAYERED) assert.equal(I6_TREE, "224a00a655f0f2af9a0e55abac96db3265355cfb", "the I6 candidate commit itself is verified");
  assert.equal(gitIn(REPO, ["rev-parse", I6_TREE + "^"]).stdout.trim(), I6_PARENT, "the I5 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", I6_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(I6_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  assert.deepEqual(Object.keys(I6_PINS).sort(), [...I6_SCOPE].sort());
  const committed = lines(gitIn(REPO, ["diff", "--name-only", I6_PARENT, I6_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", I6_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", I6_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), [...I6_SCOPE].sort(), label + ": protected changes vs I5 = the I6 scope");
  // the I6 commit's own pin table when layered: the effective tables without the DT-O1 overlay (the successor files are held by DTO1G-01)
  const eff = { ...m1EffectivePins(REPO, { withDTO1: false }), ...serverReaderEffectiveBlobs(REPO, { withDTO1: false }), ...ADB06_PINS };
  for (const f of I6_SCOPE) assert.equal(eff[f], I6_PINS[f], f + " is held to its I6 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(I6_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the I6 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId(I6_TREE + ":" + PG), I3_PINS[PG], "the page is the I3 page");
  const page = LAYERED ? gitIn(REPO, ["cat-file", "blob", `${I6_TREE}:${PG}`], { encoding: "buffer" }).stdout : readFileSync(join(REPO, PG));
  assert.deepEqual(m1EffectivePageVerdict(REPO, page), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
});

test("I6G-02 provenance: the I5 bytes + exactly the recorded edits; the I5 lines that disappear are exactly the enumerated ones; non-vacuity", { skip: SKIP }, () => {
  assert.deepEqual([...I6_NEW_FILES], []);
  const i5Eff = m1EffectivePins(REPO, { withI6: false });
  for (const f of I6_SCOPE) {
    const parentBlob = blobId(`${I6_PARENT}:${f}`);
    if (I5_PINS[f] || i5Eff[f]) assert.equal(parentBlob, I5_PINS[f] ?? i5Eff[f], f + ": the parent bytes are its I5 effective pin");
    const d = deriveI6(REPO, f); assert.ok(d.ok, JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), I6_PINS[f], f + ": I5 bytes + the recorded edits = the pin");
    assert.deepEqual(removedLines(parentText(f), d.bytes.toString("utf8")), [...REMOVED[f]].sort(), f + ": exactly the enumerated I5 lines disappear");
  }
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(I6_EDITS)); fn(e[f]); return e; };
  assert.equal(deriveI6(REPO, SC, tamper(SC, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  assert.equal(deriveI6(REPO, SC, tamper(SC, (l) => { l.length = 0; })).reason, "no_recorded_edits");
  const altered = deriveI6(REPO, AD, tamper(AD, (l) => { l[0].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== I6_PINS[AD]);
});

const walk = (d) => (LAYERED
  ? lines(gitIn(REPO, ["ls-tree", "-r", "--name-only", I6_TREE, "--", d + "/"]))
  : readdirSync(join(REPO, d)).flatMap((f) => { const rel = `${d}/${f}`; return statSync(join(REPO, rel)).isDirectory() ? walk(rel) : [rel]; }));
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("I6G-03 the rule in the source: approved predicates and the approved registry reader only; every gate caller and grant writer classified", { skip: SKIP }, () => {
  const sc = read(SC), ad = read(AD);
  const gate = sc.slice(sc.indexOf("export async function requireBizContext"), sc.indexOf("export async function requireRegisteredBizContext"));
  assert.ok(gate.includes('if (!isValidId(tenantId)) throw { status: 400, msg: "invalid tenantId" };'), "tenant slot: isValidId (\":\" valid)");
  assert.ok(gate.includes('if (!isRegistryBizId(bizId)) throw { status: 400, msg: "invalid bizId" };') && !/isValidId\(bizId\)/.test(gate), "business slot: isRegistryBizId only");
  assert.ok(gate.indexOf("isRegistryBizId(bizId)") < gate.indexOf("requireTenantAccessFn(") && gate.indexOf("requireAuthFn(req)") < gate.indexOf("isValidId(tenantId)"), "authentication first; both ids before tenant access / any reference");
  assert.ok(!/\.trim\(/.test(gate), "nothing is trimmed");
  const reg = sc.slice(sc.indexOf("export async function requireRegisteredBizContext"));
  assert.ok(reg.includes("const ctx = await requireBizContext(req, opts, deps);") && reg.includes("readRegistryTarget(ctx.db, ctx.tenantId, ctx.bizId)") && reg.indexOf("requireBizContext(req") < reg.indexOf("readRegistryTarget("), "registered variant = the full gate, then ONE approved registry read");
  assert.ok(sc.includes('import { isRegistryBizId, readRegistryTarget } from "./businessRegistry.js";'), "the approved shared module");
  // every production caller of the shared gate
  const callers = {};
  for (const f of [...walk("api"), ...walk("lib"), ...walk("src")].filter((x) => /\.(js|ts|mjs)$/.test(x) && !x.endsWith(".d.ts"))) {
    const code = codeOnly(read(f));
    const plain = (code.match(/\brequireBizContext\s*\(/g) || []).length, regd = (code.match(/\brequireRegisteredBizContext\s*\(/g) || []).length;
    const injected = /requireBizContext:\s*requireRegisteredBizContext/.test(code), injectsPlain = /[{,]\s*requireBizContext\s*[,}]/.test(code) && /from\s+["'][./]+lib\/securityContext\.js["']/.test(code);
    if (plain || regd || injected || injectsPlain) callers[f] = { plain, regd, injected, injectsPlain };
  }
  assert.deepEqual(Object.keys(callers).sort(), ["api/agent/ask.ts", "api/alerts/run.ts", "api/cost-history.js", "api/daily-snapshot/run.ts", "api/proactive/run.ts",
    "lib/agentAskCore.js", "lib/alertsCore.js", "lib/finance/costHistoryWriter.js", "lib/proactiveCore.js", "lib/securityContext.js"].sort(), "the complete caller set (CALLER_COVERAGE.md)");
  for (const f of ["api/agent/ask.ts", "api/alerts/run.ts"]) assert.deepEqual([callers[f].injected, callers[f].injectsPlain, callers[f].plain], [true, false, 0], f + ": injects the registered gate only");
  assert.deepEqual([callers["api/proactive/run.ts"].injected, callers["api/proactive/run.ts"].plain, callers["api/proactive/run.ts"].regd], [true, 0, 1], "proactive: registered gate for the read actions AND the manual scan");
  for (const f of ["lib/agentAskCore.js", "lib/alertsCore.js", "lib/proactiveCore.js"]) assert.ok(!/from\s+["'][./]+securityContext\.js["']/.test(read(f)), f + ": the gate is injected (the route decides), the core imports none");
  // the two consumers that keep the plain gate apply the SAME approved registry rule themselves (no duplicate / discordant read)
  assert.ok(read("lib/finance/costHistoryWriter.js").includes("try { await requireBusinessInTenant(db, tenantId, bizId); }"), "Core cost history: requireBusinessInTenant after the gate (unchanged)");
  assert.ok(/classifyRegistryTarget\(raw, bizId\)/.test(read("lib/emailDelivery.js")) && callers["api/daily-snapshot/run.ts"].plain === 1, "Daily manual send: the delivery receipt's registry classification (unchanged)");
  // every grant writer in api/admin.js classifies the registry before it writes
  const handlers = [["create-user", "async function handleCreateUser", "async function handleCompleteProfile"], ["update-user", "async function handleUpdateUser", "async function handleBootstrapSelf"], ["roles", "async function handleRoles", "async function requireBizAccess"]];
  for (const [name, from, to] of handlers) {
    const body = ad.slice(ad.indexOf(from), ad.indexOf(to));
    const writes = [...body.matchAll(/bizAccess(Set|Diff)Updates\(/g)].map((m) => m.index);
    assert.ok(writes.length > 0, name + ": non-vacuous");
    const checks = [...body.matchAll(/await requireRegisteredGrantTargets\(db, tenantId, (createBiz|nextBiz)\)/g)].map((m) => m.index);
    for (const w of writes) assert.ok(checks.some((c) => c < w), name + ": registry classification precedes the grant write at " + w);
  }
  const helper = ad.slice(ad.indexOf("async function requireRegisteredGrantTargets"), ad.indexOf("const APP_BASE_URL"));
  assert.ok(helper.includes("classifyRegistryTarget(raw, bizId)") && helper.includes('if (t.state === "registered") continue;') && (helper.match(/\.get\(\)/g) || []).length === 1, "one registry read; only `registered` passes");
  // ordering: no read or refusal after the Auth mutation
  const uu = ad.slice(ad.indexOf("async function handleUpdateUser"), ad.indexOf("async function handleBootstrapSelf"));
  const authAt = uu.indexOf("await auth.updateUser(firebaseUid, { email: newEmail });");
  for (const s of ["db.ref(`tenants/${tenantId}/biz_access`).once(\"value\")", "await requireRegisteredGrantTargets(db, tenantId, nextBiz);", "const appUsersSnap = await db.ref(`tenants/${tenantId}/app/users`).once(\"value\");", "db.ref(`tenants/${tenantId}/roles/${firebaseUid}`).once(\"value\")", "יש להגדיר הרשאות עסק בעת שינוי לתפקיד מוגבל"])
    assert.ok(uu.indexOf(s) > 0 && uu.lastIndexOf(s) < authAt, "update-user: before the Auth e-mail change — " + s);
  const afterAuth = uu.slice(authAt);
  assert.equal((afterAuth.match(/\.once\(|\.get\(\)/g) || []).length, 0, "update-user: no read after the Auth e-mail change");
  assert.equal((afterAuth.match(/await db\.ref\(\)\.update\(updates\)/g) || []).length, 1, "update-user: one atomic write after Phase 4");
  const cu = ad.slice(ad.indexOf("async function handleCreateUser"), ad.indexOf("async function handleCompleteProfile"));
  const createAt = cu.indexOf("await auth.createUser(");
  for (const s of ["await requireRegisteredGrantTargets(db, tenantId, createBiz);", "const appUsersSnap = await db.ref(`tenants/${tenantId}/app/users`).once(\"value\");", "normalizeAllowedBizIds(allowedBizIds)"])
    assert.ok(cu.indexOf(s) > 0 && cu.indexOf(s) < createAt, "create-user: before the Auth user is created — " + s);
});

test("I6G-04 scope: no predicate module, registry reader, helper, core, page, other route, delivery, Builder, Core, backfill, Rules or configuration byte moves", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", I6_PARENT, I6_TREE, "--"]));
  assert.deepEqual(all.filter((f) => PROTECTED.test(f) && !I6_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => !PROTECTED.test(f) && !/^test\//.test(f) && !["docs/production-readiness/lib/biz-access-model.mjs", "docs/production-readiness/test/biz-access-audit.test.mjs"].includes(f)), [], "outside the scope only tests and the audit model + its test (T-I6-AUDIT-MODEL) change");
  for (const f of ["index.html", "lib/businessRegistry.js", "lib/bizAccess.js", "lib/helpers.js", "lib/businessRegistry.d.ts", "lib/apiScope.js", "lib/emailDelivery.js", "lib/sendEmail.js",
    "api/daily-snapshot/run.ts", "api/cost-history.js", "api/analytics/daily-builder.ts", "lib/alertsCore.js", "lib/agentAskCore.js", "lib/proactiveCore.js", "lib/alertsCore.d.ts", "lib/agentAskCore.d.ts", "lib/proactiveCore.d.ts",
    "lib/finance/costHistoryWriter.js", "lib/repositories/supplierCreditsRepo.js", "lib/repositories/entryExceptionsRepo.js", "lib/repositories/bizDataRepo.js", "lib/ownerGuard.js", "src/snapshot/snapshotBuilder.ts", "src/analytics/dailyBuilder.ts",
    "scripts/backfill-biz-access.mjs", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json", "fincore/v1/MANIFEST.json", "test/support/m1-run-gates.sh"])
    assert.equal(blobId(I6_TREE + ":" + f), blobId(`${I6_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId(I6_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("I6G-05 the later layer on the approved M1 R5 entry base is exactly ADB-06 ∪ DE1 ∪ I1 ∪ I3 ∪ I4 ∪ I5 ∪ I6, each at its literal pin", { skip: SKIP }, () => {
  const changed = lines(gitIn(REPO, ["diff", "--name-only", I1_ENTRY, I6_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const expected = [...new Set([...ADB06_FILES, ...DE1_SCOPE, ...I1_SCOPE, ...I3_SCOPE, ...I4_SCOPE, ...I5_SCOPE, ...I6_SCOPE])].sort();
  assert.deepEqual([...new Set(changed)].sort(), expected, "protected changes on top of the entry base = the recorded layers");
  const pins = { ...ADB06_PINS, ...de1EffectivePins(REPO), ...I1_PINS, ...I2_PINS, ...I3_PINS, ...I4_PINS, ...I5_PINS, ...I6_PINS };
  for (const f of expected) assert.equal(blobId(I6_TREE + ":" + f), pins[f], f + ": the literal layer pin");
  for (const [f, pin] of Object.entries(m1R5Pins())) if (!expected.includes(f)) assert.equal(blobId(I6_TREE + ":" + f), pin, f + " is the approved M1 R5 pin");
});
