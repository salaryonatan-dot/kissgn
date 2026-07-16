# output/ (local-only)

Destination for redacted dry-run files produced by the read-only audits when run with an
explicit `--out`. Contents are git-ignored: **never commit a live audit result**. The audits
never write to Production; any file here is a local, redacted planning artifact.
