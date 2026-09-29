// Financial Core — AMEND-02 per-slice core-consumer allowlist (data + pure validator).
//
// Every slice that makes a runtime file load the Financial Core adds ONE data file
// `test/finance/core-consumers/<slice>.json` = {slice, consumers[], serverApiConsumers[]}.
// fincore-guards G-B2 reads the UNION of those files; later slices add their own file and
// never edit the guard. This module is pure (no test registration) so the mutation tests
// (b1-guards G2-*) can exercise the exact validator the guard uses.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SLICES = Object.freeze(["B1", "B2", "C1", "C2", "F1", "F2", "D", "E", "P1", "P2"]);
/** Slices allowed to list `index.html` (browser surfaces start at C1). */
export const INDEX_HTML_SLICES = Object.freeze(["C1", "C2", "F1", "F2", "D", "E", "P1", "P2"]);
export const ALLOWED_KEYS = Object.freeze(["slice", "consumers", "serverApiConsumers"]);
export const CORE_DIRS = Object.freeze(["src/finance", "src/metrics", "src/policy", "src/presenters", "src/browser"]);
export const SERVER_API_DIR = "src/finance-server";

const SPEC = String.raw`["']([^"']+)["']`;
const IMPORT_RES = [new RegExp(String.raw`(?:import|export)\s[^;]*?from\s+` + SPEC, "g"), new RegExp(String.raw`import\(\s*` + SPEC, "g"), new RegExp(String.raw`^\s*import\s+` + SPEC, "gm")];
/** Import specifiers of a source file (static, re-export, side-effect and dynamic). */
export function importSpecifiers(src) {
  const out = new Set();
  for (const re of IMPORT_RES) for (const m of String(src).matchAll(re)) out.add(m[1]);
  return [...out];
}
export const importsCore = (src) => importSpecifiers(src).some((s) => /(?:^|\/)(?:finance|metrics|policy|presenters|browser)\//.test(s)) || /fincore|MarjinFinance/.test(src);
export const importsServerApi = (src) => importSpecifiers(src).some((s) => /(?:^|\/)finance-server\//.test(s));

/** An entry must be ONE existing file by exact repo-relative path (no glob, no directory, no `..`). */
export function entryProblem(rel, kindOf) {
  if (typeof rel !== "string" || !rel) return "not_a_string";
  if (/[*?[\]{}()|^$\\]/.test(rel)) return "glob";
  if (rel.startsWith("/") || rel.endsWith("/") || rel.includes("..") || rel.includes("//") || rel.startsWith("./")) return "not_exact_path";
  const kind = kindOf(rel);
  if (kind === "dir") return "directory";
  if (kind !== "file") return "missing_file";
  return null;
}

/**
 * Pure validation of the allowlist files. `files` = [{name, json}] (json = parsed value or a
 * parse error marker {__parseError}); `kindOf(rel)` → "file" | "dir" | null.
 * Returns {ok, errors[], consumers:Set, serverApiConsumers:Set}.
 */
export function validateConsumerFiles(files, kindOf) {
  const errors = [];
  const consumers = new Set(), serverApiConsumers = new Set(), seen = new Map();
  for (const { name, json } of files) {
    if (!json || typeof json !== "object" || Array.isArray(json) || json.__parseError) { errors.push(`${name}: not a JSON object`); continue; }
    const slice = json.slice;
    if (!SLICES.includes(slice)) { errors.push(`${name}: unknown slice ${JSON.stringify(slice)}`); continue; }
    if (name !== `${slice.toLowerCase()}.json`) errors.push(`${name}: file name must be ${slice.toLowerCase()}.json`);
    for (const k of Object.keys(json)) if (!ALLOWED_KEYS.includes(k)) errors.push(`${name}: unknown key ${k}`);
    for (const key of ["consumers", "serverApiConsumers"]) {
      const list = json[key] === undefined ? [] : json[key];
      if (!Array.isArray(list)) { errors.push(`${name}: ${key} must be an array`); continue; }
      for (const rel of list) {
        const p = entryProblem(rel, kindOf);
        if (p) { errors.push(`${name}: ${key} entry ${JSON.stringify(rel)}: ${p}`); continue; }
        if (rel === "index.html" && !INDEX_HTML_SLICES.includes(slice)) errors.push(`${name}: index.html may be listed only by a slice >= C1`);
        const tag = key + ":" + rel;
        if (seen.has(tag)) { errors.push(`${name}: duplicate ${key} entry ${rel} (also in ${seen.get(tag)})`); continue; }
        seen.set(tag, name);
        (key === "consumers" ? consumers : serverApiConsumers).add(rel);
      }
    }
  }
  return { ok: errors.length === 0, errors, consumers, serverApiConsumers };
}

/**
 * Pure importer verdict: every non-core file that loads the core must be a listed consumer;
 * every file outside src/finance-server that imports the server API must be a listed
 * serverApiConsumer. `sources` = {[rel]: text}.
 */
export function importerVerdict(sources, { consumers, serverApiConsumers }) {
  const unlistedCore = [], unlistedServer = [];
  for (const [rel, src] of Object.entries(sources)) {
    if (CORE_DIRS.some((d) => rel.startsWith(d + "/"))) continue;
    if (importsCore(src) && !consumers.has(rel)) unlistedCore.push(rel);
    if (!rel.startsWith(SERVER_API_DIR + "/") && importsServerApi(src) && !serverApiConsumers.has(rel)) unlistedServer.push(rel);
  }
  return { ok: unlistedCore.length === 0 && unlistedServer.length === 0, unlistedCore: unlistedCore.sort(), unlistedServer: unlistedServer.sort() };
}

/** Real inputs from the repository. */
export function loadConsumerFiles(repo) {
  const dir = join(repo, "test", "finance", "core-consumers");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
  return names.map((name) => { try { return { name, json: JSON.parse(readFileSync(join(dir, name), "utf8")) }; } catch { return { name, json: { __parseError: true } }; } });
}
export const repoKindOf = (repo) => (rel) => { const p = join(repo, rel); if (!existsSync(p)) return null; return statSync(p).isDirectory() ? "dir" : "file"; };
