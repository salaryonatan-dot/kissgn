# 09 — Codex finding closure (review `2026-09-29/codex-ev1-collector-review/`)

| Codex item | Closure | Where |
|---|---|---|
| **F1 / 00** collector candidate absent | `tools/finance-core/ev1-collector.mjs` (single entrypoint) + `ev1-transport.mjs` + `ev1-preflight.mjs`; 25 collector tests | code, 06 |
| **F2 / 01** `biz:*:entries` discovery cannot prove empty-business coverage | Authoritative sources proven from the repository. Tenants: shallow `tenants`. Businesses: registry `app/business` ∪ every stored `biz:<id>:*` key. A registered business with no entries node is discovered from the registry and recorded `READ_OK_EMPTY`. Self-id, inactive and deleted-from-registry businesses are all censused. | 01; tests 04/25, scope |
| 01 root null/empty | HTTP 200 `null` tenant root ⇒ zero tenants, success (reported) | test 25 |
| 01 no allowlist filtering | There is no tenant filter flag at all; the full scope is always enumerated | code |
| 01 deterministic sort + dedupe without hiding outcomes | Sorted tenants and businesses; identity merge per `(t, b)`; failures are separate records | test 09 |
| 01 pagination | Single complete REST responses (shallow listings are unpaginated); no continuation exists | 04 |
| 01 malformed discovery / parse ⇒ failure | `decodeShallow` / `decodeRegistry` / `storedBusinessKeys` fail closed | tests 06, malformed discovery, discovery edge cases |
| 01 scope invariant (7 equations) | I01–I07, I18, I19 | 02 |
| **F3 / 02** `evidenceComplete` bound to scope; `summarize()` not trusted | `evaluateReport` computes 19 invariants from the report; `summarize()` is not used | 02; test 08 |
| 02 items 1–12 (identity, enumeration, one outcome each, null ⇒ empty, lossless decode, classifier completion, row accounting, counter equations, empty failures, same-run binding, `COMPLETE.json` last) | I01–I19; `readEntriesNode` verbatim; `COMPLETE.json` binds runId/mode/project/as-of/classifier/repoSha/source digests/scope digest/file digests | 02, 03; bundle tests |
| 02 no `catch => []/{}`, no retry | Static test; typed failures; no retry path | tests "fail-open", 06 |
| **03** lossless classifier input | Shared reader `readEntriesNode` passes legacy `_v` arrays verbatim (non-objects, legacy fields, duplicates, invalid ids and dates kept); V2 nodes fail closed on structure. The approved `classifyBusiness` (unchanged) runs once per business on the full array. | test 10–22 |
| 03 collector counters | tenants / businesses / rows counters incl. empty and classifier-failed | 03 |
| 03 row equation + exclusive equations | I11, I12 (incl. `objectRows`, `validDate`, `noFinancialValue` partitions); overlapping groups labelled `overlapNote` | 02 |
| **F4 / 04** read-only | GET-only database transport; only POSTs = token + IAM query; no Firebase SDK in the graph; static + runtime proofs; I17 | 04 |
| 04 broad credential rejected before reads | IAM proof ⇒ `CREDENTIAL_SCOPE_TOO_BROAD`, exit 3, zero database requests | test |
| 04 environment gates (all listed) | exact env/project/db/credential/emulator/ADC/HTTPS/commit+clean/as-of/output checks | 05; test 23/24 |
| 04 safe output | counts + technical tenant/business ids; row ids removed; secret scan on write and verify | 03; bundle tests |
| **05** collector failure tests absent | 25 tests covering every listed case, plus mutation evidence | 06, 08 |
| **06** operator contract | runbook with preconditions, command shape, files, success/stop markers, post-run checks; `--verify` implements the bundle checks | 07 |

Not in scope and not done:
- EV-1 was not executed.
- No Production access.
- Slice A semantics are unchanged (`ev1-classifier.mjs`, `src/**`, `fincore/**` untouched).
