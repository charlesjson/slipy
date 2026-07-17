#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  loongarch64) ARCH="loong64" ;;
  *) echo "不支持的架构：$(uname -m)" >&2; exit 1 ;;
esac

BUILDER="${ROOT}/node_modules/.bin/electron-builder"
[[ -x "$BUILDER" ]] || { echo "请先运行 npm install。" >&2; exit 1; }

echo "[1/4] 打包应用和 Electron 运行时…"
echo "编译 Rust 后端…"
cargo build --release --manifest-path backend/Cargo.toml
"$BUILDER" --linux dir "--${ARCH}"

case "$ARCH" in
  x64) UNPACKED="${ROOT}/dist/linux-unpacked" ;;
  *) UNPACKED="${ROOT}/dist/linux-${ARCH}-unpacked" ;;
esac
[[ -x "${UNPACKED}/slipy" ]] || { echo "electron-builder 未生成预期目录：$UNPACKED" >&2; exit 1; }
[[ -f "${UNPACKED}/resources/app.asar" ]] || { echo "打包结果缺少 app.asar" >&2; exit 1; }
[[ -x "${UNPACKED}/resources/backend/slipy-backend" ]] || { echo "打包结果缺少 Rust 后端" >&2; exit 1; }
[[ -x "${UNPACKED}/chrome-sandbox" ]] || { echo "打包结果缺少 Electron sandbox" >&2; exit 1; }

STAGE="${ROOT}/dist/.installer-stage"
ARCHIVE="${ROOT}/dist/Slipy-${VERSION}-linux-${ARCH}.tar.gz"
INSTALLER="${ROOT}/dist/Slipy-${VERSION}-linux-${ARCH}-installer.run"
rm -rf -- "$STAGE"
mkdir -p "$STAGE/payload"

echo "[2/4] 组装离线 payload…"
cp -a -- "${UNPACKED}/." "$STAGE/payload/"
install -m 0755 scripts/install.sh "$STAGE/install.sh"
install -m 0644 assets/icon.png "$STAGE/icon.png"

echo "[3/4] 生成压缩包和自解压安装程序…"
tar -czf "$ARCHIVE" -C "$STAGE" .
cat scripts/self-extract-header.sh "$ARCHIVE" >"$INSTALLER"
chmod 0755 "$INSTALLER"

echo "[4/4] 校验 Electron 内容…"
gzip -t "$ARCHIVE"
rm -rf -- "$STAGE"

echo
echo "离线安装包已生成（包含 Electron）："
ls -lh "$INSTALLER" "$ARCHIVE"
sha256sum "$INSTALLER" "$ARCHIVE"
