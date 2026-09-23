# S0 EXACT PIN — Codex SR-F2

## Finding
R0 pinned, per authorized file, the normalized `+`/`-` lines of the diff against the approved core. Hunk positions were dropped, so moving the approved `todayEntry` declaration below its first use kept the same normalized lines → guard `{ok:true}` while the compiled mutant threw `ReferenceError: Cannot access 'todayEntry' before initialization`.

## Model now in force (Layer B)
**Exact content identity.** For each of exactly five files the guard computes the git blob SHA-1 of the working-tree bytes — `sha1("blob <byteLength>\0" + bytes)`, identical to `git hash-object` (asserted in the positive control) — and requires it to equal the pinned blob of the reviewed version:

```
src/analytics/dailyBuilder.ts                     a327186c90e957a44aeeb40a023734e2f0c027c1
src/repositories/analytics/dailyMetricsRepo.ts    51675f0af60cc33926ae74281e8295eb3df4b3b4
src/repositories/analytics/laborRepo.ts           33a646e92523f758d70b1707652cf39fc36c4605
src/repositories/analytics/purchasesRepo.ts       6a3f9be2a5c4ceec7d5339cbda50d61fd28513af
src/snapshot/snapshotBuilder.ts                   e36df4d83d945d16e158dacc82b12ce2500f9956
```

The guard proves "this protected file IS the reviewed version" — nothing is normalized, no diff is inspected, no token is searched for. Whitespace policy is strict (a single extra space fails).

Verdict rules (`serverReaderScopeVerdict`): every authorized key must be a plain `.ts` path under `src/(analytics|repositories|snapshot)/` — no directory, glob, regex metacharacter, `..`, leading slash; `src/agent/**` and `src/forecast/**` are not authorizable at all; every pin must be a 40-hex SHA; a pin equal to the core blob is rejected (`pin_equals_base` — a non-change must not be listed); any changed protected path outside the five → `unauthorized_protected_path`; blob ≠ pin (or file absent) → `approved_content_mismatch`. Test 5 also asserts each file is present and differs from `8cac71c1`.

Layer A unchanged: BASE `686b4350` → core `8cac71c1` forbidden-path check with the semantic Rules exception; live Rules must satisfy it and must not change after the core; VAT assertions 1–4 and the added-line regex byte-identical (pinned by [H10], unchanged in R1).

## Consequences
- Any future edit to one of the five files — code, comment, whitespace — fails test 5 and the mutation suite until the blob is deliberately re-pinned in a reviewed change; the guard is a change detector, not an exemption.
- Re-approval procedure: review the file, `git hash-object <file>`, replace the pin, commit both together.
- No `src/agent` file is authorized in R1 (Blocker 1 was closed at the repository boundary), so every `src/agent` modification fails as `unauthorized_protected_path`.

## Files
`test/support/server-reader-authorized-delta.mjs` (rewritten in place; historical name), `test/finance/vat-invariant.test.mjs` (test 5 Layer B block only), `test/finance/s0-guard-server-reader-mutations.test.mjs` (rewritten).
