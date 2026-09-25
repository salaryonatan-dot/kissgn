# COMMAND REFERENCE — `node tools/storage-v2/canary.mjs <command> --manifest <file> --env production|emulator --evidence-dir <dir> [--credentials-file <sa.json>] [options]`

| command | class | reads | writes (only with `--execute --confirm <token>`) | extra gates | exit codes |
|---|---|---|---|---|---|
| `plan` | read | entries, control, exceptions, config/fixed/suppliers, deployed Rules | — | — | 0 / 14 (identity or Rules mismatch) |
| `preflight` | read | same + latest drain report | — | `--resolved a,b` | 0 PASS/WARNING · 11 OPERATOR_ACTION_REQUIRED · 10 BLOCKER |
| `enroll` | write | control | policy CAS absent→legacy (`initializeLegacy`) | record must be absent | 0 · 10 · 15 |
| `quiesce` | write | control | policy CAS legacy→quiesced (`quiesce`), owned by `operation.{operator,id}` | phase legacy | 0 · 10 · 15 |
| `abort` | write | control | quiesced→legacy (`abortQuiescence`) | owned, `conversionAttempted` false | 0 · 10 · 15 |
| `drain-check` | read | 3 samples: entries, exceptions, context, control, derived | — | `--interval s --writer-bound W --attest file` | 0 DRAIN_EVIDENCE_COMPLETE · 11 not proven · 10 STOP finding |
| `capture` | read + local FS | everything + readers over the snapshot | evidence bundle (local) | owned quiesced, DRAIN_EVIDENCE_COMPLETE, preflight not BLOCKER, no read errors, source unchanged during capture | 0 · 11 · 10 |
| `migrate` | write | control, entries (warm listener) | policy CAS `conversionAttempted:true` then the UNCHANGED core through a source-bound transaction | `--ack file` bound to bundleId; not attempted before; digest equal; fresh preflight not BLOCKER | 0 MIGRATED_HELD · 10 refused · 12 unexpected node · 13 UNKNOWN · 15 |
| `verify --phase pre\|post\|active` | read + local FS | entries, control, exceptions, context; readers | checkpoint bundle (post, clean) | bundle required | 0 OK · 12 STOP (recommendation only) |
| `activate` | write | control, entries | quiesced→v2_active (`activateV2`) | `--checkpoint id` digest still current; `--ack` bound to checkpoint | 0 · 10 · 15 |
| `probe-legacy-denial` | write (harmless) | entries (client read), control | same-value PUT of `control/phase` with the ordinary token (expected DENIED) | `--token-file file\|-` | 0 · 12 accepted/mismatch · 13 inconclusive · 15 |
| `live-check --action create\|edit\|delete --step before\|after [--await s]` | read + local FS | entries, control, exceptions, context; readers | observation state files | phase v2_active; `liveWrite` in manifest | 0 · 12 STOP · 13 no change |
| `hold` | write | control | v2_active→recovery_hold (`enterRecoveryHold`) | `--reason` | 0 · 10 · 15 |
| `resume` | write | control, entries | recovery_hold→v2_active (`resumeV2Active`) | recovery op owned | 0 · 10 · 15 |
| `status` | read + local FS | entries, control | — | `--verify-evidence bundleId` | 0 · 12 HOLD state |
| `monitor --cycle YYYY-MM-DD [--receipts file]` | read + local FS | entries, control, exceptions, context, derived docs, proactive insights; readers | ledger record (append-only) | — | 0 · 12 STOP |

Common: `--bundle <id>` selects a capture bundle (default: latest COMPLETE), `--expected-revision n` asserts the revision, `--json` prints the full report body, `--help`.
Exit code table: 0 OK, 2 USAGE, 10 BLOCKER, 11 ACTION, 12 STOP, 13 UNKNOWN, 14 ENV, 15 CONFIRM.
Every run writes `<evidence>/<operationId>/reports/<command>-<ts>.json`; every write attempt appends to `actions.jsonl`.
