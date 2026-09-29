# 06 — Test Results

| Check | Cloud (`/home/claude/hf1`) | Mac worktree |
|---|---|---|
| Focused `test/dashboard/setup-config-preservation.test.mjs` at base | 4 pass / 19 fail (reproduction) | — |
| Focused, with HF-1 | 23 / 23 | see external handoff |
| Full suite `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **988 / 988**, 0 fail / 0 cancelled / 0 skipped (base 965 + 23 new) | see external handoff |
| `npx tsc --noEmit -p .` | 22 errors, all TS2742 (baseline, identical at base); 0 new | see external handoff |
| `git diff --check` | clean | — |
| Parse of the four `index.html` scripts (TypeScript parser, JSX for `text/babel`) | 0 parse errors (base and HF-1) | — |
| Guards: VAT added-line invariant, P0 pinned blocks, UI call-site harnesses | included in the full suite, passing | — |
| Firebase emulator suites | not run (emulator required); no Rules change | — |
