# B2 successor — scope and guards

**Runtime (B2-G26):**
- `src/snapshot/snapshotBuilder.ts` (S08, the server-API consumer);
- `src/snapshot/snapshotEmail.ts` (S09, the core consumer: view model, `kpiShares`, retained insights and presenter).

**Unchanged:**
- `api/daily-snapshot/run.ts`, `lib/**`, `index.html`;
- every core, generated `fincore/**`, `src/policy/productFinance.ts` and `src/finance-server/**` file (B2-G27/G28);
- Layer A, Rules and the four B1 reader pins (`6b70d03c…`, `4a5cb8f8…`, `14eff463…`, `7916308f…`).

**Guard and pin changes (owner-authorized narrow list):**
- `test/support/server-reader-authorized-delta.mjs`: exact re-pin of the builder and pin of the e-mail as the sixth exact file.
- `test/finance/b1-guards.test.mjs`: union of slice manifests; exact B1 entries kept; one owner per path.
- `test/finance/vat-invariant.test.mjs`: Layer-B list only.
- `test/finance/s0-guard-server-reader-mutations.test.mjs`: re-anchored needles plus B2 mutants (gross-up, dropped exceptions, missing ⇒ ₪0, legacy partial leak, forced 100% share, dropped dated warning).
- `test/finance/core-consumers/b2.json` = `{consumers:[snapshotEmail.ts], serverApiConsumers:[snapshotBuilder.ts]}`.
- `test/finance/consumer-manifest.json`: S08/S09 `MIGRATED (B2)` and H8 `migrated_in: B2`. There is no SV3 row.

**Mutation evidence:** `test/finance/b2-guard-mutations.test.mjs` (B2G-01…05).
