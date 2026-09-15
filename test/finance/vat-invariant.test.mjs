// S0 VAT invariant guard: active daily-entry gross mode converts once before save;
// all stored/calculated financial values remain net of VAT.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// R10-GATE-016: reach the repository through the resolved git context. A linked
// worktree records ABSOLUTE back-pointers when it is created, so a checkout reached
// through a different absolute path (a container mount, a relocated volume) makes
// plain `git` fail from inside it with "not a git repository" — which failed this
// guard for reasons that had nothing to do with the VAT invariant. The invariant
// assertions below are unchanged; only how git is invoked is.
import { gitIn } from "../support/git-context.mjs";
import vm from "node:vm";
import { dailyReportMessage } from "../../lib/whatsappMessages.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "686b4350c6b6186c81d7f821d8c26a960428d30b";

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function loadMarjinVat() {
  const html = read("index.html");
  const start = html.indexOf("const VAT_RATE = 1.18;");
  assert.notEqual(start, -1, "index.html must define the canonical VAT_RATE");
  const endNeedle = "window.MarjinVat = Object.freeze({ VAT_RATE, grossToNetAmount, normalizeDailyEntryRevenueForVat });";
  const end = html.indexOf(endNeedle, start);
  assert.notEqual(end, -1, "index.html must expose the VAT helper for focused tests");
  const helperJs = html.slice(start, end + endNeedle.length);
  const sandbox = { window: {}, Math, Number, Object };
  vm.runInNewContext(helperJs, sandbox);
  return sandbox.window.MarjinVat;
}

function runtimeFiles() {
  const roots = ["api", "lib", "src"];
  const out = ["index.html"];
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const child = join(abs, name);
      const rel = relative(ROOT, child).split(sep).join("/");
      if (rel.split("/").includes("__fixtures__")) continue;
      const st = statSync(child);
      if (st.isDirectory()) {
        if (name === "node_modules") continue;
        walk(child);
      } else if (/\.(?:js|ts|html)$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(rel);
      }
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  return out.sort();
}

function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    let text = "";
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false;
          i += 1;
        }
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlock = true;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") break;
      text += ch;
    }
    out.push(text);
  }
  return out.join("\n");
}

test("gross daily-entry mode converts revenue fields to net once before save", () => {
  const vat = loadMarjinVat();
  assert.equal(vat.VAT_RATE, 1.18);
  const saved = vat.normalizeDailyEntryRevenueForVat({
    sales: 11800,
    deliveries: 2360,
    other_income: 1180,
    includeVat: true,
    food_cost: 500,
  });
  assert.equal(saved.sales, 10000);
  assert.equal(saved.deliveries, 2000);
  assert.equal(saved.other_income, 1000);
  assert.equal(saved.includeVat, false);
  assert.equal(saved.food_cost, 500, "non-revenue fields are not VAT-adjusted");
});

test("net daily-entry mode preserves already-net values byte-for-byte at helper boundary", () => {
  const vat = loadMarjinVat();
  const form = { sales: 100, deliveries: "", other_income: "", includeVat: false };
  const saved = vat.normalizeDailyEntryRevenueForVat(form);
  assert.equal(saved, form, "net mode returns the original object without transformation");
  assert.equal(saved.sales, 100);
  assert.equal(saved.includeVat, false);
});

test("stored net revenue is not double-converted by S0-touched formatter", () => {
  const vat = loadMarjinVat();
  assert.equal(vat.normalizeDailyEntryRevenueForVat({ sales: 100, includeVat: false }).sales, 100);
  const message = dailyReportMessage({
    bizName: "Test Biz",
    date: "2026-07-24",
    entry: { total_sales: 100, food_cost: 25, payroll: 20 },
    targets: { foodCostPct: 33, laborCostPct: 27 },
  });
  assert.match(message, /מחזור נטו:\* ₪100/);
  assert.match(message, /עלות מזון:\* ✅ 25\.0%/);
  assert.doesNotMatch(message, /₪85|84\.75|29\.5%/);
});

test("runtime source has one VAT-rate literal and one sanctioned VAT division site", () => {
  const literalHits = [];
  const operatorHits = [];
  const storedDivisionHits = [];
  for (const rel of runtimeFiles()) {
    const source = read(rel);
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const match of line.matchAll(/(?<![\w.])1\.18(?![\w.])/g)) {
        literalHits.push({ rel, line: i + 1, text: line.trim(), index: match.index });
      }
    }
    const strippedLines = stripComments(source).split(/\r?\n/);
    for (let i = 0; i < strippedLines.length; i += 1) {
      const text = strippedLines[i].trim();
      if (!text) continue;
      if (/[*/]\s*(?:VAT_RATE|vat|vatRate|1\.18)\b|\b(?:VAT_RATE|vat|vatRate|1\.18)\s*[*/]/i.test(text)) {
        operatorHits.push({ rel, line: i + 1, text });
      }
      if (/\b(?:entry|record|doc|data)\.(?:total_sales|sales|deliveries|other_income|revenue|total)\s*\/\s*(?:VAT_RATE|vat|vatRate|1\.18)\b/i.test(text)) {
        storedDivisionHits.push({ rel, line: i + 1, text });
      }
    }
  }

  assert.deepEqual(
    literalHits.map((hit) => `${hit.rel}:${hit.text}`),
    ["index.html:const VAT_RATE = 1.18; // Israeli VAT (18%)"],
    "the active runtime must have exactly one VAT-rate literal",
  );
  assert.deepEqual(
    operatorHits.map((hit) => `${hit.rel}:${hit.text}`),
    ["index.html:return Math.round((Number(amount) || 0) / VAT_RATE);"],
    "VAT multiplication/division is only allowed in the gross-entry conversion helper",
  );
  assert.deepEqual(storedDivisionHits, [], "stored financial data must not be divided by VAT");
});

test("S0 diff contains no historical data transform, migration, RTDB rules, or forbidden runtime area", () => {
  const names = gitIn(ROOT, ["diff", "--name-only", BASE, "--"]);
  assert.equal(names.status, 0, names.stderr);
  const changed = names.stdout.trim().split(/\n/).filter(Boolean);
  const forbiddenPaths = [
    /^src\/analytics\//,
    /^src\/repositories\//,
    /^src\/agent\//,
    /^src\/snapshot\//,
    /^src\/forecast\//,
    /^database\.rules\.json$/,
    /^vercel\.json$/,
    /^package(?:-lock)?\.json$/,
    /(?:^|\/)(?:migration|migrations|scripts)\//i,
  ];
  // R10.1-GATE-018. `database.rules.json` REMAINS forbidden. The single exception is
  // the explicitly authorized R10.1 remediation of Codex blocking finding 2 — adding
  // server-side validation for `biz:{bizId}:entries` — and the exception is granted by
  // CONTENT, never by exempting the path: the rules tree with exactly those two
  // additions removed must still be deep-equal to the base version. Any other rules
  // drift, including anything touching authorization or a VAT-relevant node, fails
  // here exactly as it did before, and so does any change to the added expressions'
  // location. Nothing about the VAT invariant itself is relaxed.
  const rulesChangeIsOnlyAuthorizedEntriesValidation = () => {
    const show = gitIn(ROOT, ["show", `${BASE}:database.rules.json`]);
    if (show.status !== 0) return false;
    let before, after;
    try { before = JSON.parse(show.stdout); after = JSON.parse(read("database.rules.json")); }
    catch { return false; }
    const dk = after?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
    if (!dk || typeof dk[".validate"] !== "string") return false;
    if (!dk["_v"] || typeof dk["_v"][".validate"] !== "string") return false;
    if (Object.keys(dk["_v"]).length !== 1) return false;          // `_v` carries ONLY a validator
    // Storage V2 (row-keyed entries) adds three more validators at this ONE location,
    // under the same content-verified exception: the schema marker, the collection
    // generation, and the per-row structural contract. Each must be shaped exactly as
    // authorized — a validator only, nothing else smuggled alongside it.
    const v2 = { schemaVersion: dk["schemaVersion"], generation: dk["generation"], rows: dk["rows"] };
    if (!v2.schemaVersion || typeof v2.schemaVersion[".validate"] !== "string" || Object.keys(v2.schemaVersion).length !== 1) return false;
    if (!v2.generation || typeof v2.generation[".validate"] !== "string" || Object.keys(v2.generation).length !== 1) return false;
    const rowRule = v2.rows && v2.rows["$rowId"];
    if (!rowRule || typeof rowRule[".validate"] !== "string") return false;
    if (Object.keys(v2.rows).length !== 1) return false;            // `rows` carries ONLY the row wildcard
    for (const k of Object.keys(rowRule)) {
      if (k === ".validate") continue;
      if (["id", "gen", "date"].indexOf(k) === -1) return false;    // no unexpected child rule
      if (typeof rowRule[k][".validate"] !== "string" || Object.keys(rowRule[k]).length !== 1) return false;
    }
    // The row contract must be the identity contract it claims to be.
    if (!rowRule[".validate"].includes("newData.child('id').val() === $rowId")) return false;
    if (!rowRule[".validate"].includes("newData.child('gen').val() === newData.parent().parent().child('generation').val()")) return false;
    // Every added expression must actually constrain the entries node, not be inert.
    for (const expr of [dk[".validate"], dk["_v"][".validate"], v2.schemaVersion[".validate"],
                        v2.generation[".validate"], rowRule[".validate"]]) {
      if (!expr.includes("biz:[^:]+:entries")) return false;
    }
    for (const expr of [dk[".validate"], dk["_v"][".validate"], v2.generation[".validate"], rowRule[".validate"]]) {
      if (!expr.includes("matches(")) return false;
    }
    delete dk[".validate"];
    delete dk["_v"];
    delete dk["schemaVersion"];
    delete dk["generation"];
    delete dk["rows"];
    try { assert.deepEqual(after, before); } catch { return false; }
    return true;
  };
  const rulesExempt = changed.includes("database.rules.json") && rulesChangeIsOnlyAuthorizedEntriesValidation();
  assert.deepEqual(
    changed.filter((rel) => forbiddenPaths.some((re) => re.test(rel)))
           .filter((rel) => !(rulesExempt && rel === "database.rules.json")),
    [],
    "S0 must not touch historical transforms, RTDB rules, forecast/KPI areas, packages, or stored-data scripts",
  );

  const runtimeDiff = gitIn(ROOT, ["diff", "--unified=0", BASE, "--", "index.html", "api", "lib", "src"]);
  assert.equal(runtimeDiff.status, 0, runtimeDiff.stderr);
  const addedLines = runtimeDiff.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  assert.deepEqual(
    addedLines.filter((line) => /\b(?:migration|migrate|_rtdbSet|storage\.set|set\(ref|remove\(ref|persist\(|entries\s*=)\b/i.test(line)),
    [],
    "S0 must not add migrations, RTDB writes, or entries rewrites",
  );
});
