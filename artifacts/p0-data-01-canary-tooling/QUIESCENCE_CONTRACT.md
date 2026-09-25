# QUIESCENCE CONTRACT (`drain-check`)

Vocabulary (exact strings in reports): `STABLE_INTERVAL`, `ATTESTED`, `STABLE_INTERVAL_AND_ATTESTED_WITH_FINDINGS`, `DRAIN_EVIDENCE_COMPLETE`, `INCOMPLETE`. The word "proof" never appears; every report carries `honesty: "equal fingerprints across the interval do not exclude a write-and-revert inside it; migration is additionally bound to the evidence digest on every transaction callback"`.

* Requires the control record to be `quiesced` and owned by `operation.{operator,id}` (`kind: cutover`); otherwise `not_quiesced` / `operation_ownership_mismatch` (STOP ⇒ INCOMPLETE).
* Three samples (t0, t0+interval/2, t0+interval) of digests over: entries node, exceptions node, config/fixed/suppliers, control record, derived docs for today. Any change ⇒ `unstable_fingerprint` (STOP, exit 10, INCOMPLETE).
* `--writer-bound W` (seconds, the longest write path a client can still have in flight) is required: floor = `max(120, W+60)` s in production (`max(1, W+1)` in the emulator, reported as `floorPolicy`); `--interval` below the floor ⇒ `interval_below_floor` (OPERATOR_ACTION_REQUIRED); unknown W ⇒ `writer_bound_unknown`.
* `--attest <file>` — `{attestationVersion, operationId, by, at, items{controlledClientsInventory, oldSessionsClosedOrReplaced, pendingSavesReconciled, adminWritesFrozen, exceptionWritesFrozen, configEditsFrozen, jobsPaused{analytics,proactive,alerts,snapshot}, unknowns[]}}`; every item must be `true` and `unknowns` empty for ATTESTED; wrong operationId ⇒ STOP.
* `DRAIN_EVIDENCE_COMPLETE` = stable AND attested AND no other finding. Only this verdict satisfies `capture`'s `final_held_conditions`.
* Exit: 0 proven · 11 not proven (operator action) · 10 STOP finding.
