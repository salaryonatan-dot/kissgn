# R10.1 — remediation of the two Codex blocking findings

Branch `claude/p0-data-01-r10`. Parent: the reviewed R10 candidate
`1038b4cd199d01d0b8df599fb6d54411fbfff204`, which is **not amended** — this is a child
commit. Scope is the two `P0_RELEASE_BLOCKER` findings and the tests and artifacts they
directly require. No redesign, no reopened areas.

## Finding 1 — a stale delete could erase concurrent, undeclared row fields

`applyEntryIntent` checked only the paths a call site listed in `intent.base`, and both
delete call sites listed `sales`, `deliveries`, `other_income`. A second writer could
commit `supplier_payments` — or anything added to the schema later — to the same row, and
the delete still matched its declared base, committed, and removed the concurrent change
with the row while reporting success.

Fixed by making the precondition the **complete canonical target row**, so it cannot go
stale when a field is added:

- new `buildEntryDeleteIntent(prev)` produces `base.row` — the whole row, canonicalised
  through `stableStringify`;
- the transformation compares `stableStringify(baseRow)` with the persisted row and
  aborts with `conflict` on any difference;
- a delete that does **not** carry a complete base row is refused outright
  (`precondition_missing` / `delete_base_row_required`) rather than run with a partial
  guard;
- `rowDiffPaths` names exactly what moved, map fields key-by-key
  (`supplier_payments.sup9`), so the conflict reaches the operator through the typed UI
  path R10 already fixed;
- both call sites (`deleteEntryByDate`, `deleteEntryById`) use the builder, and a typed
  builder refusal is surfaced with nothing submitted.

There are **no exclusions**: every persisted field of an entry row is client-authored and
semantic — the node holds no server-generated or derived values — so nothing was carved
out. Detail: `STALE_DELETE_FIX.md`.

## Finding 2 — `biz:*:entries` had no server-side validation

The dynamic `$dataKey` branch defined `.read` and `.write` but no `.validate`, so an
authorized manager could write non-JSON `_v`, id-less rows, or an object without `_v`
directly into the authoritative node. Fixed by adding `.validate` at `$dataKey` **and** at
`$dataKey/_v` (the child path that would otherwise bypass the parent), conditional on the
key being an entries key, enforcing: `_v` present, a string, within a documented size
ceiling, and matching a structural pattern that requires a JSON array whose every element
carries a canonical lowercase RFC 4122 UUID v4 `id`. Detail: `RULES_VALIDATION.md`.

## Files changed vs `1038b4cd`

| File | +/− | What |
|---|---|---|
| `index.html` | +58 / −16 | the delete concurrency contract and both call sites |
| `database.rules.json` | +5 / −1 | the two `.validate` expressions |
| `test/emulator/database.rules.json` | +5 / −1 | the byte-identical copy the emulator loads |
| `test/dashboard/entries-stale-delete.test.mjs` | new, 31 tests | regression cases A–F |
| `test/emulator/entries-rules-validation-matrix.mjs` | new, 30 cases | adversarial Rules matrix |
| `test/emulator/entries-remote-atomic-emulator.mjs` | +62 / −1 | three real-emulator stale-delete cases (EMU-F-*) |
| `test/emulator/rtdb-authorization-matrix.mjs` | +17 / −12 | entries payloads made valid so it still measures authorization |
| `test/finance/vat-invariant.test.mjs` | +31 / −1 | the content-verified rules exception (see below) |
| `test/support/cross-writer-harness.mjs` | +11 / −4 | `del()` uses the production builder |
| `test/support/ui-call-site-harness.mjs` | +4 / −4 | delete-handler markers follow the new production text |
| `test/dashboard/entries-{concurrency-matrix,lifecycle,remote-atomic,ui-call-sites}.test.mjs` | +24 / −15 | follow the new contract; C-10c now asserts the corrected semantics |
| `test/emulator/README.md` | +52 | how to run the new matrix, and why `test/**/*.mjs` is not a regression command |

## One judgement call the reviewer must confirm

The S0 anti-migration guard lists `database.rules.json` as a forbidden path, and this
remediation was explicitly authorized to change it. Rather than exempt the path — which
would let any future rules drift through — the guard now grants the exception **by
content**: the rules tree with exactly the two added validators removed must still be
deep-equal to the base version, and both validators must actually constrain the entries
node. Three mutation probes confirm the exception is narrow. Every VAT assertion is
unchanged. This is a deliberate widening of a scope guard and is called out here rather
than buried: `VAT_GUARD_EVIDENCE` in `RULES_VALIDATION.md` and the probe results in
`TEST_RESULTS.md`.

## Not done

No amend of `1038b4cd`, no rebase, merge, cherry-pick, push or deploy. No Production or
Preview access, no backfill, no migration, no cron, no secrets, no dependency change,
no role changes, no schema redesign, nothing in the Codex weekday worktree or the stale
Desktop clone. The non-blocking comment-drift finding at `index.html:1095–1107` was left
alone: it is not adjacent to any code changed here.
