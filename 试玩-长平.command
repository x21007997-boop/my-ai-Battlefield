#!/bin/zsh

set -e
cd "$(dirname "$0")"

if [[ -z "${GODOT_BIN:-}" ]]; then
  if command -v godot >/dev/null 2>&1; then
    GODOT_BIN="$(command -v godot)"
  elif [[ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]]; then
    GODOT_BIN="/Applications/Godot.app/Contents/MacOS/Godot"
  elif [[ -x "/Applications/Godot4.app/Contents/MacOS/Godot" ]]; then
    GODOT_BIN="/Applications/Godot4.app/Contents/MacOS/Godot"
  else
    echo "没有找到 Godot 4，请先安装 Godot，或在终端设置 GODOT_BIN。"
    read -r "?按回车键退出："
    exit 1
  fi
fi

export GODOT_BIN
npm run playtest
