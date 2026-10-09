// Kit: answers requests from its companion app (native host "tab_bridge", kit.py).
// Every request is {id, method, params}; every reply is {id, result} or {id, error}.
// Nothing here clicks, types, navigates to new addresses or submits forms.

const HOST = "tab_bridge";
const GROUP_COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple", "grey"];

let port = null;
let bridgeReady = false; // true once the companion app has answered; the AI features are optional

function setConnected(ready) {
  bridgeReady = ready;
  browser.browserAction.setTitle({ title: ready ? "Kit: AI assistant connected" : "Kit" });
}

function connect() {
  port = browser.runtime.connectNative(HOST);
  port.postMessage({ type: "ping" }); // the app answers "pong"; if it isn't installed, the port just disconnects
  const own = port; // replies go back on the port the request came in on, even if it has since dropped
  const reply = (m) => { try { own.postMessage(m); } catch (e) { /* the companion app went away */ } };
  port.onMessage.addListener(async (msg) => {
    if (msg && msg.event === "pong") return setConnected(true);
    if (msg && msg.event) return onHostEvent(msg); // e.g. "Organise with AI" finished
    const { id, method, params } = msg || {};
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, method) ? HANDLERS[method] : null;
    const animated = handler && ANIMATED.has(method);
    if (animated) await Mascot.start(method, params || {});
    let ok = false;
    try {
      if (!handler) throw new Error(`unknown method ${method}`);
      reply({ id, result: await handler(params || {}) });
      ok = true;
    } catch (e) {
      reply({ id, error: String((e && e.message) || e) });
    } finally {
      if (animated) Mascot.end(ok);
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setConnected(false);
    onHostEvent({ event: "disconnected" });
    setTimeout(connect, 5000);
  });
}

function tabSummary(t) {
  return {
    id: t.id,
    window_id: t.windowId,
    index: t.index,
    title: t.title,
    url: t.url,
    active: t.active,
    pinned: t.pinned,
    unloaded: !!t.discarded,
    group_id: t.groupId === undefined || t.groupId === -1 ? null : t.groupId,
    last_accessed: t.lastAccessed ? new Date(t.lastAccessed).toISOString() : null,
  };
}

function ids(list, name = "tab_ids") {
  if (!Array.isArray(list) || list.length === 0 || !list.every(Number.isInteger)) {
    throw new Error(`${name} must be a non-empty list of tab ids`);
  }
  return list;
}

// Private windows are off limits: every request that names tabs, groups or windows checks first.
async function publicTabs(list) {
  const tabs = await Promise.all(ids(list).map((id) => browser.tabs.get(id)));
  if (tabs.some((t) => t.incognito)) throw new Error("tabs in private windows are off limits");
  return tabs;
}

async function publicWindow(windowId) {
  if ((await browser.windows.get(windowId)).incognito) throw new Error("private windows are off limits");
}

async function publicGroup(groupId) {
  await publicWindow((await browser.tabGroups.get(groupId)).windowId);
}

async function publicWindowIds() {
  return new Set((await browser.windows.getAll()).filter((w) => !w.incognito).map((w) => w.id));
}

function checkColor(color) {
  if (color !== undefined && color !== null && !GROUP_COLORS.includes(color)) {
    throw new Error(`color must be one of: ${GROUP_COLORS.join(", ")}`);
  }
}

function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { browser.tabs.onUpdated.removeListener(onUpdated); reject(new Error("the tab took too long to load")); }, timeoutMs);
    function onUpdated(id, change) {
      if (id === tabId && change.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

// Runs inside the page. Prefers the main content over navigation and footers, but falls back
// to the whole body when the marked region is empty or hidden (Google search has one).
const EXTRACT = `(() => {
  const bodyText = document.body ? document.body.innerText : "";
  let best = "";
  for (const el of document.querySelectorAll("main, article, [role=main]")) {
    const t = el.innerText || "";
    if (t.length > best.length) best = t;
  }
  const raw = best.trim().length >= 200 || best.length >= bodyText.length / 4 ? best : bodyText;
  const text = raw.replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text };
})()`;

const HANDLERS = {
  async ping() {
    return { ok: true, firefox: (await browser.runtime.getBrowserInfo()).version };
  },

  async list_tabs() {
    const [tabs, wins] = await Promise.all([browser.tabs.query({}), browser.windows.getAll()]);
    return {
      windows: wins.filter((w) => !w.incognito).map((w) => ({ id: w.id, focused: w.focused })),
      tabs: tabs.filter((t) => !t.incognito).map(tabSummary),
    };
  },

  async list_groups() {
    const [groups, open] = await Promise.all([browser.tabGroups.query({}), publicWindowIds()]);
    return groups.filter((g) => open.has(g.windowId)).map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed, window_id: g.windowId }));
  },

  async group_tabs({ tab_ids, group_id, title, color }) {
    checkColor(color);
    await publicTabs(tab_ids);
    const opts = { tabIds: tab_ids };
    if (group_id !== undefined && group_id !== null) {
      await publicGroup(group_id);
      opts.groupId = group_id;
    }
    const gid = await browser.tabs.group(opts);
    const update = {};
    if (title !== undefined && title !== null) update.title = String(title);
    if (color) update.color = color;
    if (Object.keys(update).length) await browser.tabGroups.update(gid, update);
    return { group_id: gid };
  },

  async ungroup_tabs({ tab_ids }) {
    await publicTabs(tab_ids);
    await browser.tabs.ungroup(tab_ids);
    return { ok: true };
  },

  async update_group({ group_id, title, color, collapsed }) {
    checkColor(color);
    await publicGroup(group_id);
    const update = {};
    if (title !== undefined && title !== null) update.title = String(title);
    if (color) update.color = color;
    if (typeof collapsed === "boolean") update.collapsed = collapsed;
    const g = await browser.tabGroups.update(group_id, update);
    return { id: g.id, title: g.title, color: g.color, collapsed: g.collapsed };
  },

  async move_tabs({ tab_ids, index, window_id }) {
    const opts = { index: Number.isInteger(index) ? index : -1 };
    await publicTabs(tab_ids);
    if (Number.isInteger(window_id)) {
      await publicWindow(window_id);
      opts.windowId = window_id;
    }
    const moved = await browser.tabs.move(tab_ids, opts);
    return (Array.isArray(moved) ? moved : [moved]).map(tabSummary);
  },

  async activate_tab({ tab_id }) {
    await publicTabs([tab_id]);
    const t = await browser.tabs.update(tab_id, { active: true });
    await browser.windows.update(t.windowId, { focused: true });
    return tabSummary(t);
  },

  async close_tabs({ tab_ids }) {
    // Tabs that are already gone are skipped rather than failing the whole request.
    const found = await Promise.allSettled(ids(tab_ids).map((id) => browser.tabs.get(id)));
    const tabs = found.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (tabs.some((t) => t.incognito)) throw new Error("tabs in private windows are off limits");
    if (!tabs.length) throw new Error("none of those tabs are open");
    await browser.tabs.remove(tabs.map((t) => t.id));
    return { closed: tabs.map((t) => ({ title: t.title, url: t.url })) };
  },

  async read_tab({ tab_id, max_chars, load }) {
    let tab = await browser.tabs.get(tab_id);
    if (tab.incognito) throw new Error("private-window tabs are not readable");
    if (tab.discarded) {
      if (!load) throw new Error("this tab is unloaded (Firefox put it to sleep). Call read_tab again with load=true to load it first.");
      const done = waitForLoad(tab_id);
      await browser.tabs.reload(tab_id);
      await done;
      tab = await browser.tabs.get(tab_id);
    }
    const unreadable = (detail) =>
      new Error(`Firefox would not let the extension read this tab (${tab.url}). Built-in pages (about:, the PDF viewer, addons.mozilla.org) cannot be read. Detail: ${detail}`);
    let out;
    try {
      [out] = await browser.tabs.executeScript(tab_id, { code: EXTRACT, runAt: "document_idle" });
    } catch (e) {
      throw unreadable((e && e.message) || e);
    }
    // Privileged pages can resolve with no result instead of rejecting.
    if (!out || typeof out.text !== "string") throw unreadable("the page returned no content");
    const limit = Number.isInteger(max_chars) && max_chars > 0 ? max_chars : 20000;
    const truncated = out.text.length > limit;
    return { title: out.title, url: out.url, chars: out.text.length, truncated, text: truncated ? out.text.slice(0, limit) : out.text };
  },
};

connect();
