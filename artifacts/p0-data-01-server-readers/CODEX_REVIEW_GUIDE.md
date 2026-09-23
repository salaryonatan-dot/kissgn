# CODEX REVIEW GUIDE — P0-DATA-01 server reader convergence (single-commit candidate)

**Where:** worktree `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-server-readers`,
branch `claude/p0-data-01-server-readers`, ONE commit on top of `8cac71c1` (approved Storage V2
core). `git show --stat HEAD` / `git diff 8cac71c1` show the whole slice. The approved
worktree `kissgn-p0-data-01-storage-v2` is untouched.

**Status:** `SERVER_READERS_READY_FOR_CODEX` — one local commit (parent `8cac71c1`), all
gates green including the CTO-authorized two-layer S0 guard (`S0_GUARD_ADAPTATION.md`).
Nothing was pushed or deployed.

## Suggested reading order (≈ 30 min)

1. `ACCESS_INVENTORY.md` — confirm 9 sites / 7 files against 8cac71c1 (`grep -rn ":entries\|bizEntriesRef" src lib api`).
2. `lib/analytics/entriesReader.js` (176 lines) — the one seam. Check the decision table against `index.html` `MarjinStorageV2.readEntriesNode` / `readV2Rows` / `detectStorageMode` / `parseEntriesNode`; then `test/analytics/entries-reader-client-parity.test.mjs` pins it.
3. Runtime diff (`git diff -- src lib tools`, 486 lines): each site is a one-for-one parser swap; `dailyBuilder` adds `requireRowForDate`; `analyticsService` adds 4 typed re-throws; `checkers` adds the D2 constant and swaps the dead query; `entryExceptions*` add the ambiguity marker; `preflight` adds the report.
4. `D1_DUPLICATE_DATE.md`, `D2_ALERT_BEHAVIOR.md`, `D3_MALFORMED_V2.md` — decision → code → test mapping.
5. `S0_GUARD_ADAPTATION.md` + `test/support/server-reader-authorized-delta.mjs` + `test/finance/s0-guard-server-reader-mutations.test.mjs` — the guard change: Layer A unchanged historical contract, Layer B literal pinned delta for five files, mutation proofs A–F. Check the VAT guard diff (`git diff 8cac71c1 -- test/finance/vat-invariant.test.mjs`): only test 5's scope body and two import lines change.
6. `KNOWN_LIMITATIONS.md` — resolved guard item (history) and the unrelated P1 (`region_ids` / Admin SDK `undefined`).

## Things worth attacking

- **No-fallback:** grep the runtime diff for `_v` — only comments and the suppliers-list parser (`purchasesRepo.parseLegacyListEnvelope`, not Storage V2). In the reader, `readV2Rows` never touches `raw._v`; `parseLegacy` refuses V2-structured nodes.
- **Silent winner:** grep for `.find((e) => e.date` / `[0]` / `last` on entries rows in the diff — none remain; `rowForDate` is the only one-row-per-date resolver.
- **D2 leak:** `ENTRIES_ANOMALY_CHECKS_ENABLED` is only defined and only tested; the flipped-copy test writes to the temp compile dir, never the tree.
- **D3 routing:** `analyticsService` re-throws only `isEntriesReadError`; `entries-reader-repos.test.mjs` "D3 routing" proves the soft-fail survives for a network error.
- **Behaviour drift on legacy nodes:** every per-caller suite asserts byte-equal outputs from `_v` and rows across fixtures F0…F10 (unicode, missing fields, `"1,234"` strings, `"skip"` markers, numeric-key maps); `SR-02` repeats it through a real conversion.
- **Malformed variants:** `malformedNodes()` — 8 shapes, each with a valid `_v` bait.
- **Emulator matrix determinism:** 3 rounds recorded in `EMULATOR_RESULTS.md`; reseed per case; `fetch` fenced.
- **Guard strength:** try to weaken `SERVER_READER_AUTHORIZED_DELTA` (directory key, glob, empty pin) or edit one of the five files by one token — `s0-guard-server-reader-mutations` and `vat-invariant` test 5 must fail. The pinned table is literal content, so a token-presence bypass has nothing to match against.

## Re-running

```
# focused
node --test test/analytics/entries-reader*.test.mjs test/analytics/entry-exception-parity.test.mjs \
  test/storage-v2/preflight-duplicates.test.mjs test/typescript/js-declaration-parity.test.mjs test/insights/false-insights-p0.test.mjs
node --test test/finance/vat-invariant.test.mjs test/finance/s0-guard-server-reader-mutations.test.mjs
# full (expect 780/780)
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# emulator (one at a time; see test/emulator/README.md)
… emulators:exec … "node test/emulator/server-readers-matrix.mjs"   # expect total=10 passed=10
… emulators:exec … "node test/emulator/storage-v2-matrix.mjs"       # expect total=46 passed=46
```

## Decision status

Guard policy approved by the CTO on 2026-09-23 and applied as a test-only change; the
candidate is the single commit `fix: converge server readers on storage v2` (parent
8cac71c1). Remaining pre-cutover blockers: this independent review; the old-build /
version fence; production preflight, backup/rollback boundary and single-business canary.
