// HR2 guard: exact successor, protected bytes and source boundaries. Technical acceptance remains with independent review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { HR2_PARENT, HR2_PINS, HR2_SCOPE, HR2_EDITS, isHR2Tree, deriveHR2 } from "../support/hr2-daily-hold.mjs";
import { isHR3Tree, HR3_PARENT } from "../support/hr3-daily-hold.mjs";

const SKIP = !isHR2Tree(REPO) && "not an HR2 commit";
const LAYERED = isHR3Tree(REPO), SOURCE = LAYERED ? HR3_PARENT : "HEAD";
const blob = (spec) => gitIn(REPO, ["rev-parse", "--verify", spec]).stdout.trim();
const names = (args) => gitIn(REPO, args).stdout.trim().split("\n").filter(Boolean);
const read = (file) => LAYERED ? gitIn(REPO, ["cat-file", "blob", `${SOURCE}:${file}`]).stdout : readFileSync(join(REPO, file), "utf8");
const protectedPath = /^(src\/|fincore\/|api\/|lib\/|tools\/daily-delivery\/hold\.mjs$|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;

test("HR2G-01 sole parent HR1; exact protected scope and effective committed/staged/checkout pins", { skip: SKIP }, () => {
  assert.equal(HR2_PARENT, "a0a9e82dffb65dc4063874ffc1d4d1fb8cb3562a");
  assert.equal(blob(`${SOURCE}^`), HR2_PARENT);
  assert.equal(names(["rev-list", "--parents", "-n1", SOURCE])[0].split(" ").length, 2);
  const changed = names(["diff", "--name-only", HR2_PARENT, SOURCE, "--"]);
  assert.deepEqual(changed.filter((x) => protectedPath.test(x)).sort(), [...HR2_SCOPE].sort());
  assert.deepEqual(Object.keys(HR2_PINS).sort(), [...HR2_SCOPE].sort());
  for (const [file, pin] of Object.entries(HR2_PINS)) {
    assert.match(pin, /^[a-f0-9]{40}$/);
    assert.equal(blob(`${SOURCE}:${file}`), pin, `${file} committed / historical`);
    if (!LAYERED) assert.equal(blob(`:${file}`), pin, `${file} staged`);
    assert.equal(gitBlobId(Buffer.from(read(file), "utf8")), pin, `${file} checkout / historical`);
    assert.equal(m1EffectivePins(REPO, { withHR3: false })[file], pin, `${file} effective historical overlay`);
  }
  for (const file of ["api/admin.js", "lib/sendEmail.js", "lib/emailDelivery.d.ts", "database.rules.json", "index.html", "src/snapshot/snapshotBuilder.ts"])
    assert.equal(blob(`${SOURCE}:${file}`), blob(`${HR2_PARENT}:${file}`), `${file} unchanged`);
});

test("HR2G-02 recorded unique edits reconstruct each protected blob from immutable HR1", { skip: SKIP }, () => {
  for (const file of HR2_SCOPE) {
    const d = deriveHR2(REPO, file);
    assert.ok(d.ok, `${file}: ${d.reason}`);
    assert.equal(gitBlobId(d.bytes), HR2_PINS[file]);
    const tampered = structuredClone(HR2_EDITS);
    tampered[file][0].from += "\u0000";
    assert.equal(deriveHR2(REPO, file, tampered).reason, "edit_anchor_not_unique");
  }
});

test("HR2G-03 Daily boundaries and unchanged receipt/provider/admin contracts", { skip: SKIP }, () => {
  const route = read("api/daily-snapshot/run.ts"), email = read("lib/emailDelivery.js");
  const parentRoute = gitIn(REPO, ["cat-file", "blob", `${HR2_PARENT}:api/daily-snapshot/run.ts`]).stdout;
  const beforeTry = (s) => s.slice(s.indexOf("export default async function handler("), s.indexOf("  try {\n    // GET = cron trigger"));
  assert.equal(beforeTry(route), beforeTry(parentRoute), "P0 route authorization unchanged");
  const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a) + a.length));
  assert.equal(between(email, "function decideClaim(", "\n}\n"),
    between(gitIn(REPO, ["cat-file", "blob", `${HR2_PARENT}:lib/emailDelivery.js`]).stdout, "function decideClaim(", "\n}\n"));
  assert.ok(route.indexOf('const g1 = await makeDailyDeliveryGate(db, run.businessDate)("g1")') < route.indexOf("recordMissingNameNotice("));
  assert.ok(route.includes("const failures = new Map(run.failedBuilds.map"));
  assert.ok(route.includes("return res.status(broken ? 500 : 503)"));
  assert.ok(email.includes("excludedThrough") && email.includes("israelDate(nowMs)"));
  assert.ok(email.includes("if (Object.keys(raw.log).length !== raw.version) return unreadable;"));
  assert.equal((email.match(/transact\(db, DELIVERY_HOLD_PATH,/g) || []).length, 1, "one state/audit writer");
  assert.equal(blob(`${SOURCE}:database.rules.json`), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf");
});
