# P0-DATA-01 Reproduction

## Observed incident (2026-07-26)
- Correct July MTD revenue: ₪580,483 (includes 2026-07-24 = ₪27,753 once).
- Temporary incorrect total: ₪608,236 = 580,483 + 27,753 (the 07-24 day counted twice).
- Chart plotted the 2026-07-24 point twice.
- Refresh restored ₪580,483.

## Deterministic reproduction (against the pre-fix code path, expressed as state math)
1. `entries` state contains one row per date for July, including `2026-07-24` with revenue 27,753 (total 580,483).
2. The daily-entry form is opened in new-entry mode (`editingId === null`) with its date set (or changed) to `2026-07-24`, and saved.
3. Pre-fix `saveEntry` builds `updated = [...entries, netFormEntry]` — an unconditional append with no date-identity check → two `2026-07-24` rows.
4. `monthEntries = entries.filter(startsWith monthPrefix)` feeds BOTH `calcMetrics` (MTD) and `buildChart` — every row counts → MTD becomes 608,236 and the chart shows 07-24 twice.
5. `await persist(updated)` fires the Firebase local `onValue` echo first; the entries listener dedups and even self-heals RTDB; **then** the resumed handler runs `setEntries(updated)` with the raw duplicated array — the duplicated array is the LAST state write, so the UI keeps showing the duplicate.
6. RTDB itself ends up deduplicated (the listener's write-back), so a refresh re-subscribes, receives the clean blob, and restores ₪580,483 — exactly the observed recovery, with no persistent production duplicate required.

## Regression fixture
`test/dashboard/entries-lifecycle.test.mjs` encodes the incident numerically: 22×₪24,031 + ₪24,048 (07-23) + ₪27,753 (07-24) = ₪580,483; replaying the 07-24 payload through the repaired upsert/canonicalize paths can no longer produce 608,236 (asserted).
