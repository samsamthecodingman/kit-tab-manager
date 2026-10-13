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
  organise_with_claude: { label: "Organise with AI", arg: "anything specific? (optional)" },
};

async function loadSettings() {
  const s = await browser.storage.local.get(["rules", "lists"]);
  return { rules: Array.isArray(s.rules) ? s.rules : [], lists: Array.isArray(s.lists) ? s.lists : [] };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

// "Website is" rules accept what people paste: https://www.github.com/ means github.com.
function siteOf(text) {
  return text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/[/?#:].*$/, "");
}

function ruleMatches(rule, tab) {
  let needle = String(rule.text || "").trim().toLowerCase();
  if (rule.field === "site") needle = siteOf(needle);
  if (!needle) return false;
  if (rule.field === "site") {
    const host = hostOf(tab.url);
    return host === needle || host.endsWith("." + needle);
  }
  return ((rule.field === "url" ? tab.url : tab.title) || "").toLowerCase().includes(needle);
}

// Group-by-website works per site, not per address: mail.google.com and docs.google.com are both
// "Google". The site is the last two parts of the host name, or three for addresses like
// bbc.co.uk and abc.net.au.
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go"]);
function siteKey(host) {
  const parts = host.split(".");
  if (parts.length > 2 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

const SITE_NAMES = {
  github: "GitHub", gitlab: "GitLab", youtube: "YouTube", linkedin: "LinkedIn", stackoverflow: "Stack Overflow",
  reddit: "Reddit", wikipedia: "Wikipedia", chatgpt: "ChatGPT", openai: "OpenAI", paypal: "PayPal",
  ebay: "eBay", bbc: "BBC", nytimes: "NY Times", stackexchange: "Stack Exchange", whatsapp: "WhatsApp",
};
function siteName(key) {
  const label = key.split(".")[0];
  return SITE_NAMES[label] || (/^\d/.test(label) ? key : label.charAt(0).toUpperCase() + label.slice(1));
}

// What a tidy-up would do, without doing it: for the counts on the menu's buttons.
async function previews(windowId) {
  const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned);
  const { rules } = await loadSettings();
  const loose = tabs.filter((t) => t.groupId === -1);
  const bySite = new Map();
  for (const t of loose) {
    const host = hostOf(t.url);
    if (!host || !/^https?:/.test(t.url)) continue;
    const key = siteKey(host);
    bySite.set(key, (bySite.get(key) || 0) + 1);
  }
  const siteGroups = [...bySite.values()].filter((n) => n >= 2);
  const groups = await browser.tabGroups.query({ windowId });
  return {
    rules: rules.length,
    apply_rules: loose.filter((t) => rules.some((r) => r.group && ruleMatches(r, t))).length,
    group_by_site: { tabs: siteGroups.reduce((a, b) => a + b, 0), groups: siteGroups.length },
    groups: groups.length,
    expanded: groups.filter((g) => !g.collapsed).length,
    duplicates: (await findDuplicates(windowId)).length,
  };
}

// Undo for the last tidy-up, list or organise: a snapshot of which group every tab was in, the
// groups' names, colours and collapsed state, and the tab order. Closed tabs can't come back this
// way (History > Recently Closed Tabs can), so closing clears it.
const Undo = { snap: null };

async function snapshot(windowId, label) {
  const [tabs, groups] = await Promise.all([browser.tabs.query({ windowId }), browser.tabGroups.query({ windowId })]);
  Undo.snap = {
    windowId, label, at: Date.now(),
    tabs: tabs.map((t) => ({ id: t.id, groupId: t.groupId, index: t.index, pinned: t.pinned })),
    groups: groups.map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed })),
  };
}

async function undoLast() {
  const snap = Undo.snap;
  if (!snap) throw new Error("Nothing to undo");
  Undo.snap = null;
  const { windowId } = snap;
  const open = new Map((await browser.tabs.query({ windowId })).map((t) => [t.id, t]));
  const tabs = snap.tabs.filter((t) => open.has(t.id) && !t.pinned);
  // Out of every group first, then back into the old ones (re-made if they were removed).
  const grouped = tabs.filter((t) => open.get(t.id).groupId !== -1).map((t) => t.id);
  if (grouped.length) await browser.tabs.ungroup(grouped);
  const liveGroups = new Set((await browser.tabGroups.query({ windowId })).map((g) => g.id));
  for (const g of snap.groups) {
    const ids = tabs.filter((t) => t.groupId === g.id).map((t) => t.id);
    if (!ids.length) continue;
    const gid = await browser.tabs.group(liveGroups.has(g.id) ? { tabIds: ids, groupId: g.id } : { tabIds: ids, createProperties: { windowId } });
    await browser.tabGroups.update(gid, { title: g.title, color: g.color });
  }
  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    try { await browser.tabs.move(t.id, { index: t.index }); } catch (e) { /* the window changed shape; best effort */ }
  }
  // Moving can pull a tab into a neighbouring group; put strays back, then restore collapsed states.
  const now = await browser.tabs.query({ windowId });
  const byTitle = new Map((await browser.tabGroups.query({ windowId })).map((g) => [g.title, g.id]));
  for (const t of tabs) {
    const want = t.groupId === -1 ? -1 : byTitle.get((snap.groups.find((g) => g.id === t.groupId) || {}).title);
    const cur = now.find((x) => x.id === t.id);
    if (!cur || want === undefined || cur.groupId === want) continue;
    if (want === -1) await browser.tabs.ungroup([t.id]);
    else await browser.tabs.group({ tabIds: [t.id], groupId: want });
  }
  for (const g of snap.groups) {
    const gid = byTitle.get(g.title);
    if (gid !== undefined) await browser.tabGroups.update(gid, { collapsed: g.collapsed }).catch(() => {});
  }
  return `Undid ${snap.label.toLowerCase()}`;
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
    // Only loose tabs: a tab you've put in a group yourself stays where you put it.
    const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned && t.groupId === -1);
    const buckets = new Map();
    for (const tab of tabs) {
      const rule = rules.find((r) => r.group && ruleMatches(r, tab));
      if (!rule) continue;
      const key = rule.group.trim().toLowerCase();
      if (!buckets.has(key)) buckets.set(key, { title: rule.group.trim(), color: rule.color, ids: [] });
      buckets.get(key).ids.push(tab.id);
    }
    let moved = 0;
    for (const b of buckets.values()) { await intoGroup(windowId, b.title, b.color, b.ids); moved += b.ids.length; }
    return moved ? `Sorted ${plural(moved, "tab")}` : "No loose tabs match your rules";
  },

  async group_by_site(windowId) {
    const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned && t.groupId === -1);
    const bySite = new Map();
    for (const t of tabs) {
      const host = hostOf(t.url);
      if (!host || !/^https?:/.test(t.url)) continue;
      const key = siteKey(host);
      if (!bySite.has(key)) bySite.set(key, []);
      bySite.get(key).push(t.id);
    }
    let made = 0, grouped = 0;
    for (const [key, ids] of bySite) {
      if (ids.length < 2) continue;
      const hash = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      await intoGroup(windowId, siteName(key), GROUP_COLORS[hash % GROUP_COLORS.length], ids);
      made++;
      grouped += ids.length;
    }
    return made ? `Grouped ${plural(grouped, "tab")} into ${plural(made, "site group")}` : "No site has 2 or more loose tabs";
  },

  async sort_groups(windowId) {
    const groups = await browser.tabGroups.query({ windowId });
    if (!groups.length) return "No groups to sort";
    let changed = 0;
    for (const g of groups) {
      const tabs = (await browser.tabs.query({ windowId, groupId: g.id })).sort((a, b) => a.index - b.index);
      const sorted = [...tabs].sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { numeric: true }));
      if (sorted.every((t, i) => t.id === tabs[i].id)) continue;
      changed++;
      await browser.tabs.move(sorted.map((t) => t.id), { index: tabs[0].index });
      const strays = (await Promise.all(sorted.map((t) => browser.tabs.get(t.id)))).filter((t) => t.groupId !== g.id);
      if (strays.length) await browser.tabs.group({ tabIds: strays.map((t) => t.id), groupId: g.id });
    }
    return changed ? `Sorted ${plural(changed, "group")}` : "Already in order";
  },

  async collapse_all(windowId, except = "") {
    const keep = except.trim().toLowerCase();
    const groups = await browser.tabGroups.query({ windowId });
    if (!groups.length) return "No groups to collapse";
    let changed = 0;
    for (const g of groups) {
      const collapse = !keep || (g.title || "").toLowerCase() !== keep;
      if (g.collapsed !== collapse) { await HANDLERS.update_group({ group_id: g.id, collapsed: collapse }); changed++; }
    }
    return changed ? `Collapsed ${plural(changed, "group")}` : "Already collapsed";
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

// "Organise with AI": the companion app runs the assistant you picked (Claude Code, Codex or
// Hermes Agent) unattended, locked to the grouping tools; its changes come back through the bridge,
// so Kit narrates them as they happen. There's no default assistant: the choice is remembered.
const Organiser = { running: null, last: null };

// AI assistants, as the companion app reports them: [{id, name, installed, connected, can_organise}].
const Agents = { list: null, at: 0, pending: new Map(), next: 1 };

function askHost(type, extra = {}, timeoutMs = 150000) {
  if (!bridgeReady) return Promise.resolve(null);
  const req = Agents.next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { Agents.pending.delete(req); reject(new Error("Kit's companion app didn't answer")); }, timeoutMs);
    Agents.pending.set(req, (msg) => { clearTimeout(timer); resolve(msg); });
    port.postMessage({ type, req, ...extra });
  });
}

async function agentList(refresh = false) {
  if (!bridgeReady) return [];
  if (refresh || !Agents.list || Date.now() - Agents.at > 60000) {
    const msg = await askHost("agents");
    if (msg && Array.isArray(msg.agents)) { Agents.list = msg.agents; Agents.at = Date.now(); }
  }
  return Agents.list || [];
}

// Connected, can organise, and not known to be signed out (null: Kit can't tell, so let it try).
function canOrganiseNow(a) {
  return a.connected && a.can_organise && a.signed_in !== false;
}

async function chosenAgent(requested) {
  const list = await agentList();
  const usable = list.filter(canOrganiseNow);
  const saved = requested || (await browser.storage.local.get("organiseAgent")).organiseAgent;
  if (saved && usable.some((a) => a.id === saved)) return saved;
  const unsigned = list.find((a) => a.id === saved && a.connected && a.signed_in === false);
  if (unsigned) throw new Error(`${unsigned.name} isn't signed in yet. Open Kit's full page and press Sign in.`);
  if (usable.length === 1) return usable[0].id;
  if (!usable.length) throw new Error("Connect Claude Code, Codex or Hermes Agent to use Organise with AI: see Kit's full page.");
  throw new Error("Choose which assistant should organise your tabs.");
}

// Each group's title, colour and tab count, to show what a run changed.
async function groupSnapshot(windowId) {
  const [groups, tabs] = await Promise.all([browser.tabGroups.query({ windowId }), browser.tabs.query({ windowId })]);
  return groups.map((g) => ({ id: g.id, title: g.title, color: g.color, count: tabs.filter((t) => t.groupId === g.id).length }));
}

// New groups, and groups that gained tabs, biggest first.
function groupChanges(before, after) {
  const was = new Map(before.map((g) => [g.id, g]));
  return after
    .map((g) => {
      const old = was.get(g.id);
      return { title: g.title, color: g.color, count: g.count, created: !old, added: g.count - (old ? old.count : 0) };
    })
    .filter((g) => g.count > 0 && (g.created || g.added > 0))
    .sort((a, b) => b.count - a.count);
}

function organiseWithClaude(instructions = "", requestedAgent = "") {
  if (Organiser.running) return Organiser.running.promise;
  if (!bridgeReady) return Promise.reject(new Error("Connect an AI assistant first: open Kit's full page for the one-line setup."));
  // Claim the run straight away, so a second click (menu and full page together) joins this one.
  const run = { run_id: Date.now() };
  const done = new Promise((resolve) => (run.resolve = resolve));
  Organiser.running = run;
  run.promise = (async () => {
    let windowId, agentName, before;
    try {
      const agent = await chosenAgent(requestedAgent);
      await browser.storage.local.set({ organiseAgent: agent });
      windowId = await focusedWindowId();
      agentName = ((await agentList()).find((a) => a.id === agent) || {}).name || "";
      before = await groupSnapshot(windowId).catch(() => []);
      await snapshot(windowId, "Organise with AI").catch(() => {});
      if (!port) throw new Error("Kit's companion app isn't running.");
      port.postMessage({ type: "organise", run_id: run.run_id, agent, instructions: String(instructions).slice(0, 500) });
    } catch (e) {
      Organiser.running = null; // nothing started
      throw e;
    }
    Mascot.begin(windowId, "Thinking about your tabs…");
    const r = await done;
    Organiser.running = null;
    const changes = groupChanges(before, await groupSnapshot(windowId).catch(() => before));
    Organiser.last = { ok: r.ok, summary: r.summary, at: Date.now(), agent: agentName, changes };
    Mascot.end(r.ok, "All organised");
    if (!r.ok) throw new Error(r.summary);
    return r.summary;
  })();
  return run.promise;
}

function onHostEvent(msg) {
  if (msg.event === "agents") {
    const done = Agents.pending.get(msg.req);
    Agents.pending.delete(msg.req);
    if (done) done(msg);
    return;
  }
  if (msg.event === "disconnected") {
    // Anything still waiting on the companion app gets no answer now.
    for (const answer of Agents.pending.values()) answer(null);
    Agents.pending.clear();
  }
  const run = Organiser.running;
  if (!run) return;
  if (msg.event === "organise_done" && msg.run_id === run.run_id) run.resolve(msg);
  if (msg.event === "disconnected") run.resolve({ ok: false, summary: "Kit's companion app disconnected while organising." });
}

// Same page open more than once: keep the active or most recent copy. #fragments are ignored,
// except app routes like #/inbox; copies in different containers (work and personal) aren't duplicates.
async function findDuplicates(windowId) {
  const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned && /^https?:|^file:/.test(t.url));
  const byUrl = new Map();
  for (const t of tabs) {
    const [page, fragment = ""] = t.url.split(/#(.*)/s);
    const key = `${t.cookieStoreId || ""} ${/^[/!]/.test(fragment) ? t.url : page}`;
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
  const words = (title) => new Set((title || "").split(/[^A-Za-z]+/).map((w) => w.toLowerCase())
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

// name: the list's name when its button was drawn, in case lists were edited since.
async function runList(index, name) {
  const { lists } = await loadSettings();
  const sameName = (l) => name === undefined || ((l && l.name) || "Untitled list") === name || (l && l.name) === name;
  const list = sameName(lists[index]) ? lists[index] : lists.find(sameName);
  if (!list) throw new Error("that list no longer exists");
  const windowId = await focusedWindowId();
  // Check before changing anything, rather than stopping halfway.
  if ((list.steps || []).some((s) => s.type === "organise_with_claude") && !bridgeReady) {
    throw new Error(`${list.name || "This list"} has an Organise with AI step, which needs AI set up (see Kit's full page).`);
  }
  await snapshot(windowId, list.name || "your list");
  return withKit(windowId, `Running ${list.name || "your list"}`, async () => {
    for (const step of list.steps || []) {
      if (step.type === "close_duplicates") Undo.snap = null; // closed tabs can't be undone here
      if (step.type === "collapse_all_except") await ACTIONS.collapse_all(windowId, step.arg || "");
      else if (step.type === "organise_with_claude") await organiseWithClaude(step.arg || "");
      else if (ACTIONS[step.type]) await ACTIONS[step.type](windowId, STEP_TYPES[step.type] && STEP_TYPES[step.type].arg ? step.arg || "" : "");
    }
    return `${list.name || "List"} done`;
  });
}

browser.runtime.onMessage.addListener(async (msg) => {
  const windowId = await focusedWindowId();
  switch (msg && msg.cmd) {
    case "status":
      return {
        connected: bridgeReady,
        lists: (await loadSettings()).lists.map((l) => l.name || "Untitled list"),
        organise: { running: !!Organiser.running, last: Organiser.last },
        undo: Undo.snap && Undo.snap.windowId === windowId ? Undo.snap.label : null,
      };
    case "previews":
      return previews(windowId);
    case "undo": {
      const label = Undo.snap ? Undo.snap.label : "";
      return withKit(Undo.snap ? Undo.snap.windowId : windowId, `Undoing ${label.toLowerCase()}`, undoLast);
    }
    case "rule_counts": {
      const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.pinned);
      return (Array.isArray(msg.rules) ? msg.rules : []).map((r) => (r && r.group ? tabs.filter((t) => ruleMatches(r, t)).length : 0));
    }
    case "dismiss_result":
      Organiser.last = null;
      return null;
    case "organise":
      return organiseWithClaude(msg.instructions || "", msg.agent || "");
    case "agents": {
      const list = await agentList(!!msg.refresh);
      const { organiseAgent } = await browser.storage.local.get("organiseAgent");
      return { agents: list, chosen: organiseAgent || null };
    }
    case "choose_agent":
      await browser.storage.local.set({ organiseAgent: msg.id });
      return true;
    case "connect_agent":
    case "sign_in": {
      // Signing in waits for you to finish in the browser, so it gets longer than other requests.
      const reply = await askHost(msg.cmd, { id: msg.id }, msg.cmd === "sign_in" ? 11 * 60 * 1000 : 150000);
      if (!reply) throw new Error("Kit's companion app isn't running.");
      if (Array.isArray(reply.agents)) { Agents.list = reply.agents; Agents.at = Date.now(); }
      if (!reply.result.ok) throw new Error(reply.result.message);
      if (msg.cmd === "sign_in") { // the menu has usually closed by now, so Kit says it
        const [tab] = await browser.tabs.query({ active: true, windowId: await focusedWindowId() });
        if (tab) { Mascot.begin(tab.windowId, reply.result.message); Mascot.end(true, "Ready to organise"); }
      }
      return { agents: Agents.list || [], message: reply.result.message };
    }
    case "hi": {
      const [tab] = await browser.tabs.query({ active: true, windowId });
      if (tab) Mascot.demo(tab);
      return "Hi!";
    }
    case "action":
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, msg.action)) throw new Error("unknown action");
      if (msg.action === "close_duplicates") Undo.snap = null;
      else await snapshot(windowId, STEP_TYPES[msg.action] ? STEP_TYPES[msg.action].label : "tidy-up");
      return withKit(windowId, ACTION_LABELS[msg.action], () => ACTIONS[msg.action](windowId, msg.arg || ""));
    case "find_duplicates":
      return findDuplicates(windowId);
    case "overview": {
      const tabs = (await browser.tabs.query({ windowId })).filter((t) => !t.url.startsWith(browser.runtime.getURL("")));
      const groups = await browser.tabGroups.query({ windowId });
      return {
        tabs: tabs.length,
        groups: groups.length,
        loose: tabs.filter((t) => !t.pinned && t.groupId === -1).length,
        duplicates: (await findDuplicates(windowId)).length,
      };
    }
    case "close_tabs":
      Undo.snap = null;
      return withKit(windowId, `Closing ${plural(msg.tab_ids.length, "tab")}`, async () => {
        await HANDLERS.close_tabs({ tab_ids: msg.tab_ids });
        return `Closed ${plural(msg.tab_ids.length, "tab")}`;
      });
    case "run_list":
      return runList(msg.index, msg.name);
    case "suggest_rules":
      return suggestRules(windowId);
    case "step_types":
      return STEP_TYPES;
    default:
      throw new Error("unknown command");
  }
});
