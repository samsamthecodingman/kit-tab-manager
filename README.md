# Tab Bridge

Lets Claude Code see and organise your Firefox tabs: list, group, move, switch, close, and read a tab's text. It never clicks, types, navigates to new addresses or submits anything.

```
Claude Code ──stdio── mcp/server.py ──unix socket── host/tab_bridge_host.py ──native messaging── extension
```

- **extension/**: the Firefox add-on. It answers requests using the `tabs` and `tabGroups` APIs.
- **host/**: the native messaging host. Firefox starts it when the extension loads. It listens on `$XDG_RUNTIME_DIR/tab-bridge.sock` (mode 600, so only you can open it). It uses the Python standard library only.
- **mcp/server.py**: the MCP server Claude Code runs. It provides the tools `list_tabs`, `list_groups`, `group_tabs`, `ungroup_tabs`, `update_group`, `move_tabs`, `activate_tab`, `close_tabs` and `read_tab`.

## Setup

1. `./install.sh` registers the host with Firefox.
2. `claude mcp add --scope user firefox-tabs -- uv run --script $PWD/mcp/server.py` registers the server with Claude Code.
3. Load the extension. In Firefox, open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and pick `extension/manifest.json`.

A temporary add-on is removed when Firefox restarts. To install it permanently, have Mozilla sign it as an unlisted (private) add-on with `npx web-ext sign --channel=unlisted` (it needs your AMO API key), then install the `.xpi` it produces.

## Notes

- Private-window tabs are never listed or read.
- `read_tab` returns whatever the page says. Claude treats it as data, not instructions.
- Closed tabs are logged to `~/.local/share/tab-bridge/closed.jsonl`, and Firefox's History → Recently Closed Tabs can reopen them.
- Firefox can't read built-in pages (about:, the PDF viewer, addons.mozilla.org).
- Tests: `uv run --with pytest pytest -q tests`
