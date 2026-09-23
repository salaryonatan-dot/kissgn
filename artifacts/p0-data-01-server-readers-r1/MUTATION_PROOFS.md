# MUTATION PROOFS — `test/finance/s0-guard-server-reader-mutations.test.mjs` (9/9)

Every mutation is applied to the ACTUAL approved source text of the named file, hashed exactly as the guard hashes the working tree, and fed to the pure verdict together with the real inputs collected from git for this tree.

| Case | Mutation (on real source) | Verdict | Required |
|---|---|---|---|
| **I** positive control | exact approved tree; 5 plain files; each pin ≠ core blob; `git hash-object` equals each pin | `{ok:true}` | PASS ✔ |
| **A** relocation (SR-F2) | `const todayEntry = (requireRowForDate(…` moved below `const sales = num(todayEntry?.sales);` in dailyBuilder — same tokens, same order of changed lines (asserted) | `approved_content_mismatch` | FAIL ✔ — and the compiled mutant throws `ReferenceError` on a healthy business while the approved file returns sales 100 |
| **B** block moved | `rowComponents` helper moved below `aggregateByDate`; `num`/`sumObj` helpers swapped | `approved_content_mismatch` ×2 | FAIL ✔ |
| **C** reordered statements | two accumulator statements swapped; `readerCtx` / `rows` declarations swapped (use before declaration) | `approved_content_mismatch` ×2 | FAIL ✔ |
| **D** extra statement | `void 0;` after readerCtx; extra `export const __probe`; an added comment; one extra space | `approved_content_mismatch` ×4 | FAIL ✔ |
| **E** financial formula | `/ 1.18` on revenue; ratio default `0 → 100`; snapshot `totalSales * 1.18` | `approved_content_mismatch` ×3 | FAIL ✔ |
| **F** partial revert | `todayEntry` back to `rows.find(...)` with import kept; aggregation bypassed by an early `return rows.map(...)`; full revert of dailyMetricsRepo to the core; file absent | `approved_content_mismatch` ×4 | FAIL ✔ |
| **G** unapproved sibling | 10 protected paths incl. `src/analytics/regionResolver.ts`, `productRepo.ts`, `src/snapshot/index.ts`, the detector, `runProactiveJob.ts`, `src/forecast/x.ts`, `vercel.json`, `package.json`, `database.rules.json`, `scripts/backfill.mjs`; detector listed first | `unauthorized_protected_path` naming exactly that path | FAIL ✔ |
| **H** widening | `src/analytics/`, `src/analytics`, `**`, `*.ts`, `^src/snapshot/`, `..`, leading `/`, the detector path, `src/agent/`, `src/forecast/x.ts`, `.js`; directory entry carrying the exact blob; pin `*` / empty; empty table; pin equal to core blob | `invalid_allowlist_entry` / `invalid_pin` / `empty_allowlist` / `pin_equals_base` | FAIL ✔ |

Also: `test/finance/vat-invariant.test.mjs` 5/5 (Layer A + Layer B on the real tree); `test/dashboard/entries-storage-v2-hardening.test.mjs` [H10] 30/30 (VAT guard file pinned to `cb8ac84e` outside the scope-check body — VAT assertions 1–4 unchanged).

D1 negative control (order dependency of the PRE-FIX repository): `test/analytics/entries-reader-d1-downstream.test.mjs` #5 — see `D1_DOWNSTREAM_FIX.md`.
