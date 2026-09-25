# EVIDENCE FORMAT (`canary-evidence.mjs`)

Directory `<evidence-dir>` must be OUTSIDE any git work tree; created `0700`; every file `0600`; symlinks anywhere in the path are refused; files are created with `O_EXCL` (never overwritten), fsync'd and read back before being hashed; nothing is ever deleted or rewritten by the tool.

## Capture bundle `<evidence-dir>/<operationId>/<bundleId>/` (bundleId = `<UTC ts>-<sourceDigest[0:8]>`)
| file | content |
|---|---|
| `manifest.json` | the manifest + `bundleId`, `capturedAt`, `expected.sourceDigest/evidenceId` filled |
| `environment.json` | repo sha, tree clean, per-file git blob ids, deployed Rules match + sha256, node version |
| `entries.source.json` | the entries node EXACTLY as read (JSON) |
| `entries.raw-v.utf8` | the raw `_v` string as UTF-8 bytes (byte-exact; Hebrew/emoji safe) |
| `exceptions.source.json`, `context.source.json`, `policy.source.json` | exceptions node; config/fixed/suppliers; control record raw + parsed |
| `source-manifest.json` | serializer version, `sourceDigest` (digestV1 of the node), raw `_v` sha256/bytes, row count, ordered/sorted ids, id↔date multiset, date groups, duplicate dates, per-row digests, normalization report, semantic digest, exceptions/context digests, policy revision |
| `expected-v2.json` | expected node (`stampRow` over the core preflight rows, `_v` frozen), digest, logical digest |
| `reader-baseline.json` | every approved reader's output over the snapshot (+ full-precision number strings) |
| `preflight.json` | the held preflight report |
| `financial-summary.json` | operator summary (sums over the reader output; parity itself is per record) |
| `deployment-evidence.json` | optional, `--deployment <file>` |
| `COMPLETE.json` | **written LAST**: `{completeVersion, bundleId, operationId, writtenAt, files[{name,bytes,sha256}], filesDigest, observerAck}` |

`verifyBundle` re-hashes every listed file, refuses unlisted files and an edited `COMPLETE.json` (its `filesDigest`). A bundle without `COMPLETE.json` is INCOMPLETE and is never used by `migrate`/`verify`/`activate` (`evidence_incomplete`).

## Other artefacts
* `reports/<command>-<ts>.json` — versioned JSON per run (`reportVersion`, command, environment, target, operationId, executed, transportMode, …).
* `actions.jsonl` — append-only receipts of every write attempt/result (`receiptVersion`, at, command, stage, expectedRevision, token, result, error).
* `post-<digest[0:16]>/` — verify checkpoint bundle (`entries.actual.json`, `policy.json`, `checkpoint.json`, `COMPLETE.json`).
* `live/<action>-<n>-before.json`, `<action>-<n>-after.json` — live-check observations (numbered; never rewritten).
* `ledger/cycle-<date>[-cN].json` + `ledger/ledger.jsonl` — monitoring records; identical body ⇒ no append; changed body ⇒ correction with `supersedes`.

Digest: `digestV1` = sha256 over a type-tagged canonical serialization (object keys sorted, arrays ordered, numbers by exact value, strings/booleans/null distinct); non-finite numbers and `undefined` are refused (`unsupported_value`) so evidence can never silently degrade.
