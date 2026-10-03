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
import { authorizedEntriesRulesDelta, authorizedVersionFenceRulesDelta, P1_R2_RULES_BLOB } from "../support/rules-authorized-delta.mjs";
import { SERVER_READER_BASE, SERVER_READER_AUTHORIZED_FILES, isProtectedPath, collectServerReaderScopeInputs, serverReaderScopeVerdict } from "../support/server-reader-authorized-delta.mjs";
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
  // the explicitly authorized entries storage contract — the R10.1 server-side
  // validation of `biz:{bizId}:entries` and the Storage V2 row-keyed contract — and
  // the exception is granted by CONTENT, never by exempting the path.
  // R-V2-H10: the content check is SEMANTIC. The authorized delta is pinned as literal
  // expressions in test/support/rules-authorized-delta.mjs and compared as a
  // whitespace-normalized expression tree; the `.write` rule must be exactly the base
  // rule plus the cutover guard; and the tree with the authorized delta removed must be
  // deep-equal to the base version. Token presence proves nothing here: an inert
  // wrapper (`true || (…)`), a loosened comparison, a dropped clause or a smuggled
  // child rule all differ from the pinned expressions and fail. Nothing about the VAT
  // invariant itself is relaxed.
  const rulesChangeIsOnlyAuthorizedEntriesValidation = (afterText) => {
    const show = gitIn(ROOT, ["show", `${BASE}:database.rules.json`]);
    if (show.status !== 0) return false;
    let before, after;
    try { before = JSON.parse(show.stdout); after = JSON.parse(afterText); }
    catch { return false; }
    return authorizedEntriesRulesDelta(before, after).ok === true;
  };

  // ── LAYER A — historical S0 protection, BASE → the Codex-approved Storage V2 core ──
  // Unchanged contract: across the whole S0 + Storage V2 history no forbidden path may
  // change, and the Rules may change only through the semantic entries exception.
  const H = SERVER_READER_BASE;
  const hist = gitIn(ROOT, ["diff", "--name-only", BASE, H, "--"]);
  assert.equal(hist.status, 0, hist.stderr);
  const changedHist = hist.stdout.trim().split(/\n/).filter(Boolean);
  const rulesAtH = gitIn(ROOT, ["show", `${H}:database.rules.json`]);
  assert.equal(rulesAtH.status, 0, rulesAtH.stderr);
  const rulesExemptHist = changedHist.includes("database.rules.json") && rulesChangeIsOnlyAuthorizedEntriesValidation(rulesAtH.stdout);
  assert.deepEqual(
    changedHist.filter((rel) => forbiddenPaths.some((re) => re.test(rel)))
               .filter((rel) => !(rulesExemptHist && rel === "database.rules.json")),
    [],
    "S0 history must not touch historical transforms, RTDB rules, forecast/KPI areas, packages, or stored-data scripts",
  );
  // VERSION FENCE (CTO D-VF2, 2026-09-24): from the approved core onward the Rules may
  // change ONLY by the exact fence delta pinned in test/support/rules-authorized-delta.mjs
  // (the storage_v2_control root + FENCE_GUARD in the entries granting branch), checked
  // semantically against the CORE rules (never a path exemption, never a blanket
  // post-core allowance) — and the live file must be the reviewed bytes (blob pin) with
  // a byte-identical emulator mirror.
  let coreRules, liveRules;
  try { coreRules = JSON.parse(rulesAtH.stdout); liveRules = JSON.parse(read("database.rules.json")); } catch { assert.fail("rules unparseable"); }
  const fenceDelta = authorizedVersionFenceRulesDelta(coreRules, liveRules);
  assert.deepEqual(fenceDelta, { ok: true }, "database.rules.json must be the approved core plus the exact version-fence delta");
  const liveRulesBlob = gitIn(ROOT, ["hash-object", "database.rules.json"]);
  assert.equal(liveRulesBlob.status, 0, liveRulesBlob.stderr);
  assert.equal(liveRulesBlob.stdout.trim(), P1_R2_RULES_BLOB, "database.rules.json is the P1 R2 candidate denial (exact blob; pending independent review)");
  assert.equal(read("test/emulator/database.rules.json"), read("database.rules.json"), "emulator Rules mirror is byte-identical");

  // ── LAYER B — the approved server-reader files, core → working tree ──────────────
  // CTO decision (2026-09-23): the P0-DATA-01 server-reader convergence may change
  // exactly five historically protected runtime files. R1 (Codex SR-F2): the
  // authorization is by IDENTITY — each file's working-tree bytes must hash to the git
  // blob of its reviewed version, pinned in test/support/server-reader-authorized-delta.mjs.
  // The guard proves "this file IS the reviewed version": a relocated declaration,
  // reordered statements, an extra statement, a partial revert, a touched formula, a
  // sixth protected file or a directory/glob entry all fail. Nothing is normalized.
  // The Rules are not part of THIS authorization: their only permitted post-core change is
  // the version-fence delta validated in Layer A above.
  assert.deepEqual([...SERVER_READER_AUTHORIZED_FILES].sort(), [
    "src/analytics/dailyBuilder.ts",
    "src/repositories/analytics/dailyMetricsRepo.ts",
    "src/repositories/analytics/laborRepo.ts",
    "src/repositories/analytics/purchasesRepo.ts",
    "src/snapshot/snapshotBuilder.ts",
    // Financial Core B2: the approved B2 MODIFY of the e-mail presenter (under the protected
    // src/snapshot/ root) is authorized the same way — by the exact reviewed blob.
    "src/snapshot/snapshotEmail.ts",
  ], "the reader authorization names exactly the approved files (five readers + the B2 e-mail presenter)");
  const collected = collectServerReaderScopeInputs(ROOT);
  // The fence Rules change was validated ABOVE (semantic delta + exact blob); only that one
  // validated change is excluded from the reader-layer protected-path projection. The
  // general protected-path function and the five-file table are untouched.
  const live = { ...collected, changedProtectedPaths: collected.changedProtectedPaths.filter((rel) => !(fenceDelta.ok === true && rel === "database.rules.json")) };
  assert.deepEqual(live.changedProtectedPaths.filter((rel) => !isProtectedPath(rel)), [], "collector sanity");
  for (const rel of SERVER_READER_AUTHORIZED_FILES) {
    assert.match(String(live.blobs[rel]), /^[0-9a-f]{40}$/, rel + " is present in the working tree");
    assert.notEqual(live.blobs[rel], live.baseBlobs[rel], rel + " is a reviewed change on top of the core (otherwise it must not be listed)");
  }
  const verdict = serverReaderScopeVerdict(live);
  assert.deepEqual(verdict, { ok: true },
    "S0 must not touch historical transforms, forecast/KPI areas, packages, or stored-data scripts beyond the pinned (exact-content) server-reader files");

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
