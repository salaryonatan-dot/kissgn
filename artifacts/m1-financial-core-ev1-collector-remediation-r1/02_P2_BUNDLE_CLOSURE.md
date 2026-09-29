# 02 — P2: the evidence bundle is closed

## Finding (Codex re-review 05)
`verifyBundle()` checked the four expected paths but never listed the directory. An added `UNLISTED.txt` was not digest-bound and not secret-scanned, yet it verified `{ok:true, evidenceComplete:true}`.

## Contract
- `BUNDLE_FILES = [PRE_FLIGHT.md, EV1_REPORT.json, EV1_SUMMARY.md]`. These are the digest-bound evidence files.
- `BUNDLE_MANIFEST = [COMPLETE.json, EV1_REPORT.json, EV1_SUMMARY.md, PRE_FLIGHT.md]`. This is the exact directory content.
- **No filesystem-metadata allowance.** A `.DS_Store` or any other hidden file fails verification. The runbook tells the operator to run `--verify` before opening the folder, and never to delete an entry to make it pass.
- `COMPLETE.json` now also declares `bundleManifest` (the four names).

## `verifyBundle(dir)` (fail-closed order)
1. **The bundle path must be a real directory.** `lstat`: not a symlink and a directory. A symlinked bundle directory fails.
2. **Directory mode is 0700.** Unchanged, POSIX only.
3. **The directory listing must match the manifest exactly.**
   - `readdirSync` includes hidden entries.
   - Every entry not byte-equal to a manifest name ⇒ `unexpected bundle entry: "<printable name>" (length n)`. File content is never read or echoed.
   - An entry whose NFKC/lower-case form equals a manifest name also gets `ambiguous bundle entry resembles an expected file`.
   - Duplicate names in a listing ⇒ `ambiguous bundle listing`.
4. **Each manifest name must be present, a regular file (`lstat`), and mode 0600.** Otherwise the problem is one of `missing`, `is a symlink` or `is not a regular file`. A symlink is never followed.
5. **`COMPLETE.json` must parse as an object.** In addition:
   - `bundleManifest` must equal the manifest;
   - the keys of `files` must equal `BUNDLE_FILES` exactly (no omission, no extra key);
   - each evidence file's sha256 must equal its bound digest.
6. **Secret scan.** Every manifest file is scanned.
7. **Cross-file identity and recomputed completeness.** See 01.

**Result:** `ok` only when there are no problems. `evidenceComplete` is the recomputed value, and only when `ok` is true.

## Unexpected-file policy
Any extra entry of any kind fails the verification. This covers regular, hidden, symlink, directory, look-alike and case-variant entries. The failure is `EV1_BUNDLE_INVALID`, exit 10. The entry is not read, so a secret inside it cannot be echoed. No entry is ignored, and none is auto-removed.

## Unchanged
- `writeBundle` still creates a new 0700 directory and exclusive (`wx`) 0600 files, and writes `COMPLETE.json` last.
- The secret scan still runs before each write.
