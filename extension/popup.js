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

// Claude can take a minute; the menu may be closed and reopened meanwhile, so it asks for news.
let wasBusy = false;

function showOrganise(organise, opening = false) {
  const busy = organise.running;
  const justFinished = wasBusy && !busy;
  wasBusy = busy;
  $("organise").disabled = busy;
  $("organise").textContent = busy ? "Claude is working…" : "Organise my tabs";
  if (busy) {
    status("Claude is organising your tabs. This can take a minute, and you can close this menu.");
    polling = polling || setInterval(refresh, 2000);
  } else {
    clearInterval(polling);
    polling = null;
    if ((opening || justFinished) && organise.last && Date.now() - organise.last.at < RECENT_MS) status(organise.last.summary, organise.last.ok ? "ok" : "bad");
  }
}

async function refresh() {
  showOrganise((await send({ cmd: "status" })).organise);
}

async function init() {
  drawHeader();
  const { connected, lists, organise } = await send({ cmd: "status" });
  showOrganise(organise, true);
  $("conn").textContent = connected ? "Connected" : "Bridge not running";
  $("lists").replaceChildren(...lists.map((name, index) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.addEventListener("click", () => run(b, { cmd: "run_list", index }));
    return b;
  }));
  $("no-lists").hidden = lists.length > 0;
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
  const msg = { cmd: "organise", instructions: $("instructions").value };
  send(msg).catch(() => {}); // the outcome arrives through refresh(), even if this menu was closed
  showOrganise({ running: true });
});

const sayHi = () => { send({ cmd: "hi" }); window.close(); };
$("hi").addEventListener("click", sayHi);
$("kit-hi").addEventListener("click", sayHi);
const openHome = () => { browser.tabs.create({ url: browser.runtime.getURL("home.html") }); window.close(); };
$("expand").addEventListener("click", openHome);
$("expand-foot").addEventListener("click", openHome);
$("options").addEventListener("click", () => { browser.runtime.openOptionsPage(); window.close(); });

init().catch((e) => status(String((e && e.message) || e), "bad"));
