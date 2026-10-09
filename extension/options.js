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

function save(message = "Saved.") {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await browser.storage.local.set({ rules, lists });
    $("saved").textContent = message;
    setTimeout(() => ($("saved").textContent = ""), 2500);
  }, 300);
}

function changed(rerender = false, message) {
  save(message);
  if (rerender) render();
}

function renderRules() {
  const rows = rules.map((r, i) => el("div", { className: "rule" }, [
    select(FIELDS, r.field || "title", (v) => { r.field = v; changed(); }, "Match on"),
    input(r.text, r.field === "site" ? "example.com" : "text to look for", (v) => { r.text = v; changed(); }, "Text to match"),
    el("span", { className: "arrow", textContent: "→" }),
    input(r.group, "group name", (v) => { r.group = v; changed(); }, "Group name"),
    select(Object.fromEntries(COLORS.map((c) => [c, c])), r.color || "blue", (v) => { r.color = v; changed(); }, "Group colour"),
    el("span", {}, [
      iconButton("↑", "Move rule up", () => { if (i > 0) { [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; changed(true); } }),
      iconButton("✕", "Delete rule", () => { rules.splice(i, 1); changed(true); }),
    ]),
  ]));
  $("rules").replaceChildren(...(rows.length ? rows : [el("p", { className: "empty", textContent: "No rules yet." })]));
}

function renderLists() {
  const options = Object.fromEntries(Object.entries(stepTypes).map(([k, v]) => [k, v.label]));
  const cards = lists.map((list, li) => {
    const steps = (list.steps || []).map((step, si) => {
      const arg = stepTypes[step.type] && stepTypes[step.type].arg;
      const argInput = input(step.arg, arg || "", (v) => { step.arg = v; changed(); }, arg || "Step detail");
      argInput.hidden = !arg;
      return el("div", { className: "step" }, [
        select(options, step.type, (v) => { step.type = v; changed(true); }, "Step"),
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
  const suggested = await browser.runtime.sendMessage({ cmd: "suggest_rules" });
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
})();

$("nav-home").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("home.html") }));
