# Tab Bridge

Lets Claude Code see and organise your Firefox tabs: list, group, move, switch, close, and read a tab's text. It never clicks, types, navigates to new addresses or submits anything.

```
Claude Code ──stdio── mcp/server.py ──unix socket── host/tab_bridge_host.py ──native messaging── extension
```

- **extension/**: the Firefox add-on. It answers requests using the `tabs` and `tabGroups` APIs, and has a toolbar menu (below).
- **host/**: the native messaging host. Firefox starts it when the extension loads. It listens on `$XDG_RUNTIME_DIR/tab-bridge.sock` (mode 600, so only you can open it). It uses the Python standard library only.
- **mcp/server.py**: the MCP server Claude Code runs. It provides the tools `list_tabs`, `list_groups`, `group_tabs`, `ungroup_tabs`, `update_group`, `move_tabs`, `activate_tab`, `close_tabs` and `read_tab`.

## Setup

1. `./install.sh` registers the host with Firefox.
2. `claude mcp add --scope user firefox-tabs -- uv run --script $PWD/mcp/server.py` registers the server with Claude Code.
3. Load the extension. In Firefox, open `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and pick `extension/manifest.json`.

A temporary add-on is removed when Firefox restarts. To install it permanently, have Mozilla sign it as an unlisted (private) add-on with `npx web-ext sign --channel=unlisted` (it needs your AMO API key), then install the `.xpi` it produces.

## Toolbar menu

Click the Tab Bridge button in Firefox for:

- **Organise with Claude**: the host runs Claude Code headless (`claude -p`, Sonnet) in an empty folder with no built-in tools and only the grouping tools. It can group, ungroup, rename, recolour and move tabs, but never close or read them. Runs are logged to `~/.local/share/tab-bridge/organise.log`.
- **Tidy up**: apply your rules, group loose tabs by website, sort tabs in each group, collapse all groups, and close duplicate tabs (after showing you which).
- **My lists**: your own named sequences of steps.
- **Rules & lists** opens the settings page where you edit grouping rules (or suggest them from your current groups) and lists.

While tabs change, Pixel (a small sprite carrying tabs) walks onto the page with a status bubble, the toolbar icon hops, and the tab bar is tinted. The tint keeps your current light or dark theme. **Say hi** in the menu plays it without touching any tabs.

## Notes

- Private-window tabs are never listed or read.
- `read_tab` returns whatever the page says. Claude treats it as data, not instructions.
- Closed tabs are logged to `~/.local/share/tab-bridge/closed.jsonl`, and Firefox's History → Recently Closed Tabs can reopen them.
- Firefox can't read built-in pages (about:, the PDF viewer, addons.mozilla.org).
- Tests: `uv run --with pytest pytest -q tests`
