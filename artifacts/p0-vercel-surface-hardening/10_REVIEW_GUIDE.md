# 10 — Review Guide (Codex)

1. `git show --stat HEAD`. Expect exactly:
   - `.vercelignore`;
   - `test/support/vercel-surface.mjs`;
   - `test/security/vercel-deployment-surface.test.mjs`;
   - `artifacts/p0-vercel-surface-hardening/00–10`.
   No runtime file.
2. Read `.vercelignore`:
   - an allowlist starting with `/*`;
   - 10 re-allowed runtime entries;
   - never-upload patterns.
   Check that `.git` is **not** re-allowed.
3. Check the model against Vercel's rules. It encodes three things: the upload filter (CLI default list plus `.vercelignore` via `ignore`), the static pattern (`VERCEL_PLATFORM_FILES`), and function detection plus the `@vercel/nft` trace with `@vercel/node`'s options. Doc 04 cites where each comes from.
4. Run `node --test test/security/vercel-deployment-surface.test.mjs`. Then try any mutation from doc 06, for example delete `!/lib`, and confirm that it fails.
5. Run the full suite and tsc.
6. Judge:
   - the severity reasoning in doc 08 (release-introduced exposure; current Production unverified);
   - the residual `src/`/`lib/` static exposure (doc 05);
   - the Preview plan (doc 07, BOTH);
   - the Git-integration question: `.vercelignore` in Git builds is not stated explicitly in Vercel's docs, so it must be observed before promote.
7. Once B1 adds `fincore/`, test 10 already allows it. Test 2 needs no change, since `fincore` is classified.

Owner items:
- Review the root image privately.
- Confirm on the dashboard, read-only, that there is no Ignored Build Step using `git` and no framework/output overrides.
