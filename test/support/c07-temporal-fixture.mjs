import { isA1Tree } from "./m1-a1-inspection.mjs";
// C07T-F1 author successor. Proposed test-only carriage; independent acceptance pending.
// The accepted C07 object/pins stay historical. Both C07G-01 and C07TG-01 call the exact current-carrier verifier.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gitIn } from "./git-context.mjs";
import { untrackedChanges, workingChanges } from "./rf2-rules-gate.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./c07-temporal-fixture.json", import.meta.url), "utf8"));
export const C07T_PARENT = "142cb808ab0d043f10e2f84f2c7051e7c7af7f45";
export const C07T_RECORD = "test/support/c07-temporal-fixture.json";
export const C07T_FILES = Object.freeze([
  "test/finance/b1-downstream-compat.test.mjs",
  "test/finance/c07-compat-fixture-guard.test.mjs",
  "test/finance/c07-temporal-guard.test.mjs",
  C07T_RECORD,
  "test/support/c07-temporal-fixture.mjs",
]);
export const C07T_PINS = Object.freeze({ ...RECORD.pins });
const blob = (b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const rev = (root, spec) => { const r = gitIn(root, ["rev-parse", "--verify", "-q", spec]); assert.equal(r.status, 0, spec); return r.stdout.trim(); };
const names = (root, args) => { const r = gitIn(root, args); assert.equal(r.status, 0, r.stderr); return r.stdout.split("\0").filter(Boolean).sort(); };

export function isC07TemporalTree(root) {
  if (isA1Tree(root)) return true;
  return gitIn(root, ["merge-base", "--is-ancestor", C07T_PARENT, "HEAD"]).status === 0 && rev(root, "HEAD") !== C07T_PARENT;
}

export function verifyC07TemporalHead(root) {
  assert.equal(RECORD.parent, C07T_PARENT, "literal accepted C07 parent");
  assert.deepEqual([...RECORD.files].sort(), [...C07T_FILES].sort(), "exact temporal scope");
  assert.deepEqual(Object.keys(C07T_PINS).sort(), C07T_FILES.filter((f) => f !== C07T_RECORD).sort(), "one pin per non-record file");
  assert.equal(rev(root, "HEAD^"), C07T_PARENT, "temporal successor sole parent is accepted C07");
  const parents = gitIn(root, ["rev-list", "--parents", "-n1", "HEAD"]); assert.equal(parents.status, 0);
  assert.equal(parents.stdout.trim().split(" ").length, 2, "exactly one parent");
  const expected = [...C07T_FILES].sort();
  assert.deepEqual(names(root, ["diff", "--name-only", "-z", C07T_PARENT, "HEAD", "--"]), expected, "committed temporal delta");
  assert.deepEqual(names(root, ["diff", "--name-only", "-z", "--cached", C07T_PARENT, "--"]), expected, "staged temporal delta");
  assert.deepEqual(workingChanges(root, C07T_PARENT), expected, "working temporal delta including every counted untracked path");
  assert.deepEqual(untrackedChanges(root), [], "no untracked path hidden by ignore settings");
  for (const [f, pin] of Object.entries(C07T_PINS)) {
    assert.match(pin, /^[0-9a-f]{40}$/);
    assert.equal(rev(root, "HEAD:" + f), pin, f + " committed temporal pin");
    assert.equal(rev(root, ":" + f), pin, f + " staged temporal pin");
    assert.equal(blob(readFileSync(join(root, f))), pin, f + " checked-out temporal pin");
  }
  for (const f of [C07T_RECORD, "test/support/c07-compat-fixture.json", "test/support/c07-compat-fixture.mjs"]) {
    const head = rev(root, "HEAD:" + f);
    assert.equal(rev(root, ":" + f), head, f + " record/module staged");
    assert.equal(blob(readFileSync(join(root, f))), head, f + " record/module checked out");
    if (f !== C07T_RECORD) assert.equal(head, rev(root, C07T_PARENT + ":" + f), "accepted C07 record/module unchanged");
  }
}
