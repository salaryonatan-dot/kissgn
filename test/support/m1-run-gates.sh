#!/usr/bin/env bash
# M1 integration candidate — every local RTDB emulator gate, SEQUENTIALLY, through the own-PID runner
# (test/support/p1-r7-emu-run.sh: it starts ONE emulator, stops only that process, and requires an absolute log dir).
# The canary operator matrix is run separately (it is expected to SAFETY-ABORT on the unapproved combined Rules
# fingerprint; see the M1 handoff canary accounting) so it is not part of this list.
set -euo pipefail
checkout=$1
logs=$2
runner="$(cd "$(dirname "$0")" && pwd)/p1-r7-emu-run.sh"
bash "$runner" "$checkout" "$logs" \
  rtdb-authorization-matrix=test/emulator/rtdb-authorization-matrix.mjs \
  entries-remote-atomic=test/emulator/entries-remote-atomic-emulator.mjs \
  entries-rules-validation-matrix=test/emulator/entries-rules-validation-matrix.mjs \
  storage-v2-matrix=test/emulator/storage-v2-matrix.mjs \
  storage-v2-rules-guard-mutations=test/emulator/storage-v2-rules-guard-mutations.mjs \
  server-readers-matrix=test/emulator/server-readers-matrix.mjs \
  storage-v2-version-fence=test/emulator/storage-v2-version-fence.mjs \
  storage-policy-parity=test/emulator/storage-policy-parity.mjs \
  admin-maintenance-gate=test/emulator/admin-maintenance-gate.mjs \
  historical-page-version-fence=test/emulator/historical-page-version-fence.mjs \
  closure-action=test/emulator/closure-action-emulator.mjs \
  rc-closure-snapshot-e2e=test/emulator/rc-closure-snapshot-e2e.mjs \
  c1-rendered-surfaces=test/emulator/c1-rendered-surfaces.mjs \
  f1-cost-history-rules-matrix=test/emulator/f1-cost-history-rules-matrix.mjs \
  f1-cost-history-writer=test/emulator/f1-cost-history-writer-emulator.mjs \
  f2-rendered-editor=test/emulator/f2-rendered-editor.mjs \
  p1-supplier-credits=test/emulator/p1-supplier-credits-emulator.mjs \
  p1-rendered-credits=test/emulator/p1-rendered-credits.mjs \
  p1-r1-review=test/emulator/p1-r1-review-emulator.mjs \
  p1-r3-contract=test/emulator/p1-r3-contract-emulator.mjs \
  p1-r4-lostack=test/emulator/p1-r4-lostack-emulator.mjs \
  p1-r5-rendered-integrity=test/emulator/p1-r5-rendered-integrity.mjs \
  p1-r7-rendered-integrity=test/emulator/p1-r6-rendered-integrity.mjs \
  m1-rendered-integration=test/emulator/m1-rendered-integration.mjs
