#!/usr/bin/env bash
# Android build environment for Tauri.
#
# Usage: bash scripts/android.sh <dev|build|...>   (args are passed to `tauri android`)
#
# NDK r23+ ships llvm-* tools only, but vendored OpenSSL (ssh2) still invokes
# <triple>-ranlib/<triple>-ar, so we generate shim symlinks on the fly.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK_VERSION="$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$NDK_VERSION}"
export ANDROID_NDK_HOME="$NDK_HOME"

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$(/usr/libexec/java_home 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

TOOLCHAIN_BIN="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
SHIM_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/.ndk-shims"
mkdir -p "$SHIM_DIR"
for triple in aarch64-linux-android arm-linux-androideabi armv7a-linux-androideabi i686-linux-android x86_64-linux-android; do
  ln -sf "$TOOLCHAIN_BIN/llvm-ranlib" "$SHIM_DIR/$triple-ranlib"
  ln -sf "$TOOLCHAIN_BIN/llvm-ar" "$SHIM_DIR/$triple-ar"
done
export PATH="$SHIM_DIR:$TOOLCHAIN_BIN:$PATH"

exec pnpm tauri android "$@"
