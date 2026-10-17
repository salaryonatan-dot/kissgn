// BF2 exact-script pin/projection, preserved by BF3 (sole parent a43b69bf). BF3 corrects only protected-file discovery after the
// independent BF2 review found opaque nested repositories could hide descendants (BF2-R-01 / BF1-R-03). Awaiting independent
// acceptance: this author change does not close the finding itself. Protected roots, reader allowlists, both records and script pins
// are unchanged. BF1 still checks its historical pin before delegating the current script to bf2Projection; no import cycle.
import { readFileSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gitIn } from "./git-context.mjs";
const RECORD = JSON.parse(readFileSync(new URL("./bf2-backfill-layer.json", import.meta.url), "utf8"));
export const BF2_PARENT = "cbc8e3a67b9fa238c0e39b92fe8eda771de46f09";        // the BF1 candidate commit
export const BF2_GRANDPARENT = "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1";   // I7, BF1's sole parent
export const BF2_FILE = "scripts/backfill-biz-access.mjs";
export const BF2_RECORD_FILE = "test/support/bf2-backfill-layer.json";
export const BF1_RECORD_FILE = "test/support/bf1-backfill-layer.json";
export const BF2_PIN = RECORD.pin;
export const BF2_PARENT_BLOB = RECORD.parentBlob;
/** BF1-R-03: the ONLY paths the working-tree collector leaves out (dependency installs), root-anchored. No git exclude source is used. */
export const BF2_UNTRACKED_EXCLUDED = Object.freeze(["node_modules/", "test/historical/.deps/"]);
const blob = (b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const rev = (root, spec) => { const r = gitIn(root, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
const zlist = (r, what) => { if (r.status !== 0) throw new Error(`git ${what} failed: ${r.stderr}`); return r.stdout.split("\0").filter(Boolean); };

export function isBF2Tree(root) {
  return existsSync(join(root, BF2_RECORD_FILE)) && gitIn(root, ["merge-base", "--is-ancestor", BF2_PARENT, "HEAD"]).status === 0;
}

/** Every path that is NOT in the index, ignored or not (.gitignore at any depth, .git/info/exclude, core.excludesFile), apart from the
 *  two dependency paths (a directory or a symlink of exactly that name; look-alikes count). NUL-separated: no path quoting.
 *  Git emits an untracked nested repository as an opaque directory. Expand it from the filesystem, ignoring no exclude source,
 *  omitting only Git metadata and the same dependency paths. lstat keeps directory symlinks as paths, without following them.
 *  Enumeration errors propagate: an unreadable/disappearing entry must not silently produce a clean verdict. */
export function untrackedPaths(root, excluded = BF2_UNTRACKED_EXCLUDED) {
  const isExcluded = (f) => excluded.some((p) => f === p.replace(/\/$/, "") || f.startsWith(p));
  const paths = zlist(gitIn(root, ["ls-files", "--others", "-z"]), "ls-files --others");
  const files = [];
  const visit = (f) => {
    if (isExcluded(f)) return;
    if (lstatSync(join(root, f)).isDirectory()) {
      for (const name of readdirSync(join(root, f))) {
        if (name !== ".git") visit(`${f}/${name}`);
      }
    } else files.push(f);
  };
  for (const f of paths) {
    if (isExcluded(f)) continue;
    if (f.endsWith("/")) visit(f.slice(0, -1));
    else files.push(f);
  }
  return [...new Set(files)].sort();
}
/** The change sets of `root` against `base`: committed (HEAD), staged (index) and working tree (tracked differences ∪ untrackedPaths). */
export function changeSets(root, base, excluded = BF2_UNTRACKED_EXCLUDED) {
  const committed = zlist(gitIn(root, ["diff", "--name-only", "-z", base, "HEAD", "--"]), "diff HEAD");
  const staged = zlist(gitIn(root, ["diff", "--name-only", "-z", "--cached", base, "--"]), "diff --cached");
  const working = [...zlist(gitIn(root, ["diff", "--name-only", "-z", base, "--"]), "diff"), ...untrackedPaths(root, excluded)];
  const u = (a) => [...new Set(a)].sort();
  return { committed: u(committed), staged: u(staged), working: u(working) };
}

export function bf2RecordVerdict(root, record = RECORD) {
  if (record.parent !== BF2_PARENT || record.file !== BF2_FILE) return { ok: false, reason: "record_scope" };
  if (!/^[0-9a-f]{40}$/.test(record.pin) || record.pin === record.parentBlob) return { ok: false, reason: "pin_shape" };
  if (record.pin !== BF2_PIN) return { ok: false, reason: "unknown_pin" };
  if (record.parentBlob !== rev(root, `${BF2_PARENT}:${BF2_FILE}`)) return { ok: false, reason: "parent_blob" };
  // the BF1 layer below is the BF1 commit's own: its record is unchanged (committed, staged, checked out) and pins this parent blob
  const bf1Record = rev(root, `${BF2_PARENT}:${BF1_RECORD_FILE}`);
  let bf1Bytes;
  try { bf1Bytes = readFileSync(join(root, BF1_RECORD_FILE)); } catch { return { ok: false, reason: "bf1_record_missing" }; }
  if (!bf1Record || rev(root, `HEAD:${BF1_RECORD_FILE}`) !== bf1Record || rev(root, `:${BF1_RECORD_FILE}`) !== bf1Record || blob(bf1Bytes) !== bf1Record)
    return { ok: false, reason: "bf1_record_changed" };
  let bf1Pin;
  try { bf1Pin = JSON.parse(gitIn(root, ["cat-file", "blob", bf1Record]).stdout).pin; } catch { return { ok: false, reason: "bf1_record_unreadable" }; }
  if (bf1Pin !== record.parentBlob) return { ok: false, reason: "bf1_chain" };
  return { ok: true };
}

/** Fail-closed: only the exact BF2 script (committed, staged and checked out at the BF2 pin) leaves the protected set. */
export function bf2Projection(root, paths) {
  const all = [...new Set(paths || [])];
  if (!isBF2Tree(root)) return { ok: true, layered: false, projected: all };
  const rec = bf2RecordVerdict(root);
  if (!rec.ok) return rec;
  let bytes;
  try { bytes = readFileSync(join(root, BF2_FILE)); } catch { return { ok: false, reason: "script_missing" }; }
  if (blob(bytes) !== BF2_PIN) return { ok: false, reason: "script_content_mismatch" };
  if (rev(root, `HEAD:${BF2_FILE}`) !== BF2_PIN || rev(root, `:${BF2_FILE}`) !== BF2_PIN) return { ok: false, reason: "script_history_mismatch" };
  return { ok: true, layered: true, layer: "bf2", projected: all.filter((f) => f !== BF2_FILE) };
}
