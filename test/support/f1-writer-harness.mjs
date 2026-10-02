// F1 R1 test support: the REAL lib/finance/costHistoryWriter.js + lib/securityContext.js + lib/helpers.js
// with ONLY the Admin-SDK and token seams replaced (globalThis.__DB / __CLAIMS).
import { mkdtempSync, writeFileSync, readFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
/** `mutations` (guard mutation tests only): [[relativePath, from, to], ...] applied to the disposable copy;
 *  each `from` must occur exactly once. `entry` selects the module to import (default: the writer). */
export async function loadWriter(root, { mutations = [], entry = "lib/finance/costHistoryWriter.js" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "f1w-"));
  cpSync(join(root, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "fincore"), { recursive: true });
  cpSync(join(root, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return {}; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n`);
  for (const [rel, from, to] of mutations) {
    const f = join(dir, rel), src = readFileSync(f, "utf8");
    if (src.split(from).length !== 2) throw new Error("mutation anchor not unique in " + rel + ": " + from);
    writeFileSync(f, src.replace(from, to));
  }
  return import(pathToFileURL(join(dir, entry)).href);
}
