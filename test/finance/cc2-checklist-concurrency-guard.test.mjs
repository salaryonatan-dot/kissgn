// CC2 guard — identity, scope and the test-contract rule of the checklist concurrency successor on CC1 (LOCAL; pending independent
// Codex review and the checklist / security-test owner's acceptance, T-CC2-TEST). Nothing here is an approval: it proves what the
// candidate IS. CC2 closes CC1-R-01 (the committed CCE-05 could not prove that its two writers ran on two distinct Admin instances:
// a forced shared instance still passed). Behaviour is proven by the real-transport gate test/emulator/checklist-cold-cache-emulator.mjs
// (CCE-01..07 + CCE-05N) and the unchanged unit tests test/security/checklist-cold-cache.test.mjs CC-01..08.
//   CC2G-01  identity: sole parent the CC1 candidate 026c2278 (grandparent I7 5bae812c); CC2 changes NO protected file — committed /
//            staged / working tree incl. untracked; every effective pin and the CC1 pin hold HEAD / index / checkout
//   CC2G-02  scope: the files CC2 changes relative to CC1 are exactly the five recorded test files; the CC1 record, its support module, the
//            CC-01..08 unit test, the M1 gate list and every protected file are byte-identical to CC1; the CCE-01..07 ids are retained
//   CC2G-03  the test-contract rule in the harness source: one AsyncLocalStorage request context reached through a non-writable,
//            non-configurable global; the Admin and token seams read ONLY that context and THROW when none is bound (no default, no
//            fallback); no process-global selector survives; the CCE-05 pair is judged by typed clauses (OUTCOME, DISTINCT_INSTANCES,
//            COLD_INSTANCES, OWN_INSTANCE) from a per-request trace; CCE-05 binds two FRESH instances under ≥ 6 schedules including
//            both asymmetric orders and retries the loser with the current token; CCE-05N expects the three forced violations to be rejected
//   CC2G-04  layering: CC1G verifies the immutable CC1 object on this tree (imports isCC2Tree, reads CC1_TREE), I7G the immutable I7 object
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "838b63659596cd995331bbf8c681e6ad12cf1ec1", "test/finance/cc2-checklist-concurrency-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins, m1EffectivePageVerdict } from "../support/m1-r1-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, isProtectedPath } from "../support/server-reader-authorized-delta.mjs";
import { ADB06_PINS } from "../support/adb06-builder-layer.mjs";
import { I3_PINS } from "../support/i3-integration.mjs";
import { I7_PINS } from "../support/i7-integration.mjs";
import { CC1_PARENT, CC1_PINS, isCC1Tree } from "../support/cc1-checklist-cold-cache.mjs";
import { CC2_PARENT, CC2_GRANDPARENT, CC2_FILES, CC2_HARNESS, CC2_SCOPE, isCC2Tree } from "../support/cc2-checklist-concurrency.mjs";

const SKIP = !isCC2Tree(REPO) && "not a CC2 tree";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const AD = "api/admin.js", PG = "index.html";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const read = (f) => readFileSync(join(REPO, f), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
const between = (src, from, to) => { const i = src.indexOf(from); assert.ok(i >= 0, from); const j = to ? src.indexOf(to, i + from.length) : src.length; assert.ok(j > i, `${from} … ${to}`); return src.slice(i, j); };

test("CC2G-01 identity: sole parent the CC1 candidate; CC2 changes NO protected file (committed / staged / working tree); every effective pin and the CC1 pin hold", { skip: SKIP }, () => {
  assert.equal(CC2_PARENT, "026c2278e511a4007145d77ea019315867b76a23", "built on the CC1 candidate");
  assert.equal(CC2_GRANDPARENT, CC1_PARENT, "CC1's recorded parent is the I7 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), CC2_PARENT, "the CC1 candidate is the SOLE parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  assert.equal(gitIn(REPO, ["rev-parse", CC2_PARENT + "^"]).stdout.trim(), CC2_GRANDPARENT, "the CC1 object's sole parent is I7");
  assert.ok(isCC1Tree(REPO), "a CC2 tree is a CC1 tree (I7 is a strict ancestor)");
  assert.deepEqual([...CC2_SCOPE], [], "CC2 owns no protected file");
  const prot = (f) => PROTECTED.test(f) || isProtectedPath(f);
  const committed = lines(gitIn(REPO, ["diff", "--name-only", CC2_PARENT, "HEAD", "--"])).filter(prot);
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", CC2_PARENT, "--"])).filter(prot);
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", CC2_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter(prot);
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree (incl. untracked)", working]])
    assert.deepEqual([...new Set(set)].sort(), [], label + ": protected changes vs CC1 = none");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS, ...ADB06_PINS, ...CC1_PINS };
  assert.equal(eff["lib/repositories/bizDataRepo.js"], "42cdb95c25154783615616285e486be15670ffc3", "the CC1 runtime pin (independently accepted at its scope, 2026-10-14)");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(blobId("HEAD:" + AD), I7_PINS[AD], "api/admin.js is the I7 pin");
  assert.equal(blobId("HEAD:" + PG), I3_PINS[PG], "the page is the I3 page");
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, PG))), { ok: true }, "the page is the recorded M1 derivation ⊕ I1 ⊕ I2 ⊕ I3");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
});

test("CC2G-02 scope: exactly the five recorded test files change; the CC1 record / support, the CC-01..08 unit test, the M1 gate list and every protected file are byte-identical to CC1; CCE-01..07 retained", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", CC2_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.sort(), [...CC2_FILES].sort(), "the changed set is exactly the recorded CC2 files");
  assert.deepEqual(all.filter((f) => !/^test\//.test(f)), [], "only tests change");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", "--diff-filter=D", CC2_PARENT, "HEAD", "--"])), [], "nothing deleted");
  for (const f of ["test/support/cc1-checklist-cold-cache.json", "test/support/cc1-checklist-cold-cache.mjs", "test/security/checklist-cold-cache.test.mjs", "test/support/m1-run-gates.sh",
    "test/support/p1-r7-emu-run.sh", "test/finance/b2-guard-mutations.test.mjs", "test/finance/i7-integration-guard.test.mjs", "test/support/i7-integration.json", "test/support/i7-integration.mjs",
    "lib/repositories/bizDataRepo.js", "lib/checklistVersion.js", "lib/adminSdk.js", "lib/verifyToken.js", "api/admin.js", "index.html", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json"])
    assert.equal(blobId("HEAD:" + f), blobId(`${CC2_PARENT}:${f}`), f + " unchanged");
  assert.equal(blobId("HEAD:test/support/cc1-checklist-cold-cache.json"), "f6b379a7d52f37b6bd1b982538d7d7198e7cf779", "the CC1 record blob (the reviewed one)");
  // the whole protected tree is CC1's
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", CC2_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f) || isProtectedPath(f)), []);
  const h = read(CC2_HARNESS);
  for (const id of ["CCE-01", "CCE-02", "CCE-03", "CCE-04", "CCE-05", "CCE-05N", "CCE-06", "CCE-07"]) assert.equal((h.match(new RegExp(`await run\\("${id}"`, "g")) || []).length, 1, id + " is run exactly once");
  const unit = read("test/security/checklist-cold-cache.test.mjs");
  for (let i = 1; i <= 8; i++) assert.ok(unit.includes(`test("CC-0${i} `), `CC-0${i} retained`);
  const cq = codeOnly(read("test/security/checklist-concurrency.test.mjs")), cqParent = codeOnly(gitIn(REPO, ["cat-file", "blob", `${CC2_PARENT}:test/security/checklist-concurrency.test.mjs`]).stdout);
  assert.equal(cq.replace(/\s+/g, " "), cqParent.replace(/\s+/g, " "), "checklist-concurrency.test.mjs: code identical to CC1 — comments only");
});

test("CC2G-03 the test-contract rule in the harness source: an immutable async-local request context, seams that throw when unbound, no process-global selector, typed pair clauses from a per-request trace, fresh distinct instances under varied schedules, the loser's retry, and the three rejected violations", { skip: SKIP }, () => {
  const src = read(CC2_HARNESS), g = codeOnly(src);
  assert.ok(g.includes('import { AsyncLocalStorage } from "node:async_hooks";'), "AsyncLocalStorage");
  assert.ok(g.includes("const REQUEST = new AsyncLocalStorage();"), "one request context");
  assert.ok(g.includes('Object.defineProperty(globalThis, "__CC2_REQUEST", { value: REQUEST, writable: false, configurable: false, enumerable: false });'), "reached through a non-writable, non-configurable global");
  assert.equal((g.match(/new AsyncLocalStorage\(\)/g) || []).length, 2, "exactly one context is created (the second occurrence is the CCE-05N rebinding attempt)");
  assert.ok(!/globalThis\.__DB|globalThis\.__CLAIMS|useInstance\(/.test(g), "no process-global database / claims selector");
  assert.ok(!/globalThis\.__CC2_REQUEST\s*=[^=]/.test(g.replace(/try \{ globalThis\.__CC2_REQUEST = new AsyncLocalStorage\(\);[^}]*\}/, "")), "the global is never assigned outside the CCE-05N rebinding attempt");
  // the seams: read ONLY the bound context; throw when none; no default, no fallback
  const adminSeam = between(src, 'writeFileSync(join(dir, "lib", "adminSdk.js"), [', '].join("\\n"));');
  assert.ok(adminSeam.includes('const s = globalThis.__CC2_REQUEST.getStore(); if (!s || !s.instance) throw new Error("CC2_UNBOUND_REQUEST'), "getAdminDb throws when unbound");
  assert.ok(!/\|\||\?\?|default|fallback/i.test(adminSeam.replace("if (!s || !s.instance) throw", "").replace(/outside a bound request context/g, "")), "the Admin seam has no default or fallback instance (the only disjunction is the unbound check)");
  assert.ok(adminSeam.includes("inst.trace.push({ request: s.id, app: inst.app, path:"), "every ref() is traced with the request id and the app name");
  const tokenSeam = between(src, 'writeFileSync(join(dir, "lib", "verifyToken.js"), [', '].join("\\n"));');
  assert.ok(tokenSeam.includes('if (!s) throw new Error("CC2_UNBOUND_REQUEST') && tokenSeam.includes("if (!s.claims) throw new Error(\"no auth\"); return s.claims;"), "requireAuth reads only the bound claims and throws when unbound");
  // binding: a frozen store per request; the instance factory is fresh
  assert.ok(g.includes("const bound = (inst, claims, fn) => REQUEST.run(Object.freeze({ id: `r${reqSeq++}`, instance: inst, claims }), fn);"), "a frozen context per request");
  assert.ok(g.includes("function coldInstance() { const a = newApp(); apps.push(a); return { app: a.name, db: a.database(), trace: [], listeners: 0 }; }"), "a cold instance is a FRESH app with an empty trace and no listener");
  assert.ok(g.includes("inst.listeners += 1;"), "warming is counted");
  // the pair contract: typed clauses
  const contract = between(g, "function assertPairContract(o) {", "const ROUNDS =");
  for (const clause of ["OUTCOME:", "DISTINCT_INSTANCES:", "COLD_INSTANCES:", "OWN_INSTANCE:"]) assert.ok(contract.includes("`" + clause), clause + " clause");
  assert.ok(contract.includes('eq(loser.body, { ok: false, error: "checklist_conflict" }'), "the loser's answer is 409 checklist_conflict");
  assert.ok(contract.includes("eq(o.stored, env(winnerDoc)"), "the winner's document is stored");
  assert.ok(contract.includes("if (o.appA === o.appB) throw"), "distinct instances");
  assert.ok(contract.includes("if (o.listenersA !== 0 || o.listenersB !== 0) throw"), "cold instances");
  assert.ok(contract.includes("JSON.stringify(o.usedA) !== JSON.stringify([o.appA])") && contract.includes("JSON.stringify(o.usedB) !== JSON.stringify([o.appB])") && contract.includes("if (o.crossA.length || o.crossB.length) throw"), "each writer's document access ran on its own instance and on no other (from the trace)");
  const pair = between(g, "async function concurrentPair(", "function assertPairContract");
  assert.ok(pair.includes("usedA: appsUsedFor(instA, path, new Set([a.request]))") && pair.includes("crossA: appsUsedFor(instA, path, new Set([b.request]))"), "the evidence comes from the per-request trace");
  assert.ok(pair.includes("await sleep(delay);") && pair.includes("await Promise.all([go(instA, DOC1, delayA), go(instB, DOC2, delayB)]);"), "both writers in flight at once, each after its own delay inside its bound context");
  // schedules: ≥ 6, both asymmetric orders
  const rounds = JSON.parse(between(g, "const ROUNDS = ", ";").slice("const ROUNDS = ".length).trim());
  assert.ok(rounds.length >= 6 && rounds.some(([a, b]) => a < b) && rounds.some(([a, b]) => a > b) && rounds.some(([a, b]) => a === b), "varied scheduling: ≥ 6 rounds, both orders and simultaneous");
  // CCE-05: fresh distinct instances per round, every family, the contract applied, the loser retried with the current token
  const c05 = between(g, 'await run("CCE-05",', 'await run("CCE-05N",');
  assert.ok(c05.includes("for (const fam of FAMILIES)") && c05.includes("for (const delays of ROUNDS)"), "every family × every schedule");
  assert.ok(c05.includes("const o = await concurrentPair(fam, coldInstance(), coldInstance(), delays);"), "two FRESH instances per pair");
  assert.ok(c05.includes("const { loser, winnerDoc } = assertPairContract(o);"), "the contract is applied to every pair");
  assert.ok(c05.includes("expectedVersionToken: checklistVersionToken(winnerDoc)") && c05.includes("the loser's retry with the current token is served"), "the loser's retry with the current token on another cold instance is served");
  // CCE-05N: the three forced violations are expected to be REJECTED, and the shared-instance codes are shown indistinguishable
  const c05n = between(g, 'await run("CCE-05N",', 'await run("CCE-06",');
  assert.ok(c05n.includes('await expectReject("forced shared instance", "DISTINCT_INSTANCES", await concurrentPair(fam, only, only, [0, 0]));'), "forced shared instance → rejected");
  assert.ok(c05n.includes('"warm instance", "COLD_INSTANCES"'), "warm instance → rejected");
  assert.ok(c05n.includes("seam.getAdminDb()") && c05n.includes("/^CC2_UNBOUND_REQUEST/.test(thrown.message)") && c05n.includes("await call(null, action,"), "unbound request → the seam throws, nothing written");
  assert.ok(c05n.includes("eq([shared.a.code, shared.b.code].sort(), [200, 409]"), "the codes alone are shown indistinguishable (why CC1-R-01 was vacuous)");
  assert.ok(c05n.includes("throw new Error(`${label}: the harness ACCEPTED a pair that violates the contract"), "acceptance of a violating pair fails the control");
  // the gate still runs the real handler over the real transport with only the three seams replaced
  assert.ok(g.includes('cpSync(join(ROOT, "api", "admin.js"), join(dir, "api", "admin.js"));') && g.includes('cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });'), "the real handler and repositories");
  assert.deepEqual((g.match(/writeFileSync\(join\(dir, "lib", "([a-zA-Z]+)\.js"\)/g) || []).map((m) => m.match(/"([a-zA-Z]+)\.js"/)[1]).sort(), ["adminSdk", "sendEmail", "verifyToken"], "exactly the three seams are replaced");
});

test("CC2G-04 layering: CC1G verifies the immutable CC1 object on this tree and I7G the immutable I7 object; the harness is still run through the sequential emulator runner", { skip: SKIP }, () => {
  const cc1g = codeOnly(read("test/finance/cc1-checklist-cold-cache-guard.test.mjs"));
  assert.ok(cc1g.includes('import { isCC2Tree, CC2_PARENT } from "../support/cc2-checklist-concurrency.mjs";'), "CC1G imports the CC2 layer");
  assert.ok(cc1g.includes("const LAYERED = isCC2Tree(REPO);") && cc1g.includes('const CC1_TREE = LAYERED ? CC2_PARENT : "HEAD";'), "CC1G reads the CC1 object when CC2 is checked out");
  assert.ok(!/gitIn\(REPO, \["rev-parse", "HEAD\^"\]\)/.test(cc1g) && !/"HEAD:" \+/.test(cc1g), "CC1G no longer addresses HEAD directly");
  assert.ok(cc1g.includes('if (LAYERED) assert.equal(CC1_TREE, "026c2278e511a4007145d77ea019315867b76a23"'), "the CC1 commit itself is verified when layered");
  const i7g = codeOnly(read("test/finance/i7-integration-guard.test.mjs"));
  assert.ok(i7g.includes("const LAYERED = isCC1Tree(REPO);") && i7g.includes('const I7_TREE = LAYERED ? CC1_PARENT : "HEAD";'), "I7G reads the I7 object (unchanged CC1 layering)");
  assert.equal(blobId("HEAD:test/finance/i7-integration-guard.test.mjs"), blobId(`${CC2_PARENT}:test/finance/i7-integration-guard.test.mjs`), "I7G unchanged");
  const h = read(CC2_HARNESS);
  assert.ok(h.includes("Host run: bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> cc1=test/emulator/checklist-cold-cache-emulator.mjs"), "run through the sequential runner");
  assert.ok(h.includes("Deliberately NOT named *.test.mjs."), "not a node --test file");
  assert.equal(blobId("HEAD:test/support/m1-run-gates.sh"), blobId(`${CC2_PARENT}:test/support/m1-run-gates.sh`), "the M1 24-gate list is unchanged (adding CCE permanently is a separate M1 test transition)");
});
