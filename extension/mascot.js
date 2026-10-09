// Activity feedback for tab changes: Kit (a little pixel-art mascot) walks along the tab bar
// with a speech bubble, and the toolbar icon hops. Kit is drawn into the tab bar through a copy
// of the current theme, so it shows on every page (protected ones too) and colours stay the same.
// Purely cosmetic: every step swallows its own errors so it can never break a request.

const ANIMATED = new Set(["group_tabs", "ungroup_tabs", "update_group", "move_tabs", "close_tabs"]);
const WALK_SPEED = 120; // px per second: a brisk walk, but slow enough to keep flicker down
// Firefox's built-in light and dark colours. With the built-in theme, getCurrent() reports no
// colours, so the tab-bar Kit's copy of the theme spells them out; anything left unset would
// fall back to Firefox's theme defaults and visibly change the browser. That includes the accent
// colours (selected-tab line, loading bar, highlights, focus rings), which default to blue, so
// those are set to Kit's orange instead.
function accents(onAccent) {
  const accent = "#D97757", bright = "#E8833A";
  return {
    tab_line: accent, tab_loading: bright, icons_attention: bright,
    toolbar_field_border_focus: accent, toolbar_field_highlight: accent, toolbar_field_highlight_text: onAccent,
    popup_highlight: accent, popup_highlight_text: onAccent, sidebar_highlight: accent, sidebar_highlight_text: onAccent,
  };
}
// Theme colours come as "#rrggbb", "rgb(…)"/"rgba(…)" or [r, g, b(, a)]; null if unreadable.
function parseColor(v) {
  if (Array.isArray(v)) return v.slice(0, 3).map(Number);
  const s = String(v).trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  return m ? m[1].split(",").slice(0, 3).map((n) => parseFloat(n)) : null;
}

function isLight(v) {
  const c = v === undefined ? null : parseColor(v);
  if (!c) return true; // unknown: treat as Firefox's light default
  const [r, g, b] = c.map((n) => n / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

// Same hue and saturation, lightness mirrored (light blue -> dark navy, dark text -> light text).
function flipLightness(v) {
  const c = parseColor(v);
  if (!c) return v;
  const [r, g, b] = c.map((n) => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, sat = 0;
  if (d) {
    sat = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  }
  const L = 1 - l, C = (1 - Math.abs(2 * L - 1)) * sat, X = C * (1 - Math.abs((h % 2 + 2) % 2 - 1)), m = L - C / 2;
  const [r1, g1, b1] = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][Math.floor((h + 6) % 6)];
  return `rgb(${[r1, g1, b1].map((n) => Math.round((n + m) * 255)).join(", ")})`;
}

const BASE_PALETTE = {
  light: {
    frame: "#F0F0F4", frame_inactive: "#EBEBEF", tab_background_text: "#15141A",
    toolbar: "#F9F9FB", toolbar_text: "#15141A", toolbar_field: "#FFFFFF", toolbar_field_text: "#15141A",
    tab_selected: "#FFFFFF", tab_text: "#15141A", popup: "#FFFFFF", popup_text: "#15141A",
    sidebar: "#FFFFFF", sidebar_text: "#15141A", ntp_background: "#F9F9FB", ntp_text: "#15141A",
    ...accents("#FFFFFF"),
  },
  dark: {
    frame: "#1C1B22", frame_inactive: "#1F1E25", tab_background_text: "#FBFBFE",
    toolbar: "#2B2A33", toolbar_text: "#FBFBFE", toolbar_field: "#1C1B22", toolbar_field_text: "#FBFBFE",
    tab_selected: "#42414D", tab_text: "#FBFBFE", popup: "#42414D", popup_text: "#FBFBFE",
    sidebar: "#38373F", sidebar_text: "#FBFBFE", ntp_background: "#2B2A33", ntp_text: "#FBFBFE",
    ...accents("#1C1B22"),
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
const TAB_BAR_OVERLAP_MS = 16; // how long a new picture sits over the previous one while it loads (about one screen refresh)
const TAB_BAR_HOLD_MS = 1600; // each bubble stays up this long once Kit stands still
const BUBBLE_FONT = "600 11px system-ui, sans-serif";
const KIT_SPACE = KIT_W * 2 + 8; // Kit's width in the tab bar, plus the gap before its bubble
const DIM = 0.25; // how much of the tabs' text shows while Kit talks over them

// Extensions can't see where Firefox draws its tabs, so this estimates it from Firefox's own tab
// sizes (tabs shrink from 225 to 76 px, then scroll) and the window: where the last tab ends,
// where the buttons on the right start, and the empty 40 px gap Firefox keeps just before the
// window's own buttons. Rough by design: it errs towards thinking the tabs are wider.
const BAR = { tabMin: 76, tabMax: 225, pinned: 40, button: 36, spacer: 40, labelMax: 125, charW: 7 };
async function tabBarLayout(windowId, width) {
  const [win, tabs, groups, platform] = await Promise.all([
    browser.windows.get(windowId),
    browser.tabs.query({ windowId }),
    browser.tabGroups.query({ windowId }).catch(() => []),
    browser.runtime.getPlatformInfo(),
  ]);
  const mac = platform.os === "mac";
  const controls = mac ? 0 : platform.os === "win" ? 138 : 115; // minimise, maximise, close
  const left = (mac ? 76 + BAR.spacer : win.state === "normal" ? BAR.spacer : 0) + BAR.button; // window buttons or spacer, then Firefox View
  const right = controls + BAR.spacer + 3 * BAR.button; // list all tabs and the other buttons at the end of the bar
  const byId = new Map(groups.map((g) => [g.id, g]));
  const labelled = new Set();
  let fixed = 0, flexible = 0;
  for (const t of tabs) {
    if (t.hidden) continue;
    if (t.pinned) { fixed += BAR.pinned; continue; }
    const g = byId.get(t.groupId);
    if (g && !labelled.has(g.id)) {
      labelled.add(g.id);
      fixed += (g.title ? Math.min(BAR.labelMax, g.title.length * BAR.charW) + 8 : 22) + 6;
    }
    if (g && g.collapsed && !t.active) continue; // a collapsed group shows only its label (and the current tab)
    flexible++;
  }
  const room = width - left - right - BAR.button; // the new tab button follows the last tab
  const tabWidth = flexible ? Math.min(BAR.tabMax, Math.max(BAR.tabMin, (room - fixed) / flexible)) : 0;
  return {
    start: left + Math.min(room, fixed + flexible * tabWidth) + BAR.button + 8, // first free spot after the tabs
    end: width - right, // the buttons on the right start here
    gap: width - controls - BAR.spacer + 3, // Kit (34 px) fits in the 40 px gap before the window buttons
  };
}

function bubbleWidth(text) {
  const ctx = bubbleWidth.ctx || (bubbleWidth.ctx = document.createElement("canvas").getContext("2d"));
  ctx.font = BUBBLE_FONT;
  return Math.ceil(ctx.measureText(text).width) + 16;
}
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
  overlapTimer: null,
  cache: new Map(),
  waiters: [],
  facingLeft: true,
  layout: null,
  squeezed: false, // no room after the tabs: Kit stands in the gap by the window buttons and talks over the tabs
  dim: false,

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
    await this.place(windowId);
    if (this.leaving) { const done = this.leaving; this.leaving = null; this.onArrive = null; done(); } // turn back
    this.active = true;
    this.run();
  },

  // Where Kit stands: well along the bar, after the last tab, with room for its bubble before the
  // buttons on the right. If the tabs fill the bar, in the gap just before the window buttons.
  async place(windowId) {
    this.windowId = windowId;
    try {
      this.layout = await tabBarLayout(windowId, this.width);
    } catch (e) {
      this.layout = null;
    }
    const ideal = Math.max(this.width / 2, this.width - 400);
    const l = this.layout;
    if (!l) { this.squeezed = false; this.target = ideal; return; }
    const lastSpot = l.end - KIT_SPACE - Math.max(bubbleWidth(this.text), 190); // 190: room for the longer lines that follow
    this.squeezed = lastSpot < l.start;
    this.target = this.squeezed ? l.gap : Math.max(l.start, Math.min(ideal, lastSpot));
  },

  say(text, done) {
    this.text = text;
    this.done = done;
    if (this.active && !this.leaving) this.place(this.windowId); // tabs may have moved since Kit arrived
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
    clearTimeout(this.overlapTimer);
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
      // Firefox blanks a new picture until it has loaded, so only send one when it differs from
      // the one showing, and layer it over the previous picture just long enough to load
      // (TAB_BAR_OVERLAP_MS), so there's always a Kit on screen without a visible double image.
      const walking = moving && !reduce;
      const url = this.frameUrl(walking);
      if (url !== this.shown) {
        const previous = this.shown;
        // Squeezed in by the window buttons, Kit's bubble sits behind the last tabs, so their text fades while it shows.
        const dim = (this.dim = this.squeezed && !walking && !!this.text);
        Mascot.applyTheme(previous ? [url, previous] : [url], dim);
        this.shown = url;
        clearTimeout(this.overlapTimer);
        if (previous) this.overlapTimer = setTimeout(() => this.shown === url && Mascot.applyTheme([url], dim), TAB_BAR_OVERLAP_MS);
      }
      if (!moving) this.flushWaiters();
      if (!moving && this.onArrive) this.onArrive();
    }, TAB_BAR_FRAME_MS);
  },

  // Kit moves in TAB_BAR_HOP px hops and its step follows its position, so each spot always
  // has the same picture; pictures are kept and reused, so later runs don't re-draw them.
  frameUrl(walking) {
    // Standing, Kit is exactly where it stopped, so it fits the gap by the window buttons.
    const x = walking ? Math.round(this.x / TAB_BAR_HOP) * TAB_BAR_HOP : Math.round(this.x);
    const pose = !walking ? "stand" : (x / TAB_BAR_HOP) % 2 !== 0 ? "b" : "a";
    const text = walking ? "" : this.text; // the bubble only shows once Kit stands still
    const key = [this.width, x, pose, this.facingLeft, text, this.done, this.squeezed].join("|");
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
      ctx.font = BUBBLE_FONT;
      const w = bubbleWidth(text);
      // To Kit's right, away from the tabs; squeezed in by the window buttons, to its left instead.
      const bx = this.squeezed ? Math.max(0, x - 8 - w) : x + KIT_SPACE, by = 11;
      ctx.fillStyle = this.done ? "#E8833A" : "#FAECE7"; // "Done" in Kit's hoodie orange
      ctx.strokeStyle = this.done ? "#B8602A" : "#F0997B";
      ctx.beginPath();
      ctx.roundRect(bx + 0.5, by + 0.5, w, 18, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = this.done ? "#2C2C2A" : "#712B13";
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
    this.end(true, "Bye!", ["Ask me to organise your tabs!"]);
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
  // lines: anything else to say first, one bubble each.
  end(ok, doneText = "Done", lines = []) {
    if (this.busy === 0 || --this.busy > 0) return;
    const said = ok ? doneText : "That didn't work";
    const token = (this.endToken = {});
    const current = () => this.busy === 0 && this.endToken === token; // nothing new has started
    (async () => {
      await this.ready;
      await TabBarKit.whenStill();
      const hold = () => new Promise((r) => (this.timer = setTimeout(r, TAB_BAR_HOLD_MS)));
      await hold();
      for (const line of lines) {
        if (!current()) return;
        TabBarKit.say(line, false);
        await hold();
      }
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
      let colors = builtIn ? { ...BASE_PALETTE[scheme] } : own;
      // Themes with separate light and dark versions (like Mozilla's colour themes) report only
      // their light colours here, even while Firefox shows the dark version. When the copy's
      // brightness doesn't match the mode Firefox is in, flip each colour's lightness (keeping its
      // hue), which comes out close to the theme's own dark version.
      if (!builtIn && isLight(colors.frame || colors.toolbar) !== (scheme === "light")) {
        colors = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, flipLightness(v)]));
      }
      const theme = { colors };
      if (Object.keys(set(current.images)).length) theme.images = set(current.images);
      // Pin both the browser UI and web pages to the scheme in use, so pages don't flip to light.
      theme.properties = { ...set(current.properties), color_scheme: scheme, content_color_scheme: scheme };
      this.theme = theme;
    } catch (e) {
      this.themed = false;
    }
  },

  // The copied theme plus Kit's frame picture(s), placed in front of any backgrounds it had.
  // frameUrls: newest first; each is a window-wide transparent picture.
  // dim: fade the tabs' text and the selected tab, so Kit's bubble shows through them.
  applyTheme(frameUrls, dim = false) {
    if (!this.themed || !this.theme || this.windowId === null) return;
    const t = dim ? { ...this.theme, colors: this.dimmed() } : this.theme;
    const images = { ...(t.images || {}) };
    const props = { ...t.properties };
    const list = (v) => (Array.isArray(v) ? v : []);
    images.additional_backgrounds = [...frameUrls, ...list(images.additional_backgrounds)];
    props.additional_backgrounds_alignment = [...frameUrls.map(() => "left top"), ...list(props.additional_backgrounds_alignment)];
    props.additional_backgrounds_tiling = [...frameUrls.map(() => "no-repeat"), ...list(props.additional_backgrounds_tiling)];
    browser.theme.update(this.windowId, { ...t, images, properties: props }).catch(() => {});
  },

  dimmed() {
    const colors = { ...this.theme.colors };
    const base = BASE_PALETTE[this.theme.properties.color_scheme] || BASE_PALETTE.light;
    for (const key of ["tab_background_text", "tab_text", "tab_selected"]) {
      const c = parseColor(colors[key] ?? base[key]);
      if (c) colors[key] = `rgba(${c.join(", ")}, ${DIM})`;
    }
    return colors;
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
