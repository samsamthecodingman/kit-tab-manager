// Activity feedback for tab changes: Pixel (a little sprite carrying tabs) walks in from the
// right edge of the active page, the toolbar icon hops, and the window's tab bar is tinted until it is done.
// Purely cosmetic: every step swallows its own errors so it can never break a request.

const ANIMATED = new Set(["group_tabs", "ungroup_tabs", "update_group", "move_tabs", "close_tabs"]);
const WALK_SPEED = 100; // px per second: a stroll, not a sprint
const WALK_IN_MS = 1300;
const DONE_HOLD_MS = 1000;
// Tab-bar tint, one per scheme so a dark browser stays dark. With Firefox's built-in theme
// getCurrent() reports no colours, so the rest of that scheme's palette is filled in too;
// otherwise Firefox would fall back to light defaults for everything not set.
const TINT = {
  light: { frame: "#D97757", frame_inactive: "#C4673F", tab_background_text: "#2C2C2A" },
  dark: { frame: "#7A3B22", frame_inactive: "#5E2E1B", tab_background_text: "#FBFBFE" },
};
const BASE_PALETTE = {
  light: {
    toolbar: "#F9F9FB", toolbar_text: "#15141A", toolbar_field: "#FFFFFF", toolbar_field_text: "#15141A",
    tab_selected: "#FFFFFF", tab_text: "#15141A", popup: "#FFFFFF", popup_text: "#15141A",
    sidebar: "#FFFFFF", sidebar_text: "#15141A", ntp_background: "#F9F9FB", ntp_text: "#15141A",
  },
  dark: {
    toolbar: "#2B2A33", toolbar_text: "#FBFBFE", toolbar_field: "#1C1B22", toolbar_field_text: "#FBFBFE",
    tab_selected: "#42414D", tab_text: "#FBFBFE", popup: "#42414D", popup_text: "#FBFBFE",
    sidebar: "#38373F", sidebar_text: "#FBFBFE", ntp_background: "#2B2A33", ntp_text: "#FBFBFE",
  },
};

// Sprite on a 15 x 22 grid: [x, y, w, h, colour]. Tabs sway, eyes blink, the body hops.
const ORANGE = "#D97757", RUST = "#993C1D", INK = "#2C2C2A";
const SPRITE_TABS = [
  [2, 0, 11, 3, "#378ADD"], [3, 1, 5, 1, "#E6F1FB"],
  [1, 3, 13, 3, "#7F77DD"], [2, 4, 6, 1, "#EEEDFE"],
  [3, 6, 1, 2, RUST], [11, 6, 1, 2, RUST],
];
const SPRITE_BODY = [
  [3, 0, 7, 1, ORANGE], [2, 1, 9, 1, ORANGE], [1, 2, 11, 6, ORANGE], [2, 8, 9, 2, ORANGE],
  [0, 1, 1, 3, ORANGE], [12, 1, 1, 3, ORANGE],
  [3, 4, 1, 1, "#FFFFFF"], [8, 4, 1, 1, "#FFFFFF"], [5, 7, 3, 1, RUST],
];
const SPRITE_EYES = [[3, 4, 2, 2, INK], [8, 4, 2, 2, INK]];
const SPRITE_LEGS = [[3, 10, 2, 3, RUST], [8, 10, 2, 3, RUST]];
const SPRITE_STEP_A = [[3, 10, 2, 2, RUST], [8, 10, 2, 3, RUST]]; // left foot lifted
const SPRITE_STEP_B = [[3, 10, 2, 3, RUST], [8, 10, 2, 2, RUST]]; // right foot lifted

// Runs inside the page (stringified into executeScript). Builds everything with DOM calls,
// not innerHTML, so pages that enforce Trusted Types (Google) still accept it.
function pageMascot(cmd, text, sprite, speed) {
  const ID = "tab-bridge-mascot";
  const NS = "http://www.w3.org/2000/svg";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let host = document.getElementById(ID);
  const parts = () => host && host.shadowRoot && {
    walker: host.shadowRoot.querySelector(".walker"),
    bubble: host.shadowRoot.querySelector(".bubble"),
  };
  const width = () => document.documentElement.clientWidth || innerWidth;
  const restX = () => Math.max(8, width() - 84);
  const offX = () => width() + 40; // just past the right edge: Pixel walks in from there and back out
  const walkMs = () => ((offX() - restX()) / speed) * 1000;

  if (cmd === "leave") {
    if (!host || host.dataset.leaving) return;
    host.dataset.leaving = "1";
    const { walker } = parts();
    walker.classList.add("walking");
    const anim = reduce
      ? walker.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" })
      : walker.animate([{ transform: `translateX(${restX()}px)` }, { transform: `translateX(${offX()}px)` }],
          { duration: walkMs(), easing: "linear", fill: "forwards" });
    anim.onfinish = () => host.remove();
    return;
  }

  if (cmd === "say") {
    const p = parts();
    if (p) { p.bubble.textContent = text; p.bubble.classList.toggle("done", text === "Done" || text === "Bye!"); }
    return;
  }

  // cmd === "show"
  if (host && host.dataset.leaving) { host.remove(); host = null; }
  if (host) { parts().bubble.textContent = text; parts().bubble.classList.remove("done"); return; }

  host = document.createElement("div");
  host.id = ID;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;left:0;bottom:12px;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .walker{position:absolute;bottom:0;left:0;width:60px;height:88px}
    .bubble{position:absolute;right:0;bottom:96px;white-space:nowrap;font:500 12px/1.3 system-ui,sans-serif;
      padding:4px 9px;border-radius:9px;background:#FAECE7;color:#712B13;border:1px solid #F0997B}
    .bubble.done{background:#EAF3DE;color:#27500A;border-color:#97C459}
    svg{display:block;overflow:visible;shape-rendering:crispEdges}
    .walking svg{animation:hop .4s steps(1) infinite}
    .step-a,.step-b,.walking .legs{opacity:0}
    .walking .step-a{animation:legs .4s steps(1) infinite}
    .walking .step-b{animation:legs .4s steps(1) .2s infinite}
    .tabs{transform-origin:7.5px 8px;animation:sway 1.2s ease-in-out infinite}
    .walking .tabs{animation-duration:.6s}
    .eyes{transform-origin:7.5px 13px;animation:blink 3s infinite}
    @keyframes hop{0%{transform:translateY(0)}50%{transform:translateY(-3px)}}
    @keyframes legs{0%{opacity:1}50%{opacity:0}}
    @keyframes sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
    @keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
  const walker = document.createElement("div");
  walker.className = "walker walking";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "60");
  svg.setAttribute("height", "88");
  svg.setAttribute("viewBox", "0 0 15 22");
  const group = (cls, rects, dy = 0) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", cls);
    for (const [x, y, w, h, fill] of rects) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", x + (cls === "tabs" ? 0 : 1));
      r.setAttribute("y", y + dy);
      r.setAttribute("width", w);
      r.setAttribute("height", h);
      r.setAttribute("fill", fill);
      g.appendChild(r);
    }
    svg.appendChild(g);
  };
  group("tabs", sprite.tabs);
  group("body", sprite.body, 8);
  group("eyes", sprite.eyes, 8);
  group("legs", sprite.legs, 8);
  group("step-a", sprite.stepA, 8);
  group("step-b", sprite.stepB, 8);
  walker.append(bubble, svg);
  root.append(style, walker);
  (document.body || document.documentElement).appendChild(host);

  const anim = reduce
    ? walker.animate([{ opacity: 0, transform: `translateX(${restX()}px)` }, { opacity: 1, transform: `translateX(${restX()}px)` }],
        { duration: 300, fill: "forwards" })
    : walker.animate([{ transform: `translateX(${offX()}px)` }, { transform: `translateX(${restX()}px)` }],
        { duration: walkMs(), easing: "linear", fill: "forwards" });
  anim.onfinish = () => walker.classList.remove("walking");
}

const SPRITE = { tabs: SPRITE_TABS, body: SPRITE_BODY, eyes: SPRITE_EYES, legs: SPRITE_LEGS, stepA: SPRITE_STEP_A, stepB: SPRITE_STEP_B };

function pageCmd(tabId, cmd, text = "") {
  if (tabId === null) return;
  const code = `(${pageMascot})(${JSON.stringify(cmd)}, ${JSON.stringify(text)}, ${JSON.stringify(SPRITE)}, ${WALK_SPEED});`;
  browser.tabs.executeScript(tabId, { code }).catch(() => {}); // protected pages: icon and tint still show
}

// Toolbar icon: the sprite squeezed onto 16 x 16 (one tab instead of a stack), drawn at 16 and 32 px.
function iconFrame(size, alt) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const s = size / 16;
  const draw = (rects, dx, dy) => {
    for (const [x, y, w, h, fill] of rects) { ctx.fillStyle = fill; ctx.fillRect((x + dx) * s, (y + dy) * s, w * s, h * s); }
  };
  draw([[3, 0, 10, 2, "#378ADD"], [4, 0, 4, 1, "#E6F1FB"], [4, 2, 1, 1, RUST], [11, 2, 1, 1, RUST]], alt ? 1 : 0, 0);
  draw(SPRITE_BODY, 1, 3);
  draw(SPRITE_EYES, 1, 3);
  draw(alt ? SPRITE_STEP_B : SPRITE_STEP_A, 1, 3);
  return ctx.getImageData(0, 0, size, size);
}
const ICON_FRAMES = [false, true].map((alt) => ({ 16: iconFrame(16, alt), 32: iconFrame(32, alt) }));

const Mascot = {
  busy: 0,
  tabId: null,
  windowId: null,
  shownAt: 0,
  tinted: false,
  timer: null,
  iconTimer: null,

  async start(method, params) {
    try {
      const windowId = await targetWindow(params);
      const [active] = windowId === null ? [] : await browser.tabs.query({ active: true, windowId });
      this.begin(windowId, active ? active.id : null, await describe(method, params));
    } catch (e) {
      // cosmetic only
    }
  },

  // "Say hi" in the toolbar menu: a hello on the current tab without touching any tabs.
  demo(tab) {
    this.begin(tab.windowId, tab.id, "Hi! I'm Pixel");
    setTimeout(() => this.end(true, "Bye!"), WALK_IN_MS + 1500);
  },

  begin(windowId, tabId, label) {
    this.busy++;
    clearTimeout(this.timer);
    if (this.tabId !== null && this.tabId !== tabId) pageCmd(this.tabId, "leave");
    if (this.windowId !== null && this.windowId !== windowId) this.untint();
    if (this.tabId !== tabId) { this.tabId = tabId; this.shownAt = Date.now(); }
    this.windowId = windowId;
    pageCmd(tabId, "show", label);
    this.tint();
    this.animateIcon(true);
  },

  end(ok, doneText = "Done") {
    if (this.busy === 0 || --this.busy > 0) return;
    const wait = Math.max(0, this.shownAt + WALK_IN_MS - Date.now());
    this.timer = setTimeout(() => {
      pageCmd(this.tabId, "say", ok ? doneText : "That didn't work");
      this.timer = setTimeout(() => this.finish(), DONE_HOLD_MS);
    }, wait);
  },

  finish() {
    pageCmd(this.tabId, "leave");
    this.untint();
    this.animateIcon(false);
    this.tabId = null;
    this.windowId = null;
  },

  async tint() {
    if (this.tinted || this.windowId === null) return;
    this.tinted = true;
    try {
      // Read the scheme before tinting: this page follows the browser's current light/dark mode.
      const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const current = (await browser.theme.getCurrent(this.windowId)) || {};
      const set = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined));
      const own = set(current.colors);
      const builtIn = Object.keys(own).length === 0;
      const theme = { colors: { ...(builtIn ? BASE_PALETTE[scheme] : own), ...TINT[scheme] } };
      if (Object.keys(set(current.images)).length) theme.images = set(current.images);
      // Pin both the browser UI and web pages to the scheme in use, so pages don't flip to light.
      theme.properties = { ...set(current.properties), color_scheme: scheme, content_color_scheme: scheme };
      await browser.theme.update(this.windowId, theme);
    } catch (e) {
      this.tinted = false;
    }
  },

  untint() {
    if (!this.tinted) return;
    this.tinted = false;
    browser.theme.reset(this.windowId).catch(() => {});
  },

  animateIcon(on) {
    clearInterval(this.iconTimer);
    this.iconTimer = null;
    let frame = 0;
    const show = () => browser.browserAction.setIcon({ imageData: ICON_FRAMES[frame++ % 2] }).catch(() => {});
    if (on && !matchMedia("(prefers-reduced-motion: reduce)").matches) this.iconTimer = setInterval(show, 180);
    else show();
  },
};

async function targetWindow(params) {
  try {
    if (Array.isArray(params.tab_ids) && Number.isInteger(params.tab_ids[0])) return (await browser.tabs.get(params.tab_ids[0])).windowId;
    if (Number.isInteger(params.group_id)) return (await browser.tabGroups.get(params.group_id)).windowId;
  } catch (e) {
    // fall through to the focused window
  }
  try { return (await browser.windows.getLastFocused()).id; } catch (e) { return null; }
}

async function describe(method, p) {
  const n = Array.isArray(p.tab_ids) ? p.tab_ids.length : 0;
  const tabs = `${n} tab${n === 1 ? "" : "s"}`;
  const groupTitle = async (gid) => {
    try { return (await browser.tabGroups.get(gid)).title || "group"; } catch (e) { return "group"; }
  };
  switch (method) {
    case "group_tabs":
      if (p.title) return `Grouping ${tabs} → ${p.title}`;
      if (Number.isInteger(p.group_id)) return `Grouping ${tabs} → ${await groupTitle(p.group_id)}`;
      return `Grouping ${tabs}`;
    case "ungroup_tabs": return `Ungrouping ${tabs}`;
    case "move_tabs": return `Moving ${tabs}`;
    case "close_tabs": return `Closing ${tabs}`;
    case "update_group": {
      const t = await groupTitle(p.group_id);
      if (p.title) return `Renaming ${t} → ${p.title}`;
      if (p.collapsed === true) return `Collapsing ${t}`;
      if (p.collapsed === false) return `Expanding ${t}`;
      return `Recolouring ${t}`;
    }
    default: return "Tidying tabs";
  }
}

// A tint left over from a crash or reload would otherwise stick until Firefox restarts.
browser.theme.reset().catch(() => {});
Mascot.animateIcon(false);
