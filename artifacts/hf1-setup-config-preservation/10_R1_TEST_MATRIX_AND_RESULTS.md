# 10 — R1 test matrix, traceability and results

Suite: `test/dashboard/setup-config-preservation.test.mjs` — **51 named cases** = the original 23 + the 28 mandatory scenarios (R1-01…R1-28, contract 05 numbering). Every case runs the production text of `index.html` (`finish`, the edit-mode `onComplete`, the HF-1 helper block, the Employees / petty-cash writers) in `node:vm`.

Negative controls (the same test file against an older `index.html` in an isolated temp tree):
- original HF-1 candidate `95d20d86`: **21 pass / 30 fail** — every concurrency scenario fails with real data loss (e.g. R1-01: the concurrently added employee is gone), every post-check selection scenario fails with writes continuing after the selection changed (R1-19/21/23), plus 9c / 12 / owned-list order;
- base `05bf5a59`: **3 pass / 48 fail**.
R1: **51 / 51**.

| Case | Base `05bf5a59` | Candidate `95d20d86` | R1 |
|---|---|---|---|
| 1 editing the business name preserves employees (and every non-owned key) | FAIL | PASS | PASS |
| 2 editing business metadata (rent/royalty) preserves petty-cash categories | FAIL | PASS | PASS |
| 3 editing targets preserves employees; unknown target sub-keys survive | FAIL | PASS | PASS |
| 4 editing employees (and petty-cash categories) after a wizard edit preserves unrelated settings | FAIL | PASS | PASS |
| 5 absent optional fields stay absent (no location / employees / categories invented) | FAIL | PASS | PASS |
| 6 no key is ever deleted by a wizard edit; only owned keys change, by explicit value | FAIL | PASS | PASS |
| 7 unknown / future config keys survive an edit | FAIL | PASS | PASS |
| 8 nested unrelated objects survive byte-for-byte | FAIL | PASS | PASS |
| 9 malformed stored config (unparseable _v) ⇒ nothing is written, the user is told, the wizard stays open | FAIL | PASS | PASS |
| 9 malformed stored config (_v is an array) ⇒ nothing is written, the user is told, the wizard stays open | FAIL | PASS | PASS |
| 9 malformed stored config (_v is JSON null) ⇒ nothing is written, the user is told, the wizard stays open | FAIL | PASS | PASS |
| 9 malformed stored config (_v is a number) ⇒ nothing is written, the user is told, the wizard stays open | FAIL | PASS | PASS |
| 9 malformed stored config (_v is a JSON string) ⇒ nothing is written, the user is told, the wizard stays open | FAIL | PASS | PASS |
| 9b a failed read (e.g. permission / network) is not treated as 'absent' ⇒ nothing is written | FAIL | PASS | PASS |
| 9c the selection changes while the stored config is being read (in the config transaction) ⇒ only that in-flight conf… | FAIL | FAIL | PASS |
| 10 a repeated identical edit is idempotent (byte-identical stored config) | PASS | PASS | PASS |
| 11 create-new-business path is unchanged: completeSetup writes the wizard cfg for a fresh business id | PASS | PASS | PASS |
| 11b edit of a business whose config was never stored writes the wizard fields only | PASS | PASS | PASS |
| 12 the first business (bizId === tenantId) is edited in place under its own key | FAIL | FAIL | PASS |
| owned lists (suppliers, fixed costs) and the business list are still written by the edit | FAIL | FAIL | PASS |
| helper: ownership list is exactly the keys the wizard's cfg literal writes | FAIL | PASS | PASS |
| helper: merge is pure, ignores non-owned keys offered by the caller, and never deletes | FAIL | PASS | PASS |
| helper: stored-config decoding distinguishes absent, valid and malformed | FAIL | PASS | PASS |
| R1-01 an employee added between the initial UI state and the commit survives; the wizard edit commits | FAIL | FAIL | PASS |
| R1-02 petty-cash categories changed concurrently survive | FAIL | FAIL | PASS |
| R1-03 an unknown / future top-level key changed concurrently survives byte-for-value | FAIL | FAIL | PASS |
| R1-04 an unknown nested object changed concurrently keeps its latest nested value | FAIL | FAIL | PASS |
| R1-05 an unknown targets sub-key changed concurrently survives; the owned target edits apply | FAIL | FAIL | PASS |
| R1-06 the same wizard-owned key changed concurrently ⇒ the wizard's submitted value deterministically wins at its commit | FAIL | FAIL | PASS |
| R1-07 two compare-and-swap conflicts with cumulative unrelated edits ⇒ every edit survives; the intent commits once | FAIL | FAIL | PASS |
| R1-08 the transaction callback is pure and re-entrant: same input ⇒ same output, no I/O / UI / clock / randomness, in… | FAIL | FAIL | PASS |
| R1-09 a CONFIRMED-absent config node ⇒ a valid `_v` envelope is created (absent ≠ unreadable) | FAIL | FAIL | PASS |
| R1-10 a legacy direct-object config (no `_v`) keeps every property and is normalised to the `_v` envelope | FAIL | PASS | PASS |
| R1-11 unknown sibling nodes of the envelope survive while `_v` changes | FAIL | FAIL | PASS |
| R1-12 `_v` is invalid JSON ⇒ the transaction aborts; zero later writes; wizard stays open; visible error | FAIL | FAIL | PASS |
| R1-13 `_v` parsing to null / array / primitive, a non-string `_v`, or a non-object node ⇒ each aborts with no write | FAIL | FAIL | PASS |
| R1-14 the transaction rejects (permission / network / read failure) ⇒ zero later writes, no success UI, typed failure | FAIL | FAIL | PASS |
| R1-15 SDK retry exhaustion and `committed:false` are failures: no outer blind retry, no later writes | FAIL | FAIL | PASS |
| R1-16 a selection that is already stale before the first dispatch ⇒ zero writes and zero state changes | FAIL | FAIL | PASS |
| R1-17 selection changes while the config transaction is pending ⇒ only it settles, at the captured tenant/business; n… | FAIL | FAIL | PASS |
| R1-18 selection changes after config settles, before the app-businesses dispatch ⇒ no app-businesses / supplier / fix… | FAIL | FAIL | PASS |
| R1-19 selection changes while the app-businesses write is pending ⇒ it stays on the captured tenant; suppliers / fixe… | FAIL | FAIL | PASS |
| R1-20 selection changes before the supplier dispatch ⇒ suppliers / fixed never dispatch; no success UI | FAIL | FAIL | PASS |
| R1-21 selection changes while the supplier write is pending ⇒ it stays on the captured tenant/business; fixed never d… | FAIL | FAIL | PASS |
| R1-22 selection changes before the fixed-cost dispatch ⇒ fixed never dispatches; no success UI | FAIL | FAIL | PASS |
| R1-23 selection changes while the fixed-cost write is pending ⇒ it stays captured; the stale completion cannot close … | FAIL | FAIL | PASS |
| R1-24 the same bizId under a different tenant / generation ⇒ no cross-tenant write; every path uses the captured tenant | FAIL | FAIL | PASS |
| R1-25 app-businesses / supplier / fixed failures, each injected separately ⇒ stop at the first failure, visible, wiza… | FAIL | FAIL | PASS |
| R1-26 duplicate click / an older submission completing after a newer token ⇒ only the current operation owns later wr… | FAIL | FAIL | PASS |
| R1-27 create-new-business and first-business paths keep their behaviour and write set (completeSetup byte-identical) | FAIL | FAIL | PASS |
| R1-28 repeated edits + combined employee / petty-cash / unknown interleavings ⇒ idempotent final values, no unrelated… | FAIL | FAIL | PASS |

Changed expectations of the original 23 (all still present, same numbering):
- **9c** — the read now happens inside the atomic config transaction, so "selection changes during the read" = contract scenario 17: the in-flight config write may settle only at the captured tenant/business; nothing else is written and no UI changes (was: nothing written, because the old read was a separate call).
- **12** — asserts the transaction target `(tenantId, biz:{tenantId}:config)` and that no legacy `get` happens (was: one legacy `get`).
- **owned lists** — the write order is now config → `app-businesses` → suppliers → fixed, via `txn` then `setFor` (was: `app-businesses` first via mutable-tenant `set`).
The storage harness gained the explicit-tenant transports with RTDB-transaction semantics (rerun on conflict, 25-attempt bound, abort on `undefined`), deferred writes and failure injection; the legacy `set` honours the same hooks so the pre-R1 handler is exercised by the same scenarios.

## Other results (cloud, fresh `TMPDIR`)
| Check | Result |
|---|---|
| Full suite `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **1016 / 1016** (= 988 + 28), 0 fail / cancelled / skipped |
| P0 scheduled-auth focused (7 files, doc `artifacts/p0-scheduled-auth-release/09`) | **138 / 138** |
| `tsc -p tsconfig.json --noEmit` | 22 × TS2742 (unchanged `src/firebase/refs.ts`); 0 other |
| `git diff --check` | clean |
| Parse of the four `index.html` scripts (TypeScript parser; JSX for `text/babel`) | 0 errors |
| Rules | `database.rules.json` byte-identical (no emulator run needed for Rules; none changed) |
Mac results: in the external Codex handoff (produced after this commit exists).
