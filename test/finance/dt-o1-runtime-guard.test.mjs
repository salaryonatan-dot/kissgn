// DT-O1 R2 candidate guard. This records identity and scope; technical owners
// must still accept the transition, and behaviour is tested separately.
import { historicalTest } from "../support/m1-a1-inspection.mjs";
const test = historicalTest(new URL("../../", import.meta.url), "7b1d3061c1a42b2d05d7702fbe376f98916e2ce6", "test/finance/dt-o1-runtime-guard.test.mjs");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { gitBlobId, m1EffectivePins } from "../support/m1-r1-remediation.mjs";
import { serverReaderEffectiveBlobs } from "../support/server-reader-authorized-delta.mjs";
import { DT_O1_PARENT, DT_O1_I6, DT_O1_PINS, DT_O1_PREVIOUS_PINS, DT_O1_SCOPE, DT_O1_EDITS, isDTO1Tree, deriveDTO1 } from "../support/dt-o1-runtime.mjs";

const SKIP = !isDTO1Tree(REPO) && "not a DT-O1 R2 tree";
const RECORD_FILE = "test/support/dt-o1-runtime.json";
const RECORD_BLOB = "a5d174160b6e7551e442b49b23c6f4207a5d14ac";
const PROTECTED = /^(src\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|test\/emulator\/database\.rules\.json$|index\.html$|vercel\.json$|package(-lock)?\.json$)/;
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const rev = (spec) => gitIn(REPO, ["rev-parse", "--verify", spec]).stdout.trim();
const read = (f) => readFileSync(join(REPO, f));

test("DTO1G-01 exact predecessor, protected scope, and committed/staged/checked-out pins", { skip: SKIP }, () => {
  assert.equal(DT_O1_PARENT, "f427e137d3e64c532b7014f7fc887010cc2c7fc3");
  assert.equal(DT_O1_I6, "224a00a655f0f2af9a0e55abac96db3265355cfb");
  assert.equal(rev("HEAD^"), DT_O1_PARENT);
  assert.equal(rev(DT_O1_PARENT + "^"), DT_O1_I6);
  assert.equal(lines(gitIn(REPO, ["rev-list", "--parents", "-n1", "HEAD"]))[0].split(" ").length, 2);
  assert.equal(rev("HEAD:" + RECORD_FILE), RECORD_BLOB, "literal committed record");
  assert.equal(rev(":" + RECORD_FILE), RECORD_BLOB, "literal staged record");
  assert.equal(gitBlobId(read(RECORD_FILE)), RECORD_BLOB, "literal checked-out record");
  assert.deepEqual(lines(gitIn(REPO, ["diff", "--name-only", DT_O1_I6, DT_O1_PARENT, "--"])).sort(),
    ["src/analytics/dailyBuilder.ts", "src/utils/dates.ts", "test/analytics/dt-o1-calendar-date.test.mjs"].sort(), "f427's historical delta");
  const changed = lines(gitIn(REPO, ["diff", "--name-only", DT_O1_PARENT, "HEAD", "--"]));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", DT_O1_PARENT, "--"]));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", DT_O1_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))];
  for (const [label, files] of [["committed", changed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(files.filter((f) => PROTECTED.test(f)))].sort(), [...DT_O1_SCOPE], label + ": only the two recorded protected runtime files");
  assert.deepEqual(changed.filter((f) => !PROTECTED.test(f) && !f.startsWith("test/")), [], "all other changes are tests and their records");
  const effective = m1EffectivePins(REPO), reader = serverReaderEffectiveBlobs(REPO);
  for (const f of DT_O1_SCOPE) {
    const pin = DT_O1_PINS[f];
    assert.match(pin, /^[0-9a-f]{40}$/);
    assert.equal(effective[f], pin, f + ": M1 effective pin");
    assert.equal(rev("HEAD:" + f), pin, f + ": committed");
    assert.equal(rev(":" + f), pin, f + ": staged");
    assert.equal(gitBlobId(read(f)), pin, f + ": checked out");
  }
  assert.equal(reader["src/analytics/dailyBuilder.ts"], DT_O1_PINS["src/analytics/dailyBuilder.ts"], "S0 reader overlay");
});

test("DTO1G-02 the f427 bytes plus exactly the recorded edits re-derive both pins", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(DT_O1_PINS).sort(), [...DT_O1_SCOPE]);
  for (const f of DT_O1_SCOPE) {
    assert.equal(rev(DT_O1_PARENT + ":" + f), DT_O1_PREVIOUS_PINS[f]);
    const derived = deriveDTO1(REPO, f);
    assert.ok(derived.ok, JSON.stringify(derived));
    assert.equal(gitBlobId(derived.bytes), DT_O1_PINS[f]);
  }
  const f = "src/analytics/dailyBuilder.ts";
  const malformed = structuredClone(DT_O1_EDITS);
  malformed[f][0].from += "\u0000";
  assert.equal(deriveDTO1(REPO, f, malformed).reason, "edit_anchor_not_unique");
  const altered = structuredClone(DT_O1_EDITS);
  altered[f][1].to += "\n";
  const d = deriveDTO1(REPO, f, altered);
  assert.ok(d.ok && gitBlobId(d.bytes) !== DT_O1_PINS[f]);
});

test("DTO1G-03 calendar correction does not add a Financial Core consumer", { skip: SKIP }, () => {
  const analytics = read("src/analytics/dailyBuilder.ts").toString("utf8");
  const dates = read("src/utils/dates.ts").toString("utf8");
  for (const [f, source] of [["dailyBuilder", analytics], ["dates", dates]]) {
    assert.doesNotMatch(source, /from ["']\.\.\/finance\//, f + ": no direct Financial Core import");
    assert.match(source, /setUTCFullYear\(/, f + ": calendar arithmetic in UTC fields");
  }
  assert.match(analytics, /timeZone: "Asia\/Jerusalem"/);
  assert.match(dates, /todayIso\(tz\)/);
});

test("DTO1G-04 earlier Finance, Rules, delivery, page and I6 identity bytes remain intact", { skip: SKIP }, () => {
  for (const f of ["src/finance/businessDate.ts", "database.rules.json", "test/emulator/database.rules.json", "index.html", "lib/emailDelivery.js", "api/daily-snapshot/run.ts", "api/admin.js", "test/support/i6-integration.json"])
    assert.equal(rev("HEAD:" + f), rev(DT_O1_PARENT + ":" + f), f);
  assert.equal(rev("HEAD:database.rules.json"), "27887d72da5431bd0b6ee69f53e0dfd10cc44caf");
});
