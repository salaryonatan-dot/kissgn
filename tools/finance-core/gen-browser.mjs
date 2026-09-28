#!/usr/bin/env node
// Generates the committed browser artifact of the Financial Core (fincore/v1) from the
// SAME TypeScript sources the server compiles. Deterministic: pinned TypeScript from the
// lockfile, fixed tsconfig, LF newlines, sorted manifest. Never edit fincore/v1 by hand;
// test/finance/fincore-guards.test.mjs (G-B1) regenerates and byte-compares it.
//
//   node tools/finance-core/gen-browser.mjs            write fincore/v1
//   node tools/finance-core/gen-browser.mjs --out DIR  write elsewhere (used by the test)
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const GENERATOR_VERSION = 1;
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function closureSources(repo = REPO) {
  // The browser closure = every file reachable from src/browser/marjinFinanceGlobal.ts.
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = readFileSync(join(repo, rel), "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.{1,2}\/[^"]+)\.js"/gm)) {
      const target = join(dirname(rel), m[1] + ".ts").split(sep).join("/");
      visit(target);
    }
  };
  visit("src/browser/marjinFinanceGlobal.ts");
  return [...seen].sort();
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs, base));
    else out.push(relative(base, abs).split(sep).join("/"));
  }
  return out;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function generate({ repo = REPO, outDir = join(REPO, "fincore", "v1") } = {}) {
  const tsc = join(repo, "node_modules", "typescript", "bin", "tsc");
  const tsVersion = JSON.parse(readFileSync(join(repo, "node_modules", "typescript", "package.json"), "utf8")).version;
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(process.execPath, [tsc, "-p", join(repo, "tsconfig.finance-browser.json"), "--outDir", outDir], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error("tsc failed:\n" + r.stdout + r.stderr);
  const sources = closureSources(repo);
  const sourceDigest = sha256(sources.map((p) => p + "\u0000" + sha256(readFileSync(join(repo, p)))).join("\n"));
  const files = listFiles(outDir).filter((p) => p !== "MANIFEST.json").map((p) => ({ path: p, sha256: sha256(readFileSync(join(outDir, p))) }));
  const manifest = { generator: GENERATOR_VERSION, typescript: tsVersion, entry: "browser/marjinFinanceGlobal.js", sources, sourceDigest, files };
  writeFileSync(join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--out");
  const m = generate(i > 0 ? { outDir: process.argv[i + 1] } : {});
  console.log("fincore generated: " + m.files.length + " files, sourceDigest " + m.sourceDigest);
}
