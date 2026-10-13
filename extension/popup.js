// Toolbar menu. Every action runs in the background page, so it finishes even if this closes.

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);
let dupes = [];

function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

async function run(button, msg) {
  const all = document.querySelectorAll("button");
  all.forEach((b) => (b.disabled = true));
  status("Working…");
  try {
    status(await send(msg), "ok");
  } catch (e) {
    status(String((e && e.message) || e), "bad");
  } finally {
    all.forEach((b) => (b.disabled = false));
    refresh();
  }
}

function drawHeader() {
  drawKit($("kit").getContext("2d"), 0, 0, 2, "stand", false);
}

const RECENT_MS = 10 * 60 * 1000;
let polling = null;

// Organising can take a minute; the menu may be closed and reopened meanwhile, so it asks for news.
let wasBusy = false;
let aiConnected = false;
let canOrganise = false; // connected, and an assistant that can organise is picked

function showOrganise(organise, opening = false) {
  const busy = organise.running;
  const justFinished = wasBusy && !busy;
  wasBusy = busy;
  $("organise").disabled = busy || !canOrganise;
  $("organise").textContent = busy ? "Organising…" : "Organise my tabs";
  if (busy) {
    status("Organising your tabs. This can take a minute, and you can close this menu.");
    polling = polling || setInterval(refresh, 2000);
  } else {
    clearInterval(polling);
    polling = null;
    if (justFinished) status("");
    const recent = organise.last && Date.now() - organise.last.at < RECENT_MS;
    if (opening || justFinished) renderResult($("result"), recent ? organise.last : null, dismissResult);
  }
}

function dismissResult() {
  $("result").hidden = true;
  send({ cmd: "dismiss_result" });
}

// The picker lists only connected assistants that can organise; there's no default beyond your last choice.
// What to set up before Organise works, as one card with one button. AI is optional: "Not now"
// shrinks the card to a single line, and Kit remembers that.
let setupStep = null;
let signInAgent = null;
let agentsById = {};
async function showSetup(step) {
  setupStep = step;
  const steps = {
    app: ["Want AI to organise your tabs?", "Optional. It needs a one-time setup on your computer (Mac or Linux): copy one line into Terminal.", "Show me how", "home.html#connect"],
    connect: ["Connect an AI assistant", "Kit's helper is installed. Connect Claude Code, Codex or Hermes Agent to organise your tabs.", "Connect one", "home.html#assistants"],
    signin: ["Sign in to organise", "", "Sign in", null],
    desktop: ["Organising needs Claude Code", "You can already ask Claude in the Claude app about your tabs. The one-click Organise here needs Claude Code, which signs in with the same account.", "How to get it", "home.html#assistants"],
  };
  const hidden = step === "app" && (await browser.storage.local.get("aiSetupLater")).aiSetupLater;
  $("organise-controls").hidden = !!step;
  $("setup-card").hidden = !step || hidden;
  $("setup-line").hidden = !hidden;
  if (!step) return;
  const [title, text, button, page] = steps[step];
  $("setup-title").textContent = title;
  $("setup-text").textContent = step === "signin"
    ? `${signInAgent.name} is connected but needs its own sign-in (separate from the Claude app). Your browser opens a sign-in page.`
    : text;
  $("setup").textContent = button;
  $("setup").dataset.page = page || "";
  $("setup-later").hidden = step !== "app";
}

function agentLabel(a) {
  return a.name + (a.experimental ? " (experimental)" : "");
}

function noteFor(id) {
  const a = agentsById[id];
  const how = a && a.model ? `Uses ${a.name} (${a.model}) on your own plan. ` : "";
  return `${how}It can group, move and rename, but can't close tabs.`;
}

// The picker lists only connected assistants that can organise, and that aren't known to be signed
// out; there's no default beyond your last choice.
function showAgents({ agents, chosen }) {
  agentsById = Object.fromEntries(agents.map((a) => [a.id, a]));
  const usable = agents.filter((a) => a.connected && a.can_organise && a.signed_in !== false);
  const select = $("agent");
  const options = usable.map((a) => Object.assign(document.createElement("option"), { value: a.id, textContent: agentLabel(a) }));
  const pick = usable.some((a) => a.id === chosen) ? chosen : usable.length === 1 ? usable[0].id : "";
  if (usable.length > 1 && !pick) options.unshift(Object.assign(document.createElement("option"), { value: "", textContent: "Choose an assistant…" }));
  select.replaceChildren(...options);
  select.value = pick;
  select.disabled = usable.length === 0;
  canOrganise = !!pick;
  $("organise").disabled = !canOrganise || wasBusy;
  $("organise-note").textContent = noteFor(pick);
  signInAgent = agents.find((a) => a.connected && a.can_organise && a.signed_in === false && a.can_sign_in) || null;
  const desktopOnly = !usable.length && !signInAgent && agents.some((a) => a.id === "claude-desktop" && a.installed) &&
    !agents.some((a) => a.can_organise && a.installed);
  showSetup(usable.length ? null : signInAgent ? "signin" : desktopOnly ? "desktop" : "connect");
}

$("agent").addEventListener("change", (e) => {
  canOrganise = !!e.target.value;
  $("organise").disabled = !canOrganise || wasBusy;
  $("organise-note").textContent = noteFor(e.target.value);
  if (e.target.value) send({ cmd: "choose_agent", id: e.target.value });
});

async function refresh() {
  const st = await send({ cmd: "status" });
  showOrganise(st.organise);
  showUndo(st.undo);
  showCounts();
}

function showUndo(label) {
  $("undo").hidden = !label;
  if (label) $("undo").textContent = `↶ Undo: ${label}`;
}

// How much each tidy-up would change right now.
async function showCounts() {
  let p;
  try { p = await send({ cmd: "previews" }); } catch (e) { return; }
  const set = (id, text) => ($(id).textContent = text);
  set("n-group_by_site", p.group_by_site.groups ? `${p.group_by_site.tabs} tabs → ${p.group_by_site.groups} groups` : "nothing to group");
  set("n-apply_rules", !p.rules ? "no rules yet" : p.apply_rules ? `${p.apply_rules} tab${p.apply_rules === 1 ? "" : "s"}` : "");
  set("n-sort_groups", p.groups ? `${p.groups} group${p.groups === 1 ? "" : "s"}` : "no groups");
  set("n-collapse_all", p.expanded ? `${p.expanded} open` : "");
  set("n-dupes", p.duplicates ? String(p.duplicates) : "none");
}

async function init() {
  drawHeader();
  const { connected, lists, organise, undo } = await send({ cmd: "status" });
  aiConnected = connected;
  showOrganise(organise, true);
  showUndo(undo);
  showCounts();
  $("conn").textContent = connected ? "AI connected" : "Tab manager"; // no AI is a normal state, not an error
  if (!connected) showSetup("app");
  else $("organise-controls").hidden = false; // until the assistants load
  $("lists").replaceChildren(...lists.map((name, index) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.addEventListener("click", () => run(b, { cmd: "run_list", index, name }));
    return b;
  }));
  $("no-lists").hidden = lists.length > 0;
  if (connected) showAgents(await send({ cmd: "agents" })); // can take a few seconds the first time
}

document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("click", () => run(b, { cmd: "action", action: b.dataset.action })));

$("dupes").addEventListener("click", async () => {
  dupes = await send({ cmd: "find_duplicates" });
  $("dupe-panel").hidden = false;
  $("dupe-msg").textContent = dupes.length
    ? (dupes.length === 1
      ? "This tab is a copy of a page that's already open. The copy you used most recently stays."
      : `These ${dupes.length} tabs are copies of pages that are already open. The copy you used most recently stays.`)
    : "No duplicate tabs in this window.";
  $("dupe-list").replaceChildren(...dupes.map((t) => {
    const li = document.createElement("li");
    li.textContent = t.title || t.url;
    li.title = t.url;
    return li;
  }));
  $("dupe-close").hidden = dupes.length === 0;
  $("dupe-close").textContent = `Close ${dupes.length === 1 ? "it" : `these ${dupes.length}`}`;
});

$("dupe-cancel").addEventListener("click", () => ($("dupe-panel").hidden = true));
$("dupe-close").addEventListener("click", async (e) => {
  $("dupe-panel").hidden = true;
  await run(e.target, { cmd: "close_tabs", tab_ids: dupes.map((t) => t.id) });
});

$("organise").addEventListener("click", () => {
  const msg = { cmd: "organise", agent: $("agent").value, instructions: $("instructions").value };
  const clicked = Date.now();
  // The outcome arrives through refresh(), even if this menu was closed. An error with no newer
  // result means the run never started (say, no assistant picked), so show it here.
  send(msg).catch(async (e) => {
    const { organise } = await send({ cmd: "status" });
    if (!organise.running && !(organise.last && organise.last.at >= clicked)) {
      showOrganise(organise);
      status(String((e && e.message) || e), "bad");
    }
  });
  showOrganise({ running: true });
});

const sayHi = () => { send({ cmd: "hi" }); window.close(); };
$("hi").addEventListener("click", sayHi);
$("kit-hi").addEventListener("click", sayHi);
const openHome = () => { browser.tabs.create({ url: browser.runtime.getURL("home.html") }); window.close(); };
$("expand").addEventListener("click", openHome);
$("setup").addEventListener("click", () => {
  if (setupStep === "signin" && signInAgent) {
    // Sign in straight away: the background runs it and Kit says when it's done.
    send({ cmd: "sign_in", id: signInAgent.id }).catch(() => {});
    status("Opening the sign-in page in your browser…");
    setTimeout(() => window.close(), 1500);
    return;
  }
  browser.tabs.create({ url: browser.runtime.getURL($("setup").dataset.page || "home.html#connect") });
  window.close();
});
$("setup-later").addEventListener("click", async () => {
  await browser.storage.local.set({ aiSetupLater: true });
  showSetup("app");
});
$("setup-show").addEventListener("click", async () => {
  await browser.storage.local.set({ aiSetupLater: false });
  showSetup("app");
});
$("undo").addEventListener("click", () => run($("undo"), { cmd: "undo" }));
$("expand-foot").addEventListener("click", openHome);
$("options").addEventListener("click", () => { browser.runtime.openOptionsPage(); window.close(); });

init().catch((e) => status(String((e && e.message) || e), "bad"));
