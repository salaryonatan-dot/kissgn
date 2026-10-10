// DE1 R1 — identity, provenance and scope of the Daily Email reliability R1 successor (LOCAL author candidate; pending
// independent Codex review). The successor is built on the rejected DE1 candidate (DE1R1_PARENT) and answers D1–D4.
//   DE1R1G-01  the protected runtime files R1 changes relative to DE1 are EXACTLY the recorded set; committed / staged /
//              checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1) are the pins
//   DE1R1G-02  provenance: each R1 pin is the DE1 bytes (= the DE1 pin) + exactly the recorded edits
//   DE1R1G-03  scope: only the delivery files — no builder, presenter, financial, Rules, schedule, config, page or other route
//              change, nothing outside the DE1 delivery scope; the route's authorization section is byte-identical to P0
//   DE1R1G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the overlay applies only on an R1 tree
// On a DE1 R2 tree (the successor of this rejected R1 candidate, test/support/de1-r2-email.mjs) DE1R1G-01/03 verify the R1
// commit itself from git objects (DE1R2_PARENT); the HEAD / index / checkout identity is held by the R2 guard (DE1R2G-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DE1_PINS, DE1_SCOPE, de1EffectivePins, de1R1Pins } from "../support/de1-daily-email.mjs";
import { isDE1R2Tree, DE1R2_PARENT } from "../support/de1-r2-email.mjs";
import { DE1R1_PARENT, DE1R1_PINS, DE1R1_NEW_FILES, DE1R1_EDITS, DE1R1_SCOPE, isDE1R1Tree, deriveDE1R1 } from "../support/de1-r1-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
const SKIP = !isDE1R1Tree(REPO) && "not a DE1 R1 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1R1_PINS).filter((f) => !DE1R1_NEW_FILES.includes(f)).sort();
const LAYERED = isDE1R2Tree(REPO);
const R1_TREE = LAYERED ? DE1R2_PARENT : "HEAD";          // the R1 commit itself when the R2 layer is checked out
const readAt = (f) => (LAYERED ? bytesOf(`${R1_TREE}:${f}`).toString("utf8") : readFileSync(join(REPO, f), "utf8"));

test("DE1R1G-01 the R1 change set vs DE1 is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1R1_PARENT, "9baf695c8f7d8c03e47dfaa4a67c3a795a4f1073", "R1 is built on the rejected DE1 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", R1_TREE + "^"]).stdout.trim(), DE1R1_PARENT, "sole parent");
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", R1_TREE]))[0].split(" ").length, 2, "exactly one parent");
  for (const [f, pin] of Object.entries(DE1R1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1R1_PARENT, R1_TREE, "--"])).filter((f) => PROTECTED.test(f));
  const sets = [["committed", committed]];
  if (!LAYERED) {
    sets.push(["staged", lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1R1_PARENT, "--"])).filter((f) => PROTECTED.test(f))]);
    sets.push(["working tree", [...lines(gitIn(REPO, ["diff", "--name-only", DE1R1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f))]);
  }
  for (const [label, set] of sets)
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1R1_PINS).sort(), label + ": protected changes vs DE1 = the recorded R1 set");
  // the R1 commit's own pins: on an R2 tree the effective table without the R2 overlay (M1 ⊕ R1 ⊕ DE1 ⊕ DE1 R1)
  const eff = LAYERED ? { ...m1EffectivePins(REPO), ...de1R1Pins() } : m1EffectivePins(REPO);
  for (const [f, pin] of Object.entries(DE1R1_PINS)) assert.equal(eff[f], pin, f + ": the R1 pin is the effective pin");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId(R1_TREE + ":" + f), pin, f + " committed" + (LAYERED ? " (at the R1 commit)" : ""));
    if (LAYERED) continue;
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1R1G-02 provenance: each R1 pin is the DE1 pin's bytes + exactly the recorded edits", { skip: SKIP }, () => {
  assert.deepEqual(DE1R1_NEW_FILES, [], "R1 adds no runtime file");
  assert.deepEqual(Object.keys(DE1R1_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    assert.equal(blobId(`${DE1R1_PARENT}:${f}`), DE1_PINS[f], f + ": the parent bytes are the DE1 pin");
    const d = deriveDE1R1(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1R1_PINS[f], f + " = DE1 + recorded R1 edits");
  }
});

test("DE1R1G-03 scope: only the delivery files change; the route's authorization section is byte-identical to P0", { skip: SKIP }, () => {
  assert.deepEqual([...DE1R1_SCOPE].sort(), [...DE1_SCOPE].sort(), "the same delivery scope as DE1");
  for (const f of Object.keys(DE1R1_PINS)) assert.ok(DE1R1_SCOPE.includes(f), f + " is a delivery file");
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1R1_PARENT, R1_TREE, "--"]));
  const forbidden = all.filter((f) => /^(src\/|fincore\/|index\.html$|database\.rules\.json$|vercel\.json$|package(-lock)?\.json$|api\/(?!daily-snapshot\/run\.ts$)|lib\/(?!(emailDelivery|sendEmail)\.(js|d\.ts)$)|tools\/|test\/emulator\/database\.rules\.json$|test\/storage-v2\/)/.test(f));
  assert.deepEqual(forbidden, [], "no builder / presenter / financial / Rules / schedule / config / page / tool / other route change");
  assert.equal(blobId(R1_TREE + ":database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged");
  assert.equal(blobId(R1_TREE + ":vercel.json"), blobId(`${DE1R1_PARENT}:vercel.json`), "schedule unchanged");
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  assert.equal(section(readAt("api/daily-snapshot/run.ts")), section(bytesOf(`${P0}:api/daily-snapshot/run.ts`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate unchanged");
  const run = readAt("api/daily-snapshot/run.ts");
  for (const lit of ["await buildSnapshotForAll()", "await buildSnapshotForBiz(tenantId, bizId)", "sendSnapshotEmail(recipient.email, snapshot)", "sendSnapshotEmail(ownerEmail, snapshot)"]) assert.ok(run.includes(lit), lit);
});

test("DE1R1G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the overlay replaces exactly the DE1 pins", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1R1_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1R1(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1R1(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1R1_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1R1(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1R1_PINS[f], f + ": an altered edit is not the pin");
    assert.notEqual(DE1R1_PINS[f], DE1_PINS[f], f + ": the R1 pin differs from the rejected DE1 pin");
  }
  const eff = de1EffectivePins(REPO);
  assert.deepEqual(Object.keys(eff).sort(), Object.keys(DE1_PINS).sort(), "the overlay introduces no file outside the DE1 set");
  // the receipts still live at the top-level `email_delivery` node with no rule: `$other` denies every client
  const rules = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8")).rules;
  assert.equal(rules.email_delivery, undefined); assert.deepEqual(rules.$other, { ".read": false, ".write": false });
});
