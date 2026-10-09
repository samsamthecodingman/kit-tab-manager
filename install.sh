#!/usr/bin/env bash
# Registers the native host with Firefox (both the classic and the XDG profile locations).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
host="$here/host/tab_bridge_host.py"
chmod +x "$host"

manifest=$(cat <<EOF
{
  "name": "tab_bridge",
  "description": "Tab Bridge native host",
  "path": "$host",
  "type": "stdio",
  "allowed_extensions": ["tab-bridge@samroberts.local"]
}
EOF
)

for dir in "$HOME/.mozilla/native-messaging-hosts" "${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts"; do
  mkdir -p "$dir"
  printf '%s\n' "$manifest" > "$dir/tab_bridge.json"
  echo "registered: $dir/tab_bridge.json"
done
