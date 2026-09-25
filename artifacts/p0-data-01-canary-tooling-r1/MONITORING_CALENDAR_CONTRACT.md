# MONITORING CALENDAR CONTRACT (R1 — Finding 4)

"Seven consecutive complete daily cycles" = seven clean COMPLETE cycles on seven ADJACENT business calendar dates.

* Business date = `cycleId` in canonical ISO `YYYY-MM-DD`; adjacency = `next === nextBusinessDate(prev)` where `nextBusinessDate` adds one calendar day in UTC on the date string (no elapsed-24 h arithmetic, so DST never breaks adjacency; the local slot rendering is unchanged).
* Effective record per date: the last ledger record for that `cycleId` (a correction supersedes its predecessor); a duplicate record for one date is one day, never two.
* Clean = `cycle === "COMPLETE"` and level ∈ {OK, EXPECTED, WARNING}. INCOMPLETE (which includes any UNKNOWN or MISSING derived evidence — `buildCycleRecord` never marks such a cycle COMPLETE), REVIEW_REQUIRED, RECOVERY_HOLD_RECOMMENDED and STOP break the streak; a missing calendar date breaks it (the streak restarts at the next clean date).
* `windowArithmetic` returns `cleanStreak`, `streakStart`, `streakEnd`, `effectiveDates`, `elapsedHours`, `hoursMet` (≥168 h since `liveWriteCleanupAt`), `streakMet` (≥7), `stops`, and `windowMet = hoursMet && streakMet && lastRecordNotStop` — both gates are reported and tested independently.

Mandatory date tests (contract "R1-F4"): A Sep 1–7 + 168 h ⇒ pass · B Sep 1,2,4,5,6,7,8 ⇒ streak 5 (starts Sep 4), fail · C 7 adjacent days, 160 h ⇒ `streakMet` true, `hoursMet` false, fail · D ≥168 h, 6 days ⇒ fail · E day 4 INCOMPLETE ⇒ streak resets (4 from day 5) · F day 4 STOP ⇒ resets · G day 4 with UNKNOWN evidence ⇒ not a clean day · H corrected date counts once (a STOP correction breaks; a clean correction restores) and a duplicate date is one day · I seven adjacent dates across the Israel DST transition (2026-10-22…28) ⇒ adjacency intact · plus alternate-day records (8 records, streak 1) and a trailing STOP.
