# S0 EXACT PIN — R2 re-pin (one entry)

The exact-content guard (`test/support/server-reader-authorized-delta.mjs`, independently approved) is unchanged in design. Because `src/repositories/analytics/dailyMetricsRepo.ts` changed, ONLY its pin was updated:

```
src/repositories/analytics/dailyMetricsRepo.ts   51675f0a… (R1, c46c2727)  →  301f95993258f75051e4a4ee91ca22a1e8839207 (R2)
src/analytics/dailyBuilder.ts                    a327186c…  unchanged
src/repositories/analytics/laborRepo.ts          33a646e9…  unchanged
src/repositories/analytics/purchasesRepo.ts      6a3f9be2…  unchanged
src/snapshot/snapshotBuilder.ts                  e36df4d8…  unchanged
```
`git hash-object` of each working-tree file equals its pin (asserted in the positive control), and the four unchanged pins are asserted equal to `git rev-parse c46c2727:<file>`.

## Negative proofs (`test/finance/s0-guard-server-reader-mutations.test.mjs`, 9/9)
| required proof | case | result |
|---|---|---|
| previous c46 dailyMetricsRepo bytes denied | F: `git show c46c2727:…dailyMetricsRepo.ts` hashed → `approved_content_mismatch` (actual = R1 blob ≠ pin) | ✔ |
| whitespace change denied | D: one extra space | ✔ |
| comment denied | D: added comment | ✔ |
| statement change denied | C: reordered `push` statements; B: moved helper blocks; D: `void 0;` / extra export | ✔ |
| formula change denied | E: `/1.18` on revenue, ratio default, `Number(total)/10**scale` substituted for the final conversion, snapshot gross-up; F: binary `reduce` substituted for `decimalSum` | ✔ |
| other protected sibling denied | G: 10 siblings incl. the detector, `runProactiveJob.ts`, `vercel.json`, `package.json`, Rules | ✔ |
| directory/glob broadening denied | H: 12 shapes + directory carrying the exact blob + bad/empty/base-equal pins | ✔ |
| relocation (Codex SR-F2) still denied | A: declaration moved after first use → mismatch + runtime ReferenceError | ✔ |

`test/finance/vat-invariant.test.mjs` 5/5 (Layer A + Layer B on the committed tree); `[H10]` 30/30 unchanged.
