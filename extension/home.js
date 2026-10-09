// Kit's full page: the same actions as the toolbar menu, laid out with explanations, plus live
// counts, your lists and rules, and Kit walking around a little browser window.

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);
const FIELD_LABEL = { title: "Title contains", url: "Address contains", site: "Website is" };
let stepTypes = {};

// ---- feedback ---------------------------------------------------------------------------------

let toastTimer = null;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = bad ? "toast bad" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

async function run(button, msg) {
  button.disabled = true;
  try {
    toast(await send(msg));
    refreshOverview();
  } catch (e) {
    toast(String((e && e.message) || e), true);
  } finally {
    button.disabled = false;
  }
}

// ---- status and counts ------------------------------------------------------------------------

async function refreshOverview() {
  try {
    const o = await send({ cmd: "overview" });
    $("st-tabs").textContent = o.tabs;
    $("st-groups").textContent = o.groups;
    $("st-loose").textContent = o.loose;
    $("st-dupes").textContent = o.duplicates;
  } catch (e) {
    // counts are a nicety
  }
}

let polling = null;
let wasBusy = false;
let aiConnected = false;
let connectPolling = null;
function showOrganise(organise) {
  const busy = organise.running;
  for (const b of [$("organise-btn"), $("hero-organise")]) {
    b.disabled = busy;
    b.textContent = busy ? "Organising…" : "Organise my tabs";
  }
  $("organise-btn").disabled = busy || !aiConnected || !$("agent").value;
  $("organise-note").textContent = busy
    ? "Organising your tabs. Kit narrates each change in the tab bar."
    : aiConnected ? "Takes 20–60 seconds. You can keep browsing while Kit works."
    : "Connect an AI assistant first: it's one command (see the top of this page).";
  if (busy) {
    polling = polling || setInterval(refreshStatus, 2000);
  } else {
    clearInterval(polling);
    polling = null;
    renderResult($("organise-result"), organise.last, () => {
      $("organise-result").hidden = true;
      send({ cmd: "dismiss_result" });
    });
    if (wasBusy) refreshOverview();
  }
  wasBusy = busy;
}

async function refreshStatus() {
  const { connected, organise } = await send({ cmd: "status" });
  const justConnected = connected && !aiConnected && connectPolling;
  aiConnected = connected;
  const conn = $("conn");
  conn.className = connected ? "conn on" : "conn off";
  conn.querySelector(".label").textContent = connected ? "AI assistant connected" : "AI not connected";
  $("connect").hidden = connected;
  $("assistants").hidden = !connected;
  if (connected && !agentsLoaded) { agentsLoaded = true; loadAgents(false); }
  // While not connected, check every few seconds so the page updates by itself after setup.
  if (!connected && !connectPolling) connectPolling = setInterval(refreshStatus, 3000);
  if (connected && connectPolling) { clearInterval(connectPolling); connectPolling = null; }
  if (justConnected) toast("Connected! Your AI assistant can now see your tabs.");
  showOrganise(organise);
}

function organise() {
  if (!aiConnected) {
    $("connect").scrollIntoView({ block: "start" });
    return;
  }
  if (!$("agent").value) {
    $("organise").scrollIntoView({ block: "start" });
    toast($("agent").options.length > 1 ? "Choose which assistant should organise first." : "Connect Claude Code, Codex or Hermes Agent first.", true);
    return;
  }
  const clicked = Date.now();
  // The outcome arrives via refreshStatus; an error with no newer result means the run never started.
  send({ cmd: "organise", agent: $("agent").value, instructions: $("instructions").value }).catch(async (e) => {
    const { organise } = await send({ cmd: "status" });
    if (!organise.running && !(organise.last && organise.last.at >= clicked)) {
      showOrganise(organise);
      toast(String((e && e.message) || e), true);
    }
  });
  showOrganise({ running: true });
  $("organise").scrollIntoView({ block: "start" });
}

// ---- AI assistants -----------------------------------------------------------------------------

const AGENT_SITES = {
  claude: "https://claude.com/claude-code", codex: "https://github.com/openai/codex",
  hermes: "https://hermes-agent.nousresearch.com", gemini: "https://github.com/google-gemini/gemini-cli",
  cursor: "https://cursor.com", windsurf: "https://windsurf.com", "claude-desktop": "https://claude.ai/download",
};
let agentsLoaded = false;

async function loadAgents(refresh) {
  try {
    showAgents(await send({ cmd: "agents", refresh }));
  } catch (e) {
    toast(String((e && e.message) || e), true);
  }
}

function showAgents({ agents, chosen }) {
  // Organise picker: connected assistants that can organise; no default beyond the last choice.
  const usable = agents.filter((a) => a.connected && a.can_organise);
  const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
  const pick = usable.some((a) => a.id === chosen) ? chosen : usable.length === 1 ? usable[0].id : "";
  const options = usable.map((a) => option(a.id, a.name));
  if (usable.length > 1 && !pick) options.unshift(option("", "Choose an assistant…"));
  if (!usable.length) options.push(option("", "Connect Claude Code, Codex or Hermes Agent below"));
  $("agent").replaceChildren(...options);
  $("agent").value = pick;
  $("agent").disabled = !usable.length;
  $("organise-btn").disabled = !pick || wasBusy;

  // Cards: every assistant Kit knows, with what it can do and how to connect it.
  $("agent-cards").replaceChildren(...agents.map((a) => {
    const card = Object.assign(document.createElement("article"), { className: "card agent-card" });
    const pill = Object.assign(document.createElement("span"), {
      className: a.connected ? "pill on" : "pill",
      textContent: a.connected ? "Connected" : a.installed ? "Not connected" : "Not installed",
    });
    const what = Object.assign(document.createElement("p"), {
      className: "what",
      textContent: a.can_organise ? "Can see and manage your tabs, and run Organise with AI." : "Can see and manage your tabs.",
    });
    card.append(Object.assign(document.createElement("h3"), { textContent: a.name }), pill, what);
    if (a.installed && !a.connected) {
      const b = Object.assign(document.createElement("button"), { className: "primary", textContent: "Connect" });
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = "Connecting…";
        try {
          const reply = await send({ cmd: "connect_agent", id: a.id });
          toast(`${a.name}: ${reply.message}`);
          showAgents({ agents: reply.agents, chosen: $("agent").value || chosen });
        } catch (e) {
          toast(String((e && e.message) || e), true);
          b.disabled = false;
          b.textContent = "Connect";
        }
      });
      card.append(b);
    } else if (!a.installed && AGENT_SITES[a.id]) {
      card.append(Object.assign(document.createElement("a"), { className: "get", href: AGENT_SITES[a.id], target: "_blank", rel: "noopener", textContent: `Get ${a.name} ↗` }));
    }
    return card;
  }));
}

$("agent").addEventListener("change", (e) => {
  $("organise-btn").disabled = !e.target.value || wasBusy;
  if (e.target.value) send({ cmd: "choose_agent", id: e.target.value });
});
$("agents-refresh").addEventListener("click", async (e) => {
  e.target.disabled = true;
  await loadAgents(true);
  e.target.disabled = false;
});

// ---- lists and rules --------------------------------------------------------------------------

function stepText(step) {
  const type = stepTypes[step.type];
  if (!type) return step.type;
  if (!(type.arg && step.arg)) return type.label.replace(/…$/, "");
  // "Collapse all groups except…" + "Code" reads as one phrase; other details go in quotes.
  return type.label.endsWith("…") ? `${type.label.slice(0, -1)} ${step.arg}` : `${type.label}: “${step.arg}”`;
}

async function renderSaved() {
  const s = await browser.storage.local.get(["rules", "lists"]);
  const lists = Array.isArray(s.lists) ? s.lists : [];
  const rules = Array.isArray(s.rules) ? s.rules : [];

  $("lists").replaceChildren(...lists.map((list, index) => {
    const card = document.createElement("article");
    card.className = "card list-card";
    const h = document.createElement("h3");
    h.textContent = list.name || "Untitled list";
    const ol = document.createElement("ol");
    for (const step of list.steps || []) ol.append(Object.assign(document.createElement("li"), { textContent: stepText(step) }));
    const b = Object.assign(document.createElement("button"), { textContent: "Run" });
    b.addEventListener("click", () => run(b, { cmd: "run_list", index, name: list.name }));
    card.append(h, ol, b);
    return card;
  }));
  $("lists").hidden = lists.length === 0;
  $("no-lists").hidden = lists.length > 0;

  const shown = rules.filter((r) => r.text && r.group).slice(0, 6);
  $("rules").replaceChildren(...shown.map((r) => {
    const li = document.createElement("li");
    const kind = Object.assign(document.createElement("span"), { className: "kind", textContent: FIELD_LABEL[r.field] || FIELD_LABEL.title });
    const needle = Object.assign(document.createElement("span"), { className: "needle", textContent: r.text });
    const arrow = Object.assign(document.createElement("span"), { className: "arrow", textContent: "→" });
    const group = Object.assign(document.createElement("span"), { className: "group", textContent: r.group });
    group.style.setProperty("--c", GROUP_HEX[r.color] || GROUP_HEX.grey);
    li.append(kind, needle, arrow, group);
    return li;
  }));
  $("rules").hidden = shown.length === 0;
  $("no-rules").hidden = shown.length > 0;
  const n = rules.length;
  $("rules-summary").textContent = n
    ? `${n} rule${n === 1 ? "" : "s"}. Kit puts each tab in the group of the first rule it matches; other tabs stay put.`
    : "Rules decide which group a tab belongs in.";
}

// ---- duplicates -------------------------------------------------------------------------------

let dupes = [];
$("dupes").addEventListener("click", async () => {
  dupes = await send({ cmd: "find_duplicates" });
  $("dupe-panel").hidden = false;
  $("dupe-msg").textContent = dupes.length === 0 ? "No duplicate tabs in this window."
    : dupes.length === 1 ? "This tab is a copy of a page that's already open:"
    : `These ${dupes.length} tabs are copies of pages that are already open:`;
  $("dupe-list").replaceChildren(...dupes.map((t) => Object.assign(document.createElement("li"), { textContent: t.title || t.url, title: t.url })));
  $("dupe-close").hidden = dupes.length === 0;
  $("dupe-close").textContent = dupes.length === 1 ? "Close it" : `Close these ${dupes.length}`;
});
$("dupe-cancel").addEventListener("click", () => ($("dupe-panel").hidden = true));
$("dupe-close").addEventListener("click", async (e) => {
  $("dupe-panel").hidden = true;
  await run(e.target, { cmd: "close_tabs", tab_ids: dupes.map((t) => t.id) });
});

// ---- Kit on the stage -------------------------------------------------------------------------

const TIPS = [
  "Hi! I'm Kit",
  "Ask me to organise your tabs!",
  "One click tidies the lot",
  "Lists make great shortcuts",
  "Your AI assistant can ask me about any tab",
];

function startStage() {
  const S = 5; // screen pixels per Kit pixel
  const canvas = $("stage-kit"), walker = $("walker"), bubble = $("bubble"), stage = $("stage");
  canvas.width = (KIT_W + 2) * S;
  canvas.height = (KIT_H + 2) * S;
  const ctx = canvas.getContext("2d");
  const draw = (pose, left, lift) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const o = Math.round(S / 2), y = S - lift;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) drawKit(ctx, S + dx, y + dy, S, pose, left, INK);
    drawKit(ctx, S, y, S, pose, left);
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const span = () => Math.max(0, stage.clientWidth - canvas.width - 24);
  let x = reduce ? span() / 2 : span() + canvas.width, target = span() * 0.72, left = true, tip = 0, pauseUntil = 0, last = performance.now();

  const say = (text) => {
    bubble.textContent = text;
    const onRight = x + canvas.width / 2 < stage.clientWidth / 2;
    bubble.className = `bubble ${onRight ? "right" : "left"}`;
  };
  const place = () => (walker.style.transform = `translateX(${Math.round(x)}px)`);

  walker.addEventListener("click", () => {
    send({ cmd: "hi" }).catch(() => {});
    say("Hi! I'm Kit. Look up at your tab bar!");
    pauseUntil = performance.now() + 3000;
  });

  if (reduce) {
    draw("stand", false, 0);
    place();
    say(TIPS[0]);
    setInterval(() => say(TIPS[(tip = (tip + 1) % TIPS.length)]), 3500);
    return;
  }

  bubble.className = "bubble quiet";
  const frame = (now) => {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    if (now < pauseUntil) {
      draw("stand", left, 0);
    } else {
      const gap = target - x;
      if (Math.abs(gap) < 1) {
        // Arrived: say the next tip, then head for the other side.
        say(TIPS[tip]);
        tip = (tip + 1) % TIPS.length;
        pauseUntil = now + 2800;
        target = x < span() / 2 ? span() * (0.62 + Math.random() * 0.3) : span() * (0.04 + Math.random() * 0.3);
        draw("stand", left, 0);
      } else {
        bubble.className = "bubble quiet";
        left = gap < 0;
        x += Math.sign(gap) * Math.min(Math.abs(gap), 95 * dt);
        const pose = Math.floor(x / 12) % 2 ? "a" : "b";
        draw(pose, left, pose === "b" ? Math.round(S / 2) : 0);
        place();
      }
    }
    requestAnimationFrame(frame);
  };
  place();
  requestAnimationFrame(frame);
}

// ---- wiring ------------------------------------------------------------------------------------

document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => run(b, { cmd: "action", action: b.dataset.action })));
document.querySelectorAll("[data-open=options]").forEach((b) => b.addEventListener("click", () => browser.runtime.openOptionsPage()));
$("nav-rules").addEventListener("click", () => browser.runtime.openOptionsPage());
$("hero-hi").addEventListener("click", () => {
  send({ cmd: "hi" }).catch(() => {});
  toast("Look up: Kit is in your tab bar.");
});
$("hero-organise").addEventListener("click", organise);
$("copy-cmd").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("install-cmd").textContent);
    toast("Copied. Paste it into a terminal and press Enter.");
  } catch (e) {
    toast("Couldn't copy; select the command instead.", true);
  }
});
$("organise-btn").addEventListener("click", organise);
document.querySelectorAll(".prompt .copy").forEach((b) => b.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(b.parentElement.querySelector("blockquote").textContent);
    toast("Copied. Paste it into your AI assistant.");
  } catch (e) {
    toast("Couldn't copy; select the text instead.", true);
  }
}));
browser.storage.onChanged.addListener(() => renderSaved());
$("version").textContent = `Version ${browser.runtime.getManifest().version}.`;

(async () => {
  startStage();
  try {
    stepTypes = await send({ cmd: "step_types" });
  } catch (e) {
    // labels fall back to the step ids
  }
  await Promise.all([renderSaved(), refreshStatus(), refreshOverview()]);
  if (location.hash === "#connect" && !aiConnected) $("connect").scrollIntoView({ block: "start" });
  if (location.hash === "#assistants" && aiConnected) $("assistants").scrollIntoView({ block: "start" });
})().catch((e) => toast(String((e && e.message) || e), true));
