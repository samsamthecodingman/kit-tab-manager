// Toolbar menu actions: your grouping rules, one-click tidy-ups and saved action lists.
// They run here in the background page (so they finish even if the menu closes) and reuse
// the bridge HANDLERS, with Kit narrating each one.

const STEP_TYPES = {
  apply_rules: { label: "Apply my rules" },
  group_by_site: { label: "Group tabs by website" },
  sort_groups: { label: "Sort tabs in each group" },
  collapse_all: { label: "Collapse all groups" },
  collapse_all_except: { label: "Collapse all groups except…", arg: "group name" },
  expand_group: { label: "Expand group…", arg: "group name" },
  switch_to: { label: "Switch to tab whose title contains…", arg: "title text" },
  close_duplicates: { label: "Close duplicate tabs (without asking)" },
  organise_with_claude: { label: "Organise with Claude", arg: "anything specific? (optional)" },
};

async function loadSettings() {
  const s = await browser.storage.local.get(["rules", "lists"]);
  return { rules: Array.isArray(s.rules) ? s.rules : [], lists: Array.isArray(s.lists) ? s.lists : [] };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

function ruleMatches(rule, tab) {
  const needle = String(rule.text || "").trim().toLowerCase();
  if (!needle) return false;
  if (rule.field === "site") {
    const host = hostOf(tab.url);
    return host === needle || host.endsWith("." + needle);
  }
  return ((rule.field === "url" ? tab.url : tab.title) || "").toLowerCase().includes(needle);
}

async function focusedWindowId() {
  return (await browser.windows.getLastFocused({ windowTypes: ["normal"] })).id;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Puts tabs into the window's group with this title, making it if needed.
async function intoGroup(windowId, title, color, tabIds) {
  const groups = await browser.tabGroups.query({ windowId });
  const existing = groups.find((g) => (g.title || "").toLowerCase() === title.toLowerCase());
  if (existing) return HANDLERS.group_tabs({ tab_ids: tabIds, group_id: existing.id });
  return HANDLERS.group_tabs({ tab_ids: tabIds, title, color: GROUP_COLORS.includes(color) ? color : undefined });
}

async function groupTitles(windowId) {
  const groups = await browser.tabGroups.query({ windowId });
  return new Map(groups.map((g) => [g.id, (g.title || "").toLowerCase()]));
}

// Runs fn with Kit out in the tab bar; fn returns the text Kit says when done.
async function withKit(windowId, label, fn) {
  Mascot.begin(windowId, label);
  let ok = false, said = "Done";
  try {
    said = (await fn()) || "Done";
    ok = true;
    return said;
  } finally {
    Mascot.end(ok, said);
  }
}

const ACTIONS = {
  async apply_rules(windowId) {
    const { rules } = await loadSettings();
    if (!rules.length) return "No rules yet";
    const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned);
    const titles = await groupTitles(windowId);
    const buckets = new Map();
    for (const tab of tabs) {
      const rule = rules.find((r) => r.group && ruleMatches(r, tab));
      if (!rule) continue;
      const key = rule.group.trim().toLowerCase();
      if (tab.groupId !== -1 && titles.get(tab.groupId) === key) continue; // already there
      if (!buckets.has(key)) buckets.set(key, { title: rule.group.trim(), color: rule.color, ids: [] });
      buckets.get(key).ids.push(tab.id);
    }
    let moved = 0;
    for (const b of buckets.values()) { await intoGroup(windowId, b.title, b.color, b.ids); moved += b.ids.length; }
    return moved ? `Sorted ${plural(moved, "tab")}` : "Already tidy";
  },

  async group_by_site(windowId) {
    const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned && t.groupId === -1);
    const bySite = new Map();
    for (const t of tabs) {
      const host = hostOf(t.url);
      if (!host || !/^https?:/.test(t.url)) continue;
      if (!bySite.has(host)) bySite.set(host, []);
      bySite.get(host).push(t.id);
    }
    let made = 0;
    for (const [host, ids] of bySite) {
      if (ids.length < 2) continue;
      const hash = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      await intoGroup(windowId, host, GROUP_COLORS[hash % GROUP_COLORS.length], ids);
      made++;
    }
    return made ? `Made ${plural(made, "site group")}` : "No sites with 2+ loose tabs";
  },

  async sort_groups(windowId) {
    const groups = await browser.tabGroups.query({ windowId });
    for (const g of groups) {
      const tabs = (await browser.tabs.query({ windowId, groupId: g.id })).sort((a, b) => a.index - b.index);
      const sorted = [...tabs].sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { numeric: true }));
      if (sorted.every((t, i) => t.id === tabs[i].id)) continue;
      await browser.tabs.move(sorted.map((t) => t.id), { index: tabs[0].index });
      const strays = (await Promise.all(sorted.map((t) => browser.tabs.get(t.id)))).filter((t) => t.groupId !== g.id);
      if (strays.length) await browser.tabs.group({ tabIds: strays.map((t) => t.id), groupId: g.id });
    }
    return `Sorted ${plural(groups.length, "group")}`;
  },

  async collapse_all(windowId, except = "") {
    const keep = except.trim().toLowerCase();
    const groups = await browser.tabGroups.query({ windowId });
    for (const g of groups) {
      const collapse = !keep || (g.title || "").toLowerCase() !== keep;
      if (g.collapsed !== collapse) await HANDLERS.update_group({ group_id: g.id, collapsed: collapse });
    }
    return "Collapsed";
  },

  async expand_group(windowId, name = "") {
    const groups = await browser.tabGroups.query({ windowId });
    const g = groups.find((x) => (x.title || "").toLowerCase() === name.trim().toLowerCase());
    if (!g) throw new Error(`no group called ${name}`);
    await HANDLERS.update_group({ group_id: g.id, collapsed: false });
    return `Opened ${g.title}`;
  },

  async switch_to(windowId, text = "") {
    const needle = text.trim().toLowerCase();
    const tab = (await browser.tabs.query({ windowId })).find((t) => (t.title || "").toLowerCase().includes(needle));
    if (!needle || !tab) throw new Error(`no tab titled like ${text}`);
    await HANDLERS.activate_tab({ tab_id: tab.id });
    return "Switched";
  },

  async close_duplicates(windowId) {
    const dupes = await findDuplicates(windowId);
    if (!dupes.length) return "No duplicates";
    await HANDLERS.close_tabs({ tab_ids: dupes.map((t) => t.id) });
    return `Closed ${plural(dupes.length, "duplicate")}`;
  },
};

const ACTION_LABELS = {
  apply_rules: "Applying your rules",
  group_by_site: "Grouping by website",
  sort_groups: "Sorting your groups",
  collapse_all: "Collapsing groups",
  collapse_all_except: "Collapsing groups",
  expand_group: "Opening a group",
  switch_to: "Finding your tab",
  close_duplicates: "Closing duplicates",
};

// "Organise with Claude": the native host runs Claude Code headless with only the grouping
// tools; its changes come back through the bridge, so Kit narrates them as they happen.
const Organiser = { running: null, last: null };

async function organiseWithClaude(instructions = "") {
  if (Organiser.running) return Organiser.running.promise;
  if (!port) throw new Error("The bridge isn't running, so Claude can't be started.");
  const windowId = await focusedWindowId();
  const run = { run_id: Date.now() };
  run.promise = new Promise((resolve) => (run.resolve = resolve)).then((r) => {
    Organiser.running = null;
    Organiser.last = { ok: r.ok, summary: r.summary, at: Date.now() };
    Mascot.end(r.ok, "All organised");
    if (!r.ok) throw new Error(r.summary);
    return r.summary;
  });
  Organiser.running = run;
  Mascot.begin(windowId, "Thinking about your tabs…");
  port.postMessage({ type: "organise", run_id: run.run_id, instructions: String(instructions).slice(0, 500) });
  return run.promise;
}

function onHostEvent(msg) {
  const run = Organiser.running;
  if (!run) return;
  if (msg.event === "organise_done" && msg.run_id === run.run_id) run.resolve(msg);
  if (msg.event === "disconnected") run.resolve({ ok: false, summary: "The bridge disconnected while Claude was working." });
}

// Same page open more than once (ignoring #fragments): keep the active or most recent copy.
async function findDuplicates(windowId) {
  const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned && /^https?:|^file:/.test(t.url));
  const byUrl = new Map();
  for (const t of tabs) {
    const key = t.url.split("#")[0];
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(t);
  }
  const extra = [];
  for (const copies of byUrl.values()) {
    if (copies.length < 2) continue;
    copies.sort((a, b) => (b.active - a.active) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
    extra.push(...copies.slice(1));
  }
  return extra.map((t) => ({ id: t.id, title: t.title, url: t.url }));
}

// Proposes rules that reproduce the window's current groups: a website rule when 2+ of a group's
// tabs share a site no other group uses, else a title word only that group's tabs share, else
// the site or exact address.
async function suggestRules(windowId) {
  const STOP = new Set(["google", "drive", "docs", "http", "https", "html", "with", "from", "this", "that", "home", "page", "edit", "view", "pdf"]);
  const words = (title) => new Set((title || "").split(/[^A-Za-z0-9]+/).map((w) => w.replace(/\d+/g, "").toLowerCase())
    .filter((w) => w.length >= 4 && !STOP.has(w)));
  const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned);
  const groups = await browser.tabGroups.query({ windowId });
  const rules = [];
  for (const g of groups) {
    const mine = tabs.filter((t) => t.groupId === g.id);
    const others = tabs.filter((t) => t.groupId !== -1 && t.groupId !== g.id);
    const base = { group: g.title || "Group", color: g.color };
    let left = [...mine];
    const siteRule = (host) => {
      rules.push({ field: "site", text: host, ...base });
      left = left.filter((t) => hostOf(t.url) !== host);
    };
    const exclusive = (host) => host && !others.some((t) => hostOf(t.url) === host);
    for (const host of new Set(mine.map((t) => hostOf(t.url)))) {
      if (exclusive(host) && mine.filter((t) => hostOf(t.url) === host).length >= 2) siteRule(host);
    }
    const otherWords = new Set(others.flatMap((t) => [...words(t.title)]));
    while (left.length) {
      const counts = new Map();
      for (const t of left) for (const w of words(t.title)) if (!otherWords.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
      const best = [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
      if (!best) break;
      rules.push({ field: "title", text: best[0], ...base });
      left = left.filter((t) => !words(t.title).has(best[0]));
    }
    for (const host of new Set(left.map((t) => hostOf(t.url)))) if (exclusive(host)) siteRule(host);
    for (const t of left) rules.push({ field: "url", text: t.url.split("#")[0], ...base });
  }
  return rules;
}

async function runList(index) {
  const { lists } = await loadSettings();
  const list = lists[index];
  if (!list) throw new Error("that list no longer exists");
  const windowId = await focusedWindowId();
  return withKit(windowId, `Running ${list.name || "your list"}`, async () => {
    for (const step of list.steps || []) {
      if (step.type === "collapse_all_except") await ACTIONS.collapse_all(windowId, step.arg || "");
      else if (step.type === "organise_with_claude") await organiseWithClaude(step.arg || "");
      else if (ACTIONS[step.type]) await ACTIONS[step.type](windowId, step.arg || "");
    }
    return `${list.name || "List"} done`;
  });
}

browser.runtime.onMessage.addListener(async (msg) => {
  const windowId = await focusedWindowId();
  switch (msg && msg.cmd) {
    case "status":
      return {
        connected: port !== null,
        lists: (await loadSettings()).lists.map((l) => l.name || "Untitled list"),
        organise: { running: !!Organiser.running, last: Organiser.last },
      };
    case "organise":
      return organiseWithClaude(msg.instructions || "");
    case "hi": {
      const [tab] = await browser.tabs.query({ active: true, windowId });
      if (tab) Mascot.demo(tab);
      return "Hi!";
    }
    case "action":
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, msg.action)) throw new Error("unknown action");
      return withKit(windowId, ACTION_LABELS[msg.action], () => ACTIONS[msg.action](windowId, msg.arg || ""));
    case "find_duplicates":
      return findDuplicates(windowId);
    case "close_tabs":
      return withKit(windowId, `Closing ${plural(msg.tab_ids.length, "tab")}`, async () => {
        await HANDLERS.close_tabs({ tab_ids: msg.tab_ids });
        return `Closed ${plural(msg.tab_ids.length, "tab")}`;
      });
    case "run_list":
      return runList(msg.index);
    case "suggest_rules":
      return suggestRules(windowId);
    case "step_types":
      return STEP_TYPES;
    default:
      throw new Error("unknown command");
  }
});
