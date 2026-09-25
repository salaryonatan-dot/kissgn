# macOS PATH CANONICALIZATION (R1 — Finding 5)

Problem: macOS aliases `/var → /private/var` (and `/tmp → /private/tmp`); `os.tmpdir()` returns the aliased spelling. The previous validator walked the chain from `/` and rejected any symlink, so every default temp path failed unless `TMPDIR` was overridden.

Contract now: **canonicalise the APPROVED ROOT once, then enforce descendants relative to it.**
* `canonicalRoot(root)` = `realpath` of the deepest existing ancestor joined with the not-yet-existing remainder. The CLI applies it to `--evidence-dir` in `createContext` and derives EVERY path from that canonical root; the evidence module applies it to the `root` argument of every function.
* `scope(root)`: a path spelled under the REQUESTED root (e.g. `/var/folders/…/op/b1`) has only that approved prefix rewritten to the canonical root; nothing else is ever resolved through a link. A path spelled through an alias but scoped to the canonical root string is simply outside it (`path_outside_root`).
* Below the canonical root: every component is `lstat`'d — a symlink anywhere (operation dir, bundle dir, artifact, `COMPLETE.json`, receipts, ledger, live state) ⇒ `symlink_in_path` / "is a symlink"; containment (`relative()` never `..`) ⇒ `path_outside_root`; `O_NOFOLLOW` on every open.

Still denied: symlinked bundle directory, symlinked artifact, symlink introduced below the canonical root (including one that escapes it), manifest entries resolving outside the bundle.

Proof:
* Unit "R1-F5" simulates the alias (`base/var → base/private/var`, root requested as `base/var/folders/canary-ev`): A the aliased root canonicalises and is accepted (bundles create and verify; receipts land under the canonical root) · B symlinked bundle ⇒ rejected · C artifact symlink inside the root ⇒ rejected · D symlink descendant escaping the root ⇒ rejected (dir, file, receipt), outside path ⇒ `path_outside_root` · E ordinary real temp dir ⇒ accepted · F the machine's default `os.tmpdir()` ⇒ accepted.
* Primary run: all suites under the machine's ordinary default environment (no `TMPDIR` set by the harness) — 880/880, canary 44/44, emulator 18/18 ×3.
* Secondary parity: the five canary suites re-run with `TMPDIR` pointing at a synthetic `var → private/var` alias (`os.tmpdir()` reports the aliased spelling, `realpath` differs) — 44/44. This is the macOS default-TMPDIR shape reproduced on the Linux host; no override is required by the code or the tests.
