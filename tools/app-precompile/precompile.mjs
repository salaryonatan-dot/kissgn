#!/usr/bin/env node
// Marjin — browser app precompile (perf task #1: Dashboard load time).
//
// index.html stays the SOURCE page (guards, harnesses and reviews keep anchoring on it). Its React
// app is one inline <script type="text/babel" data-presets="react"> block that every page load used
// to compile in the browser with @babel/standalone (≈1.3 s of blocked main thread on a desktop Mac,
// several seconds on a phone, plus the 2.9 MB babel.min.js download on a cold cache).
//
// This tool performs that exact compilation once, ahead of time, with the SAME pinned package
// (@babel/standalone 7.23.6) and the SAME options @babel/standalone's transformScriptTags uses for
// data-presets="react" (presets ["react"], its default plugin list, filename "Inline Babel script"),
// minus the inline source map (a trailing comment, no runtime effect). The compiled code is
// byte-identical to what the browser produced (verified against the live page, sha256
// 2a20a654d83d697b88a828b7c26c02da9d8cc8f234e48e9f5e91ce2009402b60 for index.html 8c0a0c33…).
//
// Outputs (served page; both generated, never edited by hand):
//   app.js    — the compiled app code, a classic script (global scope, non-strict, like the
//               element @babel/standalone injected).
//   app.html  — index.html with (1) the babel.min.js <script> tag removed and (2) the text/babel
//               block replaced by <script defer src="/app.js?v=…">. `defer` keeps the original
//               execution point: after the page's deferred <script type="module"> blocks have
//               started, right before DOMContentLoaded — where @babel/standalone ran the app.
//
// Usage (from the repo root, after `npm ci` in tools/app-precompile):
//   node tools/app-precompile/precompile.mjs            # (re)generate app.html + app.js
//   node tools/app-precompile/precompile.mjs --check    # exit 2 if app.html/app.js ≠ build(index.html)
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.MARJIN_ROOT || join(here, "..", "..");
const require = createRequire(import.meta.url);
const Babel = require("@babel/standalone");
export const BABEL_VERSION = "7.23.6";
if (Babel.version !== BABEL_VERSION) throw new Error(`@babel/standalone ${Babel.version} installed, ${BABEL_VERSION} required`);

const BABEL_TAG = `  <script src="https://unpkg.com/@babel/standalone@${BABEL_VERSION}/babel.min.js"></script>\n`;
const OPEN = `  <script type="text/babel" data-presets="react">`;
const CLOSE = `  </script>\n</body>`;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Pure: index.html text → { appHtml, appJs, srcSha, codeSha }. Throws on any unexpected shape. */
export function build(indexHtml) {
  const tagCount = indexHtml.split(BABEL_TAG).length - 1;
  if (tagCount !== 1) throw new Error(`expected exactly one babel.min.js tag, found ${tagCount}`);
  const start = indexHtml.indexOf(OPEN);
  if (start < 0 || indexHtml.indexOf(OPEN, start + 1) >= 0) throw new Error("expected exactly one text/babel block");
  const end = indexHtml.indexOf(CLOSE, start);
  if (end < 0) throw new Error("the text/babel block must be the last script before </body>");
  const jsx = indexHtml.slice(start + OPEN.length, end);
  // Exactly the options @babel/standalone transformScriptTags builds for data-presets="react".
  const appJs = Babel.transform(jsx, {
    filename: "Inline Babel script",
    presets: ["react"],
    plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
    sourceMaps: false,
    sourceFileName: "Inline Babel script",
  }).code; // no trailing newline: byte-identical to the code @babel/standalone injected in the browser
  const srcSha = sha256(indexHtml);
  const codeSha = sha256(appJs);
  const block =
    `  <!-- app.html and app.js are GENERATED from index.html by tools/app-precompile/precompile.mjs — do not edit.\n` +
    `       source index.html sha256 ${srcSha}; app.js sha256 ${codeSha}; @babel/standalone ${BABEL_VERSION}, presets ["react"]. -->\n` +
    `  <script defer src="/app.js?v=${codeSha.slice(0, 12)}"></script>\n</body>`;
  const before = indexHtml.slice(0, start).replace(BABEL_TAG, "");
  const after = indexHtml.slice(end + CLOSE.length);
  return { appHtml: before + block + after, appJs, srcSha, codeSha };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const indexPath = join(root, "index.html"), htmlPath = join(root, "app.html"), jsPath = join(root, "app.js");
  const { appHtml, appJs, srcSha, codeSha } = build(readFileSync(indexPath, "utf8"));
  const line = (k, v) => console.log(`${k.padEnd(20)} ${v}`);
  line("index.html sha256", srcSha);
  line("app.js sha256", codeSha);
  line("app.js chars", appJs.length);
  line("app.html sha256", sha256(appHtml));
  if (check) {
    const okHtml = readFileSync(htmlPath, "utf8") === appHtml, okJs = readFileSync(jsPath, "utf8") === appJs;
    if (!okHtml || !okJs) { console.error(`CHECK FAILED: ${!okHtml ? "app.html " : ""}${!okJs ? "app.js " : ""}is not the build of index.html — run precompile.mjs`); process.exit(2); }
    console.log("CHECK OK: app.html and app.js == build(index.html)");
  } else {
    writeFileSync(htmlPath, appHtml); writeFileSync(jsPath, appJs);
    line("written", `${htmlPath}, ${jsPath}`);
  }
}
