# Known limitations — R10 final candidate

Nothing here is a claim of approval. These are the things a reviewer should know before
deciding, written down rather than left to be discovered.

## 1. The emulator harness uses the Admin SDK, production uses the Web SDK

Production calls `runTransaction(ref(db, path), txnFn, { applyLocally: false })` from the
modular Web SDK loaded from the gstatic CDN. The Web SDK is not a repository dependency,
so the emulator harness drives the same node through `firebase-admin`'s
`ref.transaction(fn, cb, applyLocally=false)`. Both speak the same server-side
compare-and-swap protocol to the same emulator, and two source anchors fail the run if the
production path derivation or the production transaction call changes. But the client-side
SDK surface is not byte-identical to production's, and this validation does not cover
Web-SDK-specific behaviour (its own cache eviction, its reconnect/offline queue, or
`.info/connected` transitions).

## 2. Cold-cache aborts return a misleading typed reason

`EMU-E-cold-cache`. With `applyLocally:false` and no live listener on the entries node,
RTDB runs the transaction callback against its cached value — `null` — and the production
callback treats an absent node as `target_not_found` and aborts. RTDB honours that abort
locally without contacting the server, so an edit to a row that *does* exist comes back as
`blocked` / `target_not_found`.

It is fail-closed: nothing is committed and nothing is corrupted. Exposure is bounded
because the lane refuses to write before hydration (`blocked_unhydrated`) and hydration
comes from the same listener that warms the cache. But the reason reaching the operator
would be wrong in that state, and the behaviour was invisible to every fake-store test.
Pinned by `EMU-E-cold-cache`; not changed in this round because it would mean touching the
transaction callback's absent-node semantics, which is outside the scope given.

## 3. `stale` is handled silently in the labor UI

Deliberate, and flagged: see `LABOR_UI_EVIDENCE.md`, "One deliberate deviation from the
brief". It follows the Gate-5-accepted policy for `deleteEntryByDate`. If a visible
message for `stale` was intended, it is a one-line change.

## 4. The labor input writes on every keystroke

`onChange={e=>setDailyLabor(date,e.target.value)}` has no debounce, so each character
typed submits an `upsert_entry` intent. Pre-existing, unchanged here. It multiplies write
volume and, now that refusals are visible, can flash the banner mid-typing. A debounce or
an on-blur commit is a UX change and was not made unilaterally.

## 5. `entryDateKey` does not validate the shape of a business date

`entryDateKey("not-a-date")` returns `"not-a-date"`; only an empty or nullish date yields
`null`. A caller that supplied a malformed date string would create a row carrying it.
Every current call site derives the date from a rendered calendar, so this is not
reachable today, and tightening it would change accepted canonicalization semantics —
reported rather than changed.

## 6. `biz:*:entries` has no server-side `.validate`

In `database.rules.json` the `$dataKey` branch that governs `biz:{bizId}:entries` defines
`.read` and `.write` but no `.validate` (unlike the top-level `entries`/`config`/`suppliers`
keys, which cap `_v` at 16 KB and require it to be a string). Shape and size of the entries
blob are therefore guarded only on the client. Rules changes are out of scope for R10; this
is recorded for the Rules owner.

## 7. What this round did NOT validate

- No Web-SDK end-to-end run in a real browser against the emulator.
- No multi-tab / same-browser concurrency, no offline-then-reconnect replay.
- No load or volume testing: the emulator history is 160 dates.
- Nothing about non-entries destinations (`fixed`, `config`, `suppliers`) beyond what the
  pre-existing suites already covered.
- No Production or Preview verification of any kind, by design.

## 8. Independent review status

R10 has still never been reviewed as a whole candidate. The Gate 3 `APPROVED` recorded in
`artifacts/p0-data-01-r10/GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md` exists only inside the
implementer's own ledger — unlike R2–R9, there is no independent
`codex-…-review-<date>/` directory for R10 under `~/Documents/marjin/`. The last
whole-candidate independent verdict on this workstream remains **`CHANGES_REQUIRED`** on
R9 (`b854054`, 2026-08-07). Implementation tests passing is not independent acceptance.

## 9. Environment note for whoever re-runs this

firebase-tools 15.23.0 refuses any JDK below 21. If the RTDB emulator JAR cannot be
downloaded (`storage.googleapis.com` blocked), copy an existing
`firebase-database-emulator-v4.11.2.jar` into `~/.cache/firebase/emulators/` — the CLI
then needs no network for the emulator itself. If the CLI reports
`Failed to load initial Database Emulator rules: … Request was cancelled`, unset the
`HTTP(S)_PROXY`/`ALL_PROXY` family for the command: the CLI's rules upload to
`127.0.0.1:9000` is otherwise sent through the proxy. Both notes are in
`test/emulator/README.md`.
