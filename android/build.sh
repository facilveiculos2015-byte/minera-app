#!/usr/bin/env bash
# Gera o APK + AAB assinados do Minera Pará (Trusted Web Activity / Bubblewrap).
# Uso:  bash android/build.sh            (ícones baixados do site publicado)
#       LOCAL_ICONS=1 bash android/build.sh   (serve ícones deste worktree numa porta local livre)
# Requer: /workspace/tools/env.sh (JDK 17 + Android SDK), bubblewrap CLI (npm i -g @bubblewrap/cli),
#         keystore em /workspace/minera-apk-keys/ (NUNCA comitar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BUILD="${BUILD_DIR:-/workspace/minera-apk-build}"
OUT="${OUT_DIR:-/workspace/minera-apk-out}"
KEYS_ENV="${KEYS_ENV:-/workspace/minera-apk-keys/keystore.env}"
. /workspace/tools/env.sh

ICON_BASE=""
if [[ "${LOCAL_ICONS:-0}" == "1" ]]; then
  PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  (cd "$REPO" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!
  trap 'kill $SRV 2>/dev/null || true' EXIT
  sleep 1.5
  ICON_BASE="http://127.0.0.1:$PORT/"
fi

mkdir -p "$BUILD" "$OUT"
node "$HERE/make-twa-manifest.mjs" "$BUILD" $ICON_BASE
cd "$BUILD"
bubblewrap update --skipVersionUpgrade < /dev/null

set -a; . "$KEYS_ENV"; set +a
export BUBBLEWRAP_KEYSTORE_PASSWORD="$STORE_PASSWORD" BUBBLEWRAP_KEY_PASSWORD="$KEY_PASSWORD"
bubblewrap build --skipPwaValidation < /dev/null
export KS_PW="$STORE_PASSWORD"
unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD STORE_PASSWORD KEY_PASSWORD

VER=$(node -p "require('$HERE/app-config.json').appVersionName")
cp app-release-signed.apk "$OUT/minera-para-$VER.apk"
cp app-release-bundle.aab "$OUT/minera-para-$VER.aab"
mkdir -p "$REPO/download"
cp app-release-signed.apk "$REPO/download/minera-para.apk"
apksigner verify --print-certs "$OUT/minera-para-$VER.apk" | grep -i 'SHA-256'
CODE=$(node -p "require('$HERE/app-config.json').appVersionCode")
PKG=$(node -p "require('$HERE/app-config.json').packageId")
SZ=$(stat -c %s "$REPO/download/minera-para.apk")
SHA=$(sha256sum "$REPO/download/minera-para.apk" | cut -d' ' -f1)
CERT=$(keytool -list -v -keystore "$(node -p "require('$HERE/app-config.json').keystorePath")" -storepass:env KS_PW 2>/dev/null | awk '/SHA256:/{print $2; exit}')
cat > "$REPO/download/app.json" <<JSON
{
  "packageId": "$PKG",
  "versionName": "$VER",
  "versionCode": $CODE,
  "minAndroid": "5.0",
  "file": "minera-para.apk",
  "sizeBytes": $SZ,
  "sha256": "$SHA",
  "signingCertSha256": "$CERT"
}
JSON
node "$HERE/make-assetlinks.mjs" "$CERT" > "$HERE/assetlinks.json"
sha256sum "$OUT/minera-para-$VER.apk" "$OUT/minera-para-$VER.aab"
unset KS_PW
echo "OK → $OUT e $REPO/download/minera-para.apk"
