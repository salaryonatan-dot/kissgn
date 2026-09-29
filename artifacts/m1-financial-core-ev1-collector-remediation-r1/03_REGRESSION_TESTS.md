# 03 — Regression tests (`test/finance/ev1-collector.test.mjs`, +15 tests; one existing test updated)

| Required case | Test | Result |
|---|---|---|
| P1-1 clean, fully classifiable ⇒ true | `R1-P1-1` | true; 20 invariants; I20 holds |
| P1-2 exactly one unclassifiable row ⇒ false | `R1-P1-2` | false. Only I15 + I20 fail; failure `rows_unclassifiable` count 1; business stays `CLASSIFIED` with counts; the row text is not persisted; bundle `COMPLETE.evidenceComplete:false`; `verifyBundle` ⇒ ok/incomplete; CLI exit 10; `--verify` ⇒ `EV1_BUNDLE_VERIFIED_INCOMPLETE` |
| P1-3 multiple unclassifiable rows ⇒ false | `R1-P1-3` | 5 rows (`null`, `5`, `[]`, `"x"`, `"y"`) across two businesses ⇒ false; one failure per business with counts 4 and 1; I11/I12 still hold |
| P1-4 forged counters/partitions ⇒ recomputation fails | `R1-P1-4` | (a) counters zeroed ⇒ I13 + I20 fail; (b) partition zeroed ⇒ I12 + I20 fail; (c) failure removed + boolean flipped ⇒ I20 fails |
| P1-5 `--verify` rejects a conflicting evidenceComplete | `R1-P1-5` | forged report (true, all invariants "true", counters zeroed, re-digested) ⇒ `EV1_BUNDLE_INVALID`, both conflict problems + invariant mismatch; COMPLETE-only flip ⇒ rejected |
| P2-1 valid exact bundle passes | `R1-P2-1` | `{ok:true, evidenceComplete:true, problems:[]}`; manifest declared in COMPLETE |
| P2-2 extra text file | `R1-P2-2/3/4` | `UNLISTED.txt` ⇒ fail |
| P2-3 extra JSON file | ″ | `EXTRA.json` ⇒ fail |
| P2-4 hidden file | ″ | `.DS_Store`, `.hidden` (and `notes.md`) ⇒ fail |
| P2-5 unexpected symlink | `R1-P2-5` | extra symlink, sub-directory, expected file replaced by a symlink, symlinked bundle directory ⇒ fail |
| P2-6 missing expected file | `R1-P2-6` | each of the 4 manifest files removed ⇒ `<file> missing`; nonexistent directory ⇒ fail |
| P2-7 modified expected file | `R1-P2-7` | each evidence file ⇒ `digest mismatch` |
| P2-8 extra file with secret-like token | `R1-P2-8` | fails, content not echoed; secret added to an expected file with re-bound digest ⇒ `contains secret-like text` |
| P2-9 COMPLETE omits an artifact | `R1-P2-9` | omitted bound file, extra bound file, missing/short/extended `bundleManifest` ⇒ fail |
| P2-10 duplicate/ambiguous entry | `R1-P2-10` | Cyrillic look-alike, full-width (NFKC-equal), trailing space, zero-width joiner ⇒ fail. Case variant `complete.json`: on a case-sensitive FS ⇒ extra + ambiguous ⇒ fail; on a case-insensitive FS exclusive create is refused (EEXIST), so no second entry can exist and the bundle stays unchanged/valid |
| CLI | `R1-P2 CLI` | `--verify` with an added file ⇒ `EV1_BUNDLE_INVALID`, exit 10 |
| GCLOUD relaxation | `R1-ENV` | exact 13-name refusal list; `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` set to other projects ⇒ run succeeds with the IAM URL and database from `--project`/`--database-url`; project/credential/database mismatch, ADC and emulator still refused before any request; no collector/transport code reads the two names |
| updated | `10–22 every EV1/3 row state …` | the committed case with one `"garbage"` row now asserts `evidenceComplete:false`, failed invariants exactly `[I15, I20]`, and the typed failure. All census counts are unchanged |

## Mutation check (manual; each fault seeded alone, suite re-run)
| Seeded fault | Caught by |
|---|---|
| I20 forced true | 10–22, R1-P1-2, R1-P1-3, R1-P1-4 |
| `rows_unclassifiable` failure not emitted | 10–22, R1-P1-2, R1-P1-3 |
| directory closure loop removed | R1-P2-2/3/4, R1-P2-5, R1-P2-8, … |
| `files` key-set check removed | R1-P2-9 |
| `bundleManifest` check removed | R1-P2-9 |
| symlinked expected file followed | R1-P2-5 |
| directory-symlink check weakened | R1-P2-5 |
| "recorded evidenceComplete conflicts" check removed | R1-P1-5 |
| verifier trusts the stored boolean | not separately observable. Every stored/recomputed conflict already raises a problem, and `evidenceComplete` requires zero problems (equivalent mutant; defence in depth) |
| equation `rows.unclassifiable == malformedRows` removed | not separately observable. It is implied by `rowsTotal == observed`, `observed == classified + unclassifiable` and `classified == rowsTotal − malformedRows`, which still fails (equivalent mutant) |
