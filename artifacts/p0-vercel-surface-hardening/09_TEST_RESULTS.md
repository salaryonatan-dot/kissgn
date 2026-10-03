# 09 — Test Results

| Check | Command | Cloud (Node v22) | Mac worktree |
|---|---|---|---|
| Focused surface suite | `node --test test/security/vercel-deployment-surface.test.mjs` | **11/11** (≈3 s) | see handoff |
| Mutation check | 22 `.vercelignore` mutations (doc 06) | 22/22 caught | — |
| Scheduled-auth focused set (7 files) | as in `p0-scheduled-auth-release/09` | **138/138** | see handoff |
| Full suite | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **976/976**, 0 fail / cancelled / skipped (base 965 + 11) | see handoff |
| Typecheck | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 22 × TS2742 (baseline); no new diagnostic | see handoff |
| Build check | no build step exists. The function bundle was checked with the installed `@vercel/nft` (test 6); no Vercel build was run (it would need project settings) | — | — |
| Runtime files unchanged | `git diff --name-only 05bf5a59 -- index.html api src lib vercel.json database.rules.json package.json package-lock.json tsconfig.json` | empty | — |
