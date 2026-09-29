# Typecheck Results

`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` (TypeScript 5.9.3).

| Tree | Diagnostics |
|---|---|
| base `f5d0a8ed` | 22 × TS2742, all `src/firebase/refs.ts` |
| candidate `a8fdf2c8` | 22 × TS2742, identical list |
| remediation working tree (= remediation commit) | 22 × TS2742, identical list (diff of the position-stripped outputs is empty) |

No new diagnostic. The browser configuration (`tsconfig.finance-browser.json`, strict) compiles the closure with zero diagnostics (the generator fails on any error) and regenerates `fincore/v1` byte-identically.
