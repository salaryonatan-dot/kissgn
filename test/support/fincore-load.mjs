// Loads the Financial Core twice: (a) freshly compiled from src/** into a temp dir with
// the same generator the artifact uses, and (b) the COMMITTED browser artifact fincore/v1.
// Golden/contract tests run against both, so the committed artifact can never drift from
// the source without a test failure.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generate } from "../../tools/finance-core/gen-browser.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let compiledDir = null;
export function compileFresh() {
  if (!compiledDir) {
    compiledDir = mkdtempSync(join(tmpdir(), "fincore-"));
    generate({ repo: REPO, outDir: compiledDir });
  }
  return compiledDir;
}

async function loadFrom(dir) {
  const mod = await import(pathToFileURL(join(dir, "browser", "marjinFinanceGlobal.js")).href);
  return mod.default;
}

export async function loadCompiled() {
  return loadFrom(compileFresh());
}

export async function loadCommitted() {
  return loadFrom(join(REPO, "fincore", "v1"));
}

export async function bothCores() {
  return [["compiled", await loadCompiled()], ["committed", await loadCommitted()]];
}
