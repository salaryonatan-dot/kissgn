// Marjin — S0 anti-migration guard, LAYER B: the APPROVED SERVER-READER FILES pinned by
// EXACT CONTENT IDENTITY (git blob SHA-1 of the reviewed bytes).
//
// (The file keeps its R0 name for import stability; R0 pinned a normalized line delta,
// which Codex SR-F2 showed accepts a relocated declaration that changes execution
// semantics. R1 replaces that model entirely — nothing here inspects diff lines.)
//
// Layer A of the guard (test/finance/vat-invariant.test.mjs) keeps the historical S0
// contract intact for the whole range BASE (686b4350) → the Codex-approved Storage V2
// core (8cac71c1): no change under src/analytics/, src/repositories/, src/agent/,
// src/snapshot/, src/forecast/, package files, vercel.json or stored-data scripts, and
// database.rules.json only through the semantic entries-contract exception.
//
// Layer B (this module) authorizes the P0-DATA-01 server-reader convergence on top of
// that core, and it authorizes it by IDENTITY, never by path and never by content
// heuristics: for each of exactly five named files the working-tree bytes must hash to
// the pinned blob of the reviewed version. The guard therefore proves "this protected
// file IS the reviewed version" — a relocated declaration, reordered statements, an extra
// statement, a partial revert, a touched formula, even a changed comment or whitespace,
// all produce a different blob and are rejected. Any other protected path that changes
// is rejected. Directories, globs and patterns are not accepted as authorized entries.
//
// Re-approving a change to one of these files REQUIRES re-pinning its blob here in the
// same reviewed change — that is the point.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gitIn } from "./git-context.mjs";

/** The Codex-approved Storage V2 core; the reader files are authorized on top of it. */
export const SERVER_READER_BASE = "8cac71c1248ad5cc49dfa1a727bf292398ae74e8";

/** Protected roots under which a change is otherwise forbidden by the S0 guard. */
export const PROTECTED_ROOTS = Object.freeze([
  /^src\/analytics\//, /^src\/repositories\//, /^src\/agent\//, /^src\/snapshot\//, /^src\/forecast\//,
  /^database\.rules\.json$/, /^vercel\.json$/, /^package(?:-lock)?\.json$/, /(?:^|\/)(?:migration|migrations|scripts)\//i,
]);
export const isProtectedPath = (rel) => PROTECTED_ROOTS.some((re) => re.test(rel));

/**
 * An authorized entry must name ONE TypeScript source file by its exact repository-
 * relative path under a protected src root: no directory, no trailing slash, no glob or
 * regex metacharacters, no `..`, no leading slash. `src/agent/**` and `src/forecast/**` are
 * never authorizable here (R1 changed no agent file; a future review that must pin one
 * exact detector file has to widen THIS rule in the same reviewed change).
 */
export function isPlainAuthorizedFile(rel) {
  if (typeof rel !== "string" || !rel) return false;
  if (/[*?[\]{}()|^$\\]/.test(rel)) return false;
  if (rel.startsWith("/") || rel.endsWith("/") || rel.includes("..") || rel.includes("//")) return false;
  if (!/\.ts$/.test(rel)) return false;
  return /^src\/(?:analytics|repositories|snapshot)\/[A-Za-z0-9_./-]+\.ts$/.test(rel);
}

/** git blob identity of a byte buffer: sha1("blob <len>\0" + bytes). */
export function blobSha(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}
const SHA1_RE = /^[0-9a-f]{40}$/;

/**
 * Exactly the files the CTO authorized for the server-reader slice, each pinned to the
 * blob of its REVIEWED bytes. Nothing under a directory.
 *
 * Financial Core B1 re-pin (canonical server metrics): dailyBuilder, dailyMetricsRepo,
 * laborRepo and purchasesRepo now serve their financial values through the canonical
 * server API (src/finance-server/*). Previous pins (P0-DATA-01 R2): dailyBuilder a327186c,
 * dailyMetricsRepo 301f9599, laborRepo 33a646e9, purchasesRepo 6a3f9be2. The snapshot pin
 * is unchanged (B2 owns snapshotBuilder).
 */
export const SERVER_READER_APPROVED_BLOBS = Object.freeze({
  "src/analytics/dailyBuilder.ts": "ecaa53337fd2ba60fc8abd8a0cae708a87ba8cdc",
  "src/repositories/analytics/dailyMetricsRepo.ts": "b04e0193196f50057cb1214f05c0cb47078af0ee",
  "src/repositories/analytics/laborRepo.ts": "78f35d558a40a23719124b22c9ad26561fab8da0",
  "src/repositories/analytics/purchasesRepo.ts": "d5f0a1eeeac9c0999a71cf91cdb6647c11ac572b",
  "src/snapshot/snapshotBuilder.ts": "e36df4d83d945d16e158dacc82b12ce2500f9956",
});
export const SERVER_READER_AUTHORIZED_FILES = Object.freeze(Object.keys(SERVER_READER_APPROVED_BLOBS));

/**
 * Pure verdict. Inputs:
 *   changedProtectedPaths — protected paths that differ between SERVER_READER_BASE and the
 *                           working tree;
 *   blobs                 — { [rel]: blob sha of the working-tree bytes } for every
 *                           authorized file (missing ⇒ treated as absent → mismatch);
 *   baseBlobs             — { [rel]: blob sha at SERVER_READER_BASE } (optional); a pin equal
 *                           to the base blob means the file is not a reviewed change and
 *                           must not be listed;
 *   authorized            — the pin table (defaults to the one above; mutation tests pass
 *                           altered tables to prove the checks bite).
 * Returns { ok:true } or { ok:false, reason, detail }.
 */
export function serverReaderScopeVerdict({ changedProtectedPaths, blobs, baseBlobs, authorized = SERVER_READER_APPROVED_BLOBS }) {
  const keys = Object.keys(authorized || {});
  if (keys.length === 0) return { ok: false, reason: "empty_allowlist" };
  for (const k of keys) {
    if (!isPlainAuthorizedFile(k)) return { ok: false, reason: "invalid_allowlist_entry", detail: k };
    if (typeof authorized[k] !== "string" || !SHA1_RE.test(authorized[k])) return { ok: false, reason: "invalid_pin", detail: k };
    if (baseBlobs && baseBlobs[k] === authorized[k]) return { ok: false, reason: "pin_equals_base", detail: k };
  }
  const changed = Array.from(new Set(changedProtectedPaths || []));
  const stray = changed.filter((rel) => isProtectedPath(rel) && !Object.prototype.hasOwnProperty.call(authorized, rel)).sort();
  if (stray.length) return { ok: false, reason: "unauthorized_protected_path", detail: stray };
  for (const k of keys) {
    const actual = (blobs || {})[k];
    if (actual !== authorized[k]) {
      return { ok: false, reason: "approved_content_mismatch", detail: { file: k, expected: authorized[k], actual: actual ?? null } };
    }
  }
  return { ok: true };
}

/** Collect the real inputs from the working tree at `root` (blobs) and git (paths, base blobs). */
export function collectServerReaderScopeInputs(root, base = SERVER_READER_BASE) {
  const names = gitIn(root, ["diff", "--name-only", base, "--"]);
  if (names.status !== 0) throw new Error("git diff --name-only failed: " + names.stderr);
  const changedAll = names.stdout.trim().split(/\n/).filter(Boolean);
  const changedProtectedPaths = changedAll.filter(isProtectedPath);
  const blobs = {}, baseBlobs = {};
  for (const rel of SERVER_READER_AUTHORIZED_FILES) {
    let bytes = null;
    try { bytes = readFileSync(join(root, rel)); } catch { bytes = null; }
    blobs[rel] = bytes === null ? null : blobSha(bytes);
    const b = gitIn(root, ["rev-parse", `${base}:${rel}`]);
    baseBlobs[rel] = b.status === 0 ? b.stdout.trim() : null;
  }
  return { changedAll, changedProtectedPaths, blobs, baseBlobs };
}
