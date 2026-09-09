# Emulator concurrency evidence — R10 against a real Firebase RTDB

`test/emulator/entries-remote-atomic-emulator.mjs`, run under
`firebase emulators:exec --only database` with the repo's own firebase-tools 15.23.0 and
the repo's `database.rules.json`. **16 cases, 16 passed, 0 failed, on three consecutive
runs with no change between them.**

Until this round every R10 proof ran against an in-process fake store written by the
same session that wrote the runtime under test. This is the first time the R10
persistence primitive has met a real RTDB server.

## What is actually executed

The production code is vm-extracted from `index.html` — `createSelectionController`,
`createRemoteEntriesMutator`, `createEntriesWriteCoordinator`, `applyEntryIntent`,
`buildEntryUpsertIntent`, `parseEntriesNode`. The only thing supplied by the harness is
the transport, and it is a real one:

```js
transact: async (t, key, txnFn) => {
  const res = await db.ref(`tenants/${t}/${key.replace(/[.#$[\]]/g, "_")}`)
                      .transaction(txnFn, undefined, false);   // applyLocally = false
  return { committed: res.committed, snapshot: res.snapshot };
}
```

Two source-anchored guards fail the run if production drifts from what this reproduces:
the `fkeySharedForTenant` fallback expression `return \`tenants/${tenantId}/${safe}\`;`
and the `mutateFor` call `return await runTransaction(ref(db, path), txnFn, { applyLocally: false });`
must both still be present in `index.html`.

Admin-SDK `ref.transaction(fn, cb, applyLocally)` and Web-SDK
`runTransaction(ref, fn, {applyLocally:false})` drive the same server-side
compare-and-swap protocol; the divergence is the SDK surface, not the server semantics.
That difference is recorded in `KNOWN_LIMITATIONS.md`.

## Independence of the clients

Each client has its own `admin.initializeApp` (its own connection and its own local
cache), its own selection controller, its own mutator, its own coordinator and its own
live `onValue` listener bound to the ctx captured at setup — the production hydration
path. Clients share nothing but the emulator.

## Case results

| Case | Area | Result |
|---|---|---|
| `EMU-A-A_then_B` | independent writers | both edits present, 160 dates retained |
| `EMU-A-B_then_A` | independent writers | both edits present, 160 dates retained |
| `EMU-A-parallel` | independent writers | both edits present under true `Promise.all` simultaneity |
| `EMU-B-negctl-A_then_B` | **R9 negative control** | the first writer's edit is LOST, as in the incident |
| `EMU-B-negctl-B_then_A` | **R9 negative control** | the first writer's edit is LOST, as in the incident |
| `EMU-B-r10-same-schedule` | paired proof | the identical schedule through R10 loses nothing |
| `EMU-C-retry` | transaction semantics | 8 independent clients, 8/8 committed, 36–37 `txnFn` runs for 8 transactions — real CAS retries |
| `EMU-C-conflict` | transaction semantics | `conflictPaths=["sales"]`, node byte-intact, commits after re-base |
| `EMU-C-idempotent` | transaction semantics | `committed_idempotent` / `already_applied`, node byte-identical |
| `EMU-C-id-collision` | transaction semantics | `blocked` / `invalid_identity` / detail `id_collision`, node untouched |
| `EMU-D-cross-business` | ownership | Rules deny; hydration denied and mutate `failed/permission_denied`; bizB unchanged |
| `EMU-D-cross-tenant` | ownership | Rules deny; tenantB unchanged |
| `EMU-D-viewer` | ownership | viewer role denied; node unchanged |
| `EMU-D-stale-selection` | ownership | `stale` with **zero** transport calls |
| `EMU-D-no-owner` | ownership | `blocked_no_owner` with **zero** transport calls |
| `EMU-E-cold-cache` | real-RTDB semantics | a write with no live listener aborts locally and fails CLOSED; the same edit commits once hydrated |

## The R9 losing schedule, and why the negative control matters

Both writers read the same 160-date revision before either writes; A edits `2026-02-10`,
B edits `2026-02-11`.

- **R9 model** (test-local full-node read-modify-write with `set()`, never re-introduced
  into runtime): the later `set` replaces the whole array, and the earlier writer's edit
  is gone. Reproduced in both completion orders on this emulator. This is what makes the
  suite credible — it can still see the historical bug.
- **R10** under the identical schedule: both edits present, all 160 dates retained.

## What the emulator revealed that the fake store could not

`EMU-E-cold-cache`. With `applyLocally:false` and no live listener on the node, the RTDB
client runs the transaction callback against its cached value — `null` — and the
production callback treats an absent node as "target not found" and aborts. RTDB honours
that abort locally, without contacting the server. The result is a typed non-commit
(`blocked` / `target_not_found`), the node is untouched, and nothing is silently
corrupted: the behaviour is fail-closed. With the listener attached — the state every
production write is issued from, because the lane refuses to write before hydration —
the identical edit commits. The in-process fake store always handed the callback the
true remote value, so this path did not exist there. It is pinned by the case above and
recorded in `KNOWN_LIMITATIONS.md`.

## Reproducing

Command, expected output and the JAR-cache note: `test/emulator/README.md`, section
"Run the R10 concurrency validation". Java 21+ is required by firebase-tools 15.23.0.
The run never touches Production or Preview: project `demo-marjin-rules`, namespace
`demo-marjin-rules-default-rtdb`, host `127.0.0.1:9000`, credentials absent, and the
safety gate aborts before any request if any of that is untrue.
