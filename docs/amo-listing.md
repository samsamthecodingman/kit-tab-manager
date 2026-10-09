# addons.mozilla.org listing

Copy these into the Developer Hub (**Edit Product Page**, and **Upload New Version** for the release notes and reviewer notes). Screenshots (1280×800, in order) are in [`docs/amo/`](amo).

## Name

Kit: Tab Manager

## Add-on URL

`kit-tab-manager` (so the page is addons.mozilla.org/firefox/addon/kit-tab-manager/)

## Summary

*(250 characters max)*

Tidy your tabs with one-click rules and tidy-ups, and Kit, a pixel fox who walks your tab bar. Connect Claude Code to let your AI assistant group and read your tabs too.

## Description

Kit is a tab manager for Firefox, LibreWolf, Floorp, Waterfox and Zen. It tidies your tabs on its own, and connects to your AI assistant when you want something smarter: Claude Code today, with more assistants to come. Ask Claude to group your research tabs, find the tab with your notes, or summarise the page you have open, and it can.

**What you get**

- Claude Code tools to list, group, move, switch to, close and read your tabs.
- Organise with Claude: one button asks Claude to sort your tabs into sensible groups, without opening a chat. Claude only gets the grouping tools, so it can't close tabs or read pages.
- Your own rules, like "titles containing recipe go in Cooking". Apply them in one click, or have Kit suggest them from your current groups.
- One-click tidy-ups: group loose tabs by website, sort groups, collapse everything, and close duplicate tabs after showing you which.
- Lists: chain steps into your own buttons, like a "Focus mode".
- A full page that explains every feature, with live counts of your tabs, groups and duplicates.
- Kit, a little pixel-art fox in a hoodie, walks along your tab bar and says what's changing, on every page. Your theme's colours stay as they are.

**Before you install**

Kit's rules, lists, one-click tidy-ups and tab-bar walks work straight away.

The AI features (Claude Code's tab tools and Organise with Claude) also need Claude Code and Kit's small companion app on Linux or macOS. Kit's full page shows the one command that sets it up; details at github.com/samsamthecodingman/kit-tab-manager

**Privacy**

Kit sends nothing to the internet itself. Tab information reaches Anthropic only when you use Claude Code or press Organise with Claude. Private windows are never seen. No analytics or tracking.

Kit is an independent open-source project, not made or endorsed by Anthropic or Mozilla.

## Categories

Tabs

## Tags

tabs, tab groups, tab manager, claude, ai, productivity, organise

## Support

- Support site: https://github.com/samsamthecodingman/kit-tab-manager/issues
- Homepage: https://github.com/samsamthecodingman/kit-tab-manager

## License

MIT License

## Privacy policy

Paste the text of [`PRIVACY.md`](../PRIVACY.md).

## Notes to reviewer

Kit is the browser side of a local bridge to Claude Code (a command-line AI assistant). Full source, including the companion native messaging host, is public at https://github.com/samsamthecodingman/kit-tab-manager. Nothing is minified or bundled.

How to test without the companion app: open the toolbar menu. "Say hi", the rules and lists settings page, and the Tidy up actions (apply rules, group by website, sort, collapse, close duplicates) all work on their own. The menu shows "AI not connected", which is expected.

Permissions:
- `tabs`, `tabGroups`: list, group, move, switch and close tabs.
- `<all_urls>`: read a tab's visible text with `tabs.executeScript`, only when Claude asks (the injected code is a fixed string in background.js, no remote code).
- `nativeMessaging`: talk to the optional local companion app (`kit.py`, installed by `install.sh`).
- `theme`: draw the mascot in the tab bar. Kit copies the current theme's colours, adds its frame as a background image, and resets the theme when it leaves.
- `storage`: the user's rules and lists.

Data collection: declared as browsingActivity and websiteContent, because tab titles, addresses and (on request) page text are passed to Claude Code, which sends them to Anthropic as part of the user's conversation.
