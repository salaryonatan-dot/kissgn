# Known Limitations

- Cron authentication was inventoried only. This slice intentionally does not unify `x-vercel-cron` and Bearer `CRON_SECRET` behavior across endpoints.
- Real Vercel runtime behavior was not verified. No production Vercel, production Firebase, production API, or deployment access was used.
- `npm ci` surfaced existing dependency audit findings. No dependency upgrades were made because upgrades are out of scope for this slice.
- `/api/proactive/run` cron/manual scan behavior still uses its pre-existing auth and error-response shape; only authenticated read actions were hardened.
- Existing owner/super_owner implicit all-business behavior is preserved because it is part of the current canonical `requireBizContext` contract.
- This slice does not address staging, backups, queueing, provider migration, POS integrations, VAT, KPI formulas, or entries blob migration.
- Documentation remediation records runtime-dependent facts as unknown rather than verified. App Check enforcement, deployed Firebase rules, production environment variables, cron headers, deployed commit, and backup configuration still require operator runtime verification.
- `SECURITY.md` now documents that current POS connectors are dormant/diagnostic/future work and that manual entries are the current primary ingestion path; no POS implementation behavior was changed.
- `SECURITY.md` now documents the known agent/KPI data-source divergence; the shared KPI engine remains pending and out of scope.
