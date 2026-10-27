// God-mode panel. Dial controls, hover tips and the Guide's dial list are generated
// from the schema at GET /api/dials, so adding a dial in sim/dials.js needs no UI code.

const $ = (id) => document.getElementById(id);
const controls = new Map(); // key -> { set(value) }
export let config = {};

export async function postJson(url, body, { quiet = false } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok && !quiet) alert(data.error || (data.errors || []).join('\n') || 'request failed');
  return data;
}

export const action = (type, data = {}, opts) => postJson('/api/action', { type, ...data }, opts);
const setDial = (key, value) => postJson('/api/dials', { [key]: value });

const fmt = (d, v) => (d.type === 'bool' ? (v ? 'on' : 'off') : String(v));

function buildDial(d) {
  const el = document.createElement('div');
  el.className = `dial ${d.type}`;
  el.title = d.help || '';
  const tag = d.reset ? ' <span class="tag">(on reset)</span>' : '';
  const info = d.help ? ' <span class="info">ⓘ</span>' : '';

  if (d.type === 'bool') {
    el.innerHTML = `<label><input type="checkbox"> ${d.label}${tag}${info}</label>`;
    const box = el.querySelector('input');
    box.onchange = () => setDial(d.key, box.checked);
    controls.set(d.key, { set: (v) => (box.checked = v) });
    return el;
  }

  el.innerHTML = `<div class="head"><span>${d.label}${tag}${info}</span>
    <input type="number" min="${d.min}" max="${d.max}" step="${d.step}"></div>
    <input type="range" min="${d.min}" max="${d.max}" step="${d.step}">`;
  const [num, range] = el.querySelectorAll('input');
  range.oninput = () => (num.value = range.value);
  range.onchange = () => setDial(d.key, Number(range.value));
  num.onchange = () => setDial(d.key, Number(num.value));
  controls.set(d.key, {
    set(v) {
      if (document.activeElement !== num) num.value = v; // don't fight the user's typing
      if (document.activeElement !== range) range.value = v;
    },
  });
  return el;
}

// --- Guide pane: every dial grouped by section ---
function buildGuide(schema) {
  const sections = new Map();
  for (const d of schema) {
    if (!sections.has(d.section)) sections.set(d.section, []);
    sections.get(d.section).push(d);
  }
  const box = $('guide-dials');
  for (const [name, dials] of sections) {
    const h = document.createElement('h3');
    h.textContent = name;
    const table = document.createElement('table');
    table.className = 'guide-table';
    table.innerHTML = '<tr><th>Dial</th><th>What it does</th><th>Range</th><th>Default</th><th>Now</th></tr>';
    for (const d of dials) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b></b>${d.reset ? '<div class="tag">applies on reset</div>' : ''}${d.group === 'advanced' ? '<div class="tag">advanced</div>' : ''}</td>
        <td></td><td class="nowrap">${d.type === 'bool' ? 'on / off' : `${d.min} – ${d.max}`}</td>
        <td>${fmt(d, d.default)}</td><td data-dial="${d.key}"></td>`;
      tr.querySelector('b').textContent = d.label;
      tr.children[1].textContent = d.help || '';
      table.append(tr);
    }
    box.append(h, table);
  }
}

let schemaByKey = new Map();

function applyConfig(values) {
  config = values;
  for (const [k, c] of controls) if (k in values) c.set(values[k]);
  for (const el of document.querySelectorAll('[data-dial]')) {
    const d = schemaByKey.get(el.dataset.dial);
    if (d) el.textContent = fmt(d, values[d.key]);
  }
  $('play').textContent = values.running ? '⏸ Pause' : '▶ Play';
  if (document.activeElement !== $('reset-seed')) $('reset-seed').value = values.seed;
}

// --- event log ---
function describe(e) {
  const d = e.data || {};
  switch (e.kind) {
    case 'dial': return `${schemaByKey.get(d.key)?.label ?? d.key}: ${d.from} → ${d.to}`;
    case 'spawn_food': return `food dropped at (${d.x}, ${d.y})`;
    case 'add_agent': return `agent ${d.id}${d.sex ? (d.sex === 'F' ? ' ♀' : ' ♂') : ''} added at (${d.x}, ${d.y})`;
    case 'birth': return `agent ${d.id} ${d.sex === 'F' ? '♀' : '♂'} born to ${d.motherId} and ${d.fatherId}`;
    case 'death': return `agent ${d.id} ${d.sex === 'F' ? '♀' : '♂'} died of ${d.cause}, aged ${d.age} days`;
    case 'remove_agent': return `agent ${d.id} removed`;
    case 'reset': return `world reset, seed ${d.seed}`;
    case 'new_run': return `new world, seed ${d.seed}`;
    case 'save_snapshot': return `snapshot #${d.id} saved${d.label ? ` "${d.label}"` : ''}`;
    case 'load_snapshot': return `snapshot #${d.id} loaded (back to tick ${d.tick})`;
    case 'delete_snapshot': return `snapshot #${d.id} deleted`;
    case 'clear_history': return 'history cleared';
    case 'resume': return 'server restarted, resumed';
    default: return e.kind;
  }
}

const MAX_EVENT_ROWS = 30;
function addEventRow(e, atTop = true) {
  const table = $('events');
  table.querySelector('.empty')?.remove();
  const tr = document.createElement('tr');
  tr.innerHTML = '<td></td><td></td>';
  tr.cells[0].textContent = `t${e.tick}`;
  tr.cells[0].title = `Tick ${e.tick} · ${e.created_at ?? 'just now'}`;
  tr.cells[1].textContent = describe(e);
  atTop ? table.prepend(tr) : table.append(tr);
  while (table.rows.length > MAX_EVENT_ROWS) table.deleteRow(-1);
}

function showEmptyEvents() {
  $('events').innerHTML = '<tr class="empty"><td class="muted">empty</td></tr>';
}

// --- snapshots ---
async function loadSnapshots() {
  const snaps = await fetch('/api/snapshots').then((r) => r.json());
  const table = $('snapshots');
  table.innerHTML = snaps.length ? '' : '<tr><td class="muted">none yet</td></tr>';
  for (const s of snaps) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>#${s.id}</td><td>tick ${s.tick} <span class="muted"></span></td>
      <td class="nowrap"><button class="small load">Load</button> <button class="small danger del">✕</button></td>`;
    tr.querySelector('.muted').textContent = s.label || '';
    tr.title = `Saved ${s.created_at} (UTC) at tick ${s.tick}`;
    const load = tr.querySelector('.load');
    load.title = 'Jump back to this saved moment. Everything after it is discarded.';
    load.onclick = () => {
      if (confirm(`Load snapshot #${s.id} (tick ${s.tick})? History after that tick will be discarded.`)) action('load_snapshot', { id: s.id });
    };
    const del = tr.querySelector('.del');
    del.title = 'Delete this snapshot permanently.';
    del.onclick = () => {
      if (confirm(`Delete snapshot #${s.id}${s.label ? ` "${s.label}"` : ''}? This cannot be undone.`)) action('delete_snapshot', { id: s.id });
    };
    table.append(tr);
  }
}

export async function initGod(es) {
  const { schema, values } = await fetch('/api/dials').then((r) => r.json());
  schemaByKey = new Map(schema.map((d) => [d.key, d]));
  for (const d of schema) $(d.group === 'main' ? 'dials-main' : 'dials-advanced').append(buildDial(d));
  buildGuide(schema);
  applyConfig(values);

  for (const el of document.querySelectorAll('.open-guide')) {
    el.onclick = (e) => {
      e.preventDefault();
      $('guide').showModal();
    };
  }
  $('close-guide').onclick = () => $('guide').close();
  $('guide').onclick = (e) => e.target === $('guide') && $('guide').close(); // click outside closes

  $('play').onclick = () => setDial('running', !config.running);
  $('add-agent').onclick = () => action('add_agent');
  $('reset').onclick = () => {
    const seed = Number($('reset-seed').value);
    if (confirm(`Reset the world with seed ${seed}? The current run and its history will be cleared (snapshots are kept).`)) action('reset', { seed });
  };
  $('snap-save').onclick = async () => {
    await action('save_snapshot', { label: $('snap-label').value });
    $('snap-label').value = '';
  };
  $('clear-events').onclick = () => {
    if (confirm('Delete every entry in the event log? This cannot be undone.')) action('clear_events');
  };
  $('clear-history').onclick = () => {
    if (confirm('Delete all saved history (the chart data)? The world itself is not changed. This cannot be undone.')) action('clear_history');
  };

  es.addEventListener('config', (e) => applyConfig(JSON.parse(e.data)));
  es.addEventListener('events_cleared', showEmptyEvents);
  es.addEventListener('log', (e) => {
    const ev = JSON.parse(e.data);
    addEventRow(ev);
    if (ev.kind === 'save_snapshot' || ev.kind === 'delete_snapshot') loadSnapshots();
  });

  const events = await fetch(`/api/events?limit=${MAX_EVENT_ROWS}`).then((r) => r.json());
  if (!events.length) showEmptyEvents();
  for (const e of events) addEventRow(e, false);
  loadSnapshots();
}
