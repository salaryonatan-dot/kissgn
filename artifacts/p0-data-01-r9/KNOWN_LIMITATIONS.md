# R9 — KNOWN LIMITATIONS

1. **Non-entries automatic repair writes remain (`P0-REV-SAFETY-005`, partial).**
   `_rtdbSet` repair/setup writes for `user_tenants`, `username_index` and `user_active_biz` still
   occur outside the entries lane. R9 removes only the **entries** self-heal write. Opening the
   deployed app is therefore still not provably write-free for those non-financial keys.
   *Out of R9 scope (not the financial `entries` lifecycle); a follow-up is recommended.*

2. **The display defect is untouched (`P0-REV-DISPLAY-001`).** `פדיון יומי` still renders the
   current browser month only. R9 deliberately changes no visible product behavior. Historical
   months remain un-browsable until the separate display commit.

3. **`allowDrop` is a trusted caller declaration.** The guard proves a payload does not *silently*
   drop dates; a caller that explicitly declares `allowDrop` (today only clear-all) is trusted.
   A wholesale replace that *modifies values* on existing dates without dropping any is likewise
   trusted — value-level validation is out of scope.

4. **Latest-wins deferral.** Only the most recent deferred remote payload is retained; superseded
   intermediate remote payloads are intentionally dropped.

5. **Bootstrap probe is best-effort.** A genuinely absent node hydrates as empty; any other read
   failure marks the lane `hydrationFailed` (fail-closed) — correct, but a business whose first
   read fails will refuse saves until a successful listener payload or a retry arrives.

6. **Pre-hydration saves are refused, not queued.** This is deliberate (queuing against unknown
   history would reintroduce the destructive-payload risk), but it is a UX change: a save
   attempted before hydration returns `blocked_unhydrated` and the caller must surface it. The
   production call sites currently treat a non-`applied` status as a failure to display; wiring a
   specific user-facing message for this status is a small follow-up.

7. **No staging or Production verification.** All evidence is local and offline. The review's
   recommended staging run against a KGS-like March–August fixture has **not** been performed
   (Production/RTDB access is prohibited in this task). A 160-date fixture is exercised in tests.

8. **R9 is not deployed and does not by itself close `P0-DATA-01`.** The deployed bundle remains
   `0130e66`, which predates R1–R9. Write suspension should remain until R9 is independently
   reviewed, the display fix lands, and deployment is separately approved.
