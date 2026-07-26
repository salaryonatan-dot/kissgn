# P0-DATA-01 Root Cause

## Verified facts (read directly from the pre-fix source at b16f5567)
- `saveEntry` selected append-vs-replace by **array index**, not business-date identity (`index.html`, pre-fix lines ~3557-3560):
  `updated = editingId!==null ? entries.map((e,i)=> i===editingId ? … : e) : [...entries, …]`
  New-entry mode (`editingId===null`) appended unconditionally; nothing prevented a second row with an existing date. Edit mode replaced by position; changing the date during an edit onto another existing date likewise produced two rows for one date.
- The dashboard consumes every row: `monthEntries = entries.filter(e => e.date && e.date.startsWith(monthPrefix))`, then `calcMetrics(monthEntries, …)` and `buildChart(monthEntries)` (`index.html:~3641-3644`). Two same-date rows ⇒ doubled MTD contribution and a doubled chart point.
- The entries listener (`sub(`biz:${bizId}:entries`, …)`, pre-fix ~2902-2943) dedups by date and writes the healed blob back to Firebase when it detects duplicates.
- Save ordering (pre-fix ~3563/3574): `await persist(updated)` → Firebase local `onValue` echo → listener dedups + self-heals → handler resumes → `setEntries(updated)` — the raw duplicated array is applied **after** the healed state.
- `persist()` wrote whatever array it was handed, unvalidated (pre-fix ~3117).
- Double-submit was already guarded (`entrySaveInFlightRef`, `:3472-3473`), so a double-click alone was not the trigger class.

## Root-cause statement (exact function and state transition)
**`saveEntry`'s new-entry branch performed the state transition `entries → [...entries, netFormEntry]` keyed by nothing** — the entry's identity (tenant+business via the storage path, plus the business-date inside the blob) was never consulted — **and the post-persist `setEntries(updated)` re-applied that duplicated array as the final state write after the subscription echo had already healed both state and RTDB.** MTD and the chart, both derived from the same `entries` state, therefore showed 2026-07-24 twice (+₪27,753 ⇒ ₪608,236) until a fresh hydration replaced state with the (self-healed) canonical blob.

## Why refresh cleared it
The listener's self-heal write-back deduplicated the RTDB blob at save time; only the React state kept the duplicate (because `setEntries(updated)` landed last and no further echo fired). Refresh re-subscribed, received the already-clean blob, and the dedup handler set canonical state — ₪580,483.

## Reproduced behavior
Encoded deterministically in `test/dashboard/entries-lifecycle.test.mjs` (incident fixture: replaying ₪27,753 for 2026-07-24 cannot change ₪580,483; pre-fix append math would have produced 608,236).

## Inference (labelled)
- The precise user gesture (which UI path put an existing date into a new-entry form) is **inferred, medium confidence** — consistent with Codex's independent forensic finding; the failure class does not depend on the exact gesture.
- Firebase local-echo timing (echo before the resumed handler's `setEntries`) is **strongly inferred** from SDK semantics; the repair does not depend on this ordering — post-fix, `updated` is canonical regardless.

## Uncertainty
- Whether production RTDB briefly held the duplicated blob before self-heal (likely, milliseconds) — unobservable now; no persistent duplicate was found or required.
- Cache/live merge, duplicate listeners, timezone mapping, and Labor Cost were examined and are **not** the cause (listener cleanup exists at the effect return; dates are exact strings; Labor figures were consistent across screens).
