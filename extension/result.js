// The result of the last "Organise with AI" run, as a small card: who ran it and when, the groups
// it made or added to (as coloured chips), and the assistant's own words, cut to two lines with
// "More" when longer. Used by the toolbar menu and the full page.

// Firefox's tab group colours, as Kit draws them (also used by the full page).
const GROUP_HEX = {
  blue: "#378ADD", cyan: "#1D9E9E", green: "#3B9B4A", yellow: "#D4A50F", orange: "#E8833A",
  red: "#D94848", pink: "#D9579B", purple: "#8B5CD6", grey: "#8A8986",
};

function timeAgo(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// last: { ok, summary, at, agent, changes: [{ title, color, count, added, created }] }
function renderResult(container, last, onDismiss) {
  container.replaceChildren();
  container.hidden = !last;
  if (!last) return;
  container.className = `kit-result ${last.ok ? "ok" : "bad"}`;

  const head = el("div", "kit-result-head");
  head.append(el("span", "kit-result-icon", last.ok ? "✓" : "!"));
  head.append(el("strong", "", last.ok ? "Organised" : "Didn't work"));
  head.append(el("span", "kit-result-meta", timeAgo(last.at)));
  if (onDismiss) {
    const close = el("button", "kit-result-close", "×");
    close.title = "Dismiss";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", onDismiss);
    head.append(close);
  }
  container.append(head);

  const changes = last.changes || [];
  if (last.ok) {
    if (changes.length) {
      const chips = el("div", "kit-result-chips");
      for (const c of changes) {
        const chip = el("span", "kit-chip");
        const dot = el("span", "kit-chip-dot");
        dot.style.background = GROUP_HEX[c.color] || GROUP_HEX.grey;
        chip.append(dot, el("span", "kit-chip-name", c.title || "Untitled"));
        chip.append(el("span", "kit-chip-count", c.created ? String(c.count) : `+${c.added}`));
        chip.title = c.created ? `New group, ${c.count} tab${c.count === 1 ? "" : "s"}` : `${c.added} tab${c.added === 1 ? "" : "s"} added`;
        chips.append(chip);
      }
      container.append(chips);
    } else if (Array.isArray(last.changes)) { // older results don't record changes
      container.append(el("p", "kit-result-none", "No groups changed: your tabs were already tidy."));
    }
  }

  const said = (last.summary || "").trim();
  if (said) {
    const text = el("p", "kit-result-text");
    // Who said it, unless the message already starts with their name ("Codex stopped with…").
    if (last.agent && !said.startsWith(last.agent)) text.append(el("span", "kit-result-who", `${last.agent}: `));
    text.append(said);
    container.append(text);
    // Only offer "More" when the text is actually cut off.
    requestAnimationFrame(() => {
      if (text.scrollHeight <= text.clientHeight + 1) return;
      const more = el("button", "kit-result-more", "More");
      more.addEventListener("click", () => {
        const open = text.classList.toggle("open");
        more.textContent = open ? "Less" : "More";
      });
      container.append(more);
    });
  }
}
