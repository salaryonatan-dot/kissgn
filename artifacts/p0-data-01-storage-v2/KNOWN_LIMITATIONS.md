# Known limitations — Storage V2 candidate

Nothing here claims P0-DATA-01 is closed. This is a candidate.

## What this candidate is, and is not

It is: the V2 contract, the Rules that enforce it, the dual-mode read path, the row-scoped
write path, the generation/clear-all contract, the preflight, the atomic cutover primitive,
and emulator proof of all of it.

It is **not** a Production rollout, and it is not a complete UI cutover. See §1.

## 1. The React layer is wired for V2 at the seams, not end-to-end

The hydration listener, the storage-mode detection and the write router are real and wired:
the coordinator's `mutate()` goes through the router, and the entries listener feeds
`readEntriesNode`. What has **not** been done is a pass over every screen that assumes the
legacy array shape in ways beyond the lane — and the server-side readers
(`src/alerts/checkers.ts` ×2, `src/analytics/dailyBuilder.ts`, `src/snapshot/snapshotBuilder.ts`)
still unwrap `_v` only. For a converted business those readers would see the frozen
snapshot. **They must be updated before any Production business is converted**, and that is
the single largest remaining piece of work.

## 2. Rows are ordered by (date, id) on read

A Firebase object has no array order, so `readV2Rows` sorts deterministically by business
date then id. Legacy preserved the stored array order. Nothing in the system treats row
order as identity — R10 made that explicit — but any screen that happened to rely on
insertion order will see a different, stable order.

## 3. Field-level typing is still the pre-existing floor

Beyond `id`, `gen` and `date`, row fields are not type-constrained by Rules. Codex's P1
findings about invalid field types and invalid date *semantics* are therefore still open.
Closing them is a data-model decision, explicitly out of scope here; the structural
identity contract is what this task was for.

## 4. `_v` child deletion is still possible

RTDB does not evaluate `.validate` on deletes, so an authorized client can still remove a
child. Deleting the frozen `_v` costs only the rollback artifact. Deleting `schemaVersion`
would be worse — it would strip the mode marker — so the runtime treats a node with V2
structure and no schema marker as **malformed** and refuses it (`V2-X02`) rather than
reading it as legacy. Fail-closed, but the delete itself is not preventable in Rules.

## 5. The legacy `},{` artifact remains for unconverted businesses

V2 has no serialization pattern, so free text is unconstrained there (`V2-I07`). A business
still on legacy keeps the R10.1 validator and its `},{` false rejection until it is
converted. That is an argument for converting, not a new defect, and the legacy validator
was left exactly as accepted rather than loosened under cover of this task.

## 6. Rollback is one-way after the first V2 write

See `ROLLBACK_BOUNDARY.md`. There is no automatic rollback and there should not be. The
boundary is knowable but not currently *recorded*; deciding whether to record it explicitly
is a small call to make before Production rollout.

## 7. The stale-tab message is generic

A legacy client after cutover gets the generic save-failure text. Correct and fail-closed,
but "reload this page" would serve the operator better. UX addition, not done unilaterally.

## 8. Scale

The emulator fixtures are small (3–4 rows). Per-row transactions should scale better than
whole-node CAS, not worse, but a business with thousands of rows will hydrate an object of
thousands of children rather than one string — worth measuring before rollout.

## 9. The rules diff is large for cosmetic reasons

`database.rules.json` shows 205/180 because the file was re-serialized with a consistent
indent. The S0 content check, not the line count, is what proves nothing but the authorized
validators changed.

## 10. Independent review status

Not reviewed. The last independent verdict on this workstream is `CHANGES_REQUIRED` on
`f9168213`, whose blockers this candidate answers by changing the storage shape — the
course the CTO chose after the R10.2 feasibility gate. P0-DATA-01 remains **OPEN**.
