# P0-DATA-01 R7 — Adversarial Probes / Negative Control

## Negative control (R6 fails, R7 passes)
A self-contained probe outside both repositories
(`/tmp/r7-negctl/probe.mjs`) loads the REAL `createEntriesWriteCoordinator` +
`createSelectionController` + `MarjinEntries` from a given `index.html` via the
same vm extraction the test suite uses, then runs the cross-destination scenario.

### Scenario
1. Selection = `T1/A` (generation 1).
2. `submit({ rows:[{date:"2026-07-24", sales:500, ...}] })`; ack the write
   (commit resolves `{ok:true}`) — the canonical payload is now persisted at
   `biz:A:entries`.
3. Switch selection to `T2/B` (`selection.invalidate("T2","B")` +
   `coordinator.invalidate()`) — new tenant, business AND generation.
4. Deliver the **identical** canonical payload as a `T2/B` listener echo:
   `onListenerEcho(sameCanonicalPayload, selection.current())`.

### Results
| Worktree | index.html source | `onListenerEcho` status | Destination hydrated |
|---|---|---|---|
| R6 (`kissgn-p0-data-01-r6`) | unmodified baseline | `ignored_own_echo` | **false** (bug: suppressed) |
| R7 (`kissgn-p0-data-01-r7`) | this change | `applied` | **true** (correct hydration) |

Commands:
```
node /tmp/r7-negctl/probe.mjs R6 <r6>/index.html   → {"label":"R6","status":"ignored_own_echo","hydrated":false}
node /tmp/r7-negctl/probe.mjs R7 <r7>/index.html   → {"label":"R7","status":"applied","hydrated":true}
```

### Why this proves closure of R6-FIND-001
The ONLY variable between the two runs is the coordinator source. With the R6
coordinator, an identical canonical payload in a different tenant+business+
generation is swallowed as the caller's own echo and the newly selected
destination is not hydrated (`hydrated:false`). With the R7 coordinator, the same
payload is recognized as legitimate remote data and applied (`hydrated:true`).
R6 was read-only throughout (verified at `13e70a81`, clean); the probe lives only
under `/tmp` and imports each worktree's `index.html` without modification.

## In-suite adversarial coverage
- `R7-5` / `R7-7`: a foreign / old-context callback is rejected `stale` before it
  can consume or clear the active destination's marker (decision-ordering probe).
- `R7-8`: a FAILED write must not leave a phantom marker that blacklists a later
  identical remote payload (retirement probe).
- `R7-9`: identical fingerprints across destinations/generations must not
  cross-consume; no marker accumulation (`ownPending == 0`).
