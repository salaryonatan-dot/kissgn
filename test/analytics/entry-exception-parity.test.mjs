// Parity: the TS analytics resolver (src/analytics/dailyBuilder.ts) must agree with
// the JS canonical (lib/entryExceptions.js) on structured-first effective resolution.
//   Run: node test/analytics/entry-exception-parity.test.mjs   (needs TSC_BIN or npm i)
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert";
import { resolveEffectiveException as jsResolve } from "../../lib/entryExceptions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(TSC)) { console.error("typescript not found at", TSC); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "ee-parity-"));
mkdirSync(join(dir, "src", "insights"), { recursive: true });
mkdirSync(join(dir, "src", "analytics"), { recursive: true });
mkdirSync(join(dir, "src", "firebase"), { recursive: true });
for (const f of ["types.ts", "baselines.ts", "rules.ts", "buildInsights.ts"])
  copyFileSync(join(REPO, "src", "insights", f), join(dir, "src", "insights", f));
copyFileSync(join(REPO, "src", "analytics", "dailyBuilder.ts"), join(dir, "src", "analytics", "dailyBuilder.ts"));
writeFileSync(join(dir, "src", "firebase", "admin.js"), `export function getDb(){ return globalThis.__DB; }`);
writeFileSync(join(dir, "src", "analytics", "regionResolver.js"), `export function resolveOrefAreas(){ return ["x"]; }`);
const r = spawnSync("node", [TSC, "--module","esnext","--target","es2020","--moduleResolution","bundler","--skipLibCheck","--noEmitOnError","false",
  join(dir,"src","insights","buildInsights.ts"), join(dir,"src","insights","rules.ts"), join(dir,"src","insights","baselines.ts"),
  join(dir,"src","analytics","dailyBuilder.ts")], { encoding: "utf8" });
if (!existsSync(join(dir,"src","analytics","dailyBuilder.js"))) { console.error("compile failed:\n", r.stdout, r.stderr); process.exit(2); }
const ts = await import(pathToFileURL(join(dir,"src","analytics","dailyBuilder.js")).href);
const tsResolve = ts.resolveEffectiveException;

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

const activeEnv = { state: { status: "active", reasonCode: "closure", reasonText: "storm", updatedAt: 5, updatedBy: "u1" } };
const clearedEnv = { state: { status: "cleared" } };
const fixtures = [
  ["structured active",        activeEnv,  { is_exception: false }],
  ["structured cleared",       clearedEnv, { is_exception: true }],
  ["structured absent+legacy", null,       { is_exception: true }],
  ["missing everywhere",       null,       { is_exception: false }],
  ["structured absent no leg", null,       null],
];
for (const [name, env, legacy] of fixtures) {
  T("parity: " + name, () => {
    const a = jsResolve(env, legacy);
    const b = tsResolve(env, legacy);
    assert.strictEqual(a.isException, b.isException, "isException");
    assert.strictEqual(a.origin, b.origin, "origin");
  });
}
T("TS exports resolveEffectiveException", () => assert.strictEqual(typeof tsResolve, "function"));

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
