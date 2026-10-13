#!/bin/sh
# Installs Kit's companion app, so Kit's AI features (your assistant's tab tools and
# "Organise with AI") work in Firefox, LibreWolf, Floorp, Waterfox and Zen.
# Kit's rules, lists and tidy-ups work without it.
#
#   curl -fsSL https://raw.githubusercontent.com/samsamthecodingman/kit-tab-manager/master/install.sh | sh
#   ./install.sh              (from a copy of the repo)
#   ./install.sh --uninstall
#
# Options (they can be combined; when piped from curl, pass them with `| sh -s -- --dry-run`):
#   --dry-run    show what would be written, registered and edited, and change nothing
#   --verbose    show the details: file locations, each browser folder, the MCP command line
#   --yes        don't ask before connecting your AI assistants
#
# It needs python3 (already on most Linux and macOS systems) and changes only files in your home folder:
#   - kit.py and a small launcher in Kit's folder (see APP_DIR below)
#   - the native messaging registration for Kit, for Firefox and each Firefox-based browser found
#   - the MCP server lists of the AI assistants it finds (Claude Code, Codex, Hermes Agent, Gemini CLI, Cursor, ...)
set -eu

# The release to download kit.py from, so a release's installer always fetches that release's kit.py.
# Bump this with each release, to the same version as extension/manifest.json (and VERSION in kit.py).
KIT_REF="${KIT_REF:-v0.10.0}"
REPO_RAW="https://raw.githubusercontent.com/samsamthecodingman/kit-tab-manager/$KIT_REF"
# Downloads kit.py for this release into $1 (via a temporary file, so a failed download can't
# break a working copy), or the latest one if the release isn't tagged yet, and checks it runs.
get_kit() {
  part="$1.part"
  if curl -fsSL "$REPO_RAW/kit.py" -o "$part" 2>/dev/null; then
    :
  elif curl -fsSL "https://raw.githubusercontent.com/samsamthecodingman/kit-tab-manager/master/kit.py" -o "$part"; then
    say "(Release ${KIT_REF} isn't on GitHub yet, so using the latest kit.py.)"
  else
    rm -f "$part"
    fail "couldn't download kit.py from GitHub. Check your internet connection and try again."
  fi
  "$PYTHON" "$part" --version >/dev/null 2>&1 || { rm -f "$part"; fail "the downloaded kit.py doesn't run. Try again in a minute."; }
  mv "$part" "$1"
}
EXTENSION_ID="tab-bridge@samroberts.local"
HOST_NAME="tab_bridge"
LISTING="https://addons.mozilla.org/firefox/addon/kit-tab-manager/"

UNINSTALL=0 VERBOSE=0 DRY=0 YES=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --verbose) VERBOSE=1 ;;
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    *) printf 'Unknown option: %s\nOptions: --dry-run, --verbose, --yes, --uninstall\n' "$arg" >&2; exit 2 ;;
  esac
done
# What kit.py register / unregister is told (the flags have no spaces, so this is safe unquoted).
KIT_FLAGS=""
[ "$VERBOSE" = 1 ] && KIT_FLAGS="$KIT_FLAGS --verbose"
[ "$DRY" = 1 ] && KIT_FLAGS="$KIT_FLAGS --dry-run"
[ "$YES" = 1 ] && KIT_FLAGS="$KIT_FLAGS --yes"

say() { printf '%s\n' "$*"; }
vsay() { if [ "$VERBOSE" = 1 ]; then printf '    %s\n' "$*"; fi; }
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

if [ "$UNINSTALL" = 1 ]; then
  step "Removing Kit"
  if [ "$DRY" = 1 ]; then
    say "(Dry run: nothing will be changed.)"
    browser_dirs | while IFS='|' read -r name dir; do say "Would remove $dir/$HOST_NAME.json ($name)"; done
    # Only Kit 0.10 and newer understand --dry-run; an older kit.py would really disconnect everything.
    if [ -f "$APP_DIR/kit.py" ] && python3 "$APP_DIR/kit.py" --version 2>/dev/null |
        python3 -c 'import sys, re; v = re.findall(r"\d+", sys.stdin.read()); sys.exit(not v or tuple(map(int, v[:2])) < (0, 10))'; then
      python3 "$APP_DIR/kit.py" unregister $KIT_FLAGS || true
    else
      say "Would disconnect Kit from your AI assistants"
    fi
    say "Would delete $APP_DIR"
    exit 0
  fi
  remove_manifest() { rm -f "$2/$HOST_NAME.json"; }
  for_each_browser_dir remove_manifest
  say "✓ Disconnected from your browsers"
  # kit.py (still installed at this point) disconnects the assistants, then offers to delete the leftovers.
  if [ -f "$APP_DIR/kit.py" ]; then
    python3 "$APP_DIR/kit.py" unregister $KIT_FLAGS || true
  else
    say "Kit's logs are in ${XDG_DATA_HOME:-$HOME/.local/share}/tab-bridge. To delete them: rm -rf \"${XDG_DATA_HOME:-$HOME/.local/share}/tab-bridge\""
  fi
  rm -rf "$APP_DIR"
  say "✓ Removed Kit's helper app"
  say ""
  say "Done. Remove the Kit extension itself from your browser's Add-ons page (about:addons)."
  exit 0
fi

step "Kit setup"
[ "$DRY" = 1 ] && say "(Dry run: nothing will be changed.)"

# Prefer the system's own Python, so removing a conda or pyenv Python later can't break Kit.
PYTHON=""
# On macOS, /usr/bin/python3 is a stub that pops up an installer unless the Command Line Tools are there.
NEED_TOOLS=0
SYSTEM_PY=/usr/bin/python3
if [ "$(uname -s)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then SYSTEM_PY=""; NEED_TOOLS=1; fi
for p in $SYSTEM_PY /usr/local/bin/python3 /opt/homebrew/bin/python3 "$(command -v python3 || true)"; do
  [ "$NEED_TOOLS" = 1 ] && [ "$p" = /usr/bin/python3 ] && continue # the stub: running it would only open the installer
  if [ -n "$p" ] && [ -x "$p" ] && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null; then PYTHON="$p"; break; fi
done
if [ -z "$PYTHON" ] && [ "$NEED_TOOLS" = 1 ]; then
  [ "$DRY" = 1 ] && fail "Kit needs Python, and this Mac doesn't have it yet. Without --dry-run, Kit would open macOS's \"developer tools\" installer."
  xcode-select --install >/dev/null 2>&1 || true # opens macOS's own installer window
  fail "Kit needs Python, and this Mac doesn't have it yet. macOS may now ask to install \"developer tools\": click Install, wait for it to finish, then run the same line again."
fi
[ -n "$PYTHON" ] || PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || fail "python3 isn't installed. Install it with your system's package manager, then run this again."
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 8))' || fail "Kit needs Python 3.8 or newer ($("$PYTHON" --version 2>&1) found)."
say "✓ Python found"
vsay "$("$PYTHON" --version 2>&1) at $PYTHON"

# From a copy of the repo, use its kit.py. Piped from curl, $0 is just "sh", so download instead
# (rather than picking up some other kit.py in the current folder).
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
if [ -f "$0" ] && [ -n "$HERE" ] && [ -f "$HERE/kit.py" ] && [ -f "$HERE/extension/manifest.json" ]; then
  SOURCE="$HERE/kit.py"
else
  SOURCE=""
  command -v curl >/dev/null 2>&1 || fail "curl isn't installed, so Kit can't be downloaded."
fi

if [ "$DRY" = 1 ]; then
  if [ -z "$SOURCE" ]; then # a dry run still needs kit.py to show what it would do, so fetch it somewhere temporary
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    get_kit "$TMP/kit.py"
    SOURCE="$TMP/kit.py"
  fi
  say "Would copy kit.py ($("$PYTHON" "$SOURCE" --version)) to $APP_DIR/kit.py"
  say "Would write the launcher $LAUNCHER"
  browser_dirs | while IFS='|' read -r name dir; do say "Would write $dir/$HOST_NAME.json ($name)"; done
  KIT_APP_PATH="$APP_DIR/kit.py" "$PYTHON" "$SOURCE" register "$PYTHON" $KIT_FLAGS
  exit 0
fi

mkdir -p "$APP_DIR"
if [ -n "$SOURCE" ]; then
  cp "$SOURCE" "$APP_DIR/kit.py"
else
  get_kit "$APP_DIR/kit.py"
fi
# The browser starts this launcher with a bare environment, so it names python3 by its full path.
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$PYTHON" "$APP_DIR/kit.py" > "$LAUNCHER"
chmod 755 "$LAUNCHER" "$APP_DIR/kit.py"
say "✓ Kit's helper app installed"
vsay "$("$PYTHON" "$APP_DIR/kit.py" --version) in $APP_DIR"

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
  vsay "Registered with $1 in $2"
}
for_each_browser_dir write_manifest
# One line however many browsers and folders there are: "Firefox", or "Firefox, Zen and Floorp".
BROWSERS="$(browser_dirs | cut -d'|' -f1 | awk '!seen[$0]++' | paste -sd, - | sed 's/,/, /g; s/\(.*\), /\1 and /')"
say "✓ Connected to $BROWSERS"

"$PYTHON" "$APP_DIR/kit.py" register "$PYTHON" $KIT_FLAGS
if [ "$VERBOSE" = 1 ]; then
  say "Any other MCP-compatible assistant can use Kit too: point it at"
  say "    $PYTHON \"$APP_DIR/kit.py\" mcp"
fi

say ""
say "If you haven't added the Kit extension to your browser yet: $LISTING"
say "All set. Switch back to Firefox: Kit's page updates by itself within a few seconds."
