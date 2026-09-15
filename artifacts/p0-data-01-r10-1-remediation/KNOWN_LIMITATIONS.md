# Known limitations — R10.1

Nothing here claims approval. These are the things a reviewer should weigh.

## New in R10.1

### 1. The delete precondition is a whole-row comparison

A delete now aborts on **any** difference between the operator's base row and the stored
row. That is the point, but it has two consequences worth stating:

- A delete issued from a view that is even slightly behind — a field another writer
  touched seconds earlier — is refused and must be retried after the listener echo. The
  operator sees the existing conflict message. This trades a little friction for the
  guarantee that a delete never removes work it never saw.
- The comparison is `stableStringify` equality, so it is sensitive to value *type* as well
  as value: a field stored as `"100"` that another writer rewrites as `100` counts as a
  change. This is consistent with `sameVal`, which the upsert path already uses.

### 2. Rules validation is structural, not semantic

RTDB Rules cannot parse JSON, so the validator works on the serialized string. It
enforces: an array, every element an object, every element carrying a canonical lowercase
UUID v4 `id`, a size ceiling. It cannot enforce id **uniqueness**, per-field **types**, or
that the `"id":"<uuid>"` it matched is a real key rather than text inside a note. A
determined authorized writer can still craft a payload that satisfies the pattern while
being semantically wrong; `validateEntriesNode` remains the authority inside the
transaction. The rule raises the floor against malformed and accidental writes — the class
Codex proved — it is not an authorization boundary.

### 3. Free text containing the exact sequence `},{` is rejected

The pattern recognises `},{` as a row boundary, so a note containing that exact three-
character sequence would be denied by the server. Braces on their own are fine
(`R-A09` pins it). Denial is fail-closed and visible, not silent loss.

### 4. Deleting the `_v` child is still possible

RTDB does not evaluate `.validate` for deletes, and `.write` cascades permissively, so an
authorized manager can remove `_v` and leave `{}` behind. The runtime treats that as
`malformed_remote` and fails closed — no data is written on top of it — but the node needs
the approved offline action to be restored. Closing this would need a shape change to the
node, which is out of scope.

### 5. The 1 MiB `_v` ceiling

Roughly 3,500 full rows, about nine years of daily entries. Generous today; it is a
ceiling, and it will eventually need revisiting for a very long-lived tenant.

### 6. The S0 guard exception is a widening

`database.rules.json` was a forbidden path in the S0 anti-migration guard. It still is,
except for this one content-verified change. The verification is strict — the rules tree
with exactly the two validators removed must be deep-equal to the base, both validators
must actually constrain the entries node, and three mutation probes confirm it — but it
is nonetheless a scope guard that now has an exception in it. Confirm or reject it.

## Carried over from R10, unchanged

7. **The emulator harness uses the Admin SDK; production uses the Web SDK.** Codex's own
   Web SDK probe independently confirmed matching transaction semantics on a local
   emulator (both writers preserved, retries observed), which narrows this considerably,
   but the R10 suites themselves still drive the Admin SDK.
8. **Cold-cache aborts return a misleading typed reason.** A mutation issued with no live
   listener aborts locally as `target_not_found`. Fail-closed, bounded by the hydration
   gate, accepted by Codex, pinned by `EMU-E-cold-cache`.
9. **`stale` is handled silently in the labor UI.** Reviewed and accepted by Codex.
10. **The labor input writes on every keystroke.** Pre-existing, unchanged.
11. **`entryDateKey` does not validate the shape of a business date.** Unchanged.
12. **Stale P0-DATA-01 comments at `index.html:1095–1107`** still describe identity as
    tenant/business/date. Codex classified this non-blocking; it is not adjacent to
    anything changed here, so it was left alone rather than widening this commit.

## What R10.1 did NOT validate

- No real-browser Web SDK run of the full R10 suite against the emulator.
- No multi-tab or offline-then-reconnect replay.
- No load testing; the emulator history is 160 dates.
- Nothing about non-entries destinations beyond the existing suites.
- No Production or Preview verification of any kind, by design.

## Independent review status

R10.1 has **not** been independently reviewed. The last independent verdict on this
workstream is `CHANGES_REQUIRED` on `1038b4cd` (Codex, 2026-09-15), which this commit
answers. Implementation tests passing is not independent acceptance, and P0-DATA-01
remains **OPEN**.
