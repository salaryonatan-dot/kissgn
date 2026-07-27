# P0-DATA-01 R4 — Scope Compliance

## Allowed edits (only these)

- **Runtime:** `index.html` — edited. This file also *defines* `window.storage` (the storage
  adapter is inline, not a separate file), so the authorized minimal explicit-tenant storage
  method (`window.storage.setFor`) was added **within `index.html`**. No separate storage-adapter
  file exists or was touched. The authorization's "one storage-adapter file" allowance was
  therefore not needed as an extra file.
- **Test:** `test/dashboard/entries-lifecycle.test.mjs` — edited.
- **Artifacts:** `artifacts/p0-data-01-r4/` — created (11 files).

`git diff --name-status eed85e23 HEAD` = `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs`,
`A artifacts/p0-data-01-r4/*`. Nothing else.

## Storage-adapter assessment (authorization item)

`window.storage.set`/`get`/`subscribe` derive the RTDB path from the mutable `_currentTenantId`
global via `fkey`/`fkeyShared`, with **no** explicit-tenant entry point — so an entries write
dispatched after a tenant switch could land in the wrong tenant. Because the adapter lives inside
`index.html` (the primary allowed runtime file), the fix is a **minimal, additive, backward-compatible**
method there: `window.storage.setFor(tenantId, key, value, shared)` computes the path from an explicit
tenant argument using the identical `tenants/{tenantId}/…` layout and `{_v}` envelope. `set`/`get`/
`subscribe` are unchanged; no other consumer is affected. No separate storage-adapter file was required,
so **no extra file outside `index.html` was edited** and the task did not need to return `BLOCKED`.

## No RTDB schema / path-semantics / Rules / auth change

`storage.setFor` writes to the same key structure (`biz:{bizId}:entries` / `biz:{bizId}:fixed`) under
the same `tenants/{tenantId}/` root. `database.rules.json` untouched. The `biz-keys-isolation`,
`entries-isolation`, `biz-access` and other security suites (which assert on `database.rules.json`
and the `biz:{bizId}:*` key shape) all pass unchanged.

## Prohibitions — all honored

- No amend of R3; exactly one new local commit created on the R4 branch.
- No merge / rebase / push / deploy.
- No Firebase / RTDB / production / external-API calls (tests use deferred stub transports).
- No dependency install/update; `package.json`/`package-lock.json` byte-identical to R2.
- No schema / Rules / secrets / credentials / roles / permissions change.
- No S2 or S4A implementation; no financial consumer migration; no new financial formula.
- No change to revenue/VAT/forecast/food-cost/labor/fixed/profit formulas or business-date semantics.
- No change to the structured-exception API contract or revision model.
- AgentBrothers untouched. The forbidden stale clone was never inspected.
- R3, R2, original P0, S0, R1.1 worktrees and the canonical repo — read-only; all at expected HEADs.
- No partial persistence, failed test, or environmental limitation concealed (see `KNOWN_LIMITATIONS.md`).

## Read-only worktrees (verified unchanged this session)

| Worktree | Expected HEAD | Observed |
|---|---|---|
| R3 | `eed85e23…` | `eed85e23…` |
| R2 | `ddd4163…` | `ddd4163…` |
| original P0 | `74150537…` | `74150537…` |
| S0 | `b16f5567…` | `b16f5567…` |
| R1.1 | `130f57c5…` | `130f57c5…` |

## Formula containment

No active financial formula changed. `vat-invariant.test.mjs` (single VAT literal + single sanctioned
division + no stored-revenue division + S0 diff-guard) passes 5/5. Forecast suites pass. The R4 runtime
diff vs base `686b4350` adds no `migration/_rtdbSet/storage.set/set(ref/remove(ref/persist(/entries =`
line (the S0 diff-guard is green).
