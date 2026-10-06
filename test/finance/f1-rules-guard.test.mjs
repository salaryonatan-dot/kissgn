import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { authorizedF1CostHistoryRulesDelta, F1_RULES_CANDIDATE_BLOB, M1_INTEGRATION_RULES_BLOB } from "../support/rules-authorized-delta.mjs";
import { coreLayer } from "../support/m1-layer.mjs";
import { SERVER_READER_BASE } from "../support/server-reader-authorized-delta.mjs";

const base = JSON.parse(gitIn(REPO, ["show", `${SERVER_READER_BASE}:database.rules.json`]).stdout);
const liveBytes = readFileSync(join(REPO, "database.rules.json"));
const live = JSON.parse(liveBytes);
const clone = () => JSON.parse(JSON.stringify(live));
const rule = (d) => d.rules.tenants["$tenantId"]["$dataKey"];

test("F1-RG01 exact reviewed Rules delta is one scoped read and denied client write", () => {
  assert.deepEqual(authorizedF1CostHistoryRulesDelta(base, live), { ok: true });
  // M1 integration: the integrated Rules compose the reviewed F1 delta with the P1 legacy-credits denial (both accepted by
  // the semantic guard above); their exact blob is the M1 candidate pin. The F1 layer blob holds at the Core/F1 R4 commit.
  const L = coreLayer(REPO);
  assert.equal(gitIn(REPO, ["hash-object", "database.rules.json"]).stdout.trim(), L.m1 ? M1_INTEGRATION_RULES_BLOB : F1_RULES_CANDIDATE_BLOB);
  assert.equal(gitIn(REPO, ["rev-parse", L.ref + ":database.rules.json"]).stdout.trim(), F1_RULES_CANDIDATE_BLOB, "the F1 layer Rules blob at its exact commit");
  assert.ok(readFileSync(join(REPO, "test/emulator/database.rules.json")).equals(liveBytes));
  assert.equal(authorizedF1CostHistoryRulesDelta(base, base).reason, "cost_history_delta_missing_or_changed");
});

test("F1-RG02 semantic negative controls refuse membership, write, parent and unrelated grants", () => {
  const cases = [
    (d) => { rule(d)[".read"] = rule(d)[".read"].replace(".child('members').child(auth.uid).val() === true && ", ""); },
    (d) => { rule(d)[".write"] = rule(d)[".write"].replace("cost_history$/) ? false", "cost_history$/) ? true"); },
    (d) => { d.rules.tenants["$tenantId"][".write"] = "auth !== null"; },
    (d) => { rule(d)[".read"] += " || true"; },
    (d) => { rule(d).head = { ".write": true }; },
  ];
  for (const change of cases) {
    const d = clone(); change(d);
    assert.notDeepEqual(authorizedF1CostHistoryRulesDelta(base, d), { ok: true });
  }
});
