#!/usr/bin/env bash
# Confere se este computador está pronto para compilar e rodar o Pingo no Android.
# Uso: pnpm android:doctor        (não instala nada; só diz o que falta e como resolver)
set -u
ok=0; bad=0
pass() { echo "  ✅ $1"; ok=$((ok+1)); }
fail() { echo "  ❌ $1"; echo "      ↳ $2"; bad=$((bad+1)); }

STUDIO="/Applications/Android Studio.app"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

echo "--- Java (precisa do 17 ou mais novo)"
JAVA_BIN=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then JAVA_BIN="$JAVA_HOME/bin/java"
elif [ -x "$STUDIO/Contents/jbr/Contents/Home/bin/java" ]; then JAVA_BIN="$STUDIO/Contents/jbr/Contents/Home/bin/java"; fi
if [ -n "$JAVA_BIN" ]; then
  major=$("$JAVA_BIN" -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+)(\.[0-9]+)?.*/\1/')
  if [ "${major:-0}" -ge 17 ]; then pass "Java $major ($JAVA_BIN)"
  else fail "Java $major é antigo" "use o JDK do Android Studio: export JAVA_HOME=\"$STUDIO/Contents/jbr/Contents/Home\""; fi
else
  fail "Java 17+ não encontrado" "instale o Android Studio (ele traz o JDK) e use: export JAVA_HOME=\"$STUDIO/Contents/jbr/Contents/Home\""
fi
[ -n "${JAVA_HOME:-}" ] && pass "JAVA_HOME definido" || fail "JAVA_HOME não definido" "adicione ao ~/.zshrc: export JAVA_HOME=\"$STUDIO/Contents/jbr/Contents/Home\""

echo "--- Android SDK"
[ -d "$STUDIO" ] && pass "Android Studio instalado" || fail "Android Studio não instalado" "brew install --cask android-studio  (e abra uma vez para ele baixar o SDK)"
[ -n "${ANDROID_HOME:-}" ] && pass "ANDROID_HOME=$ANDROID_HOME" || fail "ANDROID_HOME não definido" "adicione ao ~/.zshrc: export ANDROID_HOME=\"\$HOME/Library/Android/sdk\""
[ -x "$SDK/platform-tools/adb" ] && pass "adb (platform-tools)" || fail "platform-tools ausente" "Android Studio → Settings → Android SDK → SDK Tools → Android SDK Platform-Tools"
[ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ] && pass "cmdline-tools" || fail "cmdline-tools ausente" "SDK Tools → Android SDK Command-line Tools (latest)"
ls "$SDK"/platforms/android-3* >/dev/null 2>&1 && pass "plataforma do Android (API 3x)" || fail "nenhuma plataforma API 3x" "SDK Platforms → Android 15 (API 35) ou mais novo"
ls "$SDK"/build-tools/* >/dev/null 2>&1 && pass "build-tools" || fail "build-tools ausente" "SDK Tools → Android SDK Build-Tools"
NDK_DIR=$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1)
[ -n "$NDK_DIR" ] && pass "NDK ($(basename "$NDK_DIR"))" || fail "NDK ausente" "SDK Tools → NDK (Side by side)"
[ -n "${NDK_HOME:-}" ] && pass "NDK_HOME definido" || fail "NDK_HOME não definido" "adicione ao ~/.zshrc: export NDK_HOME=\"\$ANDROID_HOME/ndk/<versão instalada>\""

echo "--- Rust"
installed=$(rustup target list --installed 2>/dev/null)
for t in aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android; do
  echo "$installed" | grep -q "^$t$" && pass "alvo $t" || fail "alvo $t ausente" "rustup target add $t"
done

echo "--- Celular"
ADB="$SDK/platform-tools/adb"; command -v adb >/dev/null 2>&1 && ADB=adb
if [ -x "$ADB" ] || command -v adb >/dev/null 2>&1; then
  devs=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}')
  unauth=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized"{print $1}')
  if [ -n "$devs" ]; then pass "celular conectado: $(echo "$devs" | head -1)"
  elif [ -n "$unauth" ]; then fail "celular não autorizado" "no celular, toque em Permitir na janela 'Depurar USB'"
  else fail "nenhum celular conectado" "ative Opções do desenvolvedor → Depuração USB e conecte o cabo (ou crie um emulador no Android Studio)"; fi
else
  fail "adb indisponível" "instale as platform-tools"
fi

echo "--- Espaço em disco"
free_gb=$(df -g / | awk 'NR==2{print $4}')
[ "${free_gb:-0}" -ge 15 ] && pass "${free_gb} GB livres" || fail "só ${free_gb} GB livres" "o SDK e o emulador pedem uns 10 GB; prefira testar no celular em vez do emulador"

echo
if [ "$bad" -eq 0 ]; then echo "✅ Tudo pronto ($ok verificações)."; else echo "❌ Faltam $bad item(ns). Resolva na ordem acima e rode de novo."; exit 1; fi
