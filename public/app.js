// Draws the world from server state and sends map clicks. The browser never simulates anything.

import { initGod, action, config } from './god.js';

const TILE_PX = 16;
const COLORS = ['#5a9e3f', '#2f6fc4', '#1f4a1c', '#e8b33a']; // grass, water, tree, food
const AGENT_COLORS = ['#e63946', '#f4a261', '#b5179e', '#00b4d8', '#ffffff', '#9b5de5'];
const NEED_COLORS = { hunger: '#e76f51', thirst: '#4ea8de', energy: '#ffd166', health: '#57cc99' };
const NEEDS = Object.keys(NEED_COLORS);

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const chart = document.getElementById('history');
const cctx = chart.getContext('2d');
const $ = (id) => document.getElementById(id);
const agentColor = (a) => (a.action === 'dead' ? '#666' : AGENT_COLORS[(a.id - 1) % AGENT_COLORS.length]);

let state = null;

function fmtHour(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- world view ---
function draw(s) {
  const px = s.size * TILE_PX;
  if (canvas.width !== px) canvas.width = canvas.height = chart.width = px;

  for (let i = 0; i < s.grid.length; i++) {
    const x = i % s.size;
    const y = (i - x) / s.size;
    const t = +s.grid[i];
    ctx.fillStyle = t === 3 ? COLORS[0] : COLORS[t];
    ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
    if (t === 3) { // food: small berry on grass
      ctx.fillStyle = COLORS[3];
      ctx.fillRect(x * TILE_PX + 4, y * TILE_PX + 4, TILE_PX - 8, TILE_PX - 8);
    }
  }

  if (s.clock.darkness > 0) {
    ctx.fillStyle = `rgba(8, 12, 40, ${s.clock.darkness})`;
    ctx.fillRect(0, 0, px, px);
  }

  for (const a of s.agents) {
    if (a.target) { // dashed line to target
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo((a.x + 0.5) * TILE_PX, (a.y + 0.5) * TILE_PX);
      ctx.lineTo((a.target.x + 0.5) * TILE_PX, (a.target.y + 0.5) * TILE_PX);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = agentColor(a);
    ctx.fillRect(a.x * TILE_PX + 2, a.y * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(a.x * TILE_PX + 2.5, a.y * TILE_PX + 2.5, TILE_PX - 5, TILE_PX - 5);
    if (a.action === 'sleep') {
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.fillText('z', a.x * TILE_PX + TILE_PX - 4, a.y * TILE_PX + 2);
    }
  }
}

canvas.addEventListener('click', (e) => {
  if (!state) return;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.size);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.size);
  action('spawn_food', { x, y }, { quiet: true }); // clicks on water/trees/food just do nothing
});

// --- status panel ---
const NEED_HELP = {
  hunger: 'Hunger: 0 is full, 100 is starving. Rises every tick; eating a berry lowers it.',
  thirst: 'Thirst: 0 is not thirsty, 100 is parched. Rises every tick; drinking at a lake edge lowers it.',
  energy: 'Energy: 100 is fully rested, 0 is exhausted. Falls every tick; sleeping restores it.',
  health: 'Health: drops while any need is at its limit, slowly recovers otherwise. At 0 the agent dies.',
};
const SCORE_HELP = {
  eat: 'Score for eating = current hunger (— means no berry can be reached).',
  seek_water: 'Score for drinking = current thirst (— means no water can be reached).',
  sleep: 'Score for sleeping = 100 − energy, plus the night bonus at night.',
  wander: 'Score for wandering = the fixed Wander base score.',
};

function bar(name, value) {
  return `<div class="bar" title="${NEED_HELP[name]}"><span>${name}</span>
    <div class="track"><div class="fill" style="width:${value}%;background:${NEED_COLORS[name]}"></div></div>
    <span class="num">${value.toFixed(0)}</span></div>`;
}

function renderPanel(s) {
  const c = s.clock;
  $('clock').textContent = `Day ${c.day} · ${fmtHour(c.hour)} ${c.isNight ? '🌙' : '☀️'}`;
  $('world-info').textContent = `Tick ${s.tick} · food on map: ${s.foodCount}${s.running ? '' : ' · paused'}`;

  $('agents').innerHTML = s.agents.map((a) => {
    const best = Object.entries(a.scores).reduce((m, e) => (e[1] !== null && (m === null || e[1] > m[1]) ? e : m), null);
    const scores = Object.entries(a.scores).map(([k, v]) =>
      `<tr title="${SCORE_HELP[k] ?? ''}"><td>${k}</td><td class="${best && k === best[0] ? 'best' : ''}">${v === null ? '—' : v}</td></tr>`).join('');
    const recent = a.recent.slice(0, 5).map((r) => `<tr><td>t${r.tick}</td><td>${r.action}</td></tr>`).join('');
    return `<h2><span class="agent-swatch" style="background:${agentColor(a)}"></span> Agent ${a.id} <span class="action">${a.action}</span>
      <button class="small danger remove-agent" data-id="${a.id}" title="Remove this agent from the world. Its past history stays until you clear history.">✕</button></h2>
      <div class="muted">at (${a.x}, ${a.y})${a.target ? ` → (${a.target.x}, ${a.target.y})` : ''}</div>
      ${bar('hunger', a.hunger)}${bar('thirst', a.thirst)}${bar('energy', a.energy)}${bar('health', a.health)}
      <details><summary title="Each tick the agent scores its options and does the highest (highlighted). The currently chosen action gets a small bonus. Below the scores: when it last switched action.">scores &amp; recent actions</summary>
        <table>${scores}</table><table>${recent}</table></details>`;
  }).join('');
  // Keep <details> open/closed across re-renders.
  $('agents').querySelectorAll('details').forEach((d, i) => {
    d.open = openDetails.has(i);
    d.ontoggle = () => (d.open ? openDetails.add(i) : openDetails.delete(i));
  });
}
const openDetails = new Set([0]);

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
  if (a && s.tick > history.lastTick) {
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
    sel.innerHTML = s.agents.map((x) => `<option value="${x.id}">Agent ${x.id}</option>`).join('');
    if (s.agents.length && !s.agents.some((x) => x.id === history.agentId)) {
      history.agentId = s.agents[0].id; // selected agent was removed
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
  const Y = (v) => h - 4 - (v / 100) * (h - 8);

  // Day boundaries
  cctx.fillStyle = '#8a939e';
  cctx.font = '10px sans-serif';
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].day !== rows[i - 1].day) {
      cctx.fillRect(X(rows[i].tick), 0, 1, h);
      cctx.fillText(`day ${rows[i].day}`, X(rows[i].tick) + 3, 10);
    }
  }

  for (const n of NEEDS) {
    cctx.strokeStyle = NEED_COLORS[n];
    cctx.lineWidth = 1.5;
    cctx.beginPath();
    rows.forEach((r, i) => (i ? cctx.lineTo(X(r.tick), Y(r[n])) : cctx.moveTo(X(r.tick), Y(r[n]))));
    cctx.stroke();
  }
}

$('legend').innerHTML = NEEDS.map((n) => `<b style="background:${NEED_COLORS[n]}"></b>${n}`).join('');
// Remove-agent buttons are re-rendered every tick, so listen on the container.
$('agents').addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-agent');
  if (btn && confirm(`Remove agent ${btn.dataset.id}? This cannot be undone.`)) action('remove_agent', { id: Number(btn.dataset.id) });
});

$('history-agent').onchange = (e) => {
  history.agentId = Number(e.target.value);
  loadHistory();
};

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
