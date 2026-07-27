# P0-DATA-01 R5 — Scope Compliance

## Allowed edits (only these)
- **Runtime:** `index.html` — edited.
- **Test:** `test/dashboard/entries-lifecycle.test.mjs` — edited.
- **Artifacts:** `artifacts/p0-data-01-r5/` — created (11 files).

`git diff --name-status 6c4d9eb1 HEAD` = `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs`,
`A artifacts/p0-data-01-r5/*`. Nothing else.

## Not changed
- `package.json` / `package-lock.json` — **byte-identical to R4**.
- `database.rules.json`, `vercel.json`, `api/`, `lib/`, `src/`, all other runtime/config/server files.
- RTDB schema / path semantics / Rules / auth. The new supplier serialization is client-only; the RTDB
  key structure (`biz:{bizId}:entries`) and `{_v}` envelope are unchanged. Security suites
  (`entries-isolation`, `biz-keys-isolation`, `biz-access`, `entry-exceptions` CLIENT WIRING) pass unchanged.
- No dependency install/update; no `npx` download.
- R4/R3/R2/original-P0/S0/R1.1 worktrees and the canonical repo — read-only; all at expected HEADs.
- AgentBrothers untouched.

## Prohibitions honored
No amend of R4; exactly one new local commit on the R5 branch. No merge/rebase/squash/push/deploy.
No Firebase/RTDB/production/external-API calls (deferred stub transports only). No schema/Rules/API/
package/dependency/config change. No S2/S4A. No financial-formula change. No partial-persistence, failed
test, or environmental limitation concealed (see `KNOWN_LIMITATIONS.md`). The forbidden stale clone was
never inspected. The guarded RTDB emulator test was not invoked.

## Read-only worktrees (verified unchanged this session)
| Worktree | Expected | Observed |
|---|---|---|
| R4 | `6c4d9eb1…` | `6c4d9eb1…` |
| R3 | `eed85e23…` | `eed85e23…` |
| R2 | `ddd4163…` | `ddd4163…` |
| original P0 | `74150537…` | `74150537…` |
| S0 | `b16f5567…` | `b16f5567…` |
| R1.1 | `130f57c5…` | `130f57c5…` |

## Formula containment
No active financial formula changed. `vat-invariant` 5/5 (single VAT literal + single division + no
stored-revenue division + S0 diff-guard green — the R5 runtime diff vs base `686b4350` adds no
`migration/_rtdbSet/storage.set/set(ref/remove(ref/persist(/entries =` line). Forecast suites pass.

## Storage-adapter note
No storage-adapter change beyond R4's existing `window.storage.setFor` (already in `index.html`); R5
does not touch package files or add any runtime file. The authorized single storage-adapter-file
allowance was not needed.
