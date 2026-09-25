# LIVE WRITE POLICY (`live-check`)

* Observation only. The owner performs the write in the real client; the tool never writes a row.
* Allowed actions: `create`, `edit`, `delete` — in that order, once each, on the `liveWrite.date` reserved in the manifest (`plannedRow` exact, `editField`/`editValue`). `CLEAR_ALL IS FORBIDDEN`: there is no action, no flag and no code path (`test/storage-v2/canary-cli.test.mjs` asserts the command table and the source).
* Requires `v2_active`. `--step before` records the node/policy/exceptions/context snapshot (numbered, exclusive file); `--step after` (or `--await s` for a single listener-driven wait) diffs rows: exactly one added row equal to the planned row (canonical), or exactly the live row changed in exactly `editField` to `editValue`, or exactly the live row removed. Anything else ⇒ STOP.
* Always checked: generation unchanged (`generation_changed_without_clear` STOP), frozen `_v` byte-identical (`frozen_v_changed` STOP), policy record unchanged (`unexpected_policy_change` STOP), readers before/after diffed and reported (`readerImpact`).
* A generation change during any observation (a clear-all from a client) ⇒ exit 12, `RECOVERY_HOLD_RECOMMENDED`, `automaticTransition:false` — the tool never transitions.
* The delete receipt closes the live-write window; the monitoring window starts after derived reconciliation (`liveWriteCleanupAt` in the receipts).
