# 01 — Scope and base

## Worktree / branch / base
| Item | Value |
|---|---|
| Mac worktree | `/Users/yonatan/Documents/marjin/kissgn-m1-financial-core-b1` (B1 `658cd05`, kept unchanged); R1: `/Users/yonatan/Documents/marjin/kissgn-m1-financial-core-b1-r1` |
| Branch | `claude/m1-financial-core-b1` (B1); R1: `claude/m1-financial-core-b1-r1` (one commit on top of `658cd05`) |
| BASE | `213fb350019c3e212156eb032e34f4da8c179d6f` (EV-1 collector commit = the accepted bundle's `repo SHA`) |
| Base check (a) | Slice A `0bcd1753` is an ancestor of BASE — OK |
| Base check (b) | `git diff --name-only 0bcd1753 BASE -- index.html api lib src fincore` is empty — OK (the runtime/core tree is Slice A) |
| Base check (c) | BASE full suite 1198/1198; tsc 22 × TS2742 (`src/firebase/refs.ts`) |
| Untouched worktrees | P0 (`kissgn-p0-*`), HF-1 (`kissgn-hf1-setup-config-preservation`), EV-1 collector (`kissgn-m1-financial-core-ev1-collector`) — not modified |

## Step 1 — EV-1 evidence frozen (read-only; NOT re-run)
- Folder: `~/Documents/marjin-reviews/2026-09-29/ev1-production-execution/20260929T153417Z/` — verdict `EV1_PRODUCTION_ACCEPTED`.
- Verifier (collector worktree, read-only): `ev1-collector.mjs --verify <bundle>` → rc 0, `EV1_BUNDLE_VERIFIED_COMPLETE`.
- Gate script output (verbatim): `{"B1_START_GATE":"OPEN","failed":[],"asOf":"2026-09-29","maxRowsTotal":213}`.
- Bundle digests re-computed at consumption (2026-09-29T16:54Z) — identical to `COMPLETE.json`:

| File | SHA-256 |
|---|---|
| `COMPLETE.json` | `474dfafa06558709c462168deb8ee00cb4fc7004c5c23a2626cba62ac7daa064` |
| `EV1_REPORT.json` | `5ea30c8bb25139630d0a21d566430e42554f1622e8469a2495b807768665d691` |
| `EV1_SUMMARY.md` | `001a05d2ff8e7a435e3514ba4776fd661e38a21fcc3d8262f27ff777cd590d66` |
| `PRE_FLIGHT.md` | `134d428cd3be699d7dafc1ac38aa205b289b3d0628904f98a165bc0a388a9f36` |

- Evidence freshness: through `2026-09-30T15:34:55.506Z` (consumed well inside it).
- Facts consumed (counts only; no Production value or row content copied anywhere): 5 tenants / 10 businesses (5 empty) / 520 rows, 0 unclassifiable; identity 0 valid · 520 missing · 0 malformed · 0 duplicate values; purchases 478 supplier-map rows · 282 explicit-zero · 0 skip · 0 invalid · 2 negative · 0 legacy `food_cost` · 0 collisions; labor 439 payroll · 0 `hourly_payroll` · 0 coexistence; row quality 2 zero-only · 16 purchases-only; dates 0 future · 0 invalid · 0 duplicate dates; `storageV2` 0; `maxRowsTotal` 213.
- No additional Production fact is inferred. Configuration states (global employees, fixed list, rent/royalty) are **not** sized by EV-1 (it reads entries, registry and tenant keys only) — their B1 behaviour is contract-tested, prevalence unknown.

## Scope delivered
Runtime CREATE 3 · runtime MODIFY 9 · generated 3 · test/guard CREATE 9 · test/guard MODIFY 10 + 1 VERIFY · artifacts 11 = **46 files** = the 45 manifest files (doc 05, exact) + the VERIFY file `entry-exception-parity` (red-first; registered in 04). R1 removed the unmanifested helper `test/support/core-consumer-allowlist.mjs` that B1 `658cd05` had added (47 files); its validator now lives in D1 `test/support/b1-fixtures.mjs`.

| Class | Files |
|---|---|
| Runtime CREATE | `src/policy/productFinance.ts`, `src/finance-server/canonicalInputs.ts`, `src/finance-server/canonicalMetrics.ts` |
| Runtime MODIFY | `src/repositories/analytics/{dailyMetricsRepo,laborRepo,purchasesRepo}.ts`, `src/analytics/dailyBuilder.ts`, `src/services/analyticsService.ts`, `src/insights/{baselines,rules,types}.ts`, `src/browser/marjinFinanceGlobal.ts` |
| Generated (`node tools/finance-core/gen-browser.mjs`, never hand-edited) | `fincore/v1/MANIFEST.json`, `fincore/v1/browser/marjinFinanceGlobal.js`, `fincore/v1/policy/productFinance.js` |
| Test CREATE | `test/support/b1-fixtures.mjs` (incl. the AMEND-02 validator), `test/finance/core-consumers/b1.json`, `test/finance/b1-{canonical-server-api,repositories,daily-builder,downstream-compat,guards,product-finance,purchase-aggregation}.test.mjs` |
| Test MODIFY | `test/support/server-reader-authorized-delta.mjs`, `test/finance/{s0-guard-server-reader-mutations,fincore-guards}.test.mjs`, `test/finance/consumer-manifest.json`, `test/analytics/entries-reader-{dailybuilder,repos,d1-downstream,decimal-aggregation}.test.mjs`, `test/emulator/server-readers-matrix.mjs`, `test/insights/false-insights-p0.test.mjs`, VERIFY `test/analytics/entry-exception-parity.test.mjs` |
| RETAIN (byte-identical to BASE, checked) | `index.html`, `api/**`, `lib/**`, `tools/**`, `src/{snapshot,agent,alerts,forecast,utils,firebase,pos,finance,metrics,presenters}/**`, `src/policy/{evaluate,intelligence,laborSource,purchaseBasis,registry}.ts`, `database.rules.json`, `vercel.json`, `package*.json`, `tsconfig*.json` |

VERIFY files not edited (green unchanged): `test/storage-v2/canary-readers.test.mjs`, `test/security/strict-daily-metrics.test.mjs`, `test/security/checklist-template-analytics.test.mjs`, `test/typescript/proactive-purchase-plan.test.mjs`, `test/finance/vat-invariant.test.mjs`, `test/dashboard/entries-storage-v2-hardening.test.mjs`.

## Prohibitions honoured
NO Production access · NO Production writes · NO EV-1 rerun · NO entry-ID repair · NO `biz_access` mutation · NO migration · NO backfill · NO deploy · NO Rules publish · NO push. Emulator runs used only the local RTDB emulator (`demo-marjin-rules`, `127.0.0.1:9000`, no credentials).
