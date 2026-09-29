# Housekeeping Analysis (P2) — RECOMMENDATION ONLY, nothing deleted or moved

Repository: `/Users/yonatan/Documents/marjin/kissgn/.git` (inspected read-only from the linked VM on 2026-09-29).

| # | Path (under `.git/`) | Size | mtime | Valid ref? | Corresponding branch ref | In packed-refs? | Referenced by a worktree HEAD? |
|---|---|---|---|---|---|---|---|
| 1 | `refs/heads/claude/m1-financial-core-spec-r1-1.lock.mv_1785132625` | 0 B | 2026-07-27 06:10 | no (empty) | `claude/m1-financial-core-spec-r1-1` exists → `130f57c5…` | no | no (worktree HEAD is the branch itself) |
| 2 | `refs/heads/claude/p0-data-01-r10.lock.parked.1786117960` | 0 B | 2026-08-07 15:52 | no | `claude/p0-data-01-r10` → `f9168213…` | no | no |
| 3 | `refs/heads/claude/p0-data-01-r2-integrity-hardening.lock.mv_1785100774` | 0 B | 2026-07-26 21:19 | no | `claude/p0-data-01-r2-integrity-hardening` → `ddd4163b…` | no | no |
| 4 | `refs/heads/claude/p0-data-01-r3-lifecycle-consistency.lock.mv_1785142414` | 0 B | 2026-07-27 08:53 | no | `claude/p0-data-01-r3-lifecycle-consistency` → `eed85e23…` | no | no |
| 5 | `refs/heads/claude/p0-data-01-r7-fingerprint-ownership.lock.stale.14624` | 0 B | 2026-08-02 05:21 | no | `claude/p0-data-01-r7-fingerprint-ownership` → `dc321d8c…` | no | no |
| 6 | `refs/heads/claude/p0-data-01-r8-pending-write-isolation.lock.stale.13463` | 0 B | 2026-08-05 10:07 | no | `claude/p0-data-01-r8-pending-write-isolation` → `3685c926…` | no | no |
| 7 | `refs/heads/claude/p0-data-01-transient-revenue.lock.mv_1785096576` | 0 B | 2026-07-26 20:09 | no | `claude/p0-data-01-transient-revenue` → `74150537…` | no | no |

Facts:
- All seven are zero-byte files left by earlier sessions that could not unlink ref locks inside the mounted folder (they were renamed instead). Git reads them as refs named `*.lock.*` pointing to the null id; `git fsck --connectivity-only` reports `invalid sha1 pointer 0000…` for them. `packed-refs` contains only four `refs/remotes/origin/*` entries. No worktree `HEAD` names any of them (every worktree HEAD names its real branch). The real branch refs beside them are intact and resolve to the approved SHAs.
- They are not active refs and hold no data; they are not lock files git is waiting on (a real lock is `<ref>.lock` exactly).
- `claude/m1-financial-core-slice-a` resolves correctly; candidate history `a8fdf2c8 → f5d0a8ed` is valid; the issue does not affect branch identity.

Recommendation (for the owner/CTO to run on the Mac, outside any active git operation):
```
cd ~/Documents/marjin/kissgn
mkdir -p _stale_locks/refs-debris-2026-09-29
mv .git/refs/heads/claude/*.lock.mv_* .git/refs/heads/claude/*.lock.parked.* .git/refs/heads/claude/*.lock.stale.* _stale_locks/refs-debris-2026-09-29/
git fsck --connectivity-only    # the seven invalid-pointer errors should disappear
```
Moving (not deleting) is reversible. Status: **RECOMMENDATION_ONLY** — not performed (no authorization for ref surgery). Also left in place: the transfer bundle `marjin-reviews/2026-09-28/_transfer/slice-a-a8fdf2c.bundle` and earlier moved temp/lock files in `kissgn/_stale_locks/`.
