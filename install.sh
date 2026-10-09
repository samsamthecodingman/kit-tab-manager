#!/bin/sh
# Installs Kit's companion app, so Kit's AI features (Claude Code's tab tools and
# "Organise with Claude") work in Firefox, LibreWolf, Floorp, Waterfox and Zen.
# Kit's rules, lists and tidy-ups work without it.
#
#   curl -fsSL https://raw.githubusercontent.com/samsamthecodingman/kit-tab-manager/master/install.sh | sh
#   ./install.sh              (from a copy of the repo)
#   ./install.sh --uninstall
#
# It needs python3 (already on most Linux and macOS systems) and changes only files in your home folder:
#   - kit.py and a small launcher in Kit's folder (see APP_DIR below)
#   - the native messaging registration for Kit, for Firefox and each Firefox-based browser found
#   - Claude Code's MCP server list, if Claude Code is installed (`claude mcp add`)
set -eu

REPO_RAW="https://raw.githubusercontent.com/samsamthecodingman/kit-tab-manager/master"
EXTENSION_ID="tab-bridge@samroberts.local"
HOST_NAME="tab_bridge"
MCP_NAME="firefox-tabs"
LISTING="https://addons.mozilla.org/firefox/addon/kit-tab-manager/"

say() { printf '%s\n' "$*"; }
if [ -t 1 ]; then step() { printf '\n\033[1m%s\033[0m\n' "$*"; }; else step() { printf '\n%s\n' "$*"; }; fi
fail() { printf '\nKit setup stopped: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux)
    APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/kit"
    ;;
  Darwin)
    APP_DIR="$HOME/Library/Application Support/Kit"
    ;;
  *) fail "Kit's companion app supports Linux and macOS so far. Kit's rules and tidy-ups still work in your browser without it." ;;
esac
LAUNCHER="$APP_DIR/kit-host"

# Where each browser looks for companion apps, one "name|folder" per line. Firefox's are always
# used; a Firefox-based browser's only if that browser has been run (its profile folder exists).
browser_dirs() {
  if [ "$(uname -s)" = Darwin ]; then
    sup="$HOME/Library/Application Support"
    echo "Firefox|$sup/Mozilla/NativeMessagingHosts"
    for b in LibreWolf:LibreWolf Floorp:Floorp Waterfox:Waterfox Zen:zen; do # display name:folder
      [ -d "$sup/${b#*:}" ] && echo "${b%%:*}|$sup/${b#*:}/NativeMessagingHosts"
    done
  else
    echo "Firefox|$HOME/.mozilla/native-messaging-hosts"
    echo "Firefox|${XDG_CONFIG_HOME:-$HOME/.config}/mozilla/native-messaging-hosts"
    for b in LibreWolf:librewolf Floorp:floorp Waterfox:waterfox Zen:zen; do # display name:folder
      [ -d "$HOME/.${b#*:}" ] && echo "${b%%:*}|$HOME/.${b#*:}/native-messaging-hosts"
    done
  fi
  return 0
}
for_each_browser_dir() { # runs "$1 <browser> <folder>" for each registration folder (folders can contain spaces)
  browser_dirs | while IFS='|' read -r name dir; do "$1" "$name" "$dir"; done
}

if [ "${1:-}" = "--uninstall" ]; then
  step "Removing Kit's companion app"
  remove_manifest() { rm -f "$2/$HOST_NAME.json"; }
  for_each_browser_dir remove_manifest
  if [ -f "$APP_DIR/kit.py" ]; then python3 "$APP_DIR/kit.py" unregister || true; fi
  rm -rf "$APP_DIR"
  if command -v claude >/dev/null 2>&1; then claude mcp remove "$MCP_NAME" -s user >/dev/null 2>&1 || true; fi
  say "Done. Remove the Kit extension itself from your browser's Add-ons page (about:addons)."
  exit 0
fi

step "1/3  Checking Python"
# Prefer the system's own Python, so removing a conda or pyenv Python later can't break Kit.
PYTHON=""
for p in /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 "$(command -v python3 || true)"; do
  if [ -n "$p" ] && [ -x "$p" ] && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then PYTHON="$p"; break; fi
done
[ -n "$PYTHON" ] || PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || fail "python3 isn't installed. Install it with your system's package manager (on macOS: xcode-select --install), then run this again."
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 8))' || fail "Kit needs Python 3.8 or newer ($("$PYTHON" --version 2>&1) found)."
say "Using $("$PYTHON" --version 2>&1) at $PYTHON"

step "2/3  Installing Kit's companion app"
mkdir -p "$APP_DIR"
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -n "$HERE" ] && [ -f "$HERE/kit.py" ]; then
  cp "$HERE/kit.py" "$APP_DIR/kit.py"
else
  command -v curl >/dev/null 2>&1 || fail "curl isn't installed, so Kit can't be downloaded."
  curl -fsSL "$REPO_RAW/kit.py" -o "$APP_DIR/kit.py" || fail "couldn't download kit.py from GitHub."
fi
# The browser starts this launcher with a bare environment, so it names python3 by its full path.
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$PYTHON" "$APP_DIR/kit.py" > "$LAUNCHER"
chmod 755 "$LAUNCHER" "$APP_DIR/kit.py"
say "Installed $("$PYTHON" "$APP_DIR/kit.py" --version) in $APP_DIR"

write_manifest() {
  mkdir -p "$2"
  cat > "$2/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Kit companion app",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
EOF
  say "Registered with $1 in $2"
}
for_each_browser_dir write_manifest

step "3/3  Connecting your AI assistants"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "$MCP_NAME" -s user >/dev/null 2>&1 || true # replaces any older Kit or Tab Bridge setup
  claude mcp add --scope user "$MCP_NAME" -- "$PYTHON" "$APP_DIR/kit.py" mcp >/dev/null
  say "Claude Code: connected. Start a new session to use Kit's tab tools."
else
  say "Claude Code: not installed. Kit's \"Organise with AI\" button uses it (https://claude.com/claude-code)."
fi
"$PYTHON" "$APP_DIR/kit.py" register "$PYTHON"
say "Any other MCP-compatible assistant can use Kit too: point it at"
say "    $PYTHON \"$APP_DIR/kit.py\" mcp"

step "All set."
say "If you haven't yet, add the Kit extension to your browser: $LISTING"
say "Kit's menu shows \"Connected\" within a few seconds (reload the extension if it doesn't)."
