// Draws the world from server state and sends map clicks. The browser never simulates anything.

import { initGod, action, config } from './god.js';

// Layout: the map fills the room left beside the two panels, but stays short enough
// that the history chart below it is visible without scrolling.
const PAGE_PAD = 16; // page padding and gap between columns (style.css)
const SCROLLBAR = 20;
const MIN_MAP = 320;
const CHART_H = 140;
let TILE_PX = 16; // screen pixels per tile, recomputed by fit()
const COLORS = ['#5a9e3f', '#2f6fc4', '#1f4a1c', '#e8b33a']; // grass, water, tree, food
const AGENT_COLORS = ['#e63946', '#f4a261', '#b5179e', '#00b4d8', '#ffffff', '#9b5de5', '#ff70a6', '#70d6ff', '#c0fdff', '#ffd670'];
const NEED_COLORS = { hunger: '#e76f51', thirst: '#4ea8de', energy: '#ffd166', health: '#57cc99' };
const NEEDS = Object.keys(NEED_COLORS);
const SEX = { F: '♀', M: '♂' };
const MARKERS = { sleep: 'z', mate: '♥', fight: '⚔' };

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const chart = document.getElementById('history');
const cctx = chart.getContext('2d');
const $ = (id) => document.getElementById(id);
const isDead = (a) => a.action === 'dead';
const agentColor = (a) => (isDead(a) ? '#666' : AGENT_COLORS[(a.id - 1) % AGENT_COLORS.length]);

let state = null;
let selectedId = 1; // agent shown in the details box and the history chart

function fmtHour(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- world view ---

function mapCssSize() {
  const side = $('panel').offsetWidth + $('god').offsetWidth + PAGE_PAD * 4 + SCROLLBAR;
  const room = window.innerWidth - side;
  // Narrow window: the panels wrap below the map, so use the full width.
  const width = room < MIN_MAP ? window.innerWidth - PAGE_PAD * 2 - SCROLLBAR : room;
  // Everything in the map column except the map itself: hint line, chart heading, chart.
  const below = $('map-col').offsetHeight - canvas.offsetHeight;
  return Math.max(MIN_MAP, Math.min(width, window.innerHeight - PAGE_PAD * 2 - below));
}

let fittedFor = '';
function fit(size) {
  const dpr = window.devicePixelRatio || 1;
  const css = mapCssSize();
  const key = `${size}|${css}|${dpr}`;
  if (key === fittedFor) return;
  fittedFor = key;
  TILE_PX = Math.max(4, Math.floor((css * dpr) / size));
  canvas.width = canvas.height = TILE_PX * size;
  const shown = `${canvas.width / dpr}px`;
  canvas.style.width = canvas.style.height = shown;
  chart.width = canvas.width;
  chart.height = Math.round(CHART_H * dpr);
  chart.style.width = shown;
  chart.style.height = `${CHART_H}px`;
  $('map-col').style.width = shown;
  drawChart();
}
window.addEventListener('resize', () => state && (fit(state.size), draw(state)));

// Women are circles, men squares; children are drawn smaller (they grow with their strength).
function drawAgent(c, a, cx, cy, full) {
  const grow = a.stage === 'child' ? 0.55 + 0.45 * ((a.strength - 0.25) / 0.75) : 1;
  const r = (full / 2) * grow;
  c.fillStyle = agentColor(a);
  c.strokeStyle = '#000';
  c.lineWidth = Math.max(1, full / 14);
  c.beginPath();
  if (a.sex === 'F') c.arc(cx, cy, r, 0, Math.PI * 2);
  else c.rect(cx - r, cy - r, r * 2, r * 2);
  c.fill();
  c.stroke();
}

function draw(s) {
  fit(s.size);
  const px = s.size * TILE_PX;
  const inset = Math.round(TILE_PX / 4); // berry margin

  for (let i = 0; i < s.grid.length; i++) {
    const x = i % s.size;
    const y = (i - x) / s.size;
    const t = +s.grid[i];
    ctx.fillStyle = t === 3 ? COLORS[0] : COLORS[t];
    ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    if (t === 3) { // food: small berry on grass
      ctx.fillStyle = COLORS[3];
      ctx.fillRect(x * TILE_PX + inset, y * TILE_PX + inset, TILE_PX - 2 * inset, TILE_PX - 2 * inset);
    }
  }

  if (s.clock.darkness > 0) {
    ctx.fillStyle = `rgba(8, 12, 40, ${s.clock.darkness})`;
    ctx.fillRect(0, 0, px, px);
  }

  for (const a of s.agents) {
    const cx = (a.x + 0.5) * TILE_PX;
    const cy = (a.y + 0.5) * TILE_PX;
    if (a.target) { // dashed line to target
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1, TILE_PX / 16);
      ctx.setLineDash([TILE_PX / 5, TILE_PX / 5]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo((a.target.x + 0.5) * TILE_PX, (a.target.y + 0.5) * TILE_PX);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = isDead(a) ? 0.6 : 1;
    drawAgent(ctx, a, cx, cy, TILE_PX * 0.78);
    ctx.globalAlpha = 1;
    if (a.id === selectedId) { // ring around the selected agent
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, TILE_PX / 10);
      ctx.strokeRect(a.x * TILE_PX - 1, a.y * TILE_PX - 1, TILE_PX + 2, TILE_PX + 2);
    }
    const mark = MARKERS[a.action];
    if (mark) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(TILE_PX * 0.65)}px sans-serif`;
      ctx.fillText(mark, a.x * TILE_PX + TILE_PX * 0.75, a.y * TILE_PX + TILE_PX * 0.15);
    }
  }
}

// Click an agent to select it; click empty grass to drop food.
canvas.addEventListener('click', (e) => {
  if (!state) return;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.size);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.size);
  const here = state.agents.filter((a) => a.x === x && a.y === y);
  if (here.length) {
    const i = here.findIndex((a) => a.id === selectedId); // repeated clicks cycle through a crowd
    select(here[(i + 1) % here.length].id);
  } else {
    action('spawn_food', { x, y }, { quiet: true }); // clicks on water/trees/food just do nothing
  }
});

// --- status panel ---
const NEED_HELP = {
  hunger: 'Hunger: 0 is full, 100 is starving. Rises every tick; eating a berry lowers it.',
  thirst: 'Thirst: 0 is not thirsty, 100 is parched. Rises every tick; drinking at a lake edge lowers it.',
  energy: 'Energy: 100 is fully rested, 0 is exhausted. Falls every tick (faster for children and elders); sleeping restores it.',
  health: 'Health: drops while any need is at its limit, after a lost fight, and in old age; slowly recovers otherwise. At 0 the agent dies.',
};
const SCORE_HELP = {
  eat: 'Score for eating = current hunger (— means no berry can be reached).',
  seek_water: 'Score for drinking = current thirst (— means no water can be reached).',
  sleep: 'Score for sleeping = 100 − energy, plus the night bonus at night.',
  mate: 'Score for mating: just above wandering, but only when the agent is a content adult and an unrelated content adult of the other sex can be reached (— otherwise).',
  wander: 'Score for wandering = the fixed Wander base score.',
};
const STAGE_HELP = {
  child: 'Child: weaker, tires faster, heals more slowly. Can’t mate or fight yet.',
  adult: 'Adult: full strength. Can mate and fight.',
  elder: 'Elder: in the last days of its lifespan, slowly losing strength. Can fight but no longer has children.',
};

function bar(name, value) {
  return `<div class="bar" title="${NEED_HELP[name]}"><span>${name}</span>
    <div class="track"><div class="fill" style="width:${value}%;background:${NEED_COLORS[name]}"></div></div>
    <span class="num">${value.toFixed(0)}</span></div>`;
}

const miniBars = (a) => `<span class="minibars">${NEEDS.map((n) =>
  `<i title="${n} ${a[n].toFixed(0)}"><b style="width:${a[n]}%;background:${NEED_COLORS[n]}"></b></i>`).join('')}</span>`;

const swatch = (a) => `<span class="swatch ${a.sex === 'F' ? 'f' : 'm'}" style="background:${agentColor(a)}"></span>`;
const ageText = (a) => `${a.age.toFixed(1)} d`;

function details(a, s) {
  const best = Object.entries(a.scores).reduce((m, e) => (e[1] !== null && (m === null || e[1] > m[1]) ? e : m), null);
  const scores = Object.entries(a.scores).map(([k, v]) =>
    `<tr title="${SCORE_HELP[k] ?? ''}"><td>${k}</td><td class="${best && k === best[0] ? 'best' : ''}">${v === null ? '—' : v}</td></tr>`).join('');
  const recent = a.recent.slice(0, 5).map((r) => `<tr><td>t${r.tick}</td><td>${r.action}</td></tr>`).join('');
  const parent = (id) => (id === null ? '' : `${id}${s.agents.some((x) => x.id === id) ? '' : ' (gone)'}`);
  const parents = a.motherId === null ? 'none (added by god mode)' : `mother ${parent(a.motherId)}, father ${parent(a.fatherId)}`;
  const children = s.agents.filter((x) => x.motherId === a.id || x.fatherId === a.id).map((x) => x.id);
  const life = isDead(a)
    ? `<b>Died</b> of ${a.cause} at ${ageText(a)}`
    : `<span title="${STAGE_HELP[a.stage]}">${a.stage}</span>, ${ageText(a)} of about ${a.lifespan.toFixed(0)} · strength ${a.strength.toFixed(2)}`;
  return `<div class="details">
    <h2>${swatch(a)} Agent ${a.id} ${SEX[a.sex]} <span class="action">${a.action}</span></h2>
    <div class="muted">${life}</div>
    <div class="muted">at (${a.x}, ${a.y})${a.target ? ` → (${a.target.x}, ${a.target.y})` : ''} · parents: ${parents}${children.length ? ` · children: ${children.join(', ')}` : ''}</div>
    ${bar('hunger', a.hunger)}${bar('thirst', a.thirst)}${bar('energy', a.energy)}${bar('health', a.health)}
    <details ${openScores ? 'open' : ''}><summary title="Each tick the agent scores its options and does the highest (highlighted). The currently chosen action gets a small bonus. Below the scores: when it last switched action.">scores &amp; recent actions</summary>
      <table>${scores}</table><table>${recent}</table></details>
  </div>`;
}
let openScores = true;

function renderPanel(s) {
  const c = s.clock;
  $('clock').textContent = `Day ${c.day} · ${fmtHour(c.hour)} ${c.isNight ? '🌙' : '☀️'}`;
  $('world-info').textContent =
    `Tick ${s.tick} · population ${s.population} · births ${s.births} · deaths ${s.deaths} · food ${s.foodCount}${s.running ? '' : ' · paused'}`;

  if (!s.agents.some((a) => a.id === selectedId) && s.agents.length) selectedId = s.agents[0].id;
  const rows = s.agents.map((a) => `<tr class="agent-row ${a.id === selectedId ? 'selected' : ''} ${isDead(a) ? 'dead' : ''}" data-id="${a.id}"
      title="Click to see this agent's details and history.">
    <td>${swatch(a)} ${a.id}</td><td>${SEX[a.sex]}</td><td>${ageText(a)}</td>
    <td>${isDead(a) ? `† ${a.cause}` : a.action}</td><td>${isDead(a) ? '' : miniBars(a)}</td>
    <td><button class="small danger remove-agent" data-id="${a.id}" title="Remove this agent from the world. Its past history stays until you clear history.">✕</button></td></tr>`).join('');
  const sel = s.agents.find((a) => a.id === selectedId);
  $('agents').innerHTML = s.agents.length
    ? `<table class="agent-list">${rows}</table>${sel ? details(sel, s) : ''}`
    : '<p class="muted">No agents. Use Add agent or Reset world.</p>';
  const d = $('agents').querySelector('details');
  if (d) d.ontoggle = () => (openScores = d.open);
}

function select(id) {
  selectedId = id;
  history.agentId = id;
  $('history-agent').value = id;
  loadHistory();
  if (state) {
    draw(state);
    renderPanel(state);
  }
}

// --- history chart (needs over time for one agent) ---
const history = { agentId: 1, rows: [], lastTick: -1 };

async function loadHistory() {
  if (!state) return;
  const from = Math.max(0, state.tick - (config.historyTicks || 480));
  history.rows = await fetch(`/api/log?from=${from}&to=${state.tick}&agent=${history.agentId}`).then((r) => r.json());
  history.lastTick = state.tick;
  drawChart();
}

function updateHistory(s) {
  if (s.tick < history.lastTick) return loadHistory(); // reset or snapshot load rewound time
  const a = s.agents.find((x) => x.id === history.agentId);
  if (a && !isDead(a) && s.tick > history.lastTick) {
    history.rows.push({ tick: s.tick, day: s.clock.day, ...Object.fromEntries(NEEDS.map((n) => [n, a[n]])) });
    const keep = config.historyTicks || 480;
    while (history.rows.length && history.rows[0].tick < s.tick - keep) history.rows.shift();
  }
  history.lastTick = s.tick;

  // Agent picker
  const sel = $('history-agent');
  const ids = s.agents.map((x) => x.id).join(',');
  if (sel.dataset.ids !== ids) {
    sel.dataset.ids = ids;
    sel.innerHTML = s.agents.map((x) => `<option value="${x.id}">Agent ${x.id} ${SEX[x.sex]}</option>`).join('');
    if (s.agents.length && !s.agents.some((x) => x.id === history.agentId)) {
      history.agentId = selectedId; // selected agent was removed
      loadHistory();
    }
    sel.value = history.agentId;
  }
  drawChart();
}

function drawChart() {
  const w = chart.width;
  const h = chart.height;
  cctx.clearRect(0, 0, w, h);
  const rows = history.rows;
  if (rows.length < 2) return;
  const t0 = rows[0].tick;
  const span = Math.max(1, rows[rows.length - 1].tick - t0);
  const X = (t) => ((t - t0) / span) * (w - 1);
  const Y = (v) => h - 4 * dpr - (v / 100) * (h - 8 * dpr);

  // Day boundaries
  const dpr = window.devicePixelRatio || 1;
  cctx.fillStyle = '#8a939e';
  cctx.font = `${10 * dpr}px sans-serif`;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].day !== rows[i - 1].day) {
      cctx.fillRect(X(rows[i].tick), 0, dpr, h);
      cctx.fillText(`day ${rows[i].day}`, X(rows[i].tick) + 3 * dpr, 10 * dpr);
    }
  }

  for (const n of NEEDS) {
    cctx.strokeStyle = NEED_COLORS[n];
    cctx.lineWidth = 1.5 * dpr;
    cctx.beginPath();
    rows.forEach((r, i) => (i ? cctx.lineTo(X(r.tick), Y(r[n])) : cctx.moveTo(X(r.tick), Y(r[n]))));
    cctx.stroke();
  }
}

$('legend').innerHTML = NEEDS.map((n) => `<b style="background:${NEED_COLORS[n]}"></b>${n}`).join('');

// The agent list is re-rendered every tick, so listen on the container.
$('agents').addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-agent');
  if (btn) {
    if (confirm(`Remove agent ${btn.dataset.id}? This cannot be undone.`)) action('remove_agent', { id: Number(btn.dataset.id) });
    return;
  }
  const row = e.target.closest('.agent-row');
  if (row) select(Number(row.dataset.id));
});

$('history-agent').onchange = (e) => select(Number(e.target.value));

// --- live connection ---
const es = new EventSource('/api/stream');
let first = true;
es.onmessage = (e) => {
  state = JSON.parse(e.data);
  draw(state);
  renderPanel(state);
  if (first) {
    first = false;
    loadHistory();
  } else {
    updateHistory(state);
  }
};
es.onopen = () => {
  $('conn').textContent = 'live';
  $('conn').className = 'pill live';
};
es.onerror = () => {
  $('conn').textContent = 'server stopped, retrying…';
  $('conn').className = 'pill down';
  first = true; // reload history when it comes back
};

es.addEventListener('log', (e) => {
  if (JSON.parse(e.data).kind === 'clear_history') loadHistory();
});

initGod(es);
