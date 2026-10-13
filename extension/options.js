// Editor for grouping rules and action lists, stored in browser.storage.local.

const $ = (id) => document.getElementById(id);
const COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple", "grey"];
const FIELDS = { title: "Title contains", url: "Address contains", site: "Website is" };
let rules = [];
let lists = [];
let stepTypes = {};
let saveTimer = null;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function select(options, value, onChange, label) {
  const s = el("select");
  s.setAttribute("aria-label", label);
  for (const [v, text] of Object.entries(options)) s.append(el("option", { value: v, textContent: text, selected: v === value }));
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function input(value, placeholder, onInput, label) {
  const i = el("input", { value: value || "", placeholder });
  i.setAttribute("aria-label", label);
  i.addEventListener("input", () => onInput(i.value));
  return i;
}

function iconButton(text, label, onClick) {
  const b = el("button", { className: "icon", textContent: text, title: label });
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

const HEX = { blue: "#378ADD", cyan: "#1D9E9E", green: "#3B9B4A", yellow: "#D4A50F", orange: "#E8833A", red: "#D94848", pink: "#D9579B", purple: "#8B5CD6", grey: "#8A8986" };
const PLACEHOLDERS = { title: "recipe", url: "/docs/", site: "github.com" };
const STARTERS = [
  { label: "youtube.com \u2192 Video", rule: { field: "site", text: "youtube.com", group: "Video", color: "red" } },
  { label: "Title contains \u2018recipe\u2019 \u2192 Cooking", rule: { field: "title", text: "recipe", group: "Cooking", color: "orange" } },
  { label: "docs.google.com \u2192 Docs", rule: { field: "site", text: "docs.google.com", group: "Docs", color: "blue" } },
];
let counts = null;
let countTimer = null;
let countSeq = 0;
let noteEls = [];
let statusTimer = null;

function setStatus(message, bad = false) {
  const s = $("saved");
  s.textContent = message;
  s.classList.toggle("bad", bad);
  clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => (s.textContent = ""), bad ? 8000 : 2500);
}

function save(message = "Saved.") {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await browser.storage.local.set({ rules, lists });
    setStatus(message);
  }, 300);
}

function changed(rerender = false, message) {
  save(message);
  if (rerender) render();
  scheduleCounts();
}

function isIncomplete(r) {
  return !String(r.text || "").trim() || !String(r.group || "").trim();
}

function updateNotes() {
  noteEls.forEach((note, i) => {
    const r = rules[i];
    if (!r) return;
    note.classList.remove("hint");
    if (isIncomplete(r)) {
      note.textContent = "Add text and a group";
      note.classList.add("hint");
    } else if (Array.isArray(counts) && Number.isInteger(counts[i])) {
      note.textContent = `Matches ${counts[i]} tab${counts[i] === 1 ? "" : "s"}`;
    } else {
      note.textContent = ""; // counts unavailable: hide
    }
  });
}

function scheduleCounts() {
  clearTimeout(countTimer);
  countTimer = setTimeout(refreshCounts, 300);
  updateNotes();
}

async function refreshCounts() {
  const seq = ++countSeq;
  let result;
  try {
    result = await browser.runtime.sendMessage({ cmd: "rule_counts", rules });
  } catch (e) {
    result = null;
  }
  if (seq !== countSeq) return;
  counts = Array.isArray(result) && result.length === rules.length ? result : null;
  updateNotes();
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= rules.length) return;
  [rules[i], rules[j]] = [rules[j], rules[i]];
  if (counts) [counts[i], counts[j]] = [counts[j], counts[i]];
  changed(true);
}

function colorSelect(r) {
  const swatch = el("span", { className: "swatch" });
  swatch.style.background = HEX[r.color] || HEX.blue;
  const s = select(Object.fromEntries(COLORS.map((c) => [c, c[0].toUpperCase() + c.slice(1)])), r.color || "blue", (v) => {
    r.color = v;
    swatch.style.background = HEX[v] || HEX.blue;
    changed();
  }, "Group colour");
  return el("div", { className: "color-wrap" }, [swatch, s]);
}

function renderRules() {
  noteEls = [];
  const rows = rules.map((r, i) => {
    const text = input(r.text, PLACEHOLDERS[r.field] || PLACEHOLDERS.title, (v) => { r.text = v; changed(); }, "Text to match");
    const note = el("p", { className: "rule-note" });
    noteEls.push(note);
    const up = iconButton("\u2191", "Move rule up", () => move(i, -1));
    const down = iconButton("\u2193", "Move rule down", () => move(i, 1));
    if (i === 0) { up.classList.add("placeholder"); up.disabled = true; up.setAttribute("aria-hidden", "true"); up.tabIndex = -1; }
    if (i === rules.length - 1) { down.classList.add("placeholder"); down.disabled = true; down.setAttribute("aria-hidden", "true"); down.tabIndex = -1; }
    return el("div", { className: "rule-wrap" }, [
      el("div", { className: "rule" }, [
        select(FIELDS, r.field || "title", (v) => { r.field = v; text.placeholder = PLACEHOLDERS[v] || PLACEHOLDERS.title; changed(); }, "Match on"),
        text,
        el("span", { className: "arrow", textContent: "\u2192" }),
        input(r.group, "Group name, e.g. Cooking", (v) => { r.group = v; changed(); }, "Group name"),
        colorSelect(r),
        el("span", { className: "row-actions" }, [up, down, iconButton("\u2715", "Delete rule", () => { rules.splice(i, 1); if (counts) counts.splice(i, 1); changed(true); })]),
      ]),
      note,
    ]);
  });
  if (rows.length) {
    $("rules").replaceChildren(...rows);
  } else {
    const chips = STARTERS.map((st) => {
      const b = el("button", { className: "chip", textContent: st.label, title: "Add this rule" });
      b.addEventListener("click", () => { rules.push({ ...st.rule }); changed(true); });
      return b;
    });
    $("rules").replaceChildren(el("div", { className: "empty-rules" }, [
      el("p", { className: "empty", textContent: "No rules yet. Start with one of these, or add your own." }),
      el("div", { className: "starters" }, chips),
    ]));
  }
  updateNotes();
}

function renderLists() {
  const options = Object.fromEntries(Object.entries(stepTypes).map(([k, v]) => [k, v.label]));
  const cards = lists.map((list, li) => {
    const steps = (list.steps || []).map((step, si) => {
      const arg = stepTypes[step.type] && stepTypes[step.type].arg;
      const argInput = input(step.arg, arg || "", (v) => { step.arg = v; changed(); }, arg || "Step detail");
      argInput.hidden = !arg;
      return el("div", { className: "step" }, [
        select(options, step.type, (v) => {
          step.type = v;
          if (!(stepTypes[v] && stepTypes[v].arg)) step.arg = ""; // a leftover detail would change what the new step does
          changed(true);
        }, "Step"),
        argInput,
        iconButton("✕", "Delete step", () => { list.steps.splice(si, 1); changed(true); }),
      ]);
    });
    return el("div", { className: "list" }, [
      el("div", { className: "list-head" }, [
        input(list.name, "List name, e.g. Study mode", (v) => { list.name = v; changed(); }, "List name"),
        iconButton("Delete list", "Delete list", () => { lists.splice(li, 1); changed(true); }),
      ]),
      ...(steps.length ? steps : [el("p", { className: "empty", textContent: "No steps yet." })]),
      el("div", { className: "actions" }, [
        Object.assign(el("button", { textContent: "Add step" }), {
          onclick: () => { (list.steps = list.steps || []).push({ type: "apply_rules", arg: "" }); changed(true); },
        }),
      ]),
    ]);
  });
  $("lists").replaceChildren(...(cards.length ? cards : [el("p", { className: "empty", textContent: "No lists yet." })]));
}

function render() {
  renderRules();
  renderLists();
}

$("add-rule").addEventListener("click", () => { rules.push({ field: "title", text: "", group: "", color: "blue" }); changed(true); });
$("add-list").addEventListener("click", () => { lists.push({ name: "", steps: [{ type: "apply_rules", arg: "" }] }); changed(true); });
$("suggest").addEventListener("click", async () => {
  let suggested;
  try { suggested = await browser.runtime.sendMessage({ cmd: "suggest_rules" }); } catch (e) { suggested = null; }
  if (!Array.isArray(suggested)) { setStatus("Couldn't get suggestions.", true); return; }
  const key = (r) => [r.field, r.text, r.group].join("\u0000").toLowerCase();
  const have = new Set(rules.map(key));
  const fresh = suggested.filter((r) => !have.has(key(r)));
  rules.push(...fresh);
  changed(true, fresh.length ? `Added ${fresh.length} suggested rule${fresh.length === 1 ? "" : "s"}.` : "No new suggestions.");
});

(async () => {
  stepTypes = await browser.runtime.sendMessage({ cmd: "step_types" });
  const s = await browser.storage.local.get(["rules", "lists"]);
  rules = Array.isArray(s.rules) ? s.rules : [];
  lists = Array.isArray(s.lists) ? s.lists : [];
  render();
  refreshCounts();
})();

// Export / import
function validRule(r) {
  const str = (v) => typeof v === "string" && v.length <= 200;
  return r && typeof r === "object" && Object.hasOwn(FIELDS, r.field) && str(r.text) && str(r.group) && COLORS.includes(r.color);
}
function validList(l) {
  return l && typeof l === "object" && typeof l.name === "string" && l.name.length <= 200 && Array.isArray(l.steps) && l.steps.length <= 200 &&
    l.steps.every((st) => st && typeof st === "object" && Object.hasOwn(stepTypes, st.type) && (st.arg === undefined || (typeof st.arg === "string" && st.arg.length <= 200)));
}
function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("That file isn't valid JSON."); }
  if (!data || typeof data !== "object" || !Array.isArray(data.rules) || !Array.isArray(data.lists)) throw new Error("That file doesn't look like a Kit export.");
  if (data.rules.length > 500 || data.lists.length > 200) throw new Error("That file has too many rules or lists.");
  const badRule = data.rules.findIndex((r) => !validRule(r));
  if (badRule >= 0) throw new Error(`Rule ${badRule + 1} isn't valid (check its type, colour and text length).`);
  const badList = data.lists.findIndex((l) => !validList(l));
  if (badList >= 0) throw new Error(`List ${badList + 1} isn't valid (check its steps and text length).`);
  return {
    rules: data.rules.map((r) => ({ field: r.field, text: r.text, group: r.group, color: r.color })),
    lists: data.lists.map((l) => ({ name: l.name, steps: l.steps.map((st) => ({ type: st.type, arg: st.arg || "" })) })),
  };
}
$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, rules, lists }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: "kit-rules.json" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Exported kit-rules.json.");
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const next = parseImport(await file.text());
    const n = next.rules.length, m = next.lists.length;
    if (!window.confirm(`Replace your rules and lists with ${n} rule${n === 1 ? "" : "s"} and ${m} list${m === 1 ? "" : "s"} from this file?`)) return;
    rules = next.rules;
    lists = next.lists;
    counts = null;
    changed(true, "Imported.");
  } catch (err) {
    setStatus(err.message || "Couldn't import that file.", true);
  }
});

$("nav-home").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("home.html") }));

// Saves wait a moment after typing; closing the tab saves straight away.
addEventListener("pagehide", () => {
  if (saveTimer) browser.storage.local.set({ rules, lists });
});
