const RANKS = "AKQJT98765432";

function handGrid() {
  const grid = [];
  for (let r = 0; r < 13; r++) {
    const row = [];
    for (let c = 0; c < 13; c++) {
      if (r === c) row.push(RANKS[r] + RANKS[r]);
      else if (r < c) row.push(RANKS[r] + RANKS[c] + "s");
      else row.push(RANKS[c] + RANKS[r] + "o");
    }
    grid.push(row);
  }
  return grid;
}

const HAND_GRID = handGrid();

function rgb(color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

// WCAG relative luminance -- lets us pick readable (dark-on-light vs
// light-on-dark) text instead of the fixed dark text every cell/legend
// pill used before, which turned invisible against the palette's darker
// action colors (e.g. the near-black green/purple "shove-then-fold" tiers).
function relativeLuminance([r, g, b]) {
  const linear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function readableTextClass(color) {
  return relativeLuminance(color) > 0.5 ? "on-light" : "on-dark";
}

const state = {
  data: null,
  actionById: new Map(),
  selection: null, // { type: "family", familyId } | { type: "nash", role }
};

// Position (column) x decision-type (row) layout, reconstructing the
// spatial structure the original button-table had (which made it
// scannable despite the jargon) while collapsing "one button per stack"
// down to "one button per scenario family" via the slider. Multiple
// villain variants that land in the same row/column (e.g. BB facing a
// limp from either SB or BTN) get a short tag distinguishing them within
// that cell instead of a separate row.
const NAV_LAYOUT = {
  "3way": {
    columns: [["btn", "BTN"], ["sb", "SB"], ["bb", "BB"]],
    rows: [
      { label: "Ouverture", cells: {
        btn: [{ id: "btn" }], sb: [{ id: "sb_vs_bb" }], bb: [],
      } },
      { label: "Vs Limp", cells: {
        btn: [], sb: [{ id: "sb_vs_btn_limp" }],
        bb: [{ id: "bb_vs_limp_sb", tag: "vs SB" }, { id: "bb_vs_btn_limp", tag: "vs BTN" }],
      } },
      { label: "Vs Min-Raise", cells: {
        btn: [], sb: [{ id: "sb_vs_mr_btn" }],
        bb: [{ id: "bb_vs_mr_btn", tag: "vs BTN" }, { id: "bb_vs_mr_sb", tag: "vs SB" }],
      } },
      { label: "Call (vs Shove)", cells: {
        btn: [], sb: [{ id: "cos_sb_vs_btn" }],
        bb: [{ id: "cos_bb_vs_btn", tag: "vs BTN" }, { id: "cos_bb_vs_sb", tag: "vs SB" }],
      } },
      { label: "GTO", cells: {
        btn: [{ id: "gto_bu_vs_ai_sbplusbb" }], sb: [], bb: [{ id: "gto_bb_vs_3bai_sb" }],
      } },
    ],
  },
  "hu": {
    columns: [["btn", "BTN"], ["bb", "BB"]],
    rows: [
      { label: "Ouverture", cells: { btn: [{ id: "hu_sb" }], bb: [] } },
      { label: "Vs Limp", cells: { btn: [], bb: [{ id: "hu_bb_vs_limp" }] } },
      { label: "Vs Min-Raise", cells: { btn: [], bb: [{ id: "hu_bb_vs_mr" }] } },
      { label: "Call (vs Shove)", cells: { btn: [], bb: [{ id: "cos_hu" }] } },
      { label: "GTO / Nash", cells: {
        btn: [{ nash: "pusher" }], bb: [{ nash: "caller" }],
      } },
    ],
  },
};
const GROUP_LABELS = { "3way": "3-way", "hu": "Heads-Up" };

function main() {
  state.data = window.APP_DATA;
  state.actionById = new Map(state.data.actions.map(a => [a.id, a]));

  buildNav();

  document.getElementById("stack-slider").addEventListener("input", onStackSliderInput);
}

function familyStackRange(familyId) {
  const stacks = familyScenarios(familyId).map(s => s.stack);
  if (stacks.length === 0) return "";
  const min = Math.min(...stacks), max = Math.max(...stacks);
  return min === max ? `${min}bb` : `${min}–${max}bb`;
}

function buildNav() {
  const container = document.getElementById("sidebar-groups");
  const familyLabel = new Map(state.data.families.map(f => [f.id, f.label]));

  for (const groupKey of ["3way", "hu"]) {
    const layout = NAV_LAYOUT[groupKey];
    const section = document.createElement("div");
    section.className = "sidebar-group";
    const h2 = document.createElement("h2");
    h2.textContent = GROUP_LABELS[groupKey];
    section.appendChild(h2);

    const table = document.createElement("div");
    table.className = "nav-table";
    table.style.gridTemplateColumns = `auto repeat(${layout.columns.length}, 1fr)`;

    table.appendChild(document.createElement("div")).className = "nav-corner";
    for (const [, colLabel] of layout.columns) {
      const colHead = document.createElement("div");
      colHead.className = "nav-col-head";
      colHead.textContent = colLabel;
      table.appendChild(colHead);
    }

    for (const row of layout.rows) {
      const rowHead = document.createElement("div");
      rowHead.className = "nav-row-head";
      rowHead.textContent = row.label;
      table.appendChild(rowHead);

      for (const [colKey] of layout.columns) {
        const cellEl = document.createElement("div");
        cellEl.className = "nav-cell";
        const items = row.cells[colKey] || [];
        for (const item of items) {
          cellEl.appendChild(makeNavButton(item, familyLabel));
        }
        table.appendChild(cellEl);
      }
    }

    section.appendChild(table);
    container.appendChild(section);
  }
}

function makeNavButton(item, familyLabel) {
  const btn = document.createElement("button");
  btn.className = "sidebar-item";

  if (item.nash) {
    btn.classList.add("nav-nash-btn");
    btn.textContent = item.nash === "pusher" ? "Nash Pusher" : "Nash Caller";
    btn.title = familyLabel.get(item.id) || "";
    btn.addEventListener("click", () => activateNavButton(btn, () => selectNash(item.nash)));
    return btn;
  }

  const main = document.createElement("span");
  main.className = "nav-btn-main";
  main.textContent = item.tag || familyStackRange(item.id);
  btn.appendChild(main);
  if (item.tag) {
    const sub = document.createElement("span");
    sub.className = "nav-btn-sub";
    sub.textContent = familyStackRange(item.id);
    btn.appendChild(sub);
  }
  btn.title = familyLabel.get(item.id) || "";
  btn.addEventListener("click", () => activateNavButton(btn, () => selectFamily(item.id)));
  return btn;
}

function activateNavButton(btn, onClick) {
  document.querySelectorAll(".sidebar-item.active").forEach(el => el.classList.remove("active"));
  btn.classList.add("active");
  onClick();
}

function familyScenarios(familyId) {
  return state.data.scenarios
    .filter(s => s.familyId === familyId)
    .sort((a, b) => a.stack - b.stack);
}

function selectFamily(familyId) {
  const scenarios = familyScenarios(familyId);
  const family = state.data.families.find(f => f.id === familyId);
  state.selection = { type: "family", familyId, scenarios, family };

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("nash-view").classList.add("hidden");
  document.getElementById("scenario-view").classList.remove("hidden");
  document.getElementById("stack-control").classList.remove("hidden");

  const slider = document.getElementById("stack-slider");
  slider.min = 0;
  slider.max = scenarios.length - 1;
  slider.step = 1;
  slider.value = scenarios.length - 1; // default to deepest stack

  document.getElementById("scenario-title").textContent = family.label;
  renderScenarioAtIndex(scenarios.length - 1);
}

function onStackSliderInput(e) {
  renderScenarioAtIndex(parseInt(e.target.value, 10));
}

function renderScenarioAtIndex(index) {
  const { scenarios } = state.selection;
  const scenario = scenarios[index];
  document.getElementById("stack-value").textContent = scenario.stack;
  renderGrid(scenario);
  renderLegend(scenario);
}

function renderGrid(scenario) {
  const gridEl = document.getElementById("grid");
  gridEl.innerHTML = "";
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const hand = HAND_GRID[r][c];
      const pieces = scenario.cells[hand] || [];
      const cell = document.createElement("div");
      cell.className = "cell";
      const total = pieces.reduce((sum, p) => sum + p.weight, 0) || 1;
      let majorityPiece = null;
      for (const piece of pieces) {
        const action = state.actionById.get(piece.actionId);
        const slice = document.createElement("div");
        slice.className = "cell-slice";
        slice.style.flex = `${piece.weight} 0 0`;
        slice.style.background = rgb(action.color);
        cell.appendChild(slice);
        if (!majorityPiece || piece.weight > majorityPiece.weight) majorityPiece = piece;
      }
      const label = document.createElement("span");
      // Label sits over the cell's largest slice (a split cell can't satisfy
      // every slice's contrast at once) -- fold's white default covers the
      // empty/no-piece case, which never happens in practice.
      const bgColor = majorityPiece ? state.actionById.get(majorityPiece.actionId).color : [255, 255, 255];
      label.className = "cell-label " + readableTextClass(bgColor);
      label.textContent = hand;
      cell.appendChild(label);
      gridEl.appendChild(cell);
    }
  }
}

function renderLegend(scenario) {
  const legendEl = document.getElementById("legend");
  legendEl.innerHTML = "";
  for (const entry of scenario.legend) {
    const action = state.actionById.get(entry.actionId);
    const item = document.createElement("span");
    item.className = "legend-item " + readableTextClass(action.color) +
      (entry.label.includes("???") ? " unconfirmed" : "");
    item.style.background = rgb(action.color);
    item.textContent = entry.label;
    legendEl.appendChild(item);
  }
}

function handSuitClass(hand) {
  if (hand.length === 2) return "pocket";
  return hand.endsWith("s") ? "suited" : "offsuit";
}

function selectNash(role) {
  const nash = state.data.nashScenarios.find(n => n.role === role);
  state.selection = { type: "nash", role };

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("scenario-view").classList.add("hidden");
  document.getElementById("nash-view").classList.remove("hidden");
  document.getElementById("stack-control").classList.add("hidden");

  document.getElementById("nash-title").textContent = nash.title || (role === "pusher" ? "Nash — Pusher" : "Nash — Caller");

  const gridEl = document.getElementById("nash-grid");
  gridEl.innerHTML = "";
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const hand = HAND_GRID[r][c];
      const cell = document.createElement("div");
      cell.className = "cell " + handSuitClass(hand);
      const handEl = document.createElement("span");
      handEl.className = "nash-hand";
      handEl.textContent = hand;
      const valueEl = document.createElement("span");
      valueEl.className = "nash-value";
      valueEl.textContent = nash.cells[hand] || "";
      cell.appendChild(handEl);
      cell.appendChild(valueEl);
      gridEl.appendChild(cell);
    }
  }
}

main();
