# Known Limitations (after Hardening R1)

## Pre-cutover blocker — unchanged, out of scope here
**Server-reader convergence.** The nine live entries read sites in seven files
(`src/analytics/dailyBuilder.ts`, `src/snapshot/snapshotBuilder.ts`, `src/alerts/checkers.ts`
×2, `src/repositories/analytics/dailyMetricsRepo.ts` ×2, `laborRepo.ts`, `purchasesRepo.ts`,
`lib/repositories/entryExceptionsRepo.js`) still prefer `_v` or query top-level date keys.
None was modified. No business may be converted in Production until that slice is
implemented and independently reviewed. `SERVER_READERS_MODIFIED: NO`.

## Residuals that are NOT among the nine findings (recorded, not closed)
- **Old cached builds.** A client still running a build older than this one has no
  `storage_mode_mismatch` refusal by construction. Its changed writes are denied by Rules;
  a write whose value coincidentally equals the frozen `_v` never reaches the server and
  that OLD build shows a false "already applied". Requires a client/version fence at
  rollout (or accepting the narrower contract) — a rollout decision, not a stored-state
  defect.
- **Direct deletion of the frozen `_v` child** on a V2 node remains possible for an
  authorized writer (validators do not run on deletes; the `.write` cutover guard only
  protects the marker). It loses the audit/rollback snapshot, never authority.
- **Raw deletion of the whole `rows` map** (`set(rows, null)`) by an authorized writer is a
  mass row delete WITHOUT an epoch rotation. It cannot be denied without also denying the
  ordinary row-lane delete of the last row (the map disappears the same way). Nothing can be
  resurrected by it (the epoch is unchanged; the writer was authorized to delete rows).
- **Non-entries `$dataKey/rows/*` writes** are newly invalid since cb8ac84e (Codex P2). No
  supported caller writes that shape; left as is to stay within the nine.
- **Business date semantics.** `entryDateKey` normalization, not calendar validation, is
  still what preflight and the engine use (documented since cb8ac84e).
- **Rollback boundary.** Conversion remains one-way for ordinary clients; a quiesced
  reverse conversion would need its own reviewed, privileged tooling. Equality of `_v` and
  rows proves current equivalence, not write history.

## Contract changes a re-reviewer must expect
- The generation changed representation: **integer epoch** (`1, 2, 3…`) instead of a uuid
  token; the row stamp key is **`_gen`**. cb8ac84e's artifacts (`artifacts/p0-data-01-storage-v2/`)
  describe the earlier uuid form and are superseded by this directory.
- `createV2EntriesMutator(io)` takes `io.mode()` (not `io.generation()`) and
  `mutate(intent, ctx, binding)`; `createEntriesStorageRouter` forwards `binding`;
  `upgradeBusinessToV2(io, {tenantId, bizId})` takes no generation; `createLegacyPreflight`
  requires `rowGenKey`.
