# B2 successor — review guide

1. Check `git log -1 --format='%H %P'`: the parent must be `6d54e367…`. Then check that `git diff --stat 6d54e367 HEAD` shows only the two runtime files, tests, goldens and these artifacts.
2. Read `src/snapshot/snapshotEmail.ts` from the top down to `snapshotInsights`: this is the view encoding. The only derivation in it is `kpiShares`. Then read `buildSnapshotForBiz` in `src/snapshot/snapshotBuilder.ts`.
3. Run the focused set:
   `node --test test/finance/b2-snapshot.test.mjs test/finance/b2-email.test.mjs test/finance/b2-successor.test.mjs test/finance/b2-email-goldens.test.mjs test/finance/b2-guard-mutations.test.mjs test/analytics/entries-reader-snapshot.test.mjs test/finance/b1-guards.test.mjs test/finance/s0-guard-server-reader-mutations.test.mjs test/finance/vat-invariant.test.mjs`
4. Review the goldens as rendered e-mails (`test/finance/goldens/b2-email/*.golden.txt`).
5. Run the emulator: `node test/emulator/server-readers-matrix.mjs` (see `test/emulator/README.md`).
