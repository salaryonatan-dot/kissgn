# Known Limitations (after Hardening R2)

Unchanged from R1 and the Codex R1 review — recorded, not closed here:
- **Server-reader convergence** (9 sites / 7 files) — PRE_CUTOVER_BLOCKER; untouched.
  Note (Codex): after R1-F1 is fixed a new business's first save IS a V2 destination, so
  deployment/activation must gate all first V2 destinations until reader and old-client
  gates pass.
- **Old cached builds** — PRE_CUTOVER_BLOCKER; an effective deployment/version fence must
  be proven before the first V2 business.
- **Direct frozen `_v` deletion** and **raw `rows`-map deletion** by an authorized raw SDK
  writer — P1 follow-ups per Codex RESIDUALS.md (no supported runtime path; document,
  protect/monitor privileged access; raw rows deletion does not retire an epoch).
- Real-data preflight, protected backup/rollback boundary, controlled jobs/writers and a
  monitored one-business canary with explicit CTO authorization remain required.
- Non-entries `$dataKey/rows/*` restriction (Codex P2) and business-date semantics remain
  documented baseline follow-ups.

R2-specific notes:
- Numeric-key MAP equivalence is defined for exactly `supplier_payments` and
  `hourly_payroll`. A numeric-key object under any OTHER field is blocked by preflight and
  would still differ on RTDB readback at runtime; no runtime row is produced with such a
  shape by the UI template.
- The clear/listener rule keys on the storage epoch of a parked echo. A parked echo without
  an epoch (legacy destination) keeps the pre-R2 behaviour (transaction result applied).
- The dashboard harness substitutes React's `useRef`/`setEntries` and the `window.storage`
  transport; it does not render the React tree. The rendered call sites are exercised by
  `entries-ui-call-sites.test.mjs` (legacy engine) and by `submitLaborEntry` / the real
  clear-all arguments here.
