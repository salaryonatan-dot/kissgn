#!/usr/bin/env bash
# Sequential local RTDB gates. The trap stops only the emulator started by this process.
set -euo pipefail
checkout=$1
logs=$2
shift 2
case "$logs" in /*) ;; *) echo "log directory must be absolute" >&2; exit 2 ;; esac
mkdir -p "$logs"
jar=${EMU_JAR:-$HOME/.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar}
if curl -fsS --noproxy '*' --max-time 1 'http://127.0.0.1:9000/' >/dev/null 2>&1; then
  echo "port 9000 is already in use" >&2; exit 2
fi
java -jar "$jar" --host 127.0.0.1 --port 9000 > "$logs/emulator.log" 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" 2>/dev/null || true; wait "$emulator_pid" 2>/dev/null || true' EXIT
ready=0
for _ in {1..60}; do
  if curl -fsS --noproxy '*' --max-time 1 'http://127.0.0.1:9000/.json?ns=demo-marjin-rules-default-rtdb' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then echo "emulator did not start" >&2; exit 2; fi
for spec in "$@"; do
  name=${spec%%=*}
  script=${spec#*=}
  curl -fsS --noproxy '*' -X PUT -H 'Authorization: Bearer owner' --data-binary @"$checkout/database.rules.json" \
    'http://127.0.0.1:9000/.settings/rules.json?ns=demo-marjin-rules-default-rtdb' > /dev/null
  set +e
  (cd "$checkout" && {
    if [ "$script" = test/emulator/p1-r4-lostack-emulator.mjs ]; then set -- "$checkout"; else set --; fi
    env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
      GCLOUD_PROJECT=demo-marjin-rules GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
      FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 node "$script" "$@"
  }) > "$logs/$name.log" 2>&1
  rc=$?
  set -e
  echo "rc=$rc" >> "$logs/$name.log"
  echo "$name rc=$rc"
  if [ "$rc" -ne 0 ]; then exit "$rc"; fi
done
