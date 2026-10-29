// Offline model of what a Vercel deployment of this repository uploads, serves statically
// and bundles into functions. Test/harness only: nothing here talks to the network.
//
// The model uses the same building blocks Vercel uses:
//   • upload boundary — the CLI's default ignore list (vercel/vercel packages/client
//     getVercelIgnore) plus `.vercelignore`, evaluated with the `ignore` library (the
//     gitignore-semantics library that client uses);
//   • static output — zero-config preset "Other", no build command and no `public/`
//     directory: the static builder serves every uploaded file except VERCEL_PLATFORM_FILES
//     (vercel/vercel packages/fs-detectors detect-builders.ts getStaticFilesPattern);
//   • functions — every api/**/*.{js,ts} file whose path has no `/_` or `/.` segment,
//     each traced with @vercel/nft using the options @vercel/node passes
//     (base, processCwd, ts:true, mixedModules:true; TypeScript transpiled before analysis).
//
// Limits (documented in artifacts/p0-vercel-surface-hardening/04_LOCAL_PROOF.md): this is a
// model, not the Vercel build container. It cannot observe HTTP responses, Project
// Settings overrides, or build-service versions. Reachability is only claimed through
// Vercel's documented rule that the filesystem takes precedence over rewrites.

import { createRequire } from "node:module";
import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(join(ROOT, "package.json"));
const ignoreLib = require("ignore");
const minimatch = require("minimatch");

/** Vercel CLI default upload exclusions (packages/client getVercelIgnore). */
export const CLI_DEFAULT_IGNORES = Object.freeze([
  ".hg", ".git", ".gitmodules", ".svn", ".cache", ".next", ".now", ".vercel", ".npmignore",
  ".dockerignore", ".gitignore", ".*.swp", ".DS_Store", ".wafpicke-*", ".lock-wscript",
  ".env.local", ".env.*.local", ".venv", ".yarn/cache", ".pnp*", "npm-debug.log", "config.gypi",
  "node_modules", "__pycache__", "venv", "CVS",
]);

/** Files the zero-config static builder never serves (fs-detectors VERCEL_PLATFORM_FILES). */
export const VERCEL_PLATFORM_FILES = Object.freeze([
  "api/**", "node_modules/**", "middleware.[jt]s", "package.json", "package-lock.json", "yarn.lock",
  "pnpm-lock.yaml", "bun.lock", "bun.lockb", ".gitignore", "README.md",
]);

/**
 * Classification of every top-level entry of the repository. A new top-level entry that is
 * not listed here fails the surface test: it must be classified (and, if it is a runtime
 * input, allowed in .vercelignore) before it can ship.
 */
export const TOP_LEVEL = Object.freeze({
  PUBLIC_RUNTIME_REQUIRED: ["index.html", "landing.html", "app.html", "app.js", "fincore"], // app.html + app.js: generated from index.html by tools/app-precompile
  SERVER_BUNDLE_REQUIRED: ["api", "src", "lib"],
  DEPLOYMENT_METADATA_REQUIRED: ["vercel.json", "package.json", "package-lock.json", "tsconfig.json"],
  NOT_RUNTIME_REQUIRED: [
    "test", "docs", "artifacts", "tools", "scripts", "database.rules.json", "SECURITY.md",
    "CREATED_FILES_SUMMARY.txt", "admin.js", "api לבינה מלאכותית.png", ".vercelignore",
    "tsconfig.finance-browser.json",
  ],
});

/** Every file under `root`, relative, POSIX separators, skipping .git and node_modules trees. */
export function walkFiles(root = ROOT) {
  const out = [];
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      if (dir === root && (name === ".git" || name === "node_modules")) continue;
      const abs = join(dir, name);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) { out.push(relative(root, abs).split(sep).join("/")); continue; }
      if (st.isDirectory()) rec(abs);
      else out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  rec(root);
  return out.sort();
}

/** Build the upload filter from a .vercelignore text (null ⇒ no .vercelignore). */
export function uploadFilter(vercelignoreText) {
  const ig = ignoreLib().add(CLI_DEFAULT_IGNORES);
  if (typeof vercelignoreText === "string") ig.add(vercelignoreText);
  return (rel) => !ig.ignores(rel);
}

export function readVercelignore(root = ROOT) {
  const p = join(root, ".vercelignore");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Would `rel` be uploaded? */
export const isUploaded = (rel, vercelignoreText = readVercelignore()) => uploadFilter(vercelignoreText)(rel);

/** Would an uploaded file be served statically (preset Other, no build, no public/)? */
export function isStatic(rel) {
  return !VERCEL_PLATFORM_FILES.some((g) => minimatch(rel, g, { dot: true }));
}

/** Function entrypoints under api/ (zero-config detection). */
export function functionEntrypoints(files) {
  return files.filter((f) => /^api\/.+\.(?:js|mjs|cjs|ts)$/.test(f) && !f.endsWith(".d.ts") && !/\/[_.]/.test(f.slice(3)));
}

/** Project (non-node_modules) files @vercel/nft traces for one entrypoint. */
export async function traceFunction(entry, root = ROOT) {
  const { nodeFileTrace } = require("@vercel/nft");
  const ts = require("typescript");
  const { fileList } = await nodeFileTrace([join(root, entry)], {
    base: root, processCwd: root, ts: true, mixedModules: true,
    async readFile(p) {
      try {
        let s = readFileSync(p);
        if ((p.endsWith(".ts") && !p.endsWith(".d.ts")) || p.endsWith(".tsx")) {
          s = ts.transpileModule(s.toString(), { fileName: p, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
        }
        return s;
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "EISDIR")) return null;
        throw err;
      }
    },
  });
  return [...fileList].filter((f) => f !== "node_modules" && !f.startsWith("node_modules/")).map((f) => f.split(sep).join("/")).sort();
}

/** Full surface model of `files` under a given .vercelignore text. */
export function surface(files, vercelignoreText) {
  const keep = uploadFilter(vercelignoreText);
  const uploaded = files.filter(keep);
  const served = uploaded.filter(isStatic);
  return { uploaded, served, excluded: files.filter((f) => !keep(f)) };
}

// CLI: node test/support/vercel-surface.mjs [--base] <path>…
//   prints UPLOADED/EXCLUDED and STATIC/NOT_STATIC for each path under the current
//   .vercelignore (or with --base, as if there were no .vercelignore).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args[0] === "--base";
  const paths = base ? args.slice(1) : args;
  const text = base ? null : readVercelignore();
  for (const p of paths) {
    const up = uploadFilter(text)(p);
    console.log(`${p}\t${up ? "UPLOADED" : "EXCLUDED"}\t${up && isStatic(p) ? "STATIC(served)" : up ? "FUNCTION/PLATFORM(not static)" : "-"}`);
  }
}
