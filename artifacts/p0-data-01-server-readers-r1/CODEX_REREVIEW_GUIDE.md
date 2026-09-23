# CODEX RE-REVIEW GUIDE — server readers R1 (child of f00568d2)

**Where:** worktree `~/Documents/marjin/kissgn-p0-data-01-server-readers`, branch `claude/p0-data-01-server-readers`; `git show --stat HEAD`, `git diff f00568d2` (7 modified, 1 new test, 6 artifacts). Not pushed, not deployed.

## SR-F1 (D1 downstream) — 15 min
1. `D1_DOWNSTREAM_FIX.md` — the trace and why aggregation (A) is the contract: every `DailyMetric` field is a sum or a ratio of sums; `metrics["daily"]` is the only per-day series any analytical consumer reads.
2. `git diff f00568d2 -- src/repositories/analytics/dailyMetricsRepo.ts` — `rowComponents` (formulas byte-identical to the old `toDaily`), `aggregateByDate`, contract comment. Nothing else in `src/` changed; no `src/agent` file changed.
3. `test/analytics/entries-reader-d1-downstream.test.mjs` — attack ideas: add a representation (e.g. V2 with `_v` poison ordering, three-way duplicate on "yesterday"), change the baseline, run the detector directly on `PRE.getDailyMetrics` output for other orderings. #5 shows the pre-fix flip you reproduced.
4. Emulator `SR-11` (`server-readers-matrix.mjs`) — real `runForBiz`; compare the persisted `proactive_insights` / `proactive_digests` across the 8 representations yourself.

## SR-F2 (S0 exact pin) — 10 min
1. `S0_EXACT_PIN.md` + `test/support/server-reader-authorized-delta.mjs` — identity model; check `blobSha` against `git hash-object` for each of the five files (`MUTATION_PROOFS.md` I does it in-test).
2. Re-run your `guard-probe.mjs` relocation: the verdict is now `approved_content_mismatch` (case A does exactly your relocation and also proves the `ReferenceError`).
3. `git diff f00568d2 -- test/finance/vat-invariant.test.mjs` — only the Layer B block of test 5 changes; [H10] still pins the rest of the file to `cb8ac84e`.
4. Try to widen: a directory key, a glob, an `agent` path, a pin equal to the core blob — `s0-guard-server-reader-mutations` H covers each; any new edit to one of the five files must fail test 5 until re-pinned.

## Re-run
```
node --test test/analytics/entries-reader-d1-downstream.test.mjs test/analytics/entries-reader-repos.test.mjs \
  test/finance/vat-invariant.test.mjs test/finance/s0-guard-server-reader-mutations.test.mjs test/dashboard/entries-storage-v2-hardening.test.mjs
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 787/787
… emulators:exec … "node test/emulator/server-readers-matrix.mjs"   # total=11 passed=11
```

## Unchanged / out of scope
Storage V2 core, Rules, `index.html`, D2 (checkers still non-firing), D3, entryExceptions, the shared reader, version fence, the pre-existing `region_ids`/`undefined` P1.
