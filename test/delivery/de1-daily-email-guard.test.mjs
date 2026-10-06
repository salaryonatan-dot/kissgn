// DE1 — identity, provenance and scope of the daily e-mail delivery reliability layer (LOCAL checkpoint; pending independent
// review). The layer is built on the M1 integration R1 candidate (DE1_PARENT), which is itself pending review.
//   DE1G-01  the protected runtime files DE1 changes relative to its parent are EXACTLY the recorded set; committed / staged /
//            checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ DE1) are the pins
//   DE1G-02  provenance: each DE1 pin of a changed file is the parent's bytes + exactly the recorded edits; new files are new
//   DE1G-03  scope: DE1 touches only the delivery files — no builder, presenter, financial, analyzer / detector, Rules,
//            deployment-config or page change — and leaves the route's authorization section byte-identical to P0
//   DE1G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the receipt node is client-inaccessible
//            under the UNCHANGED Rules (`$other` deny) and the Rules blob is unchanged
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { DE1_PARENT, DE1_PINS, DE1_NEW_FILES, DE1_EDITS, DE1_SCOPE, isDE1Tree, deriveDE1 } from "../support/de1-daily-email.mjs";

const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
const SKIP = !isDE1Tree(REPO) && "not a DE1 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(DE1_PINS).filter((f) => !DE1_NEW_FILES.includes(f)).sort();

test("DE1G-01 the DE1 change set vs its parent is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(DE1_PARENT, "45e760c893f682b71d8e8e8e962528c385206609", "DE1 is built on the R1 author candidate");
  for (const [f, pin] of Object.entries(DE1_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", DE1_PARENT, "HEAD", "--"])).filter((f) => PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", DE1_PARENT, "--"])).filter((f) => PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", DE1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), Object.keys(DE1_PINS).sort(), label + ": protected changes vs the DE1 parent = the recorded DE1 set");
  for (const [f, pin] of Object.entries(m1EffectivePins(REPO))) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
});

test("DE1G-02 provenance: each DE1 pin is the parent's bytes + exactly the recorded edits; new files are absent at the parent", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(DE1_EDITS).sort(), MODIFIED);
  for (const f of MODIFIED) {
    const d = deriveDE1(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), DE1_PINS[f], f + " = parent + recorded DE1 edits");
  }
  assert.equal(blobId(`${DE1_PARENT}:api/daily-snapshot/run.ts`), blobId(`${P0}:api/daily-snapshot/run.ts`), "the parent's run.ts is the approved P0 route");
  for (const f of DE1_NEW_FILES) assert.equal(blobId(`${DE1_PARENT}:${f}`), null, f + " is new in DE1");
});

test("DE1G-03 scope: only the delivery files change; the route's authorization section is byte-identical to P0", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(DE1_PINS).sort(), [...DE1_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", DE1_PARENT, "HEAD", "--"]));
  const forbidden = all.filter((f) => /^(src\/|fincore\/|index\.html$|database\.rules\.json$|vercel\.json$|package(-lock)?\.json$|api\/(?!daily-snapshot\/run\.ts$)|test\/emulator\/database\.rules\.json$)/.test(f));
  assert.deepEqual(forbidden, [], "no builder / presenter / financial / analyzer / detector / Rules / config / other route change");
  assert.equal(blobId("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf", "Rules unchanged (the combined, unpublished candidate)");
  const section = (src) => { const a = src.indexOf("export default async function handler"), b = src.indexOf("  try {\n    // GET = cron trigger"); assert.ok(a > 0 && b > a, "auth section located"); return src.slice(a, b); };
  assert.equal(section(readFileSync(join(REPO, "api/daily-snapshot/run.ts"), "utf8")), section(bytesOf(`${P0}:api/daily-snapshot/run.ts`).toString("utf8")), "CORS / method / requireCron / requireBizContext / owner gate unchanged");
  // the snapshot calls the approved B2 consumer makes are unchanged
  const run = readFileSync(join(REPO, "api/daily-snapshot/run.ts"), "utf8");
  for (const lit of ["await buildSnapshotForAll()", "await buildSnapshotForBiz(tenantId, bizId)", "sendSnapshotEmail(recipient.email, snapshot)", "sendSnapshotEmail(ownerEmail, snapshot)"]) assert.ok(run.includes(lit), lit);
});

test("DE1G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the receipt node needs no Rules change", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(DE1_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveDE1(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f);
    const dropped = deriveDE1(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== DE1_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveDE1(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== DE1_PINS[f], f + ": an altered edit is not the pin");
  }
  // the receipts live at the top-level `email_delivery` node; the Rules have no rule for it ⇒ `$other` denies every client
  const rules = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8")).rules;
  assert.equal(rules.email_delivery, undefined, "no rule opens email_delivery");
  assert.deepEqual(rules.$other, { ".read": false, ".write": false }, "the default top-level rule denies clients");
});
