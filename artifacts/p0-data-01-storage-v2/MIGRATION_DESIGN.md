# Atomic per-business cutover

`tools/storage-v2/upgrade.mjs` — tooling, not runtime. It has no CLI entry point, no side
effects on import, reads no credentials or environment, is imported by nothing in the
runtime, and performs exactly the one transaction its caller hands it a transport for.
The emulator suite is its only caller in this repository.

## The operation

One compare-and-swap at the business entries node:

```js
transactNode(tenantId, `biz:${bizId}:entries`, (cur) => {
  if (isV2Node(cur)) abort("already_v2");
  const report = preflightLegacyNode(cur);        // parsed INSIDE the callback
  if (!report.ok) abort("preflight_blocked", report);
  const rows = {};
  report.rows.forEach(r => { rows[r.id] = { ...r, gen: generation }; });
  const next = { schemaVersion: 2, generation };
  if (report.rows.length) next.rows = rows;
  if (typeof cur._v === "string") next._v = cur._v;   // frozen snapshot, byte-identical
  return next;
});
```

Four properties follow from where the parse happens:

1. **Atomic.** One write. There is no window in which a business has half a V2 tree.
2. **Never from a stale snapshot.** `_v` is read inside the callback. A caller cannot
   hand it data it read a second earlier.
3. **No lost legacy write.** If a legacy writer commits between the callback's read and
   its commit, RTDB re-runs the callback against the fresher value and the cutover
   converts *that*. Proven by `V2-M04`: the concurrent row is present afterwards.
4. **Refuses rather than repairs.** Any preflight blocker aborts with the report attached
   and writes nothing (`V2-M03` — the node is still legacy afterwards).

`generation` is pre-generated outside the callback, so a CAS retry reuses the identical
token rather than minting a new one per attempt.

## The negative control

`unsafeReadThenWriteUpgrade_NEGATIVE_CONTROL` is the read-then-write shape the real path
avoids: read the node once, build V2 from that snapshot, write. `V2-M05` runs it with a
legacy writer committing inside the window; it reports success and the concurrent row is
gone. It exists so the atomic path cannot be mistaken for a no-op, and it is marked
NEGATIVE CONTROL everywhere it appears.

## What the cutover preserves

Every row, with every field, keyed by its own id (`V2-M01`). Duplicate business dates
survive as separate rows. The pre-cutover blob is retained byte-identically as `_v`.
Nothing is reordered, deduplicated, repaired or dropped — the preflight has already
guaranteed the input is convertible as it stands.

## Production

Not performed, not enumerated, not inspected. No Production or Preview RTDB was read or
written in this work, and no deployed Rules were altered. Production rollout is a separate
CTO-approved gate after independent review; `ROLLBACK_BOUNDARY.md` states what has to be
decided before that gate.
