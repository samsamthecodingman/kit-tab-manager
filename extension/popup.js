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
function showAgents({ agents, chosen }) {
  const usable = agents.filter((a) => a.connected && a.can_organise);
  const select = $("agent");
  const options = usable.map((a) => Object.assign(document.createElement("option"), { value: a.id, textContent: a.name }));
  const pick = usable.some((a) => a.id === chosen) ? chosen : usable.length === 1 ? usable[0].id : "";
  if (usable.length > 1 && !pick) options.unshift(Object.assign(document.createElement("option"), { value: "", textContent: "Choose an assistant…" }));
  if (!usable.length) options.push(Object.assign(document.createElement("option"), { value: "", textContent: "No assistant connected" }));
  select.replaceChildren(...options);
  select.value = pick;
  select.disabled = usable.length === 0;
  canOrganise = !!pick;
  $("organise").disabled = !canOrganise || wasBusy;
  $("organise-note").hidden = usable.length === 0;
  $("setup-note").hidden = usable.length > 0;
  $("setup-text").textContent = "Connect Claude Code, Codex or Hermes Agent to use this.";
  $("setup").textContent = "Connect one";
}

$("agent").addEventListener("change", (e) => {
  canOrganise = !!e.target.value;
  $("organise").disabled = !canOrganise || wasBusy;
  if (e.target.value) send({ cmd: "choose_agent", id: e.target.value });
});

async function refresh() {
  showOrganise((await send({ cmd: "status" })).organise);
}

async function init() {
  drawHeader();
  const { connected, lists, organise } = await send({ cmd: "status" });
  aiConnected = connected;
  showOrganise(organise, true);
  $("conn").textContent = connected ? "AI connected" : "AI not connected";
  $("organise-note").hidden = !connected;
  $("setup-note").hidden = connected;
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
  browser.tabs.create({ url: browser.runtime.getURL(aiConnected ? "home.html#assistants" : "home.html#connect") });
  window.close();
});
$("expand-foot").addEventListener("click", openHome);
$("options").addEventListener("click", () => { browser.runtime.openOptionsPage(); window.close(); });

init().catch((e) => status(String((e && e.message) || e), "bad"));
