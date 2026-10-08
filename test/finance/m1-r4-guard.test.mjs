// M1 integration R4 — identity, provenance and scope of the successor of the REJECTED R3 candidate (LOCAL; pending independent
// Codex review). Built on M1_R4_PARENT (the R3 candidate acf6880c, itself rejected: M1_INTEGRATION_R3_VERDICT CHANGES_REQUIRED).
//   R4G-01  the protected files R4 changes relative to its parent are EXACTLY the recorded set; committed / staged / checked-out
//           bytes of every effective pin (M1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4, and the S0 reader table) are the pins
//   R4G-02  provenance: each R4 pin is the parent's (R3) bytes + exactly the recorded edits; the parent bytes are the R3 pins
//   R4G-03  scope: the analytics endpoint / nightly builder identity, run-outcome and insights accounting; the page's setup
//           helpers and completeSetup (no page write line is added or removed); in api/admin.js ONLY the bootstrap-self and
//           create-client handlers; no financial line of the builder; the shared registry module, securityContext, Rules,
//           configuration, Core, P1 supplier credits, e-mail and the schedule are byte-identical to R3
//   R4G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the R3 page is refused as the R4 page
//   R4G-05  the corrected rules in the source: no analytics-only identity regex / trimming; the run status follows its
//           failures; the bootstrap claim is ONE transaction over the tenant node; the setup write never replaces a record
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { m1EffectivePins, m1EffectivePageVerdict, m1R3Pins, gitBlobId } from "../support/m1-r1-remediation.mjs";
import { M1_R2_PROTECTED } from "../support/m1-r2-remediation.mjs";
import { M1_R3_PINS } from "../support/m1-r3-remediation.mjs";
import { M1_R4_PARENT, M1_R4_PINS, M1_R4_NEW_FILES, M1_R4_EDITS, M1_R4_SCOPE, isM1R4Tree, deriveR4, applyR4Edits } from "../support/m1-r4-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, SERVER_READER_APPROVED_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { C1_WRITE_TOKENS } from "../support/c1-index-scope.mjs";

const SKIP = !isM1R4Tree(REPO) && "not an M1 R4 tree";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(M1_R4_PINS).filter((f) => !M1_R4_NEW_FILES.includes(f)).sort();
const read = (f) => readFileSync(join(REPO, f), "utf8");

test("R4G-01 the R4 change set vs the rejected R3 parent is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(M1_R4_PARENT, "acf6880cb4654bee53a5ec0e4b284b14221afc72", "R4 is built on the rejected R3 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), M1_R4_PARENT, "the R3 candidate is the SOLE parent");
  assert.equal(gitIn(REPO, ["rev-list", "--parents", "-n", "1", "HEAD"]).stdout.trim().split(" ").length, 2, "one parent");
  for (const [f, pin] of Object.entries(M1_R4_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", M1_R4_PARENT, "HEAD", "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", M1_R4_PARENT, "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", M1_R4_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => M1_R2_PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), Object.keys(M1_R4_PINS).sort(), label + ": protected changes vs the R3 parent = the recorded R4 set");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS };
  for (const f of Object.keys(M1_R4_PINS)) assert.equal(eff[f], M1_R4_PINS[f], f + " is held to its R4 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], "6b70d03c245d163264f1bad2cefa71c0d85ff761", "the approved B1 pin itself is untouched");
});

test("R4G-02 provenance: each R4 pin is the R3 parent's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...M1_R4_SCOPE].sort());
  assert.deepEqual([...M1_R4_NEW_FILES], [], "R4 adds no protected file");
  assert.deepEqual(Object.keys(M1_R4_EDITS).sort(), MODIFIED, "edits are recorded for exactly the modified files");
  const r3 = m1R3Pins();
  for (const f of MODIFIED) {
    assert.equal(blobId(`${M1_R4_PARENT}:${f}`), r3[f], f + ": the parent bytes are the R3 commit's pin");
    const d = deriveR4(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), M1_R4_PINS[f], f + " = parent + recorded R4 edits");
  }
});

test("R4G-03 scope: analytics identity / run outcome, the page's setup corrections and the two admin handlers only", { skip: SKIP }, () => {
  const all = lines(gitIn(REPO, ["diff", "--name-only", M1_R4_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => M1_R2_PROTECTED.test(f) && !M1_R4_SCOPE.includes(f)), [], "no other protected file");
  assert.deepEqual(all.filter((f) => /^(database\.rules\.json|vercel\.json|package(-lock)?\.json|fincore\/|lib\/|tools\/|test\/emulator\/database\.rules\.json$)/.test(f)), [], "no Rules / config / shared module / Core / e-mail / tool change");
  for (const f of ["lib/businessRegistry.js", "lib/securityContext.js", "lib/emailDelivery.js", "lib/sendEmail.js", "api/daily-snapshot/run.ts", "api/cost-history.js", "vercel.json", "database.rules.json", "src/snapshot/snapshotBuilder.ts", "src/alerts/runner.ts"])
    assert.equal(blobId("HEAD:" + f), blobId(`${M1_R4_PARENT}:${f}`), f + " is the R3 bytes");
  // the page: no write line is added or removed (the corrections are decisions around the existing CAS)
  const writes = (s) => s.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t)));
  const before = writes(bytesOf(`${M1_R4_PARENT}:index.html`).toString("utf8")), after = writes(read("index.html"));
  const minus = (a, b) => { const r = [...a]; for (const x of b) { const i = r.indexOf(x); if (i >= 0) r.splice(i, 1); } return r; };
  assert.deepEqual([minus(before, after), minus(after, before)], [[], []], "no page write line is added or removed");
  const page = read("index.html");
  const region = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b, i); assert.ok(i > 0 && j > i, "region " + a.slice(0, 40)); return [i, j]; };
  const REGIONS = [
    region("    function registrySetupWrite(current, expected, record) {", "    function pickBusiness(selectable, preferred) {"),
    region("    window.MarjinC1 = Object.freeze({", "  })();"),
    region("  const completeSetup = async (cfg, sups, fixed, firstOwner) => {", "  const saveAppUsers = async (users) => {"),
  ];
  for (const e of M1_R4_EDITS["index.html"]) {
    const at = page.indexOf(e.to);
    assert.ok(at > 0 && REGIONS.some(([i, j]) => at >= i && at + e.to.length <= j), "page edit inside the setup regions: " + e.to.slice(0, 80));
  }
  // api/admin.js: only the bootstrap-self and create-client handlers
  const admin = read("api/admin.js");
  const fn = (name, next) => { const i = admin.indexOf(`async function ${name}(req, res) {`), j = admin.indexOf(next, i); assert.ok(i > 0 && j > i, name); return [i, j]; };
  const AREG = [fn("handleCreateClient", "// POST ?action=edit-client"), fn("handleBootstrapSelf", "// Shared durable owner-operation runner")];
  const comment = admin.indexOf("// POST ?action=bootstrap-self — self-service first-owner bootstrap (Admin SDK).");
  for (const e of M1_R4_EDITS["api/admin.js"]) {
    const at = admin.indexOf(e.to);
    assert.ok(at > 0 && (AREG.some(([i, j]) => at >= i && at + e.to.length <= j) || (at >= comment && at < AREG[1][0])), "admin edit inside bootstrap-self / create-client: " + e.to.slice(0, 80));
  }
  // the builder: no financial line changes
  const removed = (f) => gitIn(REPO, ["diff", "-U0", M1_R4_PARENT, "HEAD", "--", f]).stdout.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
  assert.deepEqual(removed("src/analytics/dailyBuilder.ts").filter((l) => /canonical|toAnalyticsFinancials|loadCanonicalInputs|fin\b|payroll|purchases|revenue|labor|vat|forecast/i.test(l)), [], "no financial line of the builder is removed or rewritten");
  assert.deepEqual(removed("api/analytics/daily-builder.ts").filter((l) => !l.startsWith("import ") && /requireCron|requireAuth|requireTenantAccess|hasBusinessAccess|isRateLimited|validInsightsReadback|normalizedPreview/.test(l)), [], "no authorization / rate-limit / diagnostic line of the endpoint is removed");
});

test("R4G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the R3 page is not the R4 page", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(M1_R4_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveR4(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f + ": changed anchor");
    const dropped = deriveR4(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== M1_R4_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveR4(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== M1_R4_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(M1_R4_PINS[f], m1R3Pins()[f], f + ": the R4 pin differs from the rejected R3 bytes");
  }
  assert.equal(applyR4Edits("index.html", "no anchors here").reason, "edit_anchor_not_unique");
  assert.equal(m1EffectivePageVerdict(REPO, bytesOf(`${M1_R4_PARENT}:index.html`)).reason, "not_the_recorded_derivation", "the rejected R3 page is refused on the R4 tree");
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true }, "positive control");
  assert.equal(M1_R3_PINS["index.html"], blobId(`${M1_R4_PARENT}:index.html`), "the parent page is the R3 pin");
});

test("R4G-05 the corrected rules in the source", { skip: SKIP }, () => {
  const ep = read("api/analytics/daily-builder.ts"), nb = read("src/analytics/dailyBuilder.ts"), page = read("index.html"), admin = read("api/admin.js");
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  assert.ok(!/isExactId|isSafeId|\[A-Za-z0-9_-\]/.test(code(ep)), "A1: no analytics-only identity regex in the endpoint");
  assert.ok(code(ep).includes("return isValidId(value);") && code(ep).includes("return isRegistryBizId(value);"), "A1: the shared tenant / business predicates");
  assert.ok(!/isExactNightlyBizId|id === id\.trim\(\)|tenantId\.trim\(\)|bizId\.trim\(\)/.test(code(nb)), "A1: no trimming of nightly identities");
  assert.ok(!code(ep).includes('status: "completed",') && code(ep).includes("status: outcome,"), "A2: the GET status is the computed outcome");
  assert.ok(code(ep).includes('res.status(outcome === "completed" && recorded ? 200 : 500)'), "A2: HTTP 200 only for a completed, recorded run");
  assert.ok(code(admin).includes("const r = await db.ref(`tenants/${tenantId}`).transaction((cur) => (cur === null || cur === undefined ? claim : undefined));"), "S2: one transaction over the tenant node");
  assert.ok(!code(admin).includes("updates[`tenants/${tenantId}/roles/${uid}`]   = \"super_owner\";"), "S2: the R3 unconditional role write is gone");
  const csw = page.slice(page.indexOf("    function registrySetupWrite(current, expected, record) {"), page.indexOf("    function registryIdTaken(list, id) {"));
  assert.ok(!csw.includes(".filter("), "S1: the setup write never filters (replaces) a stored record");
  assert.ok(csw.includes('return { ok: false, reason: "registry_id_collision" };'), "S1: a collision is refused");
});
