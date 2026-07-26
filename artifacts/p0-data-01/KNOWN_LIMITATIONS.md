# P0-DATA-01 Known Limitations

- **Scope**: the keyed invariant lives in the dashboard entries lifecycle (`index.html`) only, per the P0 scope guard. Other surfaces keep their existing behavior until the planned S4 migrations; the shared financial core (S2/S4A) was deliberately NOT implemented here.
- **Undated rows are dropped** by canonicalization — identical to the previous listener behavior, now also enforced at the persistence boundary; a save with an empty date is not appended (previously it was appended and then silently dropped on the next hydration).
- **Legacy merge semantics preserved, not redesigned**: earliest-non-zero-wins for scalars and per-supplier summation for `supplier_payments` are kept verbatim to avoid behavior change; revenue is never summed. A stricter conflict model belongs to the S2 contract.
- **Dates with non-`YYYY-MM-DD` strings** are keyed by their trimmed literal string (not normalized further); trimming now heals a `" 2026-07-24"`-style duplicate that the old code would have double-counted.
- The `activeBizIdRef` guard covers the entries save path and the async `lastyear` initial load; other setters remain protected by the existing effect cleanup (listeners are unsubscribed synchronously on business switch).
- Validation environment: `node_modules` symlinked from the S0 worktree; `tsc` validated with `--preserveSymlinks` (see TEST_RESULTS). No lint script exists.
- Device-VM git quirk: files under `.git` cannot be unlinked; stale zero-byte lock files were renamed aside (never deleted) and a benign `worktrees/kissgn-p0-data-01/locked` marker remains.
- The exact user gesture that created the incident's duplicate remains medium-confidence (the failure class is fully closed regardless).
