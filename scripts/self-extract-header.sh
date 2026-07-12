#!/bin/sh
set -eu

marker='__SLIPY_ARCHIVE_BELOW__'
archive_line=$(awk -v marker="$marker" '$0 == marker { print NR + 1; exit }' "$0")
if [ -z "$archive_line" ]; then
  echo "Slipy 安装包损坏：找不到内嵌归档。" >&2
  exit 1
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/slipy-installer.XXXXXX")
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT HUP INT TERM

tail -n "+$archive_line" "$0" | tar -xzf - -C "$work_dir"
bash "$work_dir/install.sh" "$@"
exit $?

__SLIPY_ARCHIVE_BELOW__
