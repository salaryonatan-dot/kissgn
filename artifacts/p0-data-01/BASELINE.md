# P0-DATA-01 Baseline

## Worktree / branch
- Worktree created: `/Users/yonatan/Documents/marjin/kissgn-p0-data-01`
- Branch: `claude/p0-data-01-transient-revenue`
- Start point: `b16f5567c0b0f09b14a68e236b9baf781a9d19e8` (verified parent `686b4350c6b6186c81d7f821d8c26a960428d30b`)

## Repository states recorded before any edit
- Canonical repo (`~/Desktop/Marjin קבצי הקמת אפליקציה /01_REPOS/kissgn`): branch `claude/security-hardening-pr2a`, HEAD `1690f0a803e5dd8bd262348a90a863c1e07d31ba`, tracked-clean (untracked `.DS_Store` files only). Not modified.
- Documents main repo (`~/Documents/marjin/kissgn`): branch `codex/fix-weekday-aggregation`, HEAD `0243123027031b068993f7ee69f8e9363f3eed48`, carries the known uncommitted weekday-aggregation working tree (unchanged before/after this task). Worktrees: containment-slice-1 (`4c4e6d3`), integration (`686b435`, main), s0-vat-invariant (`b16f556`).
- S0 worktree (`~/Documents/marjin/kissgn-m1-s0-vat-invariant`): HEAD `b16f5567`, no tracked changes (untracked `node_modules/`, `artifacts/.DS_Store` ignored, untouched). Not modified.
- R1.1 worktree (`~/Documents/marjin/kissgn-m1-financial-core-spec-r1-1`): **absent** — not present on disk and not registered in `git worktree list`. Recorded; not needed (documentation-only reference; no code was to be copied from it).

## Pre-edit test baseline (in the new worktree, at b16f5567)
- `node --test test/finance/vat-invariant.test.mjs` → 5/5
- `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` → 2/2 files
- Full suite `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` → **341/341**
- `tsc --noEmit --preserveSymlinks` → exit 0 (see TEST_RESULTS for the symlink note)
- `package.json` sha1 `d3757926cc3e63eeb2631dcb24e7d129beab3e99`, `package-lock.json` sha1 `4c2677876a903273f308560ab664e3eed8eb2e37`

## Validation environment notes
- `node_modules` in this worktree is an untracked **relative symlink** to the sibling S0 worktree's `node_modules` (read-only reuse; no install was run, no dependency changed).
- The device VM cannot unlink files under `.git` (Operation not permitted). Stale zero-byte lock files created and immediately orphaned by this quirk were renamed aside (never deleted): `refs/heads/claude/p0-data-01-transient-revenue.lock` → `*.lock.mv_<ts>`; same treatment for `worktrees/kissgn-p0-data-01/index.lock` before staging. The `worktrees/kissgn-p0-data-01/locked` marker file also remains (harmless; prevents accidental prune).
