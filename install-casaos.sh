#!/usr/bin/env bash
set -Eeuo pipefail

# Casino El Al3ab — first-time installer for Intel/AMD CasaOS.
# Run from the checked-out repository: sudo bash install-casaos.sh

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
DATA_ROOT="/DATA/AppData/casino-party-lan"
if [[ $EUID -ne 0 ]]; then
  echo "شغّل السكربت باستخدام sudo bash install-casaos.sh" >&2
  exit 1
fi
for command_name in docker curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "الأداة المطلوبة غير موجودة: $command_name" >&2
    exit 1
  fi
done
if ! docker info >/dev/null 2>&1; then
  echo "Docker مش شغال على CasaOS — اتأكد إن خدمة Docker شغالة" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose V2 مش متاح. حدّث Docker Compose على الجهاز." >&2
  exit 1
fi
arch="$(uname -m)"
if [[ "$arch" != "x86_64" && "$arch" != "amd64" ]]; then
  echo "تنبيه: النسخة مجهزة للـMini PC Intel/AMD (amd64)، المعالج الحالي: $arch" >&2
fi

mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/apk"
chown -R 1000:1000 "$DATA_ROOT/data"
chmod 755 "$DATA_ROOT" "$DATA_ROOT/data" "$DATA_ROOT/apk"

if [[ ! -f .env ]]; then
  # 20 cryptographically random bytes. Never commit this .env to Git.
  new_pin="$(od -An -N20 -tx1 /dev/urandom | tr -d ' \n')"
  cat >.env <<EOF
ADMIN_PIN=$new_pin
PORT=3000
ROOM_NAME=Casino Party LAN
CORRECT_POINTS=1
WRONG_POINTS=1
MAX_PLAYERS=20
EOF
  chmod 600 .env
  echo "تم إنشاء .env بكلمة مرور عشوائية للمذيع"
else
  echo "تم العثور على .env موجود — هنستخدم إعداداته بدون تعديل"
fi
if ! grep -q '^ADMIN_PIN=.' .env; then
  echo "ADMIN_PIN لازم يكون موجود في .env" >&2
  exit 1
fi
docker compose -f docker-compose.yml config --quiet

echo "بنبني صورة Docker وبنشغّل اللعبة..."
docker compose -f docker-compose.yml up -d --build

# Optional: download the signed (debug) Android client from the project release.
# If GitHub is unreachable the web client remains fully playable.
APK="$DATA_ROOT/apk/casino-elal3ab.apk"
APK_RELEASE="https://github.com/aYmAn-Helmy/casino-elal3ab/releases/download/v0.1.2/casino-elal3ab.apk"
if [[ ! -s "$APK" ]]; then
  tempfile="$(mktemp "$DATA_ROOT/apk/.casino-apk.XXXXXX")"
  if curl -fLsS --connect-timeout 8 --max-time 90 "$APK_RELEASE" -o "$tempfile" && [[ -s "$tempfile" ]]; then
    mv -f "$tempfile" "$APK"
    chmod 644 "$APK"
    echo "تم تجهيز APK على السيرفر للتحميل من /download"
  else
    rm -f "$tempfile"
    echo "لم نقدر ننزّل APK. افتح /play من متصفح أي موبايل وابدأ اللعب عادي."
  fi
fi

port="$(sed -n 's/^PORT=//p' .env | tail -n1)"
port="${port:-3000}"
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
ip="${ip:-YOUR_CASAOS_IP}"
echo
echo "==========================================================="
echo "  Casino El Al3ab is installed on CasaOS"
echo "  اللاعب:  http://$ip:$port/play"
echo "  المذيع:  http://$ip:$port/admin"
echo "  الشاشة:  http://$ip:$port/screen"
echo "  تحميل APK: http://$ip:$port/download"
echo "  كلمة مرور المذيع (خاصة بك):"
sed -n 's/^ADMIN_PIN=//p' .env | tail -n1
echo "  احفظ كلمة المرور ومتشاركهاش مع اللاعبين."
echo "==========================================================="
echo
curl -fSs --connect-timeout 3 --max-time 8 "http://127.0.0.1:$port/api/health" || {
  echo "السيرفر لسه مش جاهز أو المنفذ مقفول، جرّب: docker compose logs --tail=60" >&2
}
echo
echo "لو موقع اللعبة مش بيفتح من الموبايل، اتأكد إن كل الأجهزة على نفس الواي فاي."
