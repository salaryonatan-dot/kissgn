# Absent Business Bootstrap (Codex SV2-05)

## Finding
`subscribeNode` (correctly) does not call back for a non-existent node; the R9 absent probe
marked the lane hydrated but left `entriesStorageModeRef` `null`, so the router refused the
first save with `storage_mode_unknown`. The ref also survived business switches.

## Explicit storage states
`entriesStorageModeRef.current` ∈ `null` (unknown — writes nothing) | `{mode:"absent"}` |
`{mode:"legacy", generation:null}` | `{mode:"v2", generation:<epoch>}` |
`{mode:"malformed", reason}` (writes nothing).

- Reset to `null` at the start of every selection effect (business/tenant switch), before
  any listener of the new selection is attached.
- Set to `v2`/`legacy`/`malformed` by the entries listener only.
- Set to `absent` by the read-only R9 probe (`storage.get` → "not found") ONLY while still
  `null`, so a probe result that resolves after the listener already reported a node
  cannot regress the mode. `markHydrated(ctxAtSetup, [])` is retained verbatim.

## Chosen behaviour (CTO preference): initialise directly into V2
Router: `absent` → V2 engine. V2 engine in `absent` mode accepts a create only (edit/delete
→ `target_not_found`; clear-all → `clear_all_requires_full_hydration`; a V2-bound intent →
`generation_retired`) and performs ONE node-level CAS: `cur === null` →
`{schemaVersion:2, generation:1, rows:{[id]: stampRow(row, 1)}}`; `cur !== null` →
`conflict/storage_initialised_concurrently` (the listener then hydrates the node and the
retry takes the row lane). No legacy `_v` is ever written for a new business; authorization
is unchanged (the write is an ordinary entries write); no conversion is needed.

Rules allow exactly this transition (`generation === 1`, rows a non-empty map, row
`_gen === 1`) and deny initialisation at any other epoch.

## Proof
`[H5]` unit ×4: first create initialises V2 (log shows one node-level write, then the row
lane); identical repeat is `committed_idempotent/already_created`; absent mode refusals;
concurrent initialisation is a typed conflict with nothing overwritten; router dispatch;
production wiring pins (reset, listener, probe guard, `mode()` hook, binding capture and
dispatch, exactly four assignments of the ref).
`V2-H07` emulator with the REAL coordinator/router/engine over the real SDK: absent →
committed `generation 1`, no `_v`, row stamped, mode flips to `v2` from the listener, second
create via the row lane, identical first save repeated is idempotent; two clients racing on
an absent business: `committed,conflict` (typed `storage_initialised_concurrently`), the
loser succeeds after hydration, two rows at epoch 1.

Result: **PASS** (ABSENT_BUSINESS_BOOTSTRAP).
