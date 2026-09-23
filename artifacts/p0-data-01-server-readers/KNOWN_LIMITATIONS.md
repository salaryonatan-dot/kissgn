# KNOWN LIMITATIONS / OPEN ITEMS

## 1. RESOLVED 2026-09-23 — the S0/VAT scope guard (test boundary, not storage core)

**Resolution:** the CTO ruled the failing scope check an expected policy boundary and
authorized the minimum guard change. The two-layer guard described below (originally a
proposal) is now IMPLEMENTED — see `S0_GUARD_ADAPTATION.md` — with the refinements that
the authorization is by literal pinned per-file delta (not a path allowlist), the Rules
are frozen from the approved core onward, and mutation proofs A–F cover the abuse cases.
The original analysis is kept for the record:

`test/finance/vat-invariant.test.mjs` test 5 diffs the working tree against its pinned
`BASE = 686b4350…` and asserts no changed path matches `^src/analytics/`,
`^src/repositories/`, `^src/agent/`, `^src/snapshot/`, `^src/forecast/`, `database.rules.json`,
`vercel.json`, `package*.json`, `/(migration|migrations|scripts)/`. The only path-level
exception is `database.rules.json` under the semantic authorized-delta check.

Three of the nine live read sites are in `src/analytics/dailyBuilder.ts`,
`src/repositories/analytics/{dailyMetricsRepo,laborRepo,purchasesRepo}.ts` and
`src/snapshot/snapshotBuilder.ts`. Converging them is the assignment; any change there fails
the guard by construction. The guard is on the DO-NOT-MODIFY list ("VAT/S0 logic"), and the
assignment says: "If implementation proves one of these MUST change: STOP and report
CORE_DEPENDENCY_FOUND." Codex's plan said the same thing in advance: "a legitimate
reader-only patch would fail this scope guard … If a safe scope-check decomposition is not
demonstrable, stop for explicit guard-policy approval … This is a test-boundary issue, NOT a
core-storage dependency."

At that point no commit was made and the guard file was untouched pending the CTO's policy.

### Guard decomposition as originally proposed (now applied, in the stricter pinned-delta form)

Keep every historical S0 guarantee and add a second, narrower gate for the reader slice:

1. Keep test 5 exactly as is for the range `BASE(686b4350) → H`, where
   `H = 8cac71c1` (the Codex-approved Storage V2 core). This preserves the proof that the
   entire S0 + Storage V2 history never touched the forbidden areas.
2. Add a new range check `H → working tree` with an explicit **reader-only allowlist**
   under the forbidden roots: exactly `src/analytics/dailyBuilder.ts`,
   `src/repositories/analytics/dailyMetricsRepo.ts`, `…/laborRepo.ts`, `…/purchasesRepo.ts`,
   `src/snapshot/snapshotBuilder.ts`; every other forbidden path still fails.
3. Content checks on the allowlisted files (`git diff --unified=0 H -- <file>`):
   the existing added-line regex; every added `import` under a forbidden root must be
   `../../lib/analytics/entriesReader.js` (or the relative equivalent) only; no added line
   may contain `parseFirebaseData(` applied to an entries snapshot, `_v`, `JSON.parse(`,
   `.set(`, `.update(`, `.remove(`, `.transaction(`; the VAT literal / division-site test
   (test 4) already covers the VAT arithmetic and stays untouched.
4. Once the slice is merged, `H` advances to the merged reader SHA and the allowlist for
   this slice is retired (so the guard returns to "no changes under forbidden roots").

Alternative (Codex's suggestion): split the reader work so the five files are the only
diff of a dedicated commit and have the guard skip only that commit by SHA. Equivalent in
strength; the allowlist form is easier to audit in one place. Either way the change is to
the **test**, not to VAT logic or storage core.

## 2. UNRELATED P1 FOLLOW-UP — pre-existing production behaviour surfaced by the real Admin SDK (not changed; canary-preflight concern)

`dailyBuilder` copies `config.region_ids` / `config.subregion_ids` into
`meta.location` verbatim; when a business config lacks both keys they are `undefined`, and
the Admin SDK rejects `set()` payloads containing `undefined`
(`value argument contains undefined in property '…meta.location.region_ids'`). The emulator
matrix seeds both as `[]`. Whether production configs always carry these keys was not
investigated (out of scope; `src/analytics` content changes are limited to the reader).
Deliberately NOT fixed in this task (CTO instruction). Track as a separate P1 and check it
in the production preflight / single-business canary: a business config without
`region_ids`/`subregion_ids` would fail `saveAnalyticsDoc` today, independently of Storage V2.

## 3. Deliberately out of scope / unchanged

- Activation of the supplier / expensive-employee checkers (D2) — separate reviewed change that removes `ENTRIES_ANOMALY_CHECKS_ENABLED`.
- Operator resolution of duplicate business dates (D1) — stable-id delete path; the preflight report is informational only.
- Old cached client builds (`PRE_CUTOVER_BLOCKER` from Codex R1) — needs the build fence.
- Production preflight / backup / rollback / canary — not part of this slice.
- `src/alerts/runner.ts`, `api/**`, `src/agent/**` — untouched; their existing error boundaries are what D3 relies on (proven at the module level and on the emulator via `runAlertsForBiz`, `buildAnalyticsForAll`, `buildSnapshotForAll`, `fetchPlannedData`).

## 4. Harness caveats

- The in-memory RTDB (`test/support/server-reader-harness.mjs`) implements `orderByKey().startAt/endAt/limitToLast` key-range filtering (needed by the structured exceptions query) but not `orderByChild` filtering; nothing under test uses the latter. The emulator matrix is the authority for real query semantics.
- The compiled-module harness replaces only `src/firebase/admin.ts`, `lib/adminSdk.js` and `lib/sendEmail.js`; everything else is the real source compiled by the repo's `tsc`.
- `node_modules` in the new worktree is a symlink to the sibling worktree's (`kissgn-m1-s0-vat-invariant`), as in the approved worktree; it shows as untracked in `git status` and must not be committed.
