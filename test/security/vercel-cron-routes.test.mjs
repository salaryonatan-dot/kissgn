// Static config guard: every Vercel cron path must resolve to an API route file.
// Run: node --test test/security/vercel-cron-routes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function routeExists(path) {
  assert.ok(path.startsWith("/api/"), `cron path must be under /api: ${path}`);
  const rel = path.slice("/api/".length);
  const candidates = [
    join(ROOT, "api", `${rel}.js`),
    join(ROOT, "api", `${rel}.ts`),
    join(ROOT, "api", rel, "index.js"),
    join(ROOT, "api", rel, "index.ts"),
  ];
  return candidates.some((p) => existsSync(p));
}

test("vercel cron declarations reference existing API route files", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.ok(Array.isArray(vercel.crons), "vercel.json crons must be an array");
  for (const cron of vercel.crons) {
    assert.equal(typeof cron.path, "string");
    assert.ok(routeExists(cron.path), `missing API route for cron path ${cron.path}`);
  }
});

test("dead whatsapp-daily cron remains removed", () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  assert.ok(!vercel.crons.some((c) => c.path === "/api/whatsapp-daily"));
});
