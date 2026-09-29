# 07 — Operator runbook (PREPARED, NOT RUN; requires separate CTO authorization)

EV-1 only informs the B1 gate. There is no apply, remediation, backfill, Rules, access or deployment step here.

## Preconditions
1. Codex has approved the exact collector commit (this commit, SHA recorded in the external handoff).
2. The CTO authorization names:
   - EV-1;
   - the commit;
   - project `kissgn-1227b`;
   - database `https://kissgn-1227b-default-rtdb.firebaseio.com`;
   - the approved **read-only** service-account file;
   - the as-of Israel business date;
   - the output parent directory.
3. Operator Mac:
   - a checkout **at exactly that commit** with a clean tracked tree (the tool refuses otherwise);
   - Node ≥ 20 (uses global `fetch`); no other dependency — the collector does not need `node_modules`.
4. Credential file:
   - a non-symlink regular file, mode 0600, project `kissgn-1227b`;
   - its IAM permissions must include `firebasedatabase.instances.get` and none of `update/create/delete` (the tool proves this before reading and refuses otherwise).
5. Shell environment free of the variables in 05. Run from a clean shell, e.g. `env -i HOME="$HOME" PATH="$PATH" node …`.
6. The output parent exists outside every git tree. The run directory must **not** exist.

## Command shape (no secrets on the command line)
```
cd <checkout at the approved commit>
env -i HOME="$HOME" PATH="$PATH" node tools/finance-core/ev1-collector.mjs \
  --env production \
  --project kissgn-1227b \
  --database-url https://kissgn-1227b-default-rtdb.firebaseio.com \
  --credentials-file <approved-read-only-sa.json> \
  --as-of <YYYY-MM-DD> \
  --expected-commit <approved 40-hex sha> \
  --out-dir <new dir outside git, e.g. ~/Documents/marjin-reviews/<date>/ev1-run-<UTC>>
```

## Expected output files (`<out-dir>`, 0700; files 0600)
- `PRE_FLIGHT.md`
- `EV1_REPORT.json`
- `EV1_SUMMARY.md`
- `COMPLETE.json` (written last)

## Success markers (all required)
- exit code `0` and stdout `"status":"EV1_EVIDENCE_COMPLETE"`;
- `COMPLETE.json` contains:
  - `"evidenceComplete": true`;
  - `"mode": "production"`;
  - `"project": "kissgn-1227b"`;
  - `repoSha` = the approved commit;
  - `classifierVersion` = `EV1/3`;
- `EV1_REPORT.json`: `failures: []`; every invariant I01–I19 `holds: true`;
- `node tools/finance-core/ev1-collector.mjs --verify <out-dir>` ⇒ exit 0, `EV1_BUNDLE_VERIFIED_COMPLETE`.

## Stop markers (any ⇒ stop, keep the bundle, no retry, operator/CTO review)
- **Refused before reading:**
  - exit 2 `EV1_PREFLIGHT_REFUSED` (environment, identity, credential file, commit/tree, as-of or output directory);
  - exit 3 `EV1_TRANSPORT_REFUSED` / `CREDENTIAL_SCOPE_TOO_BROAD`.
- **Output failure:** exit 4 `EV1_OUTPUT_FAILED`.
- **Incomplete evidence:**
  - exit 10 `EV1_EVIDENCE_INCOMPLETE`;
  - `evidenceComplete !== true`;
  - any `failures[]` entry;
  - any invariant `holds: false`;
  - `--verify` ≠ `EV1_BUNDLE_VERIFIED_COMPLETE`;
  - missing `COMPLETE.json`.
- **Counter checks:** `businesses.attempted ≠ businesses.discovered`, `readFailed > 0`, `classifierFailed > 0`, or `tenants.failed > 0`.
- **Unexpected mode or identity:** `mode ≠ production` or `repoSha ≠ approved`.

## Post-run checks
1. `--verify <out-dir>`: digests, modes, run identity, scope/source digests, full invariant re-evaluation, secret scan.
2. Independently recompute from `EV1_REPORT.json`:
   - `businesses.attempted == businesses.discovered`;
   - `readOk + readFailed == attempted`;
   - `rows.observed == rows.classified + rows.unclassifiable`.
3. Read `EV1_SUMMARY.md`. Confirm it contains only counts, categories and technical tenant/business ids.
4. Apply the B1 go/no-go rules to `classification.b1Signals`, for example:
   - `identity.duplicateIdValues > 0` ⇒ B1 STOP;
   - collision / zero-only / hourly-payroll counts size the visible differences.
5. Attach only the summary and the completeness decision to the B1 gate record.
6. Do not remediate, backfill, publish Rules, mutate access, deploy or start B1 unless a separate gate approves it.
