// Part 1 — structural parity between each lib/*.js runtime module and its
// adjacent .d.ts: every VALUE export (function/const) declared in the .d.ts
// exists at runtime, and every runtime export is declared. Type-only exports
// (interface/type) are excluded. No external calls (modules only define fns on import).
//
// Run: node --test test/typescript/js-declaration-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function declaredValueExports(dtsRel) {
  const src = readFileSync(join(ROOT, dtsRel), "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:declare\s+)?function\s+([A-Za-z0-9_]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:declare\s+)?const\s+([A-Za-z0-9_]+)/g)) names.add(m[1]);
  return names;
}

const PAIRS = [
  ["lib/adminSdk.js", "lib/adminSdk.d.ts"],
  ["lib/verifyToken.js", "lib/verifyToken.d.ts"],
  ["lib/helpers.js", "lib/helpers.d.ts"],
  ["lib/sendEmail.js", "lib/sendEmail.d.ts"],
  ["lib/analytics/sources.js", "lib/analytics/sources.d.ts"],
  ["lib/memoryInsightType.js", "lib/memoryInsightType.d.ts"],
  ["lib/llmResponse.js", "lib/llmResponse.d.ts"],
];

for (const [jsRel, dtsRel] of PAIRS) {
  test(`parity: ${jsRel} runtime exports === ${dtsRel} declared value exports`, async () => {
    const mod = await import(join(ROOT, jsRel));
    const runtime = new Set(Object.keys(mod).filter((k) => k !== "default"));
    const declared = declaredValueExports(dtsRel);
    // every declared value export exists at runtime
    for (const name of declared) {
      assert.ok(runtime.has(name), `${dtsRel} declares ${name} but ${jsRel} does not export it`);
      assert.ok(typeof mod[name] === "function" || typeof mod[name] === "object" || typeof mod[name] !== "undefined",
        `${name} exists`);
    }
    // every runtime export is declared (no undocumented exports, none invented)
    for (const name of runtime) {
      assert.ok(declared.has(name), `${jsRel} exports ${name} but ${dtsRel} does not declare it`);
    }
    assert.deepEqual([...runtime].sort(), [...declared].sort());
  });
}

test("adminSdk declares getAdminDb/getAdminAuth as functions", async () => {
  const m = await import(join(ROOT, "lib/adminSdk.js"));
  assert.equal(typeof m.getAdminDb, "function");
  assert.equal(typeof m.getAdminAuth, "function");
});

test("helpers VALID_ROLES is a Set at runtime (matches `export const` declaration)", async () => {
  const m = await import(join(ROOT, "lib/helpers.js"));
  assert.ok(m.VALID_ROLES instanceof Set);
});
