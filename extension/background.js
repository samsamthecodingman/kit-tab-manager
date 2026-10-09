// Tab Bridge: answers requests from the local native host ("tab_bridge").
// Every request is {id, method, params}; every reply is {id, result} or {id, error}.
// Nothing here clicks, types, navigates to new addresses or submits forms.

const HOST = "tab_bridge";
const GROUP_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple", "grey"];

let port = null;

function setBadge(connected) {
  browser.browserAction.setBadgeText({ text: connected ? "" : "off" });
  browser.browserAction.setTitle({ title: connected ? "Tab Bridge: connected" : "Tab Bridge: bridge not running" });
}

function connect() {
  port = browser.runtime.connectNative(HOST);
  setBadge(true);
  port.onMessage.addListener(async (msg) => {
    const { id, method, params } = msg || {};
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, method) ? HANDLERS[method] : null;
    try {
      if (!handler) throw new Error(`unknown method ${method}`);
      port.postMessage({ id, result: await handler(params || {}) });
    } catch (e) {
      port.postMessage({ id, error: String((e && e.message) || e) });
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setBadge(false);
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

// Runs inside the page. Prefers the main content over navigation and footers.
const EXTRACT = `(() => {
  const pick = document.querySelector("main, article, [role=main]") || document.body;
  const text = (pick ? pick.innerText : "").replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text };
})()`;

const HANDLERS = {
  async ping() {
    return { ok: true, firefox: (await browser.runtime.getBrowserInfo()).version };
  },

  async list_tabs() {
    const [tabs, wins] = await Promise.all([browser.tabs.query({}), browser.windows.getAll()]);
    return {
      windows: wins.map((w) => ({ id: w.id, focused: w.focused, incognito: w.incognito })),
      tabs: tabs.filter((t) => !t.incognito).map(tabSummary),
    };
  },

  async list_groups() {
    const groups = await browser.tabGroups.query({});
    return groups.map((g) => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed, window_id: g.windowId }));
  },

  async group_tabs({ tab_ids, group_id, title, color }) {
    checkColor(color);
    const opts = { tabIds: ids(tab_ids) };
    if (group_id !== undefined && group_id !== null) opts.groupId = group_id;
    const gid = await browser.tabs.group(opts);
    const update = {};
    if (title !== undefined && title !== null) update.title = String(title);
    if (color) update.color = color;
    if (Object.keys(update).length) await browser.tabGroups.update(gid, update);
    return { group_id: gid };
  },

  async ungroup_tabs({ tab_ids }) {
    await browser.tabs.ungroup(ids(tab_ids));
    return { ok: true };
  },

  async update_group({ group_id, title, color, collapsed }) {
    checkColor(color);
    const update = {};
    if (title !== undefined && title !== null) update.title = String(title);
    if (color) update.color = color;
    if (typeof collapsed === "boolean") update.collapsed = collapsed;
    const g = await browser.tabGroups.update(group_id, update);
    return { id: g.id, title: g.title, color: g.color, collapsed: g.collapsed };
  },

  async move_tabs({ tab_ids, index, window_id }) {
    const opts = { index: Number.isInteger(index) ? index : -1 };
    if (Number.isInteger(window_id)) opts.windowId = window_id;
    const moved = await browser.tabs.move(ids(tab_ids), opts);
    return (Array.isArray(moved) ? moved : [moved]).map(tabSummary);
  },

  async activate_tab({ tab_id }) {
    const t = await browser.tabs.update(tab_id, { active: true });
    await browser.windows.update(t.windowId, { focused: true });
    return tabSummary(t);
  },

  async close_tabs({ tab_ids }) {
    const list = ids(tab_ids);
    const tabs = await Promise.all(list.map((id) => browser.tabs.get(id)));
    await browser.tabs.remove(list);
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
    let out;
    try {
      [out] = await browser.tabs.executeScript(tab_id, { code: EXTRACT, runAt: "document_idle" });
    } catch (e) {
      throw new Error(`Firefox would not let the extension read this tab (${tab.url}). Built-in pages (about:, the PDF viewer, addons.mozilla.org) cannot be read. Detail: ${(e && e.message) || e}`);
    }
    const limit = Number.isInteger(max_chars) && max_chars > 0 ? max_chars : 20000;
    const truncated = out.text.length > limit;
    return { title: out.title, url: out.url, chars: out.text.length, truncated, text: truncated ? out.text.slice(0, limit) : out.text };
  },
};

connect();
