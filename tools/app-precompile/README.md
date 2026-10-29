# tools/app-precompile — ahead-of-time compilation of the browser app

`index.html` is the **source** page. Its React app is one inline
`<script type="text/babel" data-presets="react">` block, which every page load used to compile
in the browser with `@babel/standalone` (≈1.3 s of blocked main thread on a desktop Mac, several
seconds on a phone, plus a 2.9 MB `babel.min.js` download on a cold cache).

`precompile.mjs` performs that same compilation **once**, with the same pinned package
(`@babel/standalone` 7.23.6) and the same options `transformScriptTags` uses, and writes the two
**generated** files that production serves:

| file       | content                                                                                   |
|------------|-------------------------------------------------------------------------------------------|
| `app.js`   | the compiled app — byte-identical to the code the browser used to inject (no source map)  |
| `app.html` | `index.html` minus the `babel.min.js` tag, with the JSX block replaced by `<script defer src="/app.js?v=…">` |

`vercel.json` rewrites `/app` (and the catch-all) to `app.html`. `index.html` is still deployed and
still works on its own (it compiles in the browser as before); it is only no longer the page `/app`
serves. Financial calculations, labels and completeness behaviour are untouched — the app code that
runs is the same compiled code as before, just compiled on the developer's machine instead of in the
user's browser.

## Workflow

Any edit to `index.html` must be followed by a rebuild, or the served page silently lags behind:

```sh
cd tools/app-precompile && npm ci && cd ../..      # once per checkout (no network needed later)
node tools/app-precompile/precompile.mjs           # regenerate app.html + app.js
node tools/app-precompile/precompile.mjs --check   # exit 2 if the generated files are stale
```

Run `--check` before every deployment. The generated files carry the sha256 of the `index.html` they
were built from in a comment at the top of the compiled block.

## Why `defer`

`@babel/standalone` compiled and ran the app in its `DOMContentLoaded` handler, i.e. after the
page's deferred `<script type="module">` blocks (Firebase init, fincore bootstrap) had started.
`<script defer src="/app.js">` at the same position in the document keeps that order; the app
already tolerates either side of the Firebase/fincore readiness race (`window._firebaseReady` /
`firebase-ready` event, `window.__marjinFinance` / `marjin-finance-settled` event).
