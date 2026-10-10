// DE1 R8 guard — identity, provenance and scope of the refusal-provenance candidate (LOCAL; pending independent review).
//   DE1R8G-01  the protected runtime files R8 changes relative to R7 are EXACTLY { api/daily-snapshot/run.ts }; committed /
//              staged / checked out bytes equal the effective pins (M1 ⊕ DE1 ⊕ R1 … ⊕ R8); R8 has exactly one parent, R7
//   DE1R8G-02  provenance: the R8 pin is the R7 bytes (= the R7 pin) + exactly the recorded edits
//   DE1R8G-03  scope: only builderRefusal (and its comments) changes; the authorization section is the approved P0 bytes; the
//              scheduled path, the notice branch and the manual send tail are byte-identical to R7; the receipt module, the
//              declarations, the SMTP wrapper, the builder, the predicates, Rules and schedule are byte-identical to R7
//   DE1R8G-04  non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R7 route is not the R8 one
//   DE1R8G-05  the attribution rule in the source: instanceof Error inside the guard, the three-field marker (name constant,
//              OWN code via hasOwnProperty, code === message, membership in the unchanged bounded set), every read guarded,
//              the default snapshot_build_failed; no message-only mapping survives; nothing of the thrown value is logged
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { de1EffectivePins, de1R7Pins, DE1_PINS } from "../support/de1-daily-email.mjs";
import { DE1R8_PARENT, DE1R8_PINS, DE1R8_NEW_FILES, DE1R8_EDITS, DE1R8_SCOPE, isDE1R8Tree, deriveDE1R8 } from "../support/de1-r8-provenance.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server|analytics|repositories|snapshot|agent|forecast)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const SKIP = !isDE1R8Tree(REPO) && "not a DE1 R8 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R8_PINS).filter((f) => !DE1R8_NEW_FILES.includes(f)).sort();
const RT = "api/daily-snapshot/run.ts";

test("DE1R8G-01 the R8 change set vs R7 is exactly { api/daily-snapshot/run.ts }; the pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R8_PARENT, "d5e1f30102ff88db985a6ff60392cfbdbafd856b", "R8 is built on the R7 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), DE1R8_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R8_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R8_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R8_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", DE1R8_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), [RT], label + ": protected changes vs R7 = { the route }");
  const eff = m1EffectivePins(REPO);
  assert.equal(eff[RT], DE1R8_PINS[RT], "the R8 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R8G-02 provenance: the R8 pin is the R7 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R8_NEW_FILES, []); assert.deepEqual(Object.keys(DE1R8_EDITS), [RT]); assert.deepEqual(MODIFIED, [RT]);
  assert.equal(blobId(`${DE1R8_PARENT}:${RT}`), de1R7Pins()[RT], "the parent bytes are the R7 pin");
  const d = deriveDE1R8(REPO, RT); assert.ok(d.ok, JSON.stringify(d));
  assert.equal(gitBlobId(d.bytes), DE1R8_PINS[RT], "R7 + recorded R8 edits = the pin");
});

test("DE1R8G-03 scope: builderRefusal only; everything else of the route and of the tree is byte-identical to R7", { skip: SKIP }, () => {
  assert.deepEqual(MODIFIED, [...DE1R8_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R8_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => !/^test\/(delivery|finance|support)\//.test(f) && f !== RT), [], "no runtime / config / tool / emulator / Rules change outside the route");
  for (const f of ["lib/emailDelivery.js", "lib/emailDelivery.d.ts", "lib/sendEmail.js", "lib/sendEmail.d.ts", "database.rules.json", "test/emulator/database.rules.json", "vercel.json", "package.json", "package-lock.json",
    "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts", "lib/securityContext.js", "lib/verifyToken.js", "lib/businessRegistry.js", "lib/bizAccess.js", "test/support/daily-email-harness.mjs", "fincore/v1/MANIFEST.json", "index.html"])
    assert.equal(blobId("HEAD:" + f), blobId(`${DE1R8_PARENT}:${f}`), f + " unchanged");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DE1R8_PARENT, "HEAD", "--", "src", "fincore", "lib", "tools", "index.html"])), [], "no src / fincore / lib / tools / page change");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  const run = readFileSync(join(REPO, RT), "utf8"), run7 = bytesOf(`${DE1R8_PARENT}:${RT}`).toString("utf8");
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  assert.equal(section(run), section(bytesOf(`${P0}:${RT}`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate = the approved P0 bytes");
  // everything from the handler on is R7 except one reworded comment line in the manual catch
  const fromHandler = (src) => src.slice(src.indexOf("export default async function handler")).replace("the refusal is the code the builder attributed (provenance marker), else a build failure", "the refusal is the code the builder attributed, else a build failure");
  assert.equal(fromHandler(run), fromHandler(run7), "the handler (authorization, scheduled path, notice branch, manual send) is the R7 bytes");
  // before builderRefusal everything is R7 except the G10 comment row
  const head = (src) => src.slice(0, src.indexOf("// The bounded codes a builder may attribute itself")).replace(/; R8, review finding\n\/\/\s+CF5-01 — an attribution needs the builder's provenance marker, never the message alone\)/, ")");
  assert.equal(head(run), head(run7), "before the attribution block the route is the R7 bytes (one comment row reworded)");
  assert.ok(run.includes('const BUILDER_ATTRIBUTED_CODES: ReadonlySet<string> = new Set<DeliveryTargetCode>(["invalid_business_identity", "business_not_registered",\n  "ambiguous_business_identity", "registry_unreadable", "business_name_unavailable", "registry_unavailable"]);'), "the bounded set is unchanged");
});

test("DE1R8G-04 non-vacuity: a changed anchor, a dropped or an altered edit is refused; the R7 route is not the R8 one", { skip: SKIP }, () => {
  const tamper = (fn) => { const e = JSON.parse(JSON.stringify(DE1R8_EDITS)); fn(e[RT]); return e; };
  assert.equal(deriveDE1R8(REPO, RT, tamper((l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique");
  const dropped = deriveDE1R8(REPO, RT, tamper((l) => { l.pop(); })); assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R8_PINS[RT]);
  const altered = deriveDE1R8(REPO, RT, tamper((l) => { l[l.length - 1].to += "\n"; })); assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R8_PINS[RT]);
  assert.notEqual(DE1R8_PINS[RT], de1R7Pins()[RT]);
  const eff = de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  assert.equal(eff[RT], DE1R8_PINS[RT]);
  for (const f of Object.keys(de1R7Pins()).filter((x) => x !== RT)) assert.equal(eff[f], de1R7Pins()[f], f + " keeps its R7 pin");
});

test("DE1R8G-05 the attribution rule in the source", { skip: SKIP }, () => {
  const code = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
  const r = code(readFileSync(join(REPO, RT), "utf8"));
  assert.ok(r.includes('const BUILDER_REFUSAL_NAME = "SnapshotIdentityRefusal";'), "the marker name is a constant");
  const br = r.slice(r.indexOf("function builderRefusal"), r.indexOf("\n}\n", r.indexOf("function builderRefusal")));
  assert.ok(br.includes('    if (!(error instanceof Error)) return "snapshot_build_failed";'), "an Error instance is required (inside the guard: a revoked Proxy throws on instanceof)");
  assert.ok(br.indexOf("try {") < br.indexOf("instanceof Error"), "instanceof is guarded");
  assert.ok(br.includes("name = error.name;") && br.includes("message = error.message;") && br.includes('ownCode = Object.prototype.hasOwnProperty.call(error, "code");') && br.includes('code = ownCode ? (error as { code?: unknown }).code : undefined;'), "the three fields are read, the code only as an OWN property");
  assert.ok(br.includes('} catch { return "snapshot_build_failed"; }'), "a throwing accessor / Proxy is a build failure");
  assert.ok(br.includes('if (name !== BUILDER_REFUSAL_NAME || !ownCode || typeof message !== "string" || code !== message) return "snapshot_build_failed";'), "all three fields must agree");
  assert.ok(br.includes('return BUILDER_ATTRIBUTED_CODES.has(message) ? (message as DeliveryTargetCode) : "snapshot_build_failed";'), "membership in the bounded set decides last; the default is a build failure");
  assert.ok(!/return typeof message === "string" && BUILDER_ATTRIBUTED_CODES\.has\(message\)/.test(r), "the R7 message-only mapping is gone");
  assert.ok(!br.includes("errorClass(") && !br.includes("instanceof SnapshotIdentityRefusal") && !br.includes("import"), "no class import, no class-name inference");
  assert.ok(!/console\.(warn|error)\([^)]*error\.(message|name|code|stack)/.test(r) && !/console\.(warn|error)\([^)]*\bname\b/.test(br), "nothing of the thrown value is logged");
  assert.ok(r.includes("console.error(`[daily-snapshot] manual build failed (${errorClass(error)})`);") && r.includes("return refuse(builderRefusal(error));"), "the class is logged; the attributed refusal is returned");
});
