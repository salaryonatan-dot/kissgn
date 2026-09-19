# S0 Guard Hardening (Codex SV2-09)

## Finding
The content-verified rules exception in `test/finance/vat-invariant.test.mjs` accepted
validators wrapped as `true || (original)` because it only checked that expected tokens
were present (Codex `s0-mutations.json`: 3 of 8 mutations accepted).

## Change
`test/support/rules-authorized-delta.mjs` pins the authorized entries delta as LITERAL
expressions (`EXPECTED_ENTRIES_DELTA`, `CUTOVER_GUARD`, `expectedWriteRule(base)`), and
`authorizedEntriesRulesDelta(before, after)`:
1. requires `$dataKey/.write` to equal the BASE rule with the entries branch wrapped
   exactly once as `(<base branch> && <CUTOVER_GUARD>)` — the authorization predicate is
   byte-identical by construction;
2. compares each authorized location (`.validate`, `_v`, `schemaVersion`, `generation`,
   `rows` subtree) to its pinned expression as a whitespace-normalized expression tree —
   an inert wrapper, a reordered predicate, a loosened comparison, a renamed key, a dropped
   clause or a smuggled child rule all differ and are rejected;
3. requires the tree with the authorized delta removed to be deep-equal to the base.
No Rules interpreter is built. Changing the storage contract now REQUIRES changing the
pinned module in the same reviewed change.

The VAT test's closure delegates to this module; `[H10]` proves that, against the parent
commit, the ONLY differences in `vat-invariant.test.mjs` are the import and the body of
that closure — every VAT assertion is byte-identical. The forbidden-path list, the
runtime-line regex and all other S0 checks are untouched and still pass (5/5).

## Proof
- `[H10]` unit: candidate accepted; 18 mutations rejected (Codex's 8 — incl. the three
  previously accepted inert wrappers — plus `_v`/`schemaVersion` wrappers, cutover guard
  dropped/weakened, rows map rule dropped, epoch step/rollback loosened, stamp renamed,
  legacy regex loosened, extra child rule, VAT-adjacent node); a whitespace-only change is
  NOT a mutation.
- `test/emulator/storage-v2-rules-guard-mutations.mjs`: 12 mutations loaded into the real
  emulator through its settings endpoint; for each, a write the shipped Rules DENY becomes
  ALLOWED, the shipped Rules are restored and it is DENIED again, and the guard rejects
  the mutation — 12/12 in three rounds. So every rejection is a real loss of enforcement.

Result: **PASS** (S0_GUARD).
