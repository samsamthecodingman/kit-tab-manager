# Privacy policy

*Kit: Tab manager for Claude Code. Last updated 10 October 2026.*

Kit is a Firefox extension that lets [Claude Code](https://claude.com/claude-code), running on your own computer, see and organise your tabs. This page explains what Kit can see, where that information goes, and what stays on your computer.

## What Kit can see

- **Your open tabs:** their titles, addresses, groups and positions, in normal (not private) windows.
- **A tab's visible text**, but only when Claude Code asks to read that tab, for example because you asked Claude about it.
- **Your grouping rules and action lists**, which you create in Kit's settings.

Kit never sees or reads tabs in private windows. It never clicks, types, fills in forms, or navigates anywhere new.

## Where that information goes

**Kit itself sends nothing to the internet.** The extension only talks to a small companion program on your own computer (the "native host"), over Firefox's native messaging, and that program only accepts connections from your own user account.

Your tab information leaves your computer only when **you** use Claude:

- When you ask Claude Code about your tabs, the titles, addresses and any page text Claude reads become part of your Claude Code conversation. Claude Code sends that conversation to Anthropic to generate replies, under your own Anthropic account and [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
- When you press **Organise with Claude** in Kit's menu, Kit starts Claude Code on your computer with only the tools to list and group tabs. Claude sees your tab titles and addresses (not page text), and that run is sent to Anthropic in the same way.

Kit's rules, lists and one-click actions (apply my rules, group by website, sort, collapse, close duplicates) run entirely on your computer and send nothing anywhere.

## What Kit stores

All on your computer:

- Your rules and lists, in Firefox's extension storage.
- A log of tabs closed through Kit (title and address), in `~/.local/share/tab-bridge/closed.jsonl`, so you can find them again.
- A log of **Organise with Claude** runs (time, your optional request, and Claude's summary), in `~/.local/share/tab-bridge/organise.log`.

You can delete these files at any time. Removing the extension deletes its stored rules and lists.

## What Kit doesn't do

- No analytics, tracking, advertising or telemetry.
- No accounts, and no servers run by the developer.
- No selling or sharing of your information with anyone.

## Not affiliated

Kit is an independent, open-source project. It isn't made or endorsed by Anthropic or Mozilla. Claude and Claude Code are products of Anthropic; Firefox is a trademark of the Mozilla Foundation.

## Contact

Questions or concerns: open an issue at [github.com/samsamthecodingman/kit-tab-manager/issues](https://github.com/samsamthecodingman/kit-tab-manager/issues).
