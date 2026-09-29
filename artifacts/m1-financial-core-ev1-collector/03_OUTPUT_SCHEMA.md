# 03 — Output schema (`EV1_COLLECTOR/1`)

## Bundle `<out-dir>/`
- The directory is created new, mode 0700, and must be outside every git tree.
- Each file is created exclusively (`wx`) with mode 0600.

| File | Content |
|---|---|
| `PRE_FLIGHT.md` | run id; mode/project/database/as-of; credential **safe identity** (type, project, sha256 prefix of the client email); granted database permissions; checkout HEAD + clean flag; approved commit; classifier version; source digests |
| `EV1_REPORT.json` | full machine-readable report (below) |
| `EV1_SUMMARY.md` | answers the seven gate questions, B1 signals, invariant table, failure list |
| `COMPLETE.json` | **written last**: `runId`, `mode`, `project`, `asOfBusinessDate`, `classifierVersion`, `repoSha`, `sourceDigests`, `scopeDigest`, `evidenceComplete`, the sha256 of the three files above (`files`), and (R1) `bundleManifest` = the four file names |

**Closed bundle (R1).** The directory contains exactly `COMPLETE.json`, `EV1_REPORT.json`, `EV1_SUMMARY.md`, `PRE_FLIGHT.md`, each a regular 0600 file. `--verify` fails on any other entry (hidden files such as `.DS_Store`, symlinks and sub-directories included), on any missing file, and when `COMPLETE.json` does not bind exactly the three evidence files or declare exactly this manifest.

## `EV1_REPORT.json`
```
schemaVersion        "EV1_COLLECTOR/1"
classifierVersion    "EV1/3"
runId, startedAt, completedAt
environmentIdentity  { mode, project, databaseUrl, databaseHost, asOfBusinessDate,
                       credential: { type, projectId, clientEmailSha256Prefix } | null,
                       grantedPermissions[], fixtureSha256 | null }
tool                 { repoSha, treeClean, expectedCommit, nodeVersion, sourceDigests{5 files} }
scope {
  tenantEnumeration  { source, ok, code, status, discovered[tenantId] }
  businessEnumeration{ sources[], rule }
  scopeDigest        sha256 of { tenants, [tenant,business] pairs }
  tenants[]          { tenantId, attempted, keysRead{ok,code?,status?}, registryRead{ok,code?,status?},
                       registry{ state absent|present|unread, registered, malformedEntries, duplicateRegistrations },
                       storedKeys{ businesses, unattributableKeys, legacyTenantRootEntriesKey },
                       enumerationComplete, businessIds[] }
  businesses[]       { tenantId, bizId,
                       discovery{ registered, storedData, entriesKeyListed, keysListingAvailable },
                       flags{ selfId, explicitlyInactive, duplicateRegistration },
                       read{ state READ_OK|READ_OK_EMPTY|READ_FAILED|STRUCTURE_BLOCKED, storageMode?, code?, status?, reason? },
                       rows{ observed, classified, unclassifiable } | null,
                       classification{ state CLASSIFIED|CLASSIFIER_FAILED|NOT_CLASSIFIED, counts?{EV1/3 counters}, code? } }
}
reads                { total, byKind{"GET entries": n, …}, requests[{method, kind, status}] }
counters             { tenants{discovered, attempted, succeeded, failed, withoutBusinesses, withLegacyRootEntriesKey},
                       businesses{discovered, attempted, readOk, readFailed, readFailedTransport, structureBlocked, empty,
                                  classified, classifierFailed, registered, registeredWithoutStoredData, storedDataUnregistered,
                                  selfIdBusinesses, explicitlyInactive, duplicateRegistrations, storageLegacy, storageV2, storageAbsent},
                       rows{observed, classified, unclassifiable}, failures }
classification       { overlapNote, aggregate{EV1/3 counters summed}, b1Signals{identity, dates, purchases, labor, rowQuality, scope} }
failures[]           { scope, code, tenantId?, bizId?, status?, reason?, count? }
invariants[]         { id, holds, detail? }
evidenceComplete     boolean
```

## Privacy
- **Never present:** row contents, amounts, row dates, notes/free text, names, emails, user ids, business names, row ids, credentials, tokens, private keys, headers, raw response bodies, stack traces.
- **Row ids:** EV1/3's capped `identity.duplicateIds` and `vd16.rowIds` are **removed** (`sanitizeClassification`). Every other classifier leaf must be a non-negative integer or the output is rejected (`classifier_output_invalid`).
  - Row ids are not required for the B1 **gate**: the decision needs counts (e.g. `duplicateIdValues > 0` ⇒ STOP).
  - Locating specific rows belongs to a later, separately authorized remediation read.
- **Technical ids:** tenant and business ids appear because per-business completeness must be independently checkable. They are the same class Gate 0 already recorded.
- **Enforcement:** a secret scan runs before each write and in `--verify`. It rejects `private_key`, `PRIVATE KEY`, `access_token`, `Authorization`, `Bearer `, `client_email`, and the actual client email / key id / key.
