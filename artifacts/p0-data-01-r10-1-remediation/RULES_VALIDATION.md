# Blocking finding 2 — server-side validation for `biz:{bizId}:entries`

## What Codex reproduced

Against the real Rules engine, an authenticated manager with `biz_access` was allowed to
write, straight to `tenants/tenantA/biz:bizA:entries`:

- non-JSON `_v` · **allow**
- id-less row JSON · **allow**
- an object without `_v` · **allow**

while the legacy `tenants/$tenantId/entries` control correctly denied the last one. The
`$dataKey` branch had `.read` and `.write` and no `.validate`, so every P0-DATA-01
invariant was client-only for the authoritative node.

## The real schema, inspected before writing any rule

The node is a `{ "_v": "<JSON>" }` envelope. `_v` is `JSON.stringify(rows)` where `rows`
is an array of plain row objects. What the runtime guarantees about anything it writes,
enforced by `validateEntriesNode` inside every transaction:

- the value is an **array** (`clear_all` writes `[]`);
- every element is a **plain object**;
- every element carries an `id` that is a **canonical lowercase RFC 4122 UUID v4**
  (`ENTRY_ID_RE`) — a node with any id-less row is not writable at all, it reports
  `missing_entry_id`;
- ids are unique; duplicate business **dates** are explicitly legal.

Two schema facts drove the pattern, and both were verified against real payloads rather
than assumed:

1. **`id` is not always the first key.** `buildEntryUpsertIntent`'s create path builds
   `{ ...next, date: dateKey, id: o.newId }`, so a created row serialises with `id`
   **last**. A rule requiring "row begins with id" would have rejected every create.
   Case `R-A02` pins this.
2. **Rows contain nested objects** (`supplier_payments`, `hourly_payroll`) and free text
   that may contain braces. The pattern must not reject those. Case `R-A09` pins it.

## The rules added

At `tenants/$tenantId/$dataKey` and at `$dataKey/_v`, each conditional on the key being an
entries key so no other dynamic key is affected:

```
!($dataKey.matches(/^biz:[^:]+:entries$/)) || (
  newData.hasChildren(['_v']) &&
  newData.child('_v').isString() &&
  newData.child('_v').val().length <= 1048576 &&
  newData.child('_v').val().matches(/<structure>/)
)
```

`<structure>`, with `U` the canonical UUID v4 class and
`S = (([^}]|\}[^,]|\},[^{])*(\}|\},)?)`:

```
^(\[\]|\[\{ S "id":" U " S (\},\{ S "id":" U " S)* \}\])$
```

Read plainly: the empty array, or an array of objects where **every** element contains a
canonical `id` anywhere inside it. `S` is the standard "does not contain the substring
`},{`" construction, which is why braces inside free text are accepted while a row
boundary is still recognised.

Why the second rule: RTDB evaluates `.validate` for the node written and its descendants,
not its ancestors. A client writing `.../entries/_v` directly would never reach the parent
rule. Cases `R-D12`/`R-D13` prove that bypass is closed; the canonical rules file and the
emulator copy stay byte-identical and the harness aborts if they ever diverge.

Two limits chosen deliberately:

- **1 MiB `_v` ceiling** — roughly 3,500 full rows, about nine years of daily entries.
  Bounds abuse and rule-evaluation cost without touching any realistic history.
- **Structural, not semantic** — Rules cannot parse JSON, so uniqueness of ids and the
  types of individual fields are not server-enforced, and a crafted string could contain a
  fake `"id":"<uuid>"`. This raises the floor against malformed and accidental writes; it
  is not an authorization boundary. `KNOWN_LIMITATIONS.md` §2.

## Compatibility — what stays writable

Nothing the runtime can legitimately produce is rejected. Proven by 13 allow cases:
representative node, the create shape with `id` last, an ordinary edit, a row removal,
clear-all `[]`, duplicate dates with distinct ids, a 160-date history with mixed key
order, a row carrying only its id, free text containing braces, a direct `_v` child write,
the owner role, a real RTDB transaction, and escaped quotes with Hebrew text.

**Legacy id-less rows are denied — deliberately, and this changes nothing.** The runtime
already refuses to write such a node (`missing_entry_id`), so the rule matches the
existing contract rather than adding a restriction. Reads are unaffected: `.validate` does
not apply to reads, so a tenant whose stored node still has id-less rows can hydrate,
see its data, and be repaired by the approved offline id-assignment action — whose
**output** (every row with an id) is writable.

## Regression proof that R10 itself still works

Rules changes can break a system in ways a rules matrix cannot see, so the two existing
emulator suites were re-run unchanged against the new rules:

- **Authorization matrix 108/108** — after updating the entries payloads it writes (see
  below), all expected allow/deny values unchanged.
- **R10 concurrency suite 19/19** — transaction retry under 8-way contention, conflict
  with `conflictPaths`, idempotency, `id_collision`, ownership denial, duplicate
  preservation and the R9 negative control all still behave identically.

### One fixture change in the authorization matrix

That matrix wrote the placeholder `{ _v: "[9]" }` to entries paths — an array of a scalar,
which the new rule correctly rejects, so four ALLOW cases started failing on *validation*
while testing *authorization*. The payload for entries-path writes is now a well-formed
single-row value (`V_ENTRIES`). **Every expected allow/deny value is unchanged**; only the
payload is, and the file's purpose is preserved.

## VAT_GUARD_EVIDENCE — the S0 scope-guard exception

`test/finance/vat-invariant.test.mjs` forbids changes to `database.rules.json`. This
remediation was explicitly authorized to change that file, so the guard needed a decision.
Exempting the path would have let any future rules change through unnoticed. Instead the
exception is granted **by content**:

- `git show <base>:database.rules.json` is parsed, the current file is parsed;
- the two additions — `$dataKey[".validate"]` and `$dataKey["_v"][".validate"]` — are
  removed from the current tree, and `_v` must carry nothing but that validator;
- both expressions must actually mention the entries key pattern and call `matches(`, so
  an inert placeholder cannot buy the exemption;
- what remains must be **deep-equal** to the base rules tree.

Anything else — an authorization rule loosened, a validator moved, an extra key — fails
exactly as before. Every VAT assertion in the file is byte-unchanged. Three mutation
probes in `TEST_RESULTS.md` demonstrate the exception is narrow. This is a deliberate
widening of a scope guard, made because the alternative was either leaving a P0 blocker
open or exempting the path outright; it is flagged for the reviewer to confirm.
