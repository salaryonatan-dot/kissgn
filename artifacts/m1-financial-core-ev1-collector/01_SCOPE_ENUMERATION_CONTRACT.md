# 01 — Scope enumeration contract (authoritative sources, from repository evidence)

EV-1 censuses exactly the data the Financial Core and B1 read: the per-business entries nodes `tenants/<tenantId>/biz:<bizId>:entries`, decoded by `lib/analytics/entriesReader.js`.

## Tenant enumeration — `GET tenants.json?shallow=true`
- All tenant-scoped data lives under `tenants/<tenantId>/…`:
  - client `fkey` / `fkeyShared`, `index.html:708-765`;
  - admin `create-client`, which writes `tenants/<t>/app/*`, `roles`, `members`, `meta`, `api/admin.js:288-299`;
  - Rules `tenants/$tenantId`.
- An entries node therefore cannot exist outside a child of `tenants`, so the shallow key set of `tenants` is complete **by construction** for EV-1's object of study.
- `super_owner` list-clients reads the same node (`api/admin.js:138`).
- `user_tenants`/`username_index` map users → tenant. They are indexes, not a tenant registry, and are not needed for completeness.
- A tenant id that cannot be addressed as a path segment ⇒ failure `tenant_id_unaddressable`.
- A non-map shallow response ⇒ `tenant_list_malformed`.
- HTTP 200 `null` ⇒ zero tenants (successful; it is reported, not hidden).

## Business enumeration — per tenant, the deterministic UNION of two sources
| Source | Read | Why authoritative |
|---|---|---|
| **Business registry** `tenants/<t>/app/business` | `GET` (full value) | The product's list of the tenant's businesses. <br>• Client shared key `app-businesses`: `index.html:717,762`; read at `:4790`; written by setup `:5278`, edit `:5900/:5924`, delete `:6009`. <br>• Admin create-client `api/admin.js:290`; edit-client `:398-403`. <br>• Every server discovery uses it, and index-only businesses are skipped (`src/analytics/dailyBuilder.ts:771-821`, `src/snapshot/snapshotBuilder.ts:519-570`). <br>**A registered business with zero entries is discovered here.** |
| **Stored business keys** `tenants/<t>` shallow keys `biz:<bizId>:<suffix>` | `GET tenants/<t>.json?shallow=true` | Every per-business node is stored under `biz:<bizId>:…` (`index.html:1291, 2348, 2630, 3953, 4890, 4929, 4986`). <br>The UI "delete business" (`index.html:6009`) removes the id from the registry but **leaves its stored data**. Such businesses have data the registry no longer names, and they are still censused. |

- **Union rule.** Every `(tenant, business)` in either source is a discovered business. Each gets **exactly one** entries read and one terminal outcome.
- **Duplicate discovery** merges identity only:
  - one record, flags `registered` / `storedData` / `entriesKeyListed`;
  - a duplicate registry row is counted in `duplicateRegistrations` and cannot suppress a failure.
- **Business ids.**
  - Setup generates `biz_<epochMs>` (`index.html:5194`).
  - The first business of a wizard-created tenant uses the tenant id itself (`index.html:5195`), and admin create-client registers `{ id: tenantId }` (`api/admin.js:285`).
  - Server discovery skips such `tenantId === bizId` businesses as "legacy self". **EV-1 does not skip them**; they are censused and counted as `selfIdBusinesses`.
  - Explicitly inactive businesses (`active:false`, `disabled`, `deleted`, `archived`, `status`) are also censused and counted as `explicitlyInactive`, using the same predicate as server discovery.

## Registry decoding — fail closed
Accepted shapes are exactly those the product writes and reads:
- `null` (absent registry ⇒ zero registered, successful);
- `{ _v: "<JSON array>" }`;
- a JSON-array string;
- an array.

Anything else is a failure:
| Condition | Failure |
|---|---|
| Other shape | `registry_shape` |
| Unparseable JSON | `registry_json` |
| JSON not an array | `registry_not_array` |
| Element that is not an object, or whose `id` is not an addressable string (no `/ . # $ [ ]`, control characters or `:`) | `registry_entry_unidentifiable` (the business cannot be named ⇒ the tenant's enumeration is incomplete) |

## Stored-key decoding — fail closed
- `biz:<id>:<suffix>` with an addressable `<id>` ⇒ a business.
- A `biz:` key that cannot be attributed (e.g. `biz::entries`) ⇒ `stored_business_key_unattributable`.
- A tenant-root legacy `entries` key is counted (`tenantsWithLegacyRootEntriesKey`) but not read: no code reads it, since `src/firebase/refs.ts:entriesRef` is unused.

## Consistency check
When the tenant's key listing succeeded, a listed `biz:<b>:entries` key must read non-null, and an unlisted key must read `null`. A mismatch (a concurrent change or a discovery gap) ⇒ `entries_listed_but_absent` / `entries_present_but_unlisted`, blocking.

## Not used
| Excluded | Reason |
|---|---|
| `proactive_biz_index` | A non-authoritative hint. Server discovery skips index-only businesses, and any business with stored data is already found by the key scan. |
| Root-level legacy paths (`marjin`, `app-businesses`) | Outside `tenants`; not read by the Financial Core or by any server reader. |

## Note on the Gate 0 D1 collector
- It discovers businesses from `biz:*:` keys only, which is the gap Codex identified.
- It is a different tool on a different branch and is not modified here.
- The EV-1 collector does not import it.
