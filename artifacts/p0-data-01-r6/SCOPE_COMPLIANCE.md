# P0-DATA-01 R6 — Scope Compliance

## Allowed edits (only these)
- **Runtime:** `index.html` — edited.
- **Test:** `test/dashboard/entries-lifecycle.test.mjs` — edited.
- **Artifacts:** `artifacts/p0-data-01-r6/` — created (12 files).

`git diff --name-status 088310c3 HEAD` = `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs`,
`A artifacts/p0-data-01-r6/*`. Nothing else.

## Not changed
- `package.json` / `package-lock.json` — **byte-identical to R5**.
- `database.rules.json`, `vercel.json`, `api/`, `lib/`, `src/`, all other runtime/config/server files.
- RTDB schema / path semantics / Rules / auth / listener envelope. The destination lane is client-only;
  the RTDB key structure (`biz:{bizId}:entries`) and `{_v}` envelope are unchanged. Security suites
  (`entries-isolation`, `biz-keys-isolation`, `biz-access`, `entry-exceptions` CLIENT WIRING) pass.
- No dependency install/update; no `npx` download.
- R5/R4/R3/R2/S0/R1.1 worktrees and the canonical repo — read-only; all at expected HEADs.
- AgentBrothers untouched. The forbidden stale clone was never inspected.
- The guarded RTDB emulator test was not invoked.

## Prohibitions honored
No amend of R5; exactly one new local commit on the R6 branch. No merge/rebase/squash/push/deploy.
No Firebase/RTDB/production/external-API calls. No schema/Rules/API/package/dependency/config change.
No S2/S4A. No financial-formula change. No partial-persistence, failed test, or environmental
limitation concealed (see `KNOWN_LIMITATIONS.md`).

## No listener-envelope / schema change was needed
The listener local-before-ack fix is entirely client-side (content-fingerprint ownership); it did not
require any Firebase schema, envelope, or Rules change. No `BLOCKED_SCOPE_EXPANSION` condition arose.

## Read-only worktrees (verified unchanged this session)
| Worktree | Expected | Observed |
|---|---|---|
| R5 | `088310c3…` | `088310c3…` |
| R4 | `6c4d9eb1…` | `6c4d9eb1…` |
| R3 | `eed85e23…` | `eed85e23…` |
| R2 | `ddd4163…` | `ddd4163…` |
| S0 | `b16f5567…` | `b16f5567…` |
| R1.1 | `130f57c5…` | `130f57c5…` |

## Formula containment
No active financial formula changed. `vat-invariant` 5/5 (single VAT literal + single division + no
stored-revenue division + S0 diff-guard green — the R6 runtime diff vs base `686b4350` adds no
`migration/_rtdbSet/storage.set/set(ref/remove(ref/persist(/entries =` line). Forecast suites pass.
