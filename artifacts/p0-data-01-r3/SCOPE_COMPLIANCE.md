# R3 Scope Compliance

- Source changes: `index.html` only. Test changes: `test/dashboard/entries-lifecycle.test.mjs` only. Artifacts: `artifacts/p0-data-01-r3/` only.
- No formula change (revenue/VAT/forecast/confidence/food/labor/fixed/profit); business-date semantics, duplicate precedence and the exception API contract unchanged — proven by file containment (2 code/test files), VAT 5/5, forecast 2/2, and the full 376/376 suite.
- No S2/S4 files; no new financial engine; no consumer/surface migration; no new state-management framework or dependency.
- No dependency/package/lockfile change (byte-identical). No RTDB schema/paths, no Firebase Rules, no roles/permissions/secrets.
- No R2 in-place modification; original P0, S0, R1.1 and canonical repositories untouched (R1.1 verified at 130f57c5; R2 tracked-clean). Forbidden stale clone never inspected.
- No merge, rebase, amend of ddd4163, push, deploy, Firebase/RTDB/Production access, external API call, migration or backfill.
- Consumers were NOT changed to hide duplicates; canonical upstream state remains the contract.
