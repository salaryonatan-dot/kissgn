// Test-only: resolve THIS working tree's git context robustly.
//
// WHY THIS EXISTS. A linked worktree does not contain a `.git` directory; it contains
// a `.git` FILE holding an absolute back-pointer to `<main repo>/.git/worktrees/<name>`,
// and that admin directory holds an absolute back-pointer to the worktree. Both are
// absolute paths recorded when the worktree was created. If the checkout is later
// reached through a different absolute path — a container mount, a relocated volume,
// a renamed parent — every plain `git` command run from inside the worktree fails with
// `fatal: not a git repository`, and any guard that shells out to git fails with it.
// That is exactly how the S0 anti-migration guard came to fail: not because the
// invariant was violated, but because the guard could not reach the repository.
//
// WHAT THIS DOES. It resolves the git directory from the filesystem AS IT IS AT RUN
// TIME, in three steps, and never from a constant:
//   1. If `git rev-parse --git-dir` already works from the working tree, use plain git
//      unchanged — the normal case for a clone or a correctly registered worktree.
//   2. Otherwise, if `.git` is a worktree pointer file whose target is missing, look
//      for the same worktree's admin directory under a sibling repository of this
//      checkout: `<sibling>/.git/worktrees/<this directory's name>`. The candidate is
//      accepted only if it really is that admin directory (it names a `commondir` and
//      a `gitdir`, and its `gitdir` back-pointer ends with this checkout's own name).
//   3. If nothing resolves, throw. A guard that cannot reach the repository must FAIL,
//      never skip and never silently pass.
//
// No path here is hard-coded and nothing is written: this module only reads.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function plainGitWorks(root) {
  const r = spawnSync("git", ["--no-optional-locks", "rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" });
  return r.status === 0;
}

function pointerTarget(root) {
  const dotGit = join(root, ".git");
  if (!existsSync(dotGit)) return null;
  let st;
  try { st = statSync(dotGit); } catch { return null; }
  if (!st.isFile()) return null;                       // a real .git directory
  const m = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(dotGit, "utf8"));
  return m ? m[1].trim() : null;
}

// Is `dir` the admin directory of the worktree checked out at `root`?
function isAdminDirFor(dir, root) {
  if (!existsSync(join(dir, "commondir")) || !existsSync(join(dir, "gitdir"))) return false;
  const back = readFileSync(join(dir, "gitdir"), "utf8").trim();
  return basename(dirname(back)) === basename(root);   // <...>/<this checkout>/.git
}

/**
 * Returns the argv prefix that makes `git` operate on this working tree, e.g.
 * `[]` in the normal case, or `["--git-dir", "<admin>", "--work-tree", root]` when the
 * recorded back-pointer no longer resolves. Throws if the repository cannot be reached.
 */
export function gitPrefixFor(root) {
  if (plainGitWorks(root)) return [];

  const recorded = pointerTarget(root);
  if (recorded && existsSync(recorded)) return ["--git-dir", recorded, "--work-tree", root];

  const name = basename(root);
  const parent = dirname(root);
  let siblings = [];
  try { siblings = readdirSync(parent); } catch { siblings = []; }
  for (const sib of siblings) {
    const candidate = join(parent, sib, ".git", "worktrees", name);
    if (existsSync(candidate) && isAdminDirFor(candidate, root)) {
      return ["--git-dir", candidate, "--work-tree", root];
    }
  }

  throw new Error(
    `[git-context] cannot reach the git repository for ${root}. ` +
    (recorded ? `Its .git pointer names ${recorded}, which does not exist here, ` : "It has no usable .git pointer, ") +
    `and no sibling repository holds a worktree admin directory for "${name}". ` +
    `Run this guard from a checkout whose repository is reachable — do not skip it.`,
  );
}

// M1 R1 (independent review, VAT guard finding): spawnSync buffers stdout up to `maxBuffer` (Node's default is 1 MiB).
// Beyond it Node kills git and reports error ENOBUFS — and, depending on whether git had already exited, `status` is 0
// (output cut at the limit) or null (SIGTERM). The S0 guard's runtime diff of the integrated tree is ~1.06 MB, so a
// status-only check passed or failed by timing and a status-0 run could read truncated evidence; ~30 other guard calls
// through this helper ran at 70–87 % of the default. Every call therefore gets an EXPLICIT bound (a caller may still pass
// its own), and ANY subprocess error — ENOBUFS, a timeout, a spawn failure — THROWS: a guard can never assert on a
// truncated or killed git result, and never turns a command failure into a pass. A non-zero git exit status is returned
// unchanged, as before, for the caller's own assertion.
export const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024;   // ~60× today's largest guard output; exceeding it FAILS loudly

/** Run git against this working tree with the resolved context; complete output or an exception. */
export function gitIn(root, args, opts = {}) {
  const options = { cwd: root, encoding: "utf8", maxBuffer: GIT_OUTPUT_LIMIT, ...opts };
  const r = spawnSync("git", [...gitPrefixFor(root), "--no-optional-locks", ...args], options);
  if (r.error) {
    const captured = r.stdout == null ? 0 : Buffer.isBuffer(r.stdout) ? r.stdout.length : Buffer.byteLength(r.stdout);
    throw new Error(`[git-context] git ${args.join(" ")}: subprocess error ${r.error.code || r.error.message} ` +
      `(status=${r.status}, signal=${r.signal}, captured ${captured} bytes, maxBuffer ${options.maxBuffer}). ` +
      `A guard must never read a truncated or killed git result.`);
  }
  return r;
}
