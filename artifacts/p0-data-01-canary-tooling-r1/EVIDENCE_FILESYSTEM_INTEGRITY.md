# EVIDENCE FILESYSTEM INTEGRITY (R1 — Finding 2)

Creation-time checks are never trusted later: `verifyBundle(dir, { root })` re-validates the WHOLE state and is what `openBundle` (→ `migrate`, `verify`, `activate`'s source bundle), `activate`'s checkpoint check, `status --verify-evidence` and `createBundle` itself (verify-after-create) call.

| item | contract | on violation |
|---|---|---|
| bundle path | inside the canonical root; every component below the root lstat'd: real directory, never a symlink | `symlink_in_path` / `path_outside_root` / `not_a_directory` ⇒ INVALID |
| bundle directory | real directory (lstat), mode exactly `0700` | "bundle directory is a symlink" / "mode 755 ≠ 0700" |
| each listed artifact | plain name (`^[A-Za-z0-9._-]+$`, so no `..`, no `/`), resolves DIRECTLY inside the bundle, exists, regular file (lstat), not a symlink, mode exactly `0600`, `type: file`, `st.size === bytes`, read length === bytes, sha256 === manifest | typed problem per artifact ⇒ INVALID |
| `COMPLETE.json` | same file rules (regular, non-symlink, `0600`), written LAST, `filesDigest === digestV1(files)` | INVALID / INCOMPLETE |
| unlisted entries | none allowed | INVALID |
| creation | `O_EXCL | O_NOFOLLOW`, `0600`, fsync, read-back byte compare, lstat regular-file check; `COMPLETE.json` records `type`/`mode`/`bytes`/`sha256` per file | `file_exists`, `not_a_regular_file`, `bundle_rehash_mismatch`, `bundle_verify_after_create` |

Tamper matrix (unit `canary-evidence.test.mjs` "R1-F2"): A `chmod 0755` bundle ⇒ invalid · B `chmod 0644` artifact ⇒ invalid · C artifact → symlink to identical content ⇒ invalid (`is a symlink`; `openBundle` throws `evidence_incomplete`) · D different content ⇒ size + sha256 mismatch · E `COMPLETE.json` → symlink ⇒ invalid · F manifest entry `../twin.utf8` ⇒ "not a plain file name"; entry naming an outside file ⇒ "missing" (never followed); `createBundle` refuses traversal in file/operation/bundle names · G untouched ⇒ valid; symlinked bundle directory / symlinked operation directory / path outside root ⇒ invalid. Migration authorisation uses exactly this path (`latestBundle` → `openBundle({ root })`), so a bundle tampered after capture cannot authorise `migrate` or `activate`.
