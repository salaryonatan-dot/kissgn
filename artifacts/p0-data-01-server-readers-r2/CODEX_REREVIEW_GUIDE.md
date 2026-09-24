# CODEX RE-REVIEW GUIDE — server readers R2 (child of c46c2727)

**Where:** worktree `~/Documents/marjin/kissgn-p0-data-01-server-readers`, branch `claude/p0-data-01-server-readers`; `git diff c46c2727` (1 runtime file, 1 pin line, 2 test files, README, 8 artifacts). Not pushed, not deployed. Codex design packet: `~/Documents/marjin-reviews/2026-09-24/deterministic-decimal-design/` — the implemented boundary is exactly its `RECOMMENDED_ACCUMULATOR.md` "smallest compatible boundary", with both compatibility decisions closed by the CTO (D-R2-1 singleton/per-row preservation, D-R2-2 intermediate-overflow correction).

## Reading order (≈ 20 min)
1. `git diff c46c2727 -- src/repositories/analytics/dailyMetricsRepo.ts` — `canonicalDecimal`, `decimalSum`, array accumulation; per-row helpers byte-identical.
2. `DETERMINISTIC_ACCUMULATOR.md` + `OVERFLOW_POLICY.md` — attack ideas: an operand whose `toString()` is not matched by the regex (none exist for finite Numbers; NaN/±∞ are handled before parsing); double rounding (the final conversion parses a decimal string, not `Number(C)/10**S` — mutant covered in #8 and in the S0 suite); `-0` (never produced: `Number(v)||0` zeroes it; exact zero returns `+0`).
3. `test/analytics/entries-reader-decimal-aggregation.test.mjs` — #1/#5 are the mandatory permutation and downstream proofs; #7 is the parent negative control compiled from git (your fixture and numbers).
4. `S0_REPIN.md` — one pin changed; the R1 bytes are now denied; the other four pins asserted unchanged.
5. `DOWNSTREAM_EQUIVALENCE.md` — follow-ups recorded, not fixed.

## Re-run
```
node --test test/analytics/entries-reader-decimal-aggregation.test.mjs test/analytics/entries-reader-d1-downstream.test.mjs \
  test/finance/vat-invariant.test.mjs test/finance/s0-guard-server-reader-mutations.test.mjs
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 795/795
… emulators:exec … "node test/emulator/server-readers-matrix.mjs"   # total=12 passed=12
```
