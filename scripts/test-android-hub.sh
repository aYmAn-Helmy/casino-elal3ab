#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE="com.ayman.casinoelal3ab.hub"
APK="android/hub/build/outputs/apk/debug/hub-debug.apk"
test -s "$APK"

adb install -r "$APK"
adb shell am start -n "$PACKAGE/com.ayman.casinohub.HubActivity"
sleep 3
adb shell am start-foreground-service -n "$PACKAGE/com.ayman.casinohub.HubService"
adb forward tcp:3000 tcp:3000

echo "Checking the real Android HTTP listener over adb forward..."
healthy=0
for attempt in $(seq 1 45); do
  if curl -fsS --max-time 3 "http://127.0.0.1:3000/api/health" -o /tmp/casino-hub-health.json; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  adb logcat -d -s CasinoHubService:E CasinoHub:E AndroidRuntime:E | tail -150
  echo "Phone Hub server did not start in Android emulator" >&2
  exit 1
fi
node -e "const j = require('/tmp/casino-hub-health.json'); if (!j.ok || j.questions !== 1000) { console.error(j); process.exit(1) }; console.log('Hub HTTP ready with', j.questions, 'questions')"

PIN="$(adb shell run-as "$PACKAGE" cat shared_prefs/casino-hub-settings.xml | sed -n 's/.*<string name="host-pin">\([^<]*\)<\/string>.*/\1/p' | tr -d '\r' | head -n1)"
if [[ "${#PIN}" -lt 16 ]]; then
  echo "Host PIN not created by Android app" >&2
  exit 1
fi
# Do NOT print the host PIN into public CI logs.
HUB_PIN="$PIN" node scripts/verify-android-hub-ws.js

echo "Verifying user-facing static routes..."
for endpoint in / /play /admin /screen /shared.js /audio.js /style.css; do
  curl -fsS --max-time 6 "http://127.0.0.1:3000$endpoint" > /dev/null
  echo "OK: $endpoint"
done
adb shell am force-stop "$PACKAGE"
echo "Android phone Hub smoke test succeeded"
