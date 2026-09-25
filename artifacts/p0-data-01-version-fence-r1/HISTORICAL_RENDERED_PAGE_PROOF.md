# HISTORICAL RENDERED PAGE PROOF — Gate F (Codex F4)

**Historical build:** `1038b4cd199d01d0b8df599fb6d54411fbfff204` — `fix: finalize p0 data lifecycle r10 candidate`, the last all-legacy client (`{_v}` CAS transport, no Storage V2, no fence). Its `index.html` is read from git at that SHA (never from the working tree) and executed byte-for-byte. Old historical code is not changed.

## What "rendered page" means here (`test/historical/historical-page-harness.mjs`)
- jsdom (`runScripts: "outside-only"`) parses the ACTUAL historical HTML (DOM, `#root`, styles); the page's `<script>` blocks are then executed IN ORDER inside that window: the inline `apiFetch` stub, the Firebase module block, the forecast mirror, and the `type="text/babel"` React application (≈9.7k lines) transformed by the pinned `@babel/standalone@7.23.6` the page itself loaded from its CDN tag, rendered by the pinned `react@18.2.0` / `react-dom@18.2.0` UMD builds into `#root`.
- The page's own `window.storage` (its `set` / `setFor` / `mutateFor` (CAS, `applyLocally:false`) / `subscribe` / `get` / `delete` bytes) runs unchanged. The ONE substitution is the module's CDN `import { … } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-{app,database,auth,app-check}.js"` lines, replaced by bindings from a shim that maps the modular API (`ref/get/set/remove/onValue/runTransaction`) 1:1 onto a `firebase-admin` app carrying `databaseAuthVariableOverride { uid: u_manager }` against the LOCAL emulator — i.e. every write is an ordinary manager's write evaluated by the real Rules. Auth is a fake signed-in session (`onAuthStateChanged` → manager user); `fetch("/api/config")` returns a demo config, every other `/api/*` call 404s (the page treats them as non-fatal, e.g. `loadExceptionsBound → http_error`).
- The page auto-logs-in through its OWN retained-session path (sessionStorage `marjin_tid_/marjin_biz_` + `app/users` `firebaseUid` match), hydrates `biz:bizA:entries` through its OWN listener, and every write in the proof is triggered by CLICKING ITS OWN UI: the dashboard KPI card (→ history screen), the per-row **מחק** button (→ `deleteEntryByDate` → coordinator → `createRemoteEntriesMutator` → `mutateFor` CAS returning `{_v}`), and **מחק הכל** (→ `submitClearAll` → CAS `{_v:"[]"}`), plus the page's own transport functions for the non-UI shapes an old build can emit (`setFor`, `set`, `delete` = whole-node remove, `mutateFor`).
- Dependencies are NOT in `package.json`: `test/historical/install-deps.sh` installs the exact CDN versions + `jsdom@24.1.3` into `test/historical/.deps/` (git-ignored). The proof exits with code 5 `EVIDENCE_DEPS_MISSING` when they are absent — never a silent skip.

## Sequence — ONE retained page session (`test/emulator/historical-page-version-fence.mjs`)
| step | action | server result |
|---|---|---|
| 1 | business `bizA` legacy, no control record | — |
| 2 | HP-01: page boots, real React tree mounted (152 DOM nodes), auto-login, dashboard shows the business, 3 legacy rows hydrated | — |
| 3 | HP-02: click **מחק** on a row in the history screen | **committed** — server rows 3→2 through the page's `{_v}` CAS |
| 4 | Admin: `initializeLegacy` → `quiesce` (control plane, same process) — page NOT reloaded | — |
| 5 | HP-03: same page — click **מחק**, click **מחק הכל**, run the page's `setFor` / `set` / `delete` / `mutateFor` | **DENIED** (all), node byte-identical |
| 6 | Admin: `createFencedConversion` (quiesced, owned) → `committed` | node is V2 (rows + frozen `_v`) |
| 7 | Admin: `activateV2` → `v2_active` — page NOT reloaded; its listener receives the V2 node (its generic reader keeps showing the frozen `_v` rows — misleading UI, accepted) | — |
| 8 | HP-04: same page — click **מחק** (legacy CAS that would REPLACE the V2 node with `{_v}`) | **DENIED** |
| 9 | HP-04: click **מחק הכל** (`{_v:"[]"}`), `setFor` / `set` `{_v}` whole node, `delete` whole node (removes `_v` and everything), `mutateFor` → `{_v}` | **DENIED** (all); authoritative V2 rows, frozen `_v` and generation byte-identical |
| 10 | HP-05 negative control: a second page under the PRE-FENCE core Rules (`47f7f888`) with a `quiesced` record → **מחק** click **COMMITS** (rows 3→2) — the quiesced denial is the fence delta; canonical Rules restored | control |

Result: **5/5 × 3 rounds** — `ALL CASES PASSED — server truth held against a retained rendered historical page`.

## What this proof is and is not
It is the historical page's real rendered component tree, real event handlers, real coordinator/lifecycle code and real transport bytes, hitting the real Rules engine with ordinary member auth, across phase transitions performed by the real control plane while the session is retained. It is not a pixel-level browser (jsdom has no layout) and the Firebase client SDK itself is replaced by an API-identical shim over the Admin SDK (the SDK's wire behaviour is exercised by the engine-level proofs, VF-26). The historical UI's display after activation stays misleading — accepted; the required property (server truth) holds.
