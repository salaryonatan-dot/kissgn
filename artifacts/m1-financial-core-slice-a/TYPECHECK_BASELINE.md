# Typecheck Baseline

Command: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` (TypeScript 5.9.3 from the lockfile).

| Tree | Diagnostics |
|---|---|
| Base `f5d0a8ed` (before edits) | 22 × TS2742 (inferred-type portability in existing api/src files) |
| Slice A working tree | 22 × TS2742 — **byte-identical diagnostic list** after stripping line/column positions (`diff` empty) |

New TypeScript files compile under the repository's `strict` configuration with **no new diagnostics**. The browser configuration `tsconfig.finance-browser.json` (strict, ES2020, ES2022 modules) compiles the closure with zero diagnostics (the generator fails on any tsc error).
