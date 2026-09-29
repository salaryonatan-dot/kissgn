# 08 — Test results (cloud clone of the canonical repo, Node v22.22.2)

| Run | Command | Result |
|---|---|---|
| Baseline at `0bcd1753` | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **1158 / 1158** |
| Baseline classifier | `node --test test/finance/ev1-classifier.test.mjs` | 9 / 9 |
| Focused (classifier + collector) | `node --test test/finance/ev1-classifier.test.mjs test/finance/ev1-collector.test.mjs` | **34 / 34** (9 + 25) |
| Full suite (candidate) | same full command | **1183 / 1183** (1158 + 25); 0 fail / cancelled / skipped |
| Typecheck | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 22 × TS2742 (`src/firebase/refs.ts`), **byte-identical** error list to baseline. The collector is `.mjs`, outside `tsconfig.include`, so there are no new diagnostics. |
| `git diff --check` | — | clean |
| CLI smoke (fixture) | `env -u CLOUDSDK_AUTH_ACCESS_TOKEN node tools/finance-core/ev1-collector.mjs --fixture <tree> --as-of … --out-dir <new>`, then `--verify` | exit 0 `EV1_EVIDENCE_COMPLETE`; bundle 0700/0600; `EV1_BUNDLE_VERIFIED_COMPLETE` |
| Environment refusal observed | same without `env -u` | exit 2 `forbidden_environment` (`CLOUDSDK_AUTH_ACCESS_TOKEN` present in the build container) |

## Mutation check
I seeded eight faults, one at a time, and restored each afterwards.

| Mutation | Failing tests |
|---|---|
| Failed entries read treated as empty | 3 |
| Transport HTTP ≠ 200 returned as `null` | 1 |
| Non-map shallow response accepted as empty | 1 (after adding the malformed-discovery test) |
| Id-less registry rows ignored | 1 |
| Environment check removed | 1 |
| `evidenceComplete` decoupled from the invariants | 1 |
| Row-id lists kept in the output | 9 |
| Classifier exception swallowed | 1 |

## Not claimed
- **Emulator:** not required. The collector is REST GET-only and was tested with injected transports and a fake `fetch`.
- **Production:** no Production or network access.
- **Mac worktree re-run:** recorded in the external handoff.
