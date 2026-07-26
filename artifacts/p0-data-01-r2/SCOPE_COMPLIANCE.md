# P0-DATA-01 R2 Scope Compliance

- No S2 (no `src/finance/contract.ts`, no financial data contract implementation).
- No S4A (no `src/metrics/core.ts`, no `computeMetrics`, no engine).
- No formula redesign: revenue, VAT, forecast, labor, food-cost, fixed-cost, profit, rounding and the business-date definition are unchanged (file containment: only `index.html` + one test changed; VAT guard 5/5; forecast suites pass).
- No schema change, no migration, no backfill, no stored-data transformation.
- No dependency change (`package.json`/`package-lock.json` byte-identical; nothing installed).
- No Firebase Rules change; no Firebase/RTDB/Production access; no external API calls.
- No canonical-repo edit; no S0-worktree edit; no original-P0-worktree edit (`kissgn-p0-data-01` untouched; Codex review target immutable); no edit to `artifacts/p0-data-01/`.
- No push, no merge, no deploy, no amend of 74150537, no squash.
- Secrets, credentials, permissions, roles: untouched.
