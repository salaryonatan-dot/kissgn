#!/usr/bin/env bash
# Installs the EXACT browser-side builds the historical page (index.html@1038b4cd) loaded from
# its CDN <script> tags, plus jsdom, into test/historical/.deps (git-ignored). package.json of
# the repository is NOT touched — these are evidence-harness dependencies only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPS="$HERE/.deps"
mkdir -p "$DEPS"
cd "$DEPS"
[ -f package.json ] || printf '{ "name": "marjin-historical-page-deps", "private": true }\n' > package.json
npm install --no-audit --no-fund --save-exact \
  react@18.2.0 react-dom@18.2.0 prop-types@15.8.1 @babel/standalone@7.23.6 jsdom@24.1.3
echo "historical page deps installed in $DEPS"
