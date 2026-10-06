// M1 integration R2 — identity, provenance and scope of the successor of the REJECTED R1 candidate (LOCAL; pending independent
// Codex review). Built on M1_R2_PARENT (the R1 candidate 45e760c8, itself rejected: CHANGES_REQUIRED).
//   R2G-01  the protected files R2 changes relative to its parent are EXACTLY the recorded set; committed / staged /
//           checked-out bytes of every effective pin (M1 ⊕ R1 ⊕ R2, and the S0 reader table) are the pins
//   R2G-02  provenance: each R2 pin of a changed file is the parent's bytes + exactly the recorded edits; the new file is new
//   R2G-03  scope: only the registry-selection decision changes — the page's business-list load / selection path (no write
//           line of the page changes), the analytics endpoint's target identity (its authorization branches byte-identical
//           to P0), the analytics builder's name lookup and discovery (no financial line), the shared module's prose and one
//           added export (the classifier itself byte-identical); no Rules, deployment config, e-mail or Core / P1 file
//   R2G-04  non-vacuity: changed anchors, dropped or altered edits are refused; the R1 page is refused as the R2 page
//   R2G-05  the shared rule is in the import closure of the analytics endpoint and of the analytics builder
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { m1EffectivePins, m1EffectivePageVerdict, gitBlobId } from "../support/m1-r1-remediation.mjs";
import { M1_R2_PARENT, M1_R2_PINS, M1_R2_NEW_FILES, M1_R2_EDITS, M1_R2_SCOPE, M1_R2_PROTECTED, isM1R2Tree, deriveR2 } from "../support/m1-r2-remediation.mjs";
import { SERVER_READER_EFFECTIVE_BLOBS, SERVER_READER_APPROVED_BLOBS } from "../support/server-reader-authorized-delta.mjs";
import { C1_WRITE_TOKENS } from "../support/c1-index-scope.mjs";

const SKIP = !isM1R2Tree(REPO) && "not an M1 R2 tree";
const P0 = "05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661";
const blobId = (spec) => { const r = gitIn(REPO, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const bytesOf = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 1 << 28 }); assert.equal(r.status, 0, spec); return r.stdout; };
const lines = (r) => r.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
const MODIFIED = Object.keys(M1_R2_PINS).filter((f) => !M1_R2_NEW_FILES.includes(f)).sort();
const read = (f) => readFileSync(join(REPO, f), "utf8");

test("R2G-01 the R2 change set vs the rejected R1 parent is exactly the recorded set; every effective pin holds committed / staged / checked out", { skip: SKIP }, () => {
  assert.equal(M1_R2_PARENT, "45e760c893f682b71d8e8e8e962528c385206609", "R2 is built on the rejected R1 candidate");
  assert.equal(gitIn(REPO, ["rev-parse", "HEAD^"]).stdout.trim(), M1_R2_PARENT, "the R1 candidate is the SOLE parent");
  assert.equal(gitIn(REPO, ["rev-list", "--parents", "-n", "1", "HEAD"]).stdout.trim().split(" ").length, 2, "one parent");
  for (const [f, pin] of Object.entries(M1_R2_PINS)) assert.match(pin, /^[0-9a-f]{40}$/, f + ": literal blob id");
  const committed = lines(gitIn(REPO, ["diff", "--name-only", M1_R2_PARENT, "HEAD", "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const staged = lines(gitIn(REPO, ["diff", "--name-only", "--cached", M1_R2_PARENT, "--"])).filter((f) => M1_R2_PROTECTED.test(f));
  const working = [...lines(gitIn(REPO, ["diff", "--name-only", M1_R2_PARENT, "--"])), ...lines(gitIn(REPO, ["ls-files", "--others", "--exclude-standard"]))].filter((f) => M1_R2_PROTECTED.test(f));
  for (const [label, set] of [["committed", committed], ["staged", staged], ["working tree", working]])
    assert.deepEqual([...new Set(set)].sort(), Object.keys(M1_R2_PINS).sort(), label + ": protected changes vs the R1 parent = the recorded R2 set");
  const eff = { ...m1EffectivePins(REPO), ...SERVER_READER_EFFECTIVE_BLOBS };
  for (const f of Object.keys(M1_R2_PINS)) assert.equal(eff[f], M1_R2_PINS[f], f + " is held to its R2 pin by the effective tables");
  for (const [f, pin] of Object.entries(eff)) {
    assert.equal(blobId("HEAD:" + f), pin, f + " committed");
    assert.equal(blobId(":" + f), pin, f + " staged");
    assert.equal(gitBlobId(readFileSync(join(REPO, f))), pin, f + " checked out");
  }
  assert.equal(SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], "6b70d03c245d163264f1bad2cefa71c0d85ff761", "the approved B1 pin itself is untouched");
});

test("R2G-02 provenance: each R2 pin is the R1 parent's bytes + exactly the recorded edits; the new file is absent at the parent", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(M1_R2_EDITS).sort(), MODIFIED, "edits are recorded for exactly the modified files");
  for (const f of MODIFIED) {
    const d = deriveR2(REPO, f);
    assert.ok(d.ok, f + ": " + JSON.stringify(d));
    assert.equal(gitBlobId(d.bytes), M1_R2_PINS[f], f + " = parent + recorded R2 edits");
  }
  assert.equal(blobId(`${M1_R2_PARENT}:api/analytics/daily-builder.ts`), blobId(`${P0}:api/analytics/daily-builder.ts`), "the parent's endpoint is the approved P0 bytes");
  assert.equal(blobId(`${M1_R2_PARENT}:src/analytics/dailyBuilder.ts`), SERVER_READER_APPROVED_BLOBS["src/analytics/dailyBuilder.ts"], "the parent's builder is the approved B1 bytes");
  for (const f of M1_R2_NEW_FILES) assert.equal(blobId(`${M1_R2_PARENT}:${f}`), null, f + " is new in R2");
});

test("R2G-03 scope: only the registry-selection decision changes; authorization, financial lines, page writes, Rules and e-mail are untouched", { skip: SKIP }, () => {
  assert.deepEqual(Object.keys(M1_R2_PINS).sort(), [...M1_R2_SCOPE].sort());
  const all = lines(gitIn(REPO, ["diff", "--name-only", M1_R2_PARENT, "HEAD", "--"]));
  assert.deepEqual(all.filter((f) => /^(database\.rules\.json|vercel\.json|package(-lock)?\.json|fincore\/|src\/(finance|metrics|policy|presenters|browser|finance-server|snapshot|agent|alerts|services)\/|api\/(?!analytics\/daily-builder\.ts$)|lib\/(?!businessRegistry\.(js|d\.ts)$)|test\/emulator\/database\.rules\.json$)/.test(f)), [], "no Rules / config / Core / P1 / e-mail / other route change");
  // the page: no write line changes (the multiset of lines calling a write / lifecycle entry point is identical to R1's)
  const writes = (s) => s.split("\n").filter((l) => C1_WRITE_TOKENS.some((t) => l.includes(t))).sort();
  assert.deepEqual(writes(read("index.html")), writes(bytesOf(`${M1_R2_PARENT}:index.html`).toString("utf8")), "no write line of the page changed");
  // every page edit lies in one of three regions: the C1 seam's binding helpers (the registry rule and the new business-list
  // view), the MarjinC1 export, and the App's business-list state / load / selection / gating code
  const page = read("index.html");
  const region = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b, i); assert.ok(i > 0 && j > i, "region " + a.slice(0, 40)); return [i, j]; };
  const REGIONS = [
    region("    var READ_FAILED = Object.freeze(", "    function ledgerChunks(F, from, to) {"),
    region("    window.MarjinC1 = Object.freeze({", "  })();"),
    region("  const [businesses, setBusinesses] = useState([]);", "  // Setup for this business"),
  ];
  for (const e of M1_R2_EDITS["index.html"]) {
    const at = page.indexOf(e.to);
    assert.ok(at > 0 && REGIONS.some(([i, j]) => at >= i && at + e.to.length <= j), "page edit inside the business-list regions: " + e.to.slice(0, 80));
  }
  // the endpoint: both authorization branches byte-identical to P0 (the POS diagnostic and the cron gate)
  const ep = read("api/analytics/daily-builder.ts"), p0 = bytesOf(`${P0}:api/analytics/daily-builder.ts`).toString("utf8");
  const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i > 0 && j > i, a); return s.slice(i, j); };
  assert.equal(slice(ep, 'if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "beecomm_diagnose")', 'if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "rebuild_after_entry_save")'),
    slice(p0, 'if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "beecomm_diagnose")', 'if (req.method === "POST" && (req.body as { action?: string } | undefined)?.action === "rebuild_after_entry_save")'), "POS diagnostic branch unchanged");
  assert.equal(slice(ep, "  if (req.method !== \"GET\" && req.method !== \"POST\") {", "  try {\n    // GET = cron trigger"), slice(p0, "  if (req.method !== \"GET\" && req.method !== \"POST\") {", "  try {\n    // GET = cron trigger"), "cron gate unchanged");
  for (const lit of ["claims = await requireAuth(req);", 'role = await requireTenantAccess(claims.uid, safeTenantId, "shift_manager");', "hasBusinessAccess(role, claims.uid, parseAppUsers(usersRaw), safeBizId)", "resolveAnalyticsRebuildRateLimit("]) assert.ok(ep.includes(lit), "endpoint keeps " + lit);
  assert.ok(!/function findBusiness|\.find\(\(b\) => b && typeof b === "object" && \(b as AppBusiness\)\.id === bizId\)/.test(ep), "no first-match lookup remains");
  // the builder: no financial line changes
  const removed = (f) => gitIn(REPO, ["diff", "-U0", M1_R2_PARENT, "HEAD", "--", f]).stdout.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
  assert.deepEqual(removed("src/analytics/dailyBuilder.ts").filter((l) => /canonical|toAnalyticsFinancials|loadCanonicalInputs|fin\b|payroll|purchases|revenue|labor|vat|forecast/i.test(l)), [], "no financial line of the builder is removed or rewritten");
  for (const e of M1_R2_EDITS["src/analytics/dailyBuilder.ts"]) assert.ok(/[Rr]egistry|ambiguous|businesses|bizName|registered/.test(e.from + e.to), "builder edit is a registry-selection edit");
  // the shared module: the classifier is byte-identical to R1
  const fn = (s) => s.slice(s.indexOf("export function classifyRegistryTarget("), s.indexOf("/**", s.indexOf("export function classifyRegistryTarget(")));
  assert.equal(fn(read("lib/businessRegistry.js")), fn(bytesOf(`${M1_R2_PARENT}:lib/businessRegistry.js`).toString("utf8")), "classifyRegistryTarget unchanged");
  const r2 = read("lib/businessRegistry.js"), r1 = bytesOf(`${M1_R2_PARENT}:lib/businessRegistry.js`).toString("utf8");
  const tail = (s) => s.slice(s.indexOf("export function decodeRegistryNode("));
  const added = r2.slice(r2.indexOf("/**\n * M1 R2 — the classification plus"), r2.indexOf("/** Read tenants/"));
  assert.ok(added.includes("export function resolveRegistryTarget("), "the added export");
  assert.equal(tail(r2).replace(added, ""), tail(r1), "the only code change in the shared module is the added resolveRegistryTarget");
});

test("R2G-04 non-vacuity: changed anchors, dropped or altered edits are refused; the R1 page is not the R2 page", { skip: SKIP }, () => {
  const tamper = (f, fn) => { const e = JSON.parse(JSON.stringify(M1_R2_EDITS)); fn(e[f]); return e; };
  for (const f of MODIFIED) {
    assert.equal(deriveR2(REPO, f, tamper(f, (l) => { l[0].from += "\u0000"; })).reason, "edit_anchor_not_unique", f + ": changed anchor");
    const dropped = deriveR2(REPO, f, tamper(f, (l) => { l.pop(); }));
    assert.ok(!dropped.ok || gitBlobId(dropped.bytes) !== M1_R2_PINS[f], f + ": a dropped edit is not the pin");
    const altered = deriveR2(REPO, f, tamper(f, (l) => { l[l.length - 1].to += "\n"; }));
    assert.ok(altered.ok && gitBlobId(altered.bytes) !== M1_R2_PINS[f], f + ": an altered edit is not the pin");
  }
  assert.equal(m1EffectivePageVerdict(REPO, bytesOf(`${M1_R2_PARENT}:index.html`)).reason, "not_the_recorded_derivation", "the rejected R1 page is refused on the R2 tree");
  assert.deepEqual(m1EffectivePageVerdict(REPO, readFileSync(join(REPO, "index.html"))), { ok: true }, "positive control");
});

function importClosure(entry) {
  const seen = new Set(), stack = [entry];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(join(REPO, f), "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      const p = normalize(join(dirname(f), m[1])), ts = p.replace(/\.js$/, ".ts");
      if (existsSync(join(REPO, p))) stack.push(p); else if (existsSync(join(REPO, ts))) stack.push(ts);
    }
  }
  return seen;
}
test("R2G-05 the shared registry rule is in the import closure of the analytics endpoint and the analytics builder", { skip: SKIP }, () => {
  for (const f of ["api/analytics/daily-builder.ts", "src/analytics/dailyBuilder.ts"]) assert.ok(importClosure(f).has("lib/businessRegistry.js"), f + " → lib/businessRegistry.js");
});
