# 00 — Executive status: EV-1 Production read-only collector

**Status: COMPLETED (local tooling).** One local commit on `claude/m1-financial-core-ev1-collector` (parent `0bcd1753`, approved Slice A). EV-1 was **not** executed. No Production access, no push, no deploy.

## Collector
- **Entrypoint:** `tools/finance-core/ev1-collector.mjs`.
- **Supporting modules:** `ev1-transport.mjs` (the only network code; GET-only database reads) and `ev1-preflight.mjs` (identity, environment and credential checks before any network activity).
- **Reused unchanged:** the approved EV1/3 classifier and the shared entries reader.

## Authoritative scope (repository-proven)
- **Tenants:** shallow `tenants`. All tenant data, and therefore every entries node, lives under it.
- **Businesses:** per tenant, the union of:
  - the registry `tenants/<t>/app/business` (client "app-businesses", admin create/edit, used by every server discovery);
  - every stored `biz:<id>:*` key.
- **Coverage:** a registered business without entries is recorded `READ_OK_EMPTY`. Businesses deleted from the registry but still holding data, self-id businesses and inactive businesses are all censused.

## Guarantees
| Area | How it is met |
|---|---|
| Fail-closed | `evidenceComplete` is the conjunction of 19 invariants recomputed from the report JSON, which is also what `--verify` checks |
| Reconciliation | `businesses.attempted == discovered`; `readOk + readFailed == attempted`; `classified + classifierFailed == readOk`; `rows.observed == classified + unclassifiable`; EV1/3 exclusive partitions; one entries read per business; scope digest |
| Read-only | no Firebase SDK in the import graph. The only non-GET requests are the OAuth token exchange and an IAM permission query, and a credential with database write permission is refused before any read. Static and runtime tests prove this. |
| Environment | exact project and database; no emulator/ADC/credential environment variables; credential file must be regular, non-symlink, 0600 and project-bound; approved commit with a clean tree; real as-of date not in the future; new output directory outside git |
| Safe output | counts, categories and technical tenant/business ids only; row-id lists removed; secret scan before every write and in verify; `COMPLETE.json` written last and binding everything |

## Tests
| Check | Result |
|---|---|
| Collector tests | 25 |
| Focused (classifier + collector) | 34 / 34 |
| Full suite | 1183 / 1183 (baseline 1158) |
| tsc | 22 × TS2742, identical to baseline |
| Mutation check | 8 / 8 seeded faults caught |

**Next action:** Codex focused re-review of this collector commit (10).
