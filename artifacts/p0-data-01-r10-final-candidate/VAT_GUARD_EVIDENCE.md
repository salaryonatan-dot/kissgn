# VAT S0 guard — root cause and repair (R10-GATE-016)

## The failure

`test/finance/vat-invariant.test.mjs`, case 5, the S0 anti-migration guard:

```
fatal: not a git repository:
/sessions/rcw-01mwjtjyoow9d1kzdcm2jku5/mnt/marjin/kissgn/.git/worktrees/kissgn-p0-data-01-r10
128 !== 0
```

It was the only failure in an otherwise 633/634 suite.

## Why it pointed at a dead path

A linked worktree has no `.git` directory. It has a `.git` **file** holding an absolute
back-pointer to `<main repo>/.git/worktrees/<name>`, and that admin directory holds an
absolute back-pointer to the worktree. Both absolute paths are recorded when the worktree
is created.

R10 was produced in a session where the repository was mounted at
`/sessions/rcw-01mwjtjyoow9d1kzdcm2jku5/mnt/marjin/…`. That session created no commit, so
it never ran the project's documented "restore the `.git` and `gitdir` back-pointers to
host paths after committing" step — the Gate 3 artifact records the consequence
explicitly: *"The worktree `.git` pointer was not modified."* Both pointers were left
naming a mount path that no longer exists.

The guard shells out to `git` with `{ cwd: ROOT }`. With an unresolvable back-pointer,
git cannot find the repository from inside the worktree, `spawnSync` returns status 128,
and the assertion `assert.equal(names.status, 0, names.stderr)` fails. The guard never
evaluated a diff. Nothing about the VAT invariant was involved.

## The repair — two parts, neither of which weakens anything

**1. The worktree's git identity was restored to host paths**, matching `…-r8` and
`…-r9`:

```
kissgn-p0-data-01-r10/.git
  gitdir: /Users/yonatan/Documents/marjin/kissgn/.git/worktrees/kissgn-p0-data-01-r10
kissgn/.git/worktrees/kissgn-p0-data-01-r10/gitdir
  /Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10/.git
```

Metadata only; no tracked file was touched.

**2. The guard no longer depends on that back-pointer being correct.** A recorded
absolute path is exactly the assumption that broke, and restoring it fixes today's path
while leaving the same trap for the next relocated checkout. `test/support/git-context.mjs`
resolves the git context from the filesystem **as it is at run time**:

1. if `git rev-parse --git-dir` already works from the working tree, use plain `git`
   unchanged — the normal case, and the case on the host;
2. otherwise, if `.git` is a pointer file whose target is missing, look for this
   worktree's admin directory under a sibling repository of the checkout —
   `<sibling>/.git/worktrees/<this directory's name>` — accepting a candidate only if it
   really is that admin directory (it has `commondir` and `gitdir`, and its `gitdir`
   back-pointer ends with this checkout's own name);
3. otherwise **throw**, with a message naming what it looked for.

No path is hard-coded, no sandbox path is baked in, and the module only reads. Step 3
matters: a guard that cannot reach the repository must fail, never skip and never pass by
default.

## What changed in the guard file — `+9 / −3`

- one import added, with the reason in a comment;
- `spawnSync("git", [...], { cwd: ROOT })` → `gitIn(ROOT, [...])` at the two call sites;
- the now-unused `spawnSync` import removed.

**Every assertion is byte-identical**, including the forbidden-path list, the
forbidden-added-line regex
`/\b(?:migration|migrate|_rtdbSet|storage\.set|set\(ref|remove\(ref|persist\(|entries\s*=)\b/i`,
the single-VAT-literal assertion and the single-sanctioned-division assertion. The
invariant was not weakened, skipped, narrowed or removed; only the way git is invoked
changed.

## Result

`node --test test/finance/vat-invariant.test.mjs` → **5 tests, 5 pass, 0 fail**, run from
the actual R10 worktree, both before and after the back-pointer repair — the resolver
makes the guard independent of it. The S0 diff check now genuinely evaluates this round's
runtime additions and finds no forbidden path and no forbidden added line.
