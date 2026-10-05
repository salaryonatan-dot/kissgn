#!/usr/bin/env bash
set -euo pipefail
checkout=$1
logs=$2
runner="$(cd "$(dirname "$0")" && pwd)/p1-r7-emu-run.sh"
bash "$runner" "$checkout" "$logs" \
  p1-r3-contract=test/emulator/p1-r3-contract-emulator.mjs \
  p1-supplier-credits=test/emulator/p1-supplier-credits-emulator.mjs \
  p1-r1-review=test/emulator/p1-r1-review-emulator.mjs \
  p1-rendered-credits=test/emulator/p1-rendered-credits.mjs \
  p1-r4-lostack=test/emulator/p1-r4-lostack-emulator.mjs \
  p1-r5-rendered-integrity=test/emulator/p1-r5-rendered-integrity.mjs \
  p1-r7-rendered-integrity=test/emulator/p1-r6-rendered-integrity.mjs \
  rtdb-authorization-matrix=test/emulator/rtdb-authorization-matrix.mjs \
  entries-rules-validation-matrix=test/emulator/entries-rules-validation-matrix.mjs \
  storage-v2-rules-guard-mutations=test/emulator/storage-v2-rules-guard-mutations.mjs \
  storage-policy-parity=test/emulator/storage-policy-parity.mjs \
  storage-v2-matrix=test/emulator/storage-v2-matrix.mjs \
  storage-v2-version-fence=test/emulator/storage-v2-version-fence.mjs \
  closure-action=test/emulator/closure-action-emulator.mjs \
  entries-remote-atomic=test/emulator/entries-remote-atomic-emulator.mjs \
  admin-maintenance-gate=test/emulator/admin-maintenance-gate.mjs \
  c1-rendered-surfaces=test/emulator/c1-rendered-surfaces.mjs \
  server-readers-matrix=test/emulator/server-readers-matrix.mjs \
  historical-page-version-fence=test/emulator/historical-page-version-fence.mjs \
  rc-closure-snapshot-e2e=test/emulator/rc-closure-snapshot-e2e.mjs
