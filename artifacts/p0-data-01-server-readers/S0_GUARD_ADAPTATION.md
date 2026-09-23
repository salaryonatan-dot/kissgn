# S0 GUARD ADAPTATION — two-layer scope guard (CTO approval 2026-09-23)

**Why:** the S0/VAT scope guard (`test/finance/vat-invariant.test.mjs`, test 5) forbids
any change under `src/analytics/`, `src/repositories/`, `src/snapshot/` (and more)
relative to BASE `686b4350`. The approved server-reader convergence changes exactly five
files there. The CTO authorized the MINIMUM guard change that recognizes this exact delta
— by content, never by path — and nothing else.

## Layer A — historical S0 protection (unchanged contract)

Range `BASE 686b4350 → H 8cac71c1` (the Codex-approved Storage V2 core):
- `git diff --name-only BASE H` filtered by the same forbidden-path list → must be empty,
  except `database.rules.json` when `authorizedEntriesRulesDelta(BASE, H)` is `ok` (the
  R-V2-H10 semantic exception, unchanged).
- The LIVE `database.rules.json` must still satisfy the semantic exception against BASE
  (never a path exemption), and it must be **unchanged from H onward** (Rules are frozen
  after the approved core; they are not part of the reader authorization).
- VAT assertions 1–4 and the added-line content regex over `index.html api lib src`
  (BASE → working tree) are **byte-identical** to the parent version — pinned by
  `test/dashboard/entries-storage-v2-hardening.test.mjs` [H10], whose `strip()` now
  masks only the scope-check body of test 5 and re-asserts the guard consumes both
  semantic modules and contains no directory allowlist.

## Layer B — the authorized server-reader delta (`test/support/server-reader-authorized-delta.mjs`)

Range `H 8cac71c1 → working tree`:
- `SERVER_READER_AUTHORIZED_DELTA` pins, for **exactly five files**
  (`src/analytics/dailyBuilder.ts`, `src/repositories/analytics/{dailyMetricsRepo,laborRepo,purchasesRepo}.ts`,
  `src/snapshot/snapshotBuilder.ts`), the literal normalized unified diff `H → tree`:
  every `+`/`-` content line, marker kept, whitespace runs collapsed, headers dropped
  (13 / 28 / 17 / 14 / 9 lines).
- `serverReaderScopeVerdict({changedProtectedPaths, deltas, authorized})`:
  1. every authorized key must be a plain `.ts` file path under `src/(analytics|repositories|snapshot)/`
     — no directory, trailing slash, glob, regex metacharacter, `..` or leading slash
     (`invalid_allowlist_entry`); every pinned delta must be non-empty content lines
     (`invalid_pinned_delta`); an empty table is rejected (`empty_allowlist`);
  2. any changed protected path not among the five → `unauthorized_protected_path`
     (a sibling file in the same directory gets no cover);
  3. each of the five: normalized actual diff must equal the pinned lines **index by
     index** → otherwise `authorized_delta_mismatch` with the first differing line.
- Test 5 additionally pins the authorized file list to the five exact paths and asserts
  `database.rules.json` is not in the `H → tree` change set.

Consequence: after this slice is committed, any further edit to one of the five files
(an added line, a reverted line, a changed token, a reordered hunk) changes the diff
against `H` and fails the guard until the pinned delta is deliberately re-pinned in a
reviewed change. The guard remains a change detector for those files, not an exemption.

## Mutation proofs — `test/finance/s0-guard-server-reader-mutations.test.mjs` (7/7)

Real inputs are collected from git for this working tree (positive control passes;
the collector's normalized diffs equal the pinned table exactly), then mutated:

| case | mutation | verdict |
|---|---|---|
| A | another protected file changed (`src/analytics/regionResolver.ts`, `src/repositories/analytics/productRepo.ts`, `src/snapshot/index.ts`, `src/agent/…`, `src/forecast/…`, `vercel.json`, `package.json`, `database.rules.json`, `scripts/backfill.mjs`) | `unauthorized_protected_path` naming exactly that file |
| B | extra `console.log` line in dailyBuilder; extra `-/+` pair in dailyMetricsRepo; token added to a pinned line | `authorized_delta_mismatch` (whitespace-only reformat of a pinned line still passes) |
| C | `/ 1.18` on the repo revenue line; `* 1.18` on snapshot sales; `* 0.9` on dailyBuilder food_cost | `authorized_delta_mismatch` pointing at the revenue line |
| D | D1 line reverted while the import stays; old `parseV` removal line dropped; one approved file fully reverted | `authorized_delta_mismatch` |
| E | `JSON.parse(…_v…)` parser inserted; a `normalizePayments` transformation; `dedupeByDate(...)` wrapped around the reader | `authorized_delta_mismatch` |
| F | allowlist entry `src/analytics/`, `src/analytics`, `src/analytics/**`, `*.ts` globs, `^src/snapshot/`, `..` traversal, leading slash, a `src/agent` file, a `.js` file; empty pinned delta; empty table; directory entry with a matching delta | `invalid_allowlist_entry` / `invalid_pinned_delta` / `empty_allowlist` |

## Files touched for the adaptation

- `test/finance/vat-invariant.test.mjs` — test 5 body only (imports + scope checks); tests 1–4 and the added-line regex untouched.
- `test/support/server-reader-authorized-delta.mjs` — new (pinned delta + pure verdict + collector).
- `test/finance/s0-guard-server-reader-mutations.test.mjs` — new.
- `test/dashboard/entries-storage-v2-hardening.test.mjs` — [H10] pin of the VAT guard file updated (see Layer A).

Not touched: `test/support/rules-authorized-delta.mjs`, `database.rules.json`, any runtime file.
