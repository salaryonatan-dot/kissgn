# Storage V2 — CANARY OPERATOR (P0-DATA-01, one business)

`tools/storage-v2/canary.mjs` is the operator CLI for migrating **exactly one** legacy business to
Storage V2 behind the approved Version Fence, and for watching it afterwards. It is a **local
operator tool**: nothing in it runs from the API, from a job, or from the page. It never touches
Rules, `index.html`, `api/**`, the Version Fence runtime, the Server Readers, the coordinator /
router / mutator, or `tools/storage-v2/upgrade.mjs` (the conversion core is invoked **unchanged**
through the approved `createFencedConversion`).

**What this tool will never do:** clear a business, write rows, restore or repair a node, retry a
migration on its own, place a business into `recovery_hold` on its own, guess an identifier, read
credentials from the environment, or run against Production without an explicit `--env production`,
a service-account file, a validated manifest, a printed confirmation token and (for `migrate` /
`activate`) a signed observer acknowledgement.

## Modules

| file | role |
|---|---|
| `canary.mjs` | the CLI dispatcher (inert on import; commands below) |
| `canary-contract.mjs` | pure: manifest validation, digests, enhanced preflight, comparisons, classification, tokens, drain verdict, ledger records, window arithmetic |
| `canary-evidence.mjs` | protected local evidence: exclusive-create bundles (COMPLETE last), receipts, append-only ledger |
| `canary-transport.mjs` | environment gate, one-business Admin transport (read surface / dry-run / writable), source-bound entries transaction, REST probe, Rules fingerprint |
| `canary-readers.mjs` | the approved server readers over a **captured snapshot** in a deny-write sandbox |
| `production-window.mjs`, `reader-sandbox.mjs` | verbatim extractions of the test harness loaders (the page's storage helpers via `vm`; the compiled server + in-memory database) |

## Manifest (one per operation, private, outside git)

```json
{ "manifestVersion": 1, "environment": "production", "projectId": "<project>", "databaseURL": "https://<db>.firebasedatabase.app",
  "tenantId": "<exact tenant id>", "bizId": "<exact business id>",
  "expectedIdentity": { "businessName": "<name as stored in biz config>", "ownerAttestation": { "by": "<owner>", "at": "<ISO>", "ref": "<msg/ticket>" } },
  "probeBizId": null,
  "approved": { "repoSha": "<40-hex commit the operator runs>", "rulesBlob": "<git blob id of the deployed database.rules.json>" },
  "operation": { "id": "<unique>", "operator": "<person>", "observer": "<a different person>", "approvalRef": "<CTO approval>" },
  "expected": { "policyRevisionAtStart": 1, "sourceDigest": null, "evidenceId": null },
  "limits": { "maxRows": 500, "maxNodeBytes": 1048576 }, "timezone": "Asia/Jerusalem",
  "liveWrite": { "date": "<unused business date>", "plannedRow": { "...": "the exact row the owner will enter" }, "editField": "sales", "editValue": "<value>" } }
```

Wildcards, empty or whitespace ids, placeholder ids (`tenantA`, `bizA`, `test`, `demo`, `default`) in
production, a local URL in production, a non-demo project in the emulator, and observer = operator are
all refused (`manifest_invalid`, exit 14).

## Environment gates (fail closed, exit 14)

* `--env production|emulator` is mandatory and must equal `manifest.environment`.
* Emulator: `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:<port>`, `GCLOUD_PROJECT=demo-…` equal to the
  manifest project, no credentials anywhere.
* Production: `FIREBASE_DATABASE_EMULATOR_HOST` unset; `GOOGLE_APPLICATION_CREDENTIALS` / `FIREBASE_SA_*`
  unset; credentials **only** from `--credentials-file <sa.json>` (mode 0600, `type: service_account`,
  `project_id` equal to the manifest); the tool must be the approved commit on a clean tree.
* One business: every path is derived from the manifest; nothing is listed or searched.
* Evidence directory must be outside any git work tree; it is created 0700 and every file 0600.

## Commands

Read-only (never write to RTDB): `plan preflight drain-check capture verify live-check status monitor`
Write (dry-run unless `--execute --confirm <token>`): `enroll quiesce abort migrate activate hold resume probe-legacy-denial`

```
node tools/storage-v2/canary.mjs <command> --manifest m.json --env production --credentials-file sa.json --evidence-dir /secure/canary [options]
```

| command | what it does | gate |
|---|---|---|
| `plan` | reads everything once; prints identity/environment/policy/storage summary and the **confirmation tokens** for every write command at the current revision | — |
| `preflight` | pure read-only report: PASS / WARNING / OPERATOR_ACTION_REQUIRED / BLOCKER per finding, aggregate + eligibility; never repairs; `--resolved code,…` records operator resolutions | — |
| `enroll` | absent → `legacy` control record (`initializeLegacy`) | token |
| `quiesce` | `legacy` → `quiesced`, opens the owned cutover operation | token |
| `drain-check` | three fingerprint samples over `--interval` seconds (floor `max(120, W+60)` with `--writer-bound W`), plus `--attest <file>`; verdict vocabulary `STABLE_INTERVAL` / `ATTESTED` / `DRAIN_EVIDENCE_COMPLETE` / `INCOMPLETE` — never "proof" | — |
| `capture` | requires owned `quiesced` + `DRAIN_EVIDENCE_COMPLETE`; writes the **COMPLETE evidence bundle** (source bytes, raw `_v` bytes, expected V2 node, reader baseline, preflight, environment) and prints the `migrate` token bound to the source digest | — |
| `migrate` | wrapper around the unchanged core: identity → env → owned quiesced → revision → no prior attempt → clean COMPLETE bundle → warm listener → source digest equal → fresh preflight → CAS `conversionAttempted` → core exactly once through a **source-bound** transaction | token + `--ack` |
| `verify --phase pre\|post\|active` | repeatable comparison: structure, ids, dates, frozen `_v` bytes, expected-node digest, logical rows, exceptions/context digests, all readers vs baseline, no `_v` fallback; a clean `post` writes a checkpoint bundle | — |
| `activate` | `quiesced` → `v2_active` (`activateV2`) — requires `--checkpoint <post checkpoint>` whose digest still matches the node | token + `--ack` |
| `probe-legacy-denial` | **Option B**: with `--token-file` (ordinary member ID token from stdin/file, never argv): authenticated read of the entries node, then a same-value PUT of the control record's `phase` (harmless if it were accepted) — DENIED is the expected result; plus the deployed Rules fingerprint and references to the emulator/historical evidence. No entries-shaped write exists. | token |
| `live-check --action create\|edit\|delete --step before\|after` | observation only: the owner performs the write in the real client; the tool diffs rows, checks the frozen `_v`, the generation, the policy and the readers; a generation change ⇒ STOP. There is no clear-all action. | — |
| `monitor --cycle YYYY-MM-DD [--receipts r.json]` | appends one immutable ledger record per cycle (idempotent; a changed body is a correction that supersedes); `UNKNOWN` is never `PASS`; window = ≥168 h **and** ≥7 consecutive COMPLETE clean cycles | — |
| `status` | reconciles node vs evidence: `A1/A2` (source intact), `B` (converted, held), `C` (active), `HOLD_UNRECOGNISED_STATE`; prints the window arithmetic | — |
| `hold` / `resume` | `v2_active` → `recovery_hold` / back, **only** when the operator runs them; `verify`/`monitor`/`status` only ever print `RECOVERY_HOLD_RECOMMENDED` | token |

Exit codes: `0` OK · `2` usage · `10` BLOCKER / refused · `11` OPERATOR_ACTION_REQUIRED · `12` STOP
(recommendation printed, nothing transitioned) · `13` UNKNOWN (reconcile with `status`, never retry
blindly) · `14` environment / identity · `15` confirmation / acknowledgement.

Confirmation token = `sha256(identityDigest:command:expectedRevision:sourceDigest:operationId)[0..16]`,
printed by `plan` (and by `capture` for `migrate`). A stale plan, a different command, a changed
revision or a changed source digest invalidates it. Observer ack file: `{ operationId, stage, by, at,
evidenceId|checkpointId }` bound to the bundle / checkpoint being acted on.

## Evidence layout

```
<evidence-dir>/<operationId>/
  reports/<command>-<timestamp>.json      every run, versioned JSON
  actions.jsonl                           append-only receipts of every write attempt and result
  <bundleId>/  manifest.json environment.json entries.source.json entries.raw-v.utf8 exceptions.source.json
               context.source.json policy.source.json source-manifest.json expected-v2.json reader-baseline.json
               preflight.json financial-summary.json [deployment-evidence.json] COMPLETE.json   (written LAST)
  post-<digest>/ entries.actual.json policy.json checkpoint.json COMPLETE.json
  live/<action>-<n>-before.json, <action>-<n>-after.json
  ledger/cycle-<date>[-cN].json, ledger.jsonl
```

Files are created exclusively (never overwritten), symlinks in the path are refused, and
`COMPLETE.json` lists every file with its size and sha256; `status --verify-evidence <bundleId>`
re-checks them.

## Sequence for the first canary

1. `plan` → `preflight` (fix OPERATOR_ACTION_REQUIRED items outside the tool; BLOCKER ⇒ stop).
2. `enroll` (if no record) → `quiesce` (observer present, owner attests all clients closed).
3. `drain-check --interval ≥ floor --writer-bound W --attest attestation.json` until `DRAIN_EVIDENCE_COMPLETE`.
4. `capture` → review the bundle → observer signs the ack for that `bundleId`.
5. `migrate --execute --confirm <token> --ack ack-migrate.json` → `MIGRATED_HELD` (anything else: `status`, then decide; never re-run blindly).
6. `verify --phase post` (twice, identical) → observer signs the ack for the checkpoint.
7. `activate --checkpoint <id> --execute --confirm <token> --ack ack-activate.json` → `verify --phase active`.
8. `probe-legacy-denial --execute --confirm <token> --token-file -` (Option B evidence).
9. `live-check` create → edit → delete with the owner, `--step before` / `--step after` each.
10. `monitor --cycle <date> --receipts r.json` every day; `status` for the window. `hold` only on a decision.

## Emulator rehearsal

`test/emulator/canary-operator-matrix.mjs` (17 cases) runs this whole sequence against the real
emulator with a fresh Admin app per command; `test/storage-v2/canary-*.test.mjs` cover the pure logic
over an in-memory database. In emulator mode the tool identity is reported as a WARNING (the matrix
runs on a work tree) and the drain floor is `max(1, W+1)` seconds; both are BLOCKER / `max(120, W+60)`
in production.
