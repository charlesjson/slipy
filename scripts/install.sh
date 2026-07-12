#!/usr/bin/env bash
set -euo pipefail

APP_ID="org.slipy.app"
APP_NAME="Slipy"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MODE="auto"
ACTION="install"
LAUNCH=1

usage() {
  cat <<'EOF'
Slipy 离线安装程序

用法：./install.sh [选项]
  --user        安装到当前用户目录（默认：普通用户）
  --system      安装到 /opt 和 /usr（默认：root 用户）
  --uninstall   卸载程序，保留用户配置和插件
  --no-launch   安装完成后不启动 Slipy
  -h, --help    显示帮助
EOF
}

while (($#)); do
  case "$1" in
    --user) MODE="user" ;;
    --system) MODE="system" ;;
    --uninstall) ACTION="uninstall" ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$MODE" == "auto" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then MODE="system"; else MODE="user"; fi
fi

if [[ "$MODE" == "system" ]]; then
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "系统安装需要 root 权限，请使用 sudo 重新运行，或改用 --user。" >&2
    exit 1
  fi
  APP_DIR="/opt/slipy"
  BIN_LINK="/usr/local/bin/slipy"
  DESKTOP_FILE="/usr/share/applications/${APP_ID}.desktop"
  ICON_FILE="/usr/share/icons/hicolor/512x512/apps/slipy.png"
else
  DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
  APP_DIR="${DATA_HOME}/slipy"
  BIN_LINK="${HOME}/.local/bin/slipy"
  DESKTOP_FILE="${DATA_HOME}/applications/${APP_ID}.desktop"
  ICON_FILE="${DATA_HOME}/icons/hicolor/512x512/apps/slipy.png"
fi

refresh_desktop() {
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$(dirname "$(dirname "$(dirname "$ICON_FILE")")")" >/dev/null 2>&1 || true
}

is_managed_install() {
  [[ -f "${APP_DIR}/.slipy-install" ]] && grep -qxF "$APP_ID" "${APP_DIR}/.slipy-install"
}

if [[ "$ACTION" == "uninstall" ]]; then
  if ! is_managed_install; then
    echo "拒绝卸载：${APP_DIR} 不是由 Slipy 安装程序管理的目录。" >&2
    exit 1
  fi
  [[ -L "$BIN_LINK" && "$(readlink -- "$BIN_LINK")" == "${APP_DIR}/slipy" ]] && rm -f -- "$BIN_LINK"
  [[ -f "$DESKTOP_FILE" ]] && grep -q '^X-Slipy-Managed=true$' "$DESKTOP_FILE" && rm -f -- "$DESKTOP_FILE"
  rm -f -- "$ICON_FILE"
  if [[ "$MODE" == "user" ]]; then
    autostart="${XDG_CONFIG_HOME:-${HOME}/.config}/autostart/slipy.desktop"
    [[ -f "$autostart" ]] && grep -qF "${APP_DIR}/slipy" "$autostart" && rm -f -- "$autostart"
  fi
  rm -rf -- "$APP_DIR"
  refresh_desktop
  echo "Slipy 已卸载。用户配置和插件数据已保留。"
  exit 0
fi

if [[ -e "$APP_DIR" ]] && ! is_managed_install; then
  echo "安装路径已存在且不属于 Slipy：${APP_DIR}" >&2
  exit 1
fi
if [[ ! -e "$APP_DIR" ]]; then
  for target in "$BIN_LINK" "$DESKTOP_FILE" "$ICON_FILE"; do
    if [[ -e "$target" || -L "$target" ]]; then
      echo "目标路径已被其他文件占用：${target}" >&2
      exit 1
    fi
  done
else
  if [[ -e "$BIN_LINK" || -L "$BIN_LINK" ]] && { [[ ! -L "$BIN_LINK" ]] || [[ "$(readlink -- "$BIN_LINK")" != "${APP_DIR}/slipy" ]]; }; then
    echo "命令入口已被其他程序占用：${BIN_LINK}" >&2
    exit 1
  fi
  if [[ -f "$DESKTOP_FILE" ]] && ! grep -q '^X-Slipy-Managed=true$' "$DESKTOP_FILE"; then
    echo "桌面入口已被其他程序占用：${DESKTOP_FILE}" >&2
    exit 1
  fi
fi

if [[ "$APP_DIR" == *$'\n'* || "$APP_DIR" == *$'\r'* ]]; then
  echo "安装路径不能包含换行符。" >&2
  exit 1
fi

PAYLOAD_DIR="${SCRIPT_DIR}/payload"
if [[ ! -x "${PAYLOAD_DIR}/slipy" || ! -f "${PAYLOAD_DIR}/resources/app.asar" ]]; then
  echo "安装包不完整：缺少 Electron/Slipy payload。" >&2
  exit 1
fi

for directory in "$(dirname "$APP_DIR")" "$(dirname "$BIN_LINK")" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"; do
  install -d -m 0755 "$directory"
done

NEW_DIR="${APP_DIR}.new.$$"
OLD_DIR="${APP_DIR}.old.$$"
BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slipy-backup.XXXXXX")"
BIN_NEW="${BIN_LINK}.new.$$"
DESKTOP_NEW="${DESKTOP_FILE}.new.$$"
ICON_NEW="${ICON_FILE}.new.$$"
APP_SWAPPED=0

backup_target() {
  local target="$1" name="$2"
  if [[ -e "$target" || -L "$target" ]]; then
    cp -a -- "$target" "${BACKUP_DIR}/${name}"
    touch "${BACKUP_DIR}/${name}.present"
  fi
}

restore_target() {
  local target="$1" name="$2"
  rm -f -- "$target"
  [[ -f "${BACKUP_DIR}/${name}.present" ]] && cp -a -- "${BACKUP_DIR}/${name}" "$target"
}

finish_transaction() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$status" -ne 0 && "$APP_SWAPPED" -eq 1 ]]; then
    rm -rf -- "$APP_DIR"
    [[ -e "$OLD_DIR" ]] && mv -- "$OLD_DIR" "$APP_DIR"
    restore_target "$BIN_LINK" bin
    restore_target "$DESKTOP_FILE" desktop
    restore_target "$ICON_FILE" icon
  fi
  rm -rf -- "$NEW_DIR" "$OLD_DIR" "$BACKUP_DIR"
  rm -f -- "$BIN_NEW" "$DESKTOP_NEW" "$ICON_NEW"
  exit "$status"
}
trap finish_transaction EXIT
trap 'exit 130' HUP INT TERM

rm -rf -- "$NEW_DIR" "$OLD_DIR"
mkdir -m 0755 "$NEW_DIR"
cp -a -- "${PAYLOAD_DIR}/." "$NEW_DIR/"
install -m 0755 "${SCRIPT_DIR}/install.sh" "$NEW_DIR/uninstall.sh"
printf '%s\n' "$APP_ID" >"$NEW_DIR/.slipy-install"
chmod 0755 "$NEW_DIR/slipy" "$NEW_DIR/chrome-sandbox" 2>/dev/null || true
if [[ "$MODE" == "system" ]]; then
  chown -R 0:0 "$NEW_DIR"
  # Electron's setuid sandbox is required on systems without user namespaces.
  [[ -f "$NEW_DIR/chrome-sandbox" ]] && chmod 4755 "$NEW_DIR/chrome-sandbox"
fi

desktop_exec=${APP_DIR//\\/\\\\}
desktop_exec=${desktop_exec//\"/\\\"}
desktop_exec=${desktop_exec//\`/\\\`}
desktop_exec=${desktop_exec//\$/\\\$}
desktop_exec=${desktop_exec//%/%%}
rm -f -- "$BIN_NEW" "$DESKTOP_NEW" "$ICON_NEW"
ln -s -- "${APP_DIR}/slipy" "$BIN_NEW"
install -m 0644 "${SCRIPT_DIR}/icon.png" "$ICON_NEW"
cat >"$DESKTOP_NEW" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Screen edge wheel actions and global shortcuts
Exec="${desktop_exec}/slipy" %U
Icon=slipy
Terminal=false
Categories=Utility;
StartupNotify=true
StartupWMClass=${APP_ID}
X-Slipy-Managed=true
EOF
chmod 0644 "$DESKTOP_NEW"

backup_target "$BIN_LINK" bin
backup_target "$DESKTOP_FILE" desktop
backup_target "$ICON_FILE" icon
if [[ -e "$APP_DIR" ]]; then mv -- "$APP_DIR" "$OLD_DIR"; fi
mv -- "$NEW_DIR" "$APP_DIR"
APP_SWAPPED=1
mv -fT -- "$BIN_NEW" "$BIN_LINK"
mv -fT -- "$DESKTOP_NEW" "$DESKTOP_FILE"
mv -fT -- "$ICON_NEW" "$ICON_FILE"
rm -rf -- "$OLD_DIR"
APP_SWAPPED=0
refresh_desktop

echo "Slipy 已安装到：${APP_DIR}"
echo "命令行入口：${BIN_LINK}"
if [[ "$MODE" == "user" && ":${PATH}:" != *":$(dirname "$BIN_LINK"):"* ]]; then
  echo "提示：$(dirname "$BIN_LINK") 当前不在 PATH 中，但桌面菜单仍可直接启动。"
fi

if [[ "$LAUNCH" -eq 1 ]]; then
  nohup "${APP_DIR}/slipy" >/dev/null 2>&1 &
fi
