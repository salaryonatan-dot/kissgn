// DE1 R5 guard — identity, provenance and scope of the delivery owner-decisions candidate (LOCAL; pending independent review).
//   DE1R5G-01  the protected runtime files R5 changes relative to R4 are EXACTLY the recorded set; committed / staged /
//              checked out bytes equal the effective pins (M1 ⊕ DE1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4 ⊕ R5); R5 has exactly one parent, R4
//   DE1R5G-02  provenance: each R5 pin is the R4 bytes (= the R4 pin) + exactly the recorded edits
//   DE1R5G-03  scope: the delivery files only (receipt module, its declarations, the route); the SMTP wrapper, the builder,
//              the presenter, authorization, Rules, schedule, pins and generated assets are byte-identical to R4; the route's
//              authorization section is byte-identical to the approved P0 route; the approved shared predicates are UNCHANGED
//              (lib/securityContext.js isValidId, lib/businessRegistry.js isRegistryBizId are read, never edited)
//   DE1R5G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R4 modules are not the R5 ones
//   DE1R5G-05  the decision rules in the source: receiptPath applies the shared predicates per slot plus the control-character
//              rule; `:` is permitted for the tenant slot only; no trimming; the route refuses before resolving the recipient,
//              the manual refusal table is exactly the decided one, no placeholder name and no `unknown_business_name`
//              no-send remain, and the Hebrew notice text is the decided sentence
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DE1R4_PINS } from "../support/de1-r4-email.mjs";
import { de1EffectivePins, de1R4Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { DE1R5_PARENT, DE1R5_PINS, DE1R5_NEW_FILES, DE1R5_EDITS, DE1R5_SCOPE, isDE1R5Tree, deriveDE1R5 } from "../support/de1-r5-delivery.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R5Tree(REPO) && "not a DE1 R5 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R5_PINS).filter((f) => !DE1R5_NEW_FILES.includes(f)).sort();
const ED = "lib/emailDelivery.js", RT = "api/daily-snapshot/run.ts";

test("DE1R5G-01 the R5 change set vs R4 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R5_PARENT, "cdb74e4d2767307e730e7be3e950bcbe86d5d245", "R5 is built on the R4 candidate (under independent review)");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), DE1R5_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R5_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R5_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R5_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", DE1R5_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R5_PINS).sort(), label + ": protected changes vs R4 = the recorded R5 set");
  const eff = m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R5_PINS)) assert.equal(eff[f], pin, f + ": the R5 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R5G-02 provenance: each R5 pin is the R4 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R5_NEW_FILES, [], "R5 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R5_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R5_PARENT}:${f}`), de1R4Pins()[f], f + ": the parent bytes are the R4 pin");
    const d = deriveDE1R5(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R5_PINS[f], f + " = R4 + recorded R5 edits");
  }
});

test("DE1R5G-03 scope: the delivery files only; the approved predicates, the SMTP wrapper, the builder, Rules and schedule are byte-identical to R4", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R5_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R5_PARENT, "HEAD", "--"]));
  const outside = all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && !DE1R5_SCOPE.includes(f));
  // the only changes outside the delivery / layering tests: the two P0 scheduled-auth sandboxes, which copy the real registry
  // predicate the receipt module now imports and seed the registry in its runtime shape (TEST_CONTRACT_TRANSITION.md)
  assert.deepEqual(outside, ["test/security/cron-auth-hardening.test.mjs", "test/security/scheduled-auth-matrix.test.mjs"], "no runtime / config / tool / emulator / Rules change outside the delivery files");
  for (const f of ["lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/securityContext.d.ts", "lib/verifyToken.js", "lib/businessRegistry.js", "lib/bizAccess.js",
    "test/support/canary-fixtures.mjs", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json", "index.html"])
    assert.equal(blobId("HEAD:" + f), blobId(`${DE1R5_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R5_PARENT, "HEAD", "--", "src", "fincore", "tools", "index.html", "lib/securityContext.js", "lib/businessRegistry.js", "lib/sendEmail.js"])), [], "no src / fincore / tools / page / predicate / SMTP change");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  // the route's authorization section is byte-identical to the approved P0 route; the approved consumer calls are kept
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  const run = readFileSync(join(REPO, RT), "utf8");
  assert.equal(section(run), section(bytesOf(`${P0}:${RT}`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate unchanged");
  for (const lit of ["await buildSnapshotForAll()", "await buildSnapshotForBiz(tenantId, bizId)", "sendSnapshotEmail(recipient.email, snapshot)", "sendSnapshotEmail(ownerEmail, snapshot)"]) assert.ok(run.includes(lit), lit);
  // the resolved-result classifier and the claim protocol of the receipt module are byte-identical to R4
  const r5 = readFileSync(join(REPO, ED), "utf8"), r4 = bytesOf(`${DE1R5_PARENT}:${ED}`).toString("utf8");
  const tail = (s) => { const a = s.indexOf("/** Pseudonymous recipient reference"); assert.ok(a > 0); return s.slice(a); };
  const head = (s) => { const a = s.indexOf("import { AsyncLocalStorage }"); assert.ok(a > 0); return s.slice(0, a); };
  assert.equal(tail(r5), tail(r4), "from recipientHash on (the classifier, the claim protocol, the finalization), the receipt module is the R4 bytes");
  assert.equal(head(r5), head(r4), "the module contract comment is unchanged");
});

test("DE1R5G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R4 modules are not the R5 ones", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R5_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R5(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R5(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R5_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R5(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R5_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R5_PINS[f], de1R4Pins()[f], f + ": the R5 pin differs from the R4 pin");
  }
  assert.equal(DE1R5_PINS[ED] !== DE1R4_PINS[ED], true);
  const eff = de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  for (const f of MODIFIED) assert.equal(eff[f], DE1R5_PINS[f]);
  for (const f of Object.keys(de1R4Pins()).filter((x) => !MODIFIED.includes(x))) assert.equal(eff[f], de1R4Pins()[f], f + " keeps its R4 pin");
});

test("DE1R5G-05 the decision rules in the source", { skip: SKIP }, () => {
  const ed = readFileSync(join(REPO, ED), "utf8"), run = readFileSync(join(REPO, RT), "utf8");
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  const e = code(ed), r = code(run);
  // the shared predicates are imported, never re-stated with a different rule; control characters are the SDK's own set
  assert.ok(e.includes('import { isValidId } from "./securityContext.js";') && e.includes('import { isRegistryBizId, decodeRegistryNode, classifyRegistryTarget } from "./businessRegistry.js";'));
  assert.ok(e.includes("export const RTDB_CONTROL_CHARS = /[\\u0000-\\u001f\\u007f]/;"));
  assert.ok(e.includes("export function isTenantKey(v) { return isValidId(v) && !RTDB_CONTROL_CHARS.test(v); }"));
  assert.ok(e.includes("export function isBusinessKey(v) { return isRegistryBizId(v) && !RTDB_CONTROL_CHARS.test(v); }"));
  assert.ok(e.includes("  if (!isTenantKey(tenantId)) return null;\n  if (!isBusinessKey(bizId)) return null;"), "receiptPath applies the two slot rules");
  assert.ok(!e.includes("SAFE_ID"), "the single R4 rule (`:` refused in both slots) is gone");
  assert.ok(e.includes("return `${RECEIPT_ROOT}/${kind}/${tenantId}/${bizId}/${businessDate}`;"), "the path format is unchanged");
  const idSection = e.slice(e.indexOf("export const RTDB_CONTROL_CHARS"), e.indexOf("const isRecord ="));
  for (const forbidden of [".trim()", ".toLowerCase()", "encodeURIComponent", "replace(/", "normalize("]) assert.ok(!idSection.includes(forbidden), "no " + forbidden + " on identities");
  for (const forbidden of ["tenantId.trim", "bizId.trim", "String(tenantId)", "String(bizId)"]) assert.ok(!e.includes(forbidden), "no " + forbidden + " anywhere in the receipt module");
  assert.ok(e.includes('export const MISSING_NAME_NOTICE_HE = "לא ניתן להכין את הסיכום היומי כי חסר שם העסק. נדרש תיקון פרטי העסק.";'));
  assert.ok(e.includes('if (name === null) return { state: "name_unavailable", code: "business_name_unavailable" };'));
  assert.ok(!e.includes('"Unknown"'), "no placeholder name in the receipt module");
  // the route: refusal before the recipient, the decided table, no placeholder, no no-send branch
  assert.ok(!r.includes("isUnknownBusinessName") && !r.includes("unknown_business_name") && !r.includes('"Unknown"'), "the no-send branch and the placeholder comparison are gone");
  const table = r.slice(r.indexOf("const MANUAL_REFUSALS"), r.indexOf("};", r.indexOf("const MANUAL_REFUSALS")));
  for (const [code, status] of [["invalid_business_identity", 400], ["business_not_registered", 404], ["ambiguous_business_identity", 422], ["registry_unreadable", 422], ["business_name_unavailable", 422], ["registry_unavailable", 503], ["snapshot_build_failed", 503]])
    assert.match(table, new RegExp(`${code}:\\s*\\{ status: ${status},`), code + " → " + status);
  const get = r.slice(r.indexOf('if (req.method === "GET")'), r.indexOf('if (req.method === "POST" && snapshotCtx)'));
  assert.ok(get.indexOf("readDeliveryTarget(") < get.indexOf("resolveOwnerRecipient(") && get.indexOf("resolveOwnerRecipient(") < get.indexOf("deliverWithReceipt("), "GET: gate, then recipient, then delivery");
  assert.ok(get.includes('outcome: "failed", code: target.code, settlement: "failed", receipt: "not_written"'), "a refused business is a failed row");
  const post = r.slice(r.indexOf('if (req.method === "POST" && snapshotCtx)'));
  assert.ok(post.indexOf("readDeliveryTarget(") < post.indexOf("buildSnapshotForBiz(") && post.indexOf("buildSnapshotForBiz(") < post.indexOf("resolveOwnerRecipient(") && post.indexOf("resolveOwnerRecipient(") < post.indexOf("deliverWithoutReceipt("), "POST: gate, build, recipient, send");
  assert.ok(post.includes('return refuse(target.code);') && post.includes("return refuse(builderRefusal(error));"));
  assert.ok(r.includes('errorClass(error) === "SyntaxError" ? "registry_unreadable" : "snapshot_build_failed"'), "a builder SyntaxError is a malformed registry, mapped by class");
  assert.ok(!/console\.(warn|error)\([^)]*error\.message/.test(r), "no error message is logged");
});
