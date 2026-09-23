# SERVER READERS R1 — CHANGE SUMMARY (two-blocker remediation)

**Parent:** `f00568d26b1fc4c755efa4030733420c116ade40` (reviewed candidate, Codex `CHANGES_REQUIRED`, findings SR-F1 / SR-F2)
**Worktree / branch:** `~/Documents/marjin/kissgn-p0-data-01-server-readers` / `claude/p0-data-01-server-readers`
**Child commit:** one (SHA in the final report; not pushed, not deployed)
**Scope:** exactly the two findings. Storage V2 core, Rules, `index.html`, migration / generation / clear_all, D2, D3, entryExceptions, the shared reader (`lib/analytics/entriesReader.js`), `src/agent/**`, package and deployment files: untouched (verified per file).

## Runtime change (one file)

| File | Change |
|---|---|
| `src/repositories/analytics/dailyMetricsRepo.ts` | `getDailyMetrics` now returns **exactly one `DailyMetric` per business date** (`aggregateByDate`): per-row components are derived with the unchanged formulas (`rowComponents` — revenue = sales+deliveries+other_income; foodCost = Σsupplier_payments ‖ food_cost; laborCost = payroll + Σhourly_payroll), summed over every row of the date, ratios recomputed from the totals, result sorted by date. Insertion order, UUIDs and RTDB enumeration order have no effect. `getLatestDailyDate` unchanged. Contract documented in the file header. |

## Guard change (test-only)

| File | Change |
|---|---|
| `test/support/server-reader-authorized-delta.mjs` | Rewritten in place (name kept for import stability). R0's normalized-line-delta model removed entirely. Now: `SERVER_READER_APPROVED_BLOBS` pins each of the five authorized files to the **git blob SHA-1 of its reviewed bytes**; `blobSha()` computes `sha1("blob <len>\0" + bytes)`; `serverReaderScopeVerdict` requires working-tree blob === pin (`approved_content_mismatch`), rejects any other changed protected path (`unauthorized_protected_path`), any non-file entry (`invalid_allowlist_entry` — `src/agent/**` and `src/forecast/**` are never authorizable), non-SHA pins (`invalid_pin`), empty tables, and pins equal to the core blob (`pin_equals_base`). |
| `test/finance/vat-invariant.test.mjs` | Test 5 Layer B: uses the identity verdict; additionally asserts each pinned file is present and differs from the approved core (a reviewed change). Layer A, VAT assertions 1–4 and the added-line regex: byte-identical (pinned by [H10], which still passes unchanged). |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` | Rewritten: proofs A–H + positive control I (9 tests) on the ACTUAL source text, hashed exactly as the guard hashes the tree; A compiles Codex's relocation mutant and shows the runtime `ReferenceError`. |

## Tests

| File | Change |
|---|---|
| `test/analytics/entries-reader-d1-downstream.test.mjs` (**new**, 5) | Repo aggregation contract; detector final result identical across 10 representations (A=100/B=500; and Codex's 1/1000); actual `runForBiz` persisted insight + digest identical across 5 representations; **negative control** compiles the pre-fix `f00568d2` repository and shows the verdict flips on array/UUID order alone. |
| `test/analytics/entries-reader-repos.test.mjs` | Duplicate-date expectation updated: one aggregated daily metric (600 / 6 / 60), identical for V2, legacy and reversed legacy; labor/purchases still keep every row. |
| `test/emulator/server-readers-matrix.mjs` | SR-07 asserts the single aggregated daily record; **SR-11** new: real RTDB + real `runForBiz`, 8 representations → identical insight (`currentValue 600`) and digest. EXPECTED 10 → 11. |
| `test/support/server-reader-harness.mjs` | Compiles `runProactiveJob.ts` and the detector as additional entry points. |
| `test/emulator/README.md` | SR-11 documented; expected totals 11/11. |

Diffstat vs parent: 7 modified + 1 new + 6 artifacts.
