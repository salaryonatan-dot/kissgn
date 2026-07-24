# Test Results

Environment: clean local worktree `/Users/yonatan/Documents/marjin/kissgn-m1-containment-slice-1`.

Base commit before changes: `0243123027031b068993f7ee69f8e9363f3eed48`.

## Dependency Install

Command:

```sh
npm ci
```

Result: passed. This installed dependencies from `package-lock.json`; no dependency upgrade was performed. npm reported existing audit findings: 24 vulnerabilities (16 moderate, 7 high, 1 critical) and allow-scripts warnings.

## Focused Slice Tests

Command:

```sh
node --test test/security/pr2a-endpoint-hardening.test.mjs test/security/proactive-read-scope.test.mjs test/security/vercel-cron-routes.test.mjs test/forecast/revenue-forecast-ui.test.mjs test/typescript/js-declaration-parity.test.mjs
```

Result: passed.

Summary: 36 tests, 36 passed, 0 failed.

## TypeScript

Command:

```sh
./node_modules/.bin/tsc --noEmit
```

Result: passed.

## Broader Relevant Node Tests

Command:

```sh
node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
```

Result: passed.

Summary: 336 tests, 336 passed, 0 failed.

## Whitespace / Patch Sanity

Command:

```sh
git diff --check
```

Result: passed.

## Lint

No lint script is configured in `package.json`; no lint command was available to run.

