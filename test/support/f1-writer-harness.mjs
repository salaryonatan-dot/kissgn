// F1 R1 test support: the REAL lib/finance/costHistoryWriter.js + lib/securityContext.js + lib/helpers.js
// with ONLY the Admin-SDK and token seams replaced (globalThis.__DB / __CLAIMS).
import { mkdtempSync, writeFileSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export async function loadWriter(root) {
  const dir = mkdtempSync(join(tmpdir(), "f1w-"));
  cpSync(join(root, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "fincore"), { recursive: true });
  cpSync(join(root, "fincore", "v1"), join(dir, "fincore", "v1"), { recursive: true });
  try { symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir"); } catch (_) {}
  writeFileSync(join(dir, "lib", "adminSdk.js"), `export function getAdminDb() { return globalThis.__DB; }\nexport function getAdminAuth() { return {}; }\n`);
  writeFileSync(join(dir, "lib", "verifyToken.js"), `export async function requireAuth() { if (!globalThis.__CLAIMS) throw new Error("no auth"); return globalThis.__CLAIMS; }\nexport async function verifyIdToken() { return globalThis.__CLAIMS; }\n`);
  return import(pathToFileURL(join(dir, "lib", "finance", "costHistoryWriter.js")).href);
}
