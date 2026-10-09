// Activity feedback for tab changes: Kit (a little pixel-art mascot) walks along the tab bar
// with a speech bubble, and the toolbar icon hops. Kit is drawn into the tab bar through a copy
// of the current theme, so it shows on every page (protected ones too) and colours stay the same.
// Purely cosmetic: every step swallows its own errors so it can never break a request.

const ANIMATED = new Set(["group_tabs", "ungroup_tabs", "update_group", "move_tabs", "close_tabs"]);
const WALK_SPEED = 100; // px per second: a stroll, not a sprint
// Firefox's built-in light and dark colours. With the built-in theme, getCurrent() reports no
// colours, so the tab-bar Kit's copy of the theme spells them out; anything left unset would
// fall back to light defaults and visibly change the browser.
const BASE_PALETTE = {
  light: {
    frame: "#F0F0F4", frame_inactive: "#EBEBEF", tab_background_text: "#15141A",
    toolbar: "#F9F9FB", toolbar_text: "#15141A", toolbar_field: "#FFFFFF", toolbar_field_text: "#15141A",
    tab_selected: "#FFFFFF", tab_text: "#15141A", popup: "#FFFFFF", popup_text: "#15141A",
    sidebar: "#FFFFFF", sidebar_text: "#15141A", ntp_background: "#F9F9FB", ntp_text: "#15141A",
  },
  dark: {
    frame: "#1C1B22", frame_inactive: "#1F1E25", tab_background_text: "#FBFBFE",
    toolbar: "#2B2A33", toolbar_text: "#FBFBFE", toolbar_field: "#1C1B22", toolbar_field_text: "#FBFBFE",
    tab_selected: "#42414D", tab_text: "#FBFBFE", popup: "#42414D", popup_text: "#FBFBFE",
    sidebar: "#38373F", sidebar_text: "#FBFBFE", ntp_background: "#2B2A33", ntp_text: "#FBFBFE",
  },
};

// Toolbar icon: Kit's hooded head and shoulders (rows 0-12, no tail or legs) on 16 x 16; the
// second frame hops up a pixel.
function iconFrame(size, alt) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const s = size / 16;
  for (const [x, y, w, h, fill] of kitRects("stand", false, { tail: false })) {
    if (y > 12) continue;
    ctx.fillStyle = fill;
    ctx.fillRect((x - 3) * s, (y + 3 - (alt ? 1 : 0)) * s, w * s, Math.min(h, 13 - y) * s);
  }
  return ctx.getImageData(0, 0, size, size);
}
const ICON_FRAMES = [false, true].map((alt) => ({ 16: iconFrame(16, alt), 32: iconFrame(32, alt) }));

// Kit in the tab bar: each frame is a transparent window-wide image with Kit (and its bubble) at
// some x, applied as a theme background behind the tabs. Each new picture makes Firefox blank the
// tab bar for a moment, so Kit hops between a few reusable positions and a picture is only sent
// when it changes.
const TAB_BAR_FRAME_MS = 80;
const TAB_BAR_HOP = 24; // px per visible hop; fewer distinct pictures means less flicker
const TAB_BAR_HOLD_MS = 1600; // each bubble stays up this long once Kit stands still
const TabBarKit = {
  active: false,
  x: 0,
  target: 0,
  width: 0,
  text: "",
  done: false,
  timer: null,
  onArrive: null,
  leaving: null,
  shown: null,
  cache: new Map(),
  waiters: [],
  facingLeft: true,

  // Resolves once Kit has stopped walking (or has been stopped).
  whenStill() {
    if (!this.active || Math.abs(this.target - this.x) <= 0.5) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  },

  flushWaiters() {
    const waiting = this.waiters;
    this.waiters = [];
    waiting.forEach((resolve) => resolve());
  },

  async start(windowId, text) {
    const win = await browser.windows.get(windowId);
    this.width = win.width || 1200;
    this.text = text;
    this.done = false;
    if (!this.active) this.x = this.width + 20;
    this.target = Math.max(this.width / 2, this.width - 400); // well along the bar, in from the buttons on the right
    if (this.leaving) { const done = this.leaving; this.leaving = null; this.onArrive = null; done(); } // turn back
    this.active = true;
    this.run();
  },

  say(text, done) {
    this.text = text;
    this.done = done;
  },

  leave() {
    return new Promise((resolve) => {
      this.text = "";
      this.target = this.width + 20;
      this.leaving = resolve;
      this.onArrive = () => {
        this.leaving = null;
        this.stop();
        resolve();
      };
      this.run();
    });
  },

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.shown = null;
    this.active = false;
    this.flushWaiters();
    this.onArrive = null;
  },

  run() {
    if (this.timer) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.timer = setInterval(() => {
      const step = (WALK_SPEED * TAB_BAR_FRAME_MS) / 1000;
      const gap = this.target - this.x;
      const moving = Math.abs(gap) > 0.5;
      if (moving) this.facingLeft = gap < 0; // Kit faces the way it walks, and keeps facing that way when it stops
      this.x = reduce || Math.abs(gap) <= step ? this.target : this.x + Math.sign(gap) * step;
      // Firefox blanks the tab bar briefly whenever the picture changes, so only send a
      // picture when it actually differs from the one showing.
      const url = this.frameUrl(moving && !reduce);
      if (url !== this.shown) {
        this.shown = url;
        Mascot.applyTheme(url);
      }
      if (!moving) this.flushWaiters();
      if (!moving && this.onArrive) this.onArrive();
    }, TAB_BAR_FRAME_MS);
  },

  // Kit moves in TAB_BAR_HOP px hops and its step follows its position, so each spot always
  // has the same picture; pictures are kept and reused, so later runs don't re-draw them.
  frameUrl(walking) {
    const x = Math.round(this.x / TAB_BAR_HOP) * TAB_BAR_HOP;
    const pose = !walking ? "stand" : (x / TAB_BAR_HOP) % 2 !== 0 ? "b" : "a";
    const text = walking ? "" : this.text; // the bubble only shows once Kit stands still
    const key = [this.width, x, pose, this.facingLeft, text, this.done].join("|");
    let url = this.cache.get(key);
    if (!url) {
      url = this.render(x, pose, text, this.facingLeft);
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, url);
    }
    return url;
  },

  render(x, pose, text, facingLeft) {
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    const sx = x, sy = pose === "b" ? 3 : 5; // a small bob on every other step
    // A dark outline, so Kit stands out against any tab-bar colour.
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) drawKit(ctx, sx + dx, sy + dy, 2, pose, facingLeft, INK);
    drawKit(ctx, sx, sy, 2, pose, facingLeft);
    if (text) {
      ctx.font = "600 11px system-ui, sans-serif";
      const w = Math.ceil(ctx.measureText(text).width) + 16;
      const bx = x + KIT_W * 2 + 8, by = 11; // to the right of Kit, away from the tabs on the left
      ctx.fillStyle = this.done ? "#EAF3DE" : "#FAECE7";
      ctx.strokeStyle = this.done ? "#97C459" : "#F0997B";
      ctx.beginPath();
      ctx.roundRect(bx + 0.5, by + 0.5, w, 18, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = this.done ? "#27500A" : "#712B13";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 8, by + 10);
    }
    return canvas.toDataURL("image/png");
  },
};

const Mascot = {
  busy: 0,
  windowId: null,
  themed: false,
  ready: Promise.resolve(),
  endToken: null,
  theme: null,
  timer: null,
  iconTimer: null,

  async start(method, params) {
    try {
      const windowId = await targetWindow(params);
      if (windowId !== null) this.begin(windowId, await describe(method, params));
    } catch (e) {
      // cosmetic only
    }
  },

  // "Say hi" in the toolbar menu: a hello in the tab bar without touching any tabs.
  demo(tab) {
    this.begin(tab.windowId, "Hi! I'm Kit");
    this.end(true, "Bye!");
  },

  begin(windowId, label) {
    this.busy++;
    clearTimeout(this.timer);
    if (this.windowId !== null && this.windowId !== windowId) this.restoreTheme();
    this.windowId = windowId;
    this.ready = this.copyTheme().then(() => TabBarKit.start(windowId, label)).catch(() => {});
    this.animateIcon(true);
  },

  // Once Kit has walked in and its message has had time to be read, say how it went, then leave.
  end(ok, doneText = "Done") {
    if (this.busy === 0 || --this.busy > 0) return;
    const said = ok ? doneText : "That didn't work";
    const token = (this.endToken = {});
    const current = () => this.busy === 0 && this.endToken === token; // nothing new has started
    (async () => {
      await this.ready;
      await TabBarKit.whenStill();
      await new Promise((r) => (this.timer = setTimeout(r, TAB_BAR_HOLD_MS)));
      if (!current()) return;
      TabBarKit.say(said, ok);
      this.timer = setTimeout(() => current() && this.finish(), TAB_BAR_HOLD_MS);
    })();
  },

  async finish() {
    await TabBarKit.leave();
    if (this.busy > 0) return; // something new started while Kit was walking off
    this.restoreTheme();
    this.animateIcon(false);
    this.windowId = null;
  },

  // Snapshot the current theme (colours unchanged) so tab-bar Kit frames can be layered on it.
  async copyTheme() {
    if (this.themed || this.windowId === null) return;
    this.themed = true;
    this.theme = null;
    try {
      // This page follows the browser's current light/dark mode.
      const scheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const current = (await browser.theme.getCurrent(this.windowId)) || {};
      const set = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined));
      const own = set(current.colors);
      const builtIn = Object.keys(own).length === 0;
      const theme = { colors: builtIn ? { ...BASE_PALETTE[scheme] } : own };
      if (Object.keys(set(current.images)).length) theme.images = set(current.images);
      // Pin both the browser UI and web pages to the scheme in use, so pages don't flip to light.
      theme.properties = { ...set(current.properties), color_scheme: scheme, content_color_scheme: scheme };
      this.theme = theme;
    } catch (e) {
      this.themed = false;
    }
  },

  // The copied theme plus one tab-bar Kit frame, placed in front of any backgrounds it had.
  applyTheme(frameUrl) {
    if (!this.themed || !this.theme || this.windowId === null) return;
    const t = this.theme;
    const images = { ...(t.images || {}) };
    const props = { ...t.properties };
    const list = (v) => (Array.isArray(v) ? v : []);
    images.additional_backgrounds = [frameUrl, ...list(images.additional_backgrounds)];
    props.additional_backgrounds_alignment = ["left top", ...list(props.additional_backgrounds_alignment)];
    props.additional_backgrounds_tiling = ["no-repeat", ...list(props.additional_backgrounds_tiling)];
    browser.theme.update(this.windowId, { ...t, images, properties: props }).catch(() => {});
  },

  restoreTheme() {
    TabBarKit.stop();
    if (!this.themed) return;
    this.themed = false;
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

// A tab-bar theme left over from a crash or reload would otherwise stick until Firefox restarts.
browser.theme.reset().catch(() => {});
Mascot.animateIcon(false);
