// M1 integration (local candidate; pending independent Codex review): the DERIVATION of every protected file of the
// integrated tree from the two independently approved inputs — Core/F1 R4 (M1_CORE_COMMIT, carrying F2 and the Vercel
// local carriage) and P1 R7 (M1_P1_COMMIT) — over their merge base (C1 R2, M1_MERGE_BASE).
//
// For a file changed on BOTH sides the integrated bytes must be EXACTLY `git merge-file -p <core> <base> <p1>` (the same
// 3-way text merge `git merge` performed), with each conflict block replaced by its RECORDED resolution
// (test/support/m1-merge-resolutions.json). A recorded resolution only applies to the exact conflict it was written for:
// both sides of every block are bound by SHA-256 and line count, and the number of blocks is fixed. Generated fincore
// files are derived by the committed deterministic generator (GUARD-08), not here. Everything is read from git
// objects (never the working tree) except the candidate bytes under test.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { M1_CORE_COMMIT, M1_P1_COMMIT, M1_MERGE_BASE } from "./m1-integration-pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const M1_RESOLUTIONS = JSON.parse(readFileSync(join(HERE, "m1-merge-resolutions.json"), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const blobOf = (root, spec) => { const r = spawnSync("git", ["-C", root, "cat-file", "blob", spec], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }); if (r.status !== 0) throw new Error("git object " + spec); return r.stdout; };

/** The raw 3-way merge (exit code + bytes with conflict markers labelled core / base / p1). */
export function mergeFile(root, file) {
  const dir = mkdtempSync(join(tmpdir(), "m1-derive-"));
  try {
    const put = (n, spec) => { const p = join(dir, n); writeFileSync(p, blobOf(root, spec)); return p; };
    const o = put("ours", `${M1_CORE_COMMIT}:${file}`), b = put("base", `${M1_MERGE_BASE}:${file}`), t = put("theirs", `${M1_P1_COMMIT}:${file}`);
    const r = spawnSync("git", ["merge-file", "-p", "-L", "core", "-L", "base", "-L", "p1", o, b, t], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, cwd: dir });
    if (r.status < 0 || r.status > 127 || r.error) throw new Error("merge-file failed for " + file);
    return { conflicts: r.status, bytes: r.stdout };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Derive the integrated bytes of `file`; returns { ok, bytes } or { ok:false, reason, detail }. */
export function deriveMerged(root, file, resolutions = M1_RESOLUTIONS) {
  const rec = resolutions[file];
  if (!rec) return { ok: false, reason: "no_recorded_derivation", detail: file };
  const { conflicts, bytes } = mergeFile(root, file);
  if (conflicts !== rec.conflicts) return { ok: false, reason: "conflict_count_changed", detail: [file, conflicts, rec.conflicts] };
  if (conflicts === 0) return { ok: true, bytes };
  const lines = bytes.toString("utf8").split("\n"), out = [];
  let k = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< core")) { out.push(lines[i]); continue; }
    const ours = [], theirs = [];
    for (i++; !lines[i].startsWith("======="); i++) ours.push(lines[i]);
    for (i++; !lines[i].startsWith(">>>>>>> p1"); i++) theirs.push(lines[i]);
    const b = rec.blocks[k++];
    if (!b) return { ok: false, reason: "unexpected_conflict_block", detail: [file, k] };
    if (sha(ours.join("\n")) !== b.ours_sha256 || sha(theirs.join("\n")) !== b.theirs_sha256 || ours.length !== b.ours_lines || theirs.length !== b.theirs_lines)
      return { ok: false, reason: "conflict_sides_changed", detail: [file, k] };
    // the recorded resolution replaces whole lines (it ends with the newline that closes its last line)
    out.push(b.resolution.endsWith("\n") ? b.resolution.slice(0, -1) : b.resolution);
  }
  if (k !== rec.blocks.length) return { ok: false, reason: "conflict_block_missing", detail: [file, k, rec.blocks.length] };
  return { ok: true, bytes: Buffer.from(out.join("\n"), "utf8") };
}

/** Verdict: the candidate bytes equal the derivation. */
export function m1DerivationVerdict(root, file, candidateBytes) {
  const d = deriveMerged(root, file);
  if (!d.ok) return d;
  return Buffer.from(candidateBytes).equals(d.bytes) ? { ok: true } : { ok: false, reason: "not_the_recorded_derivation", detail: file };
}
