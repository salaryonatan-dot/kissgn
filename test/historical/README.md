# Historical / rendered page harness — local setup

`historical-page-harness.mjs` boots `index.html` in jsdom with the exact browser builds the page loads from its CDN tags.
Those builds are **evidence-harness dependencies only**: they are not in `package.json`, and they are never committed.

```sh
npm ci                                  # repository dependencies (package-lock.json)
bash test/historical/install-deps.sh    # react 18.2.0, react-dom 18.2.0, prop-types 15.8.1, @babel/standalone 7.23.6, jsdom 24.1.3
                                        # → test/historical/.deps/ (ignored; created next to this file)
```

`depsStatus()` reports any missing pinned package; every rendered emulator script exits `5` with
`EVIDENCE_DEPS_MISSING: …` until the installer has run. `.deps` is ignored as a directory **and** as a link, so a local
link to an existing install (for example a shared copy of the same pinned versions) never enters a commit. Never commit
`.deps`, a link to a machine-specific path, or the packages themselves.

The rendered scripts under `test/emulator/` (for example `owner-notice-rendered.mjs`, `entries-hydrate-immediate.mjs`)
additionally need Java 21+ and the RTDB emulator JAR pinned by the repository's `firebase-tools`
(`firebase-database-emulator-v4.11.2.jar` in `~/.cache/firebase/emulators/`; `./node_modules/.bin/firebase
setup:emulators:database` downloads it once). Run them through `test/support/p1-r7-emu-run.sh` (see `test/emulator/README.md`).
