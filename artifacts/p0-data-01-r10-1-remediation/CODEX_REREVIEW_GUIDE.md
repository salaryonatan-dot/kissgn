# Codex re-review guide — P0-DATA-01 R10.1

**No approval is claimed.** This commit answers the two `P0_RELEASE_BLOCKER` findings from
the 2026-09-15 review and nothing else. P0-DATA-01 remains **OPEN**.

## Identity

| Field | Value |
|---|---|
| Repository | `/Users/yonatan/Documents/marjin/kissgn` |
| Worktree | `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10` |
| Branch | `claude/p0-data-01-r10` |
| **Prior reviewed SHA** | **`1038b4cd199d01d0b8df599fb6d54411fbfff204`** — not amended, not rebased |
| **Remediation SHA** | the single commit on this branch whose parent is `1038b4cd` — `git rev-parse claude/p0-data-01-r10`. Not transcribed here because this file is inside that commit. |
| Pushed / merged / deployed | **no, no, no** |

```
git diff 1038b4cd199d01d0b8df599fb6d54411fbfff204 claude/p0-data-01-r10
git show --stat --oneline claude/p0-data-01-r10
```

## Exact diff between the two commits

Runtime (one file):

| File | +/− |
|---|---|
| `index.html` | +58 / −16 |
| `database.rules.json` | +5 / −1 |

Tests, harnesses, docs:

| File | +/− | Why |
|---|---|---|
| `test/dashboard/entries-stale-delete.test.mjs` | **new**, 31 tests | finding 1, cases A–F |
| `test/emulator/entries-rules-validation-matrix.mjs` | **new**, 30 cases | finding 2, adversarial matrix |
| `test/emulator/entries-remote-atomic-emulator.mjs` | +62 / −1 | three real-emulator stale-delete cases |
| `test/emulator/rtdb-authorization-matrix.mjs` | +17 / −12 | entries payloads made valid; **no expected value changed** |
| `test/emulator/database.rules.json` | +5 / −1 | byte-identical copy of the canonical rules |
| `test/finance/vat-invariant.test.mjs` | +31 / −1 | content-verified rules exception; **assertions unchanged** |
| `test/support/cross-writer-harness.mjs` | +11 / −4 | `del()` uses the production builder |
| `test/support/ui-call-site-harness.mjs` | +4 / −4 | delete-handler markers |
| `test/dashboard/entries-concurrency-matrix.test.mjs` | +13 / −9 | C-10c now asserts the corrected semantics |
| `test/dashboard/entries-ui-call-sites.test.mjs` | +4 / −2 | G5-D01 asserts the complete base row |
| `test/dashboard/entries-lifecycle.test.mjs` | +4 / −2 | `FREEZE` surface + `removeRow` uses the builder |
| `test/dashboard/entries-remote-atomic.test.mjs` | +3 / −2 | `del()` uses the builder |
| `test/emulator/README.md` | +52 | new commands; why `test/**/*.mjs` is not a regression command |
| `artifacts/p0-data-01-r10-1-remediation/` | **new**, 7 docs | this evidence set |

## The two original blockers, and how each was closed

### Blocker 1 — "stale delete can erase concurrent undeclared row fields"

Your probe: A renders a row, B commits `supplier_payments`, A deletes from the stale view,
the delete **commits** because the declared base (`sales`, `deliveries`, `other_income`)
still matches, and B's change disappears with the row.

Closed by replacing the declared-path base with the **complete canonical row**:

- `buildEntryDeleteIntent(prev)` emits `base.row` — the whole row via `stableStringify`;
- the transformation compares the stored row against it and aborts with `conflict`;
- a delete with **no** complete base row is refused (`precondition_missing` /
  `delete_base_row_required`), so the guard cannot be opted out of;
- `rowDiffPaths` names what moved, map fields key-by-key;
- both call sites use the builder and surface a typed builder refusal without submitting.

**No exclusions.** Every persisted field of an entry row is client-authored and semantic;
the node carries no server-generated value. `SD-F1` asserts the base row's key set equals
the row's key set, so an exclusion cannot appear silently.

Ownership is untouched: id-only target resolution, no date fallback, no positional
fallback, same coordinator / mutator / selection controller.

### Blocker 2 — "`biz:*:entries` lacks server-side `.validate`"

Your probe: non-JSON `_v`, id-less row JSON and object-without-`_v` all **allowed** for a
permitted manager.

Closed by adding `.validate` at `$dataKey` **and** `$dataKey/_v`, conditional on the key
matching `^biz:[^:]+:entries$`, requiring `_v` present, a string, ≤ 1 MiB, and matching a
structure that admits only an empty array or an array whose every element carries a
canonical lowercase UUID v4 `id`. The `_v` child rule exists because RTDB does not
evaluate ancestor `.validate` rules, so a direct child write would otherwise bypass the
parent — `R-D12`/`R-D13` prove that path is closed.

Two schema facts were verified before the pattern was written, not assumed: the create
path serialises `id` **last** (`R-A02`), and rows contain nested objects and free text that
may contain braces (`R-A09`).

## Negative-control evidence

| Control | Where | Result |
|---|---|---|
| The superseded partial-field base is refused, and the test shows why it used to pass — declared paths unchanged while the row had changed | `SD-F` | PASS |
| R9 full-node overwrite still reproduces the historical lost update on the real emulator | `EMU-B-negctl-*` | PASS — the suite can still see the old bug |
| The S0 rules exception rejects an unrelated authorization loosening | probe 1 | guard FAILS, as required |
| The S0 rules exception rejects inert validators | probe 2 | guard FAILS |
| The S0 rules exception rejects an extra key under `_v` | probe 3 | guard FAILS |

## Emulator commands

`test/emulator/README.md` — "Run the R10 concurrency validation", "Run the entries Rules
validation matrix", "Running all three emulator scripts together". Java 21+ required by
firebase-tools 15.23.0; if the emulator JAR cannot be downloaded, place
`firebase-database-emulator-v4.11.2.jar` in `~/.cache/firebase/emulators/`; if rules
loading reports *Request was cancelled*, unset the proxy variables for the command.

The three scripts each reseed the database root and must run one at a time.

## Firebase Rules allow/deny matrix — 30 cases, 13 allow / 17 deny

**Allow** — `R-A01` valid node · `R-A02` create shape with `id` LAST · `R-A03` field edit ·
`R-A04` row removed · `R-A05` clear-all `[]` · `R-A06` duplicate dates, distinct ids ·
`R-A07` 160-date history, mixed key order · `R-A08` row with only an id · `R-A09` free text
with braces · `R-A10` direct `_v` child write, valid · `R-A11` owner role · `R-A12` real
RTDB transaction · `R-A13` escaped quotes and Hebrew.

**Deny** — `R-D01` non-JSON `_v` · `R-D02` id-less row JSON · `R-D03` object without `_v` ·
`R-D04` id-less row among valid rows · `R-D05` `_v` not a string · `R-D06` truncated JSON ·
`R-D07` uppercase id · `R-D08` wrong version nibble · `R-D09` wrong variant nibble ·
`R-D10` array of scalars · `R-D11` object where an array is required · `R-D12` direct `_v`
child bypass · `R-D13` id-less rows via the child path · `R-D14` beyond the size ceiling ·
`R-D15` cross-business · `R-D16` viewer role · `R-D17` unauthenticated.

`R-D01`, `R-D02`, `R-D03` are exactly the three writes you demonstrated as allowed.

## Full-suite results

```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 689   # pass 689   # fail 0   # cancelled 0   # skipped 0   # todo 0      (×3 identical)

node --test --test-concurrency=8 test/**/*.mjs                      (no emulator)
# tests 631   # pass 628   # fail 3   — the three emulator scripts' own safety gate

<the same 47 files, sequentially, inside an emulator>
# tests 631   # pass 631   # fail 0
```

Emulator, three consecutive rounds: authorization 108/108, R10 concurrency 19/19, Rules
validation 30/30. `tsc --noEmit` exit 2 with exactly 22 `TS2742` in `src/firebase/refs.ts`
— the documented baseline. `git diff --check` exit 0.

## Where to push hardest

1. **The S0 guard exception.** `database.rules.json` was a forbidden path. Rather than
   exempt it, the guard now verifies by content that the rules tree minus exactly the two
   added validators is deep-equal to the base. Confirm that is the right call, or tell us
   to revert the rules change and reopen blocker 2.
2. **The rules pattern.** It is structural only — no id uniqueness, no per-field types, and
   a crafted string could contain a fake `"id":"<uuid>"`. Is a structural floor sufficient
   for this blocker, or is a node-shape change required?
3. **`},{` in free text** is denied by the pattern. Acceptable?
4. **Whole-row delete precondition friction.** A delete from a slightly stale view is now
   refused and must be retried. Confirm the trade.
5. **`_v` child deletion** still bypasses validation (RTDB does not validate deletes).
   Runtime fails closed on the resulting `{}`; is that acceptable?
6. **The authorization-matrix payload change** — expected values unchanged, payload made
   valid. Confirm the matrix still measures what it did.

## Reading order

`CHANGE_SUMMARY.md` → `STALE_DELETE_FIX.md` → `RULES_VALIDATION.md` →
`EMULATOR_RESULTS.md` → `TEST_RESULTS.md` → `KNOWN_LIMITATIONS.md`. R10 context:
`../p0-data-01-r10-final-candidate/` and `../p0-data-01-r10/`.
