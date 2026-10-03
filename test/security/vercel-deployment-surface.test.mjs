// P0 — Vercel deployment surface. Proves, offline, that the .vercelignore allowlist
//   (1) keeps every file the browser runtime, the 12 serverless functions (including the four
//       scheduled routes) and their transitive src/lib imports need, and
//   (2) keeps docs, tests, artifacts, tooling, operator scripts, Rules, stray sources,
//       secrets/env files and any unclassified new top-level entry out of the deployment.
// Model and its limits: test/support/vercel-surface.mjs and
// artifacts/p0-vercel-surface-hardening/04_LOCAL_PROOF.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, TOP_LEVEL, readVercelignore, uploadFilter, isStatic, surface, functionEntrypoints, traceFunction,
} from "../support/vercel-surface.mjs";
import { gitIn } from "../support/git-context.mjs";

const TEXT = readVercelignore();
const keep = uploadFilter(TEXT);

function repoFiles() {
  const r = gitIn(ROOT, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split("\0").filter(Boolean))]
    .filter((f) => f !== "node_modules" && !f.startsWith("node_modules/")).sort();
}
const FILES = repoFiles();
const topOf = (f) => f.split("/")[0];
const ALL_CLASSIFIED = new Set(Object.values(TOP_LEVEL).flat());
const RUNTIME_TOP = new Set([...TOP_LEVEL.PUBLIC_RUNTIME_REQUIRED, ...TOP_LEVEL.SERVER_BUNDLE_REQUIRED, ...TOP_LEVEL.DEPLOYMENT_METADATA_REQUIRED]);

test("1 .vercelignore exists and is an allowlist: its first rule excludes the whole project root", () => {
  assert.ok(typeof TEXT === "string" && TEXT.length > 0, ".vercelignore must exist");
  const rules = TEXT.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.equal(rules[0], "/*", "the first rule must be `/*` (deny-by-default)");
  for (const r of rules.slice(1)) {
    if (!r.startsWith("!")) continue;
    assert.match(r, /^!\/[^/*]+$/, `re-allow rules must name one top-level entry: ${r}`);
    assert.ok(RUNTIME_TOP.has(r.slice(2)), `re-allowed entry is not a classified runtime input: ${r}`);
  }
});

test("2 every top-level entry of the repository is classified (a new entry fails until reviewed)", () => {
  const unclassified = [...new Set(FILES.map(topOf))].filter((t) => !ALL_CLASSIFIED.has(t));
  assert.deepEqual(unclassified, [], "classify new top-level entries in test/support/vercel-surface.mjs TOP_LEVEL");
});

test("3 browser runtime and deployment inputs are uploaded; the browser entry points are served statically", () => {
  for (const f of ["index.html", "landing.html", "vercel.json", "package.json", "package-lock.json", "tsconfig.json"]) {
    assert.ok(keep(f), `${f} must be uploaded`);
  }
  assert.ok(isStatic("index.html") && isStatic("landing.html"), "`/app` and `/` targets must be static");
  const rewrites = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")).rewrites;
  for (const r of rewrites) {
    if (r.destination.startsWith("/api/")) continue;
    const target = r.destination.replace(/^\//, "");
    assert.ok(keep(target) && isStatic(target), `rewrite destination ${r.destination} must be deployed and static`);
  }
});

test("4 Financial Core browser bundle paths (C1: /fincore/v1/**) are uploaded and served", () => {
  for (const f of ["fincore/v1/MANIFEST.json", "fincore/v1/browser/marjinFinanceGlobal.js", "fincore/v1/finance/decimal.js", "fincore/v1/metrics/adapters/configCompat.js"]) {
    assert.ok(keep(f) && isStatic(f), `${f} must stay deployable`);
  }
});

test("5 every api/ function file is uploaded, and each scheduled route in vercel.json has an uploaded handler", () => {
  const entries = functionEntrypoints(FILES);
  assert.equal(entries.length, 12, `expected 12 functions, found ${entries.length}: ${entries.join(", ")}`);
  for (const e of entries) assert.ok(keep(e), `${e} must be uploaded`);
  const crons = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")).crons;
  assert.equal(crons.length, 4);
  for (const c of crons) {
    const base = c.path.replace(/^\//, "");
    const handler = entries.find((e) => e === `${base}.ts` || e === `${base}.js`);
    assert.ok(handler, `cron ${c.path} has no handler file`);
    assert.ok(keep(handler), `cron handler ${handler} must be uploaded`);
  }
});

test("6 the transitive import closure of every function (nft trace) is uploaded — nothing a function needs is excluded", async () => {
  const entries = functionEntrypoints(FILES);
  const missing = [];
  let traced = 0;
  const seen = new Set();
  for (const e of entries) {
    const files = await traceFunction(e);
    assert.ok(files.includes(e), `trace of ${e} must include the entrypoint`);
    for (const f of files) {
      seen.add(f);
      if (!keep(f)) missing.push(`${e} → ${f}`);
    }
    traced += files.length;
  }
  assert.deepEqual(missing, [], "a traced runtime file is excluded by .vercelignore");
  assert.ok(traced > 100, `trace looks too small (${traced})`);
  // The closure reaches the auth, scheduled-job, analytics, snapshot, proactive and alerts code.
  for (const f of [
    "lib/verifyToken.js", "lib/helpers.js", "lib/adminSdk.js", "lib/securityContext.js", "lib/ownerGuard.js", "lib/bizAccess.js",
    "src/analytics/dailyBuilder.ts", "src/snapshot/snapshotBuilder.ts", "src/snapshot/snapshotEmail.ts",
    "src/agent/proactive/runProactiveJob.ts", "src/alerts/runner.ts", "src/firebase/admin.ts",
    "lib/proactiveCore.js", "lib/alertsCore.js", "lib/sendEmail.js", "package.json",
  ]) assert.ok(seen.has(f), `expected ${f} in the traced closure`);
  // Runtime modules never reach excluded roots.
  for (const f of seen) assert.ok(RUNTIME_TOP.has(topOf(f)), `traced file outside the runtime roots: ${f}`);
});

test("7 whole runtime directories are uploaded except the never-upload patterns (type declarations and JSON fixtures imported by src stay for the TS build)", () => {
  for (const f of FILES.filter((x) => ["api", "src", "lib"].includes(topOf(x)))) {
    const neverUpload = /\.test\.[^/]+$/.test(f);
    assert.equal(keep(f), !neverUpload, `${f}: unexpected upload decision`);
  }
  assert.ok(keep("lib/verifyToken.d.ts") || !FILES.includes("lib/verifyToken.d.ts"));
  assert.ok(keep("src/pos/__fixtures__/beecommDailySummary.sample.json"), "src/pos/mockAdapter.ts imports this JSON; excluding it could break TypeScript resolution");
});

test("8 non-runtime material is excluded: docs, tests, artifacts, tools, scripts, Rules, security notes, stray sources", () => {
  const bad = FILES.filter((f) => TOP_LEVEL.NOT_RUNTIME_REQUIRED.includes(topOf(f)) && keep(f));
  assert.deepEqual(bad, []);
  for (const f of [
    "docs/production-readiness/output/run-2026-09-29.json", "artifacts/p0-scheduled-auth-release/06_RELEASE_MANIFEST.md",
    "test/security/scheduled-auth-matrix.test.mjs", "tools/storage-v2/canary.mjs", "tools/storage-v2/CANARY_OPERATOR.md",
    "scripts/backfill-biz-access.mjs", "database.rules.json", "SECURITY.md", "admin.js", "api לבינה מלאכותית.png",
    "CREATED_FILES_SUMMARY.txt", ".vercelignore", "firebase.json", ".firebaserc", "tsconfig.finance-browser.json",
  ]) assert.equal(keep(f), false, `${f} must not be uploaded`);
});

test("9 secrets, environment, credential, key, log, editor and Git files are excluded everywhere, including inside allowed directories", () => {
  for (const f of [
    ".env", ".env.production", ".env.local", "api/.env", "src/.env.production.local", "lib/config/.env.staging",
    "service-account.json", "src/firebase/firebase-service-account.json", "lib/serviceAccountKey.json",
    "api/credentials.json", "src/google-credentials.json", "lib/tls/server.key", "src/certs/root.pem", "api/cert.p12", "lib/a.pfx", "src/x.crt",
    "api/debug.log", "npm-debug.log", "src/.DS_Store", "lib/.helpers.js.swp", "src/utils/math.ts~",
    ".git/config", ".gitignore", ".vercel/project.json", "node_modules/x/index.js", "secrets/prod.json", ".secrets/token",
    "local-evidence/ev1.json", "logs/cron.log",
  ]) assert.equal(keep(f), false, `${f} must not be uploaded`);
});

test("10 served-static set after hardening is limited to: the HTML entry points, fincore, deployment JSON config and server source under src/ and lib/ (documented residual)", () => {
  const s = surface(FILES, TEXT);
  const servedTop = [...new Set(s.served.map(topOf))].sort();
  const ALLOWED_SERVED = new Set(["index.html", "landing.html", "fincore", "lib", "src", "tsconfig.json", "vercel.json"]);
  assert.deepEqual(servedTop.filter((t) => !ALLOWED_SERVED.has(t)), [], "only browser entry points, fincore, deployment JSON and server source may be static");
  for (const t of ["index.html", "landing.html"]) assert.ok(servedTop.includes(t), `${t} must be served`);
  // Before hardening (no .vercelignore) the same model serves every non-api file.
  const before = surface(FILES.filter((f) => f !== ".vercelignore"), null);
  for (const f of ["docs", "test", "artifacts", "tools", "scripts", "database.rules.json", "SECURITY.md", "admin.js"]) {
    assert.ok(before.served.some((x) => topOf(x) === f), `negative control: ${f} is served without .vercelignore`);
  }
  assert.ok(before.served.length > s.served.length * 3, "the allowlist removes the bulk of the static surface");
});

test("11 the served set never contains a file whose name looks like a secret, even inside src/ or lib/", () => {
  const s = surface(FILES, TEXT);
  const suspicious = s.served.filter((f) => /(^|\/)(\.env|.*secret.*|.*password.*|.*credential.*|.*service-?account.*|id_rsa.*)$/i.test(f) || /\.(pem|key|p12|pfx|crt)$/i.test(f));
  assert.deepEqual(suspicious, []);
});
