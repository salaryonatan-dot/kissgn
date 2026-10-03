// FZ-P1 supplement (tests only; versioned FZ-P1/1) — freezes the P1 Supplier Credits artifacts a later
// Agent/Daily integration will read: the credit summary of the month report, supplier and overall
// gross / credits / net, Food Cost completeness with credits, the decoded MARJIN_CREDITS/2 state (review
// states, document identity fields, invalid / unreadable / negative-net states) and the server day facts.
// It does NOT modify the approved FZ candidate (eb53df2a / 88212f52): separate ids, separate goldens
// (test/finance/goldens/fz-p1-0N.json), separate helper. A golden change is a versioned contract change.
//   Regenerate (reviewed change only): FZ_P1_WRITE=1 node --test test/finance/fz-p1-supplement.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { shapeOf, shapeDiff } from "../support/fz-p1-shape.mjs";
import { produce, IDS, FZ_P1_VERSION, OWNER, scenarios } from "../support/fz-p1-producers.mjs";

const DIR = join(REPO, "test/finance/goldens");
const file = (id) => join(DIR, "fz-p1-" + id.slice(-2) + ".json");
const LIVE = await produce();
const goldenOf = (id) => ({ id, version: FZ_P1_VERSION, owner: OWNER, artifact: LIVE[id].artifact,
  note: "shapes: keys and types only (JSON projection), never values; ids: frozen contract identifiers and observed enum values; derived from the P1 R1 code by test/support/fz-p1-producers.mjs",
  scenarios: scenarios().map((s) => s[0]), ids: LIVE[id].ids, shapes: Object.fromEntries(Object.entries(LIVE[id].shapes).map(([k, v]) => [k, shapeOf(v)])) });
if (process.env.FZ_P1_WRITE === "1") { mkdirSync(DIR, { recursive: true }); for (const id of IDS) writeFileSync(file(id), JSON.stringify(goldenOf(id), null, 1) + "\n"); }

test("FZ-P1-00 the supplement covers exactly FZ-P1-01…05, versioned FZ-P1/1, owned by P1; the approved FZ goldens are not touched", () => {
  for (const id of IDS) { assert.ok(existsSync(file(id)), id); const g = JSON.parse(readFileSync(file(id), "utf8")); assert.equal(g.id, id); assert.equal(g.version, FZ_P1_VERSION); assert.equal(g.owner, OWNER); }
  // the writer path of this file targets ONLY fz-p1-0N.json (never an approved fz-0N golden)
  for (const id of IDS) assert.match(file(id), /goldens\/fz-p1-0[1-5]\.json$/);
});
for (const id of IDS) {
  test(`${id} live shapes and contract identifiers equal the FZ-P1/1 golden`, () => {
    const g = JSON.parse(readFileSync(file(id), "utf8")), live = goldenOf(id);
    assert.deepEqual(live.ids, g.ids, id + " identifiers");
    assert.deepEqual(live.scenarios, g.scenarios, id + " scenarios");
    assert.deepEqual(Object.keys(live.shapes).sort(), Object.keys(g.shapes).sort(), id + " sections");
    for (const k of Object.keys(g.shapes)) assert.deepEqual(shapeDiff(g.shapes[k], live.shapes[k]), [], `${id} ${k}`);
  });
}
test("FZ-P1-06 frozen semantics the shapes rely on: contract ids, review / status enums, and the incomplete states", () => {
  const g4 = JSON.parse(readFileSync(file("FZ-P1-04"), "utf8")).ids, g1 = JSON.parse(readFileSync(file("FZ-P1-01"), "utf8")).ids;
  assert.deepEqual(g1.credits, ["MARJIN_CREDITS/2"]);
  assert.deepEqual(g1.creditsState, ["absent", "invalid", "present"]);
  for (const s of ["pending", "flagged", "cleared", "acknowledged", "rejected"]) assert.ok(g4.reviewStates.includes(s), s);
  for (const c of ["review_pending", "review_flagged", "invalid_amount", "invalid_link"]) assert.ok(g4.issueCodes.includes(c), c);
  assert.ok(g1.flags.includes("negative_net_purchases") && g1.flags.includes("supplier_credit_review_pending") && g1.flags.includes("supplier_credit_review_flagged"));
});
