// HTTP server + tick loop + API. Open http://localhost:3000

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALS, coerce, sanitizeConfig, defaultConfig } from './sim/dials.js';
import { createSim, step, serialize, restore, addAgent, removeAgent, spawnFoodAt, snapshotForClient } from './sim/sim.js';
import { openDb } from './sim/db.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const PAUSED_POLL_MS = 200;
const MAX_BODY_BYTES = 64 * 1024;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const db = openDb(join(ROOT, 'data', 'world.db'));
const config = sanitizeConfig(db.loadConfig()); // one shared object; sim.config points at it
db.saveConfig(config);

// --- server-sent events ---
const clients = new Set();
function push(event, data) {
  const msg = `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const pushState = () => push(null, snapshotForClient(sim));

// Every god-mode change goes to `events`, stamped with the current tick.
function record(kind, data) {
  const ev = db.logEvent(sim?.tick ?? 0, kind, data);
  push('log', ev);
  return ev;
}

// --- resume or start fresh ---
let sim;
const saved = db.loadState();
if (saved) {
  sim = restore(saved, config);
  console.log(`Resumed at tick ${sim.tick} (day ${sim.clock.day})`);
  record('resume', {});
} else {
  newRun('new_run');
  console.log('No saved state: started a new world');
}

function newRun(kind) {
  db.clearRun();
  sim = createSim(config);
  db.saveState(serialize(sim));
  record(kind, { seed: config.seed });
}

// --- tick loop ---
let lastPush = 0;
function loop() {
  if (config.running) {
    const { rows, events } = step(sim);
    db.saveTick(serialize(sim), rows);
    for (const e of events) record(e.kind, e.data); // births and deaths
    const now = Date.now();
    if (now - lastPush >= 1000 / config.maxPushPerSec) {
      lastPush = now;
      pushState();
    }
  }
  setTimeout(loop, config.running ? config.baseTickMs / config.speed : PAUSED_POLL_MS);
}

// --- god-mode handlers ---
function setDials(values) {
  const errors = [];
  for (const [key, raw] of Object.entries(values)) {
    const r = coerce(key, raw);
    if (r.error) { errors.push(r.error); continue; }
    if (config[key] === r.value) continue;
    record('dial', { key, from: config[key], to: r.value });
    config[key] = r.value;
  }
  db.saveConfig(config);
  push('config', config);
  return errors;
}

const actions = {
  spawn_food({ x, y }) {
    if (!spawnFoodAt(sim, Number(x), Number(y))) return { error: 'can only place food on empty grass' };
    record('spawn_food', { x, y });
    return {};
  },
  add_agent() {
    const a = addAgent(sim);
    record('add_agent', { id: a.id, sex: a.sex, x: a.x, y: a.y });
    return { id: a.id };
  },
  // Its past rows stay in the history until Clear history.
  remove_agent({ id }) {
    if (!removeAgent(sim, Number(id))) return { error: `no agent ${id}` };
    db.saveState(serialize(sim));
    record('remove_agent', { id: Number(id) });
    return {};
  },
  reset({ seed }) {
    if (seed !== undefined) setDials({ seed });
    newRun('reset');
    return {};
  },
  save_snapshot({ label }) {
    const name = String(label || '').slice(0, 80) || null;
    const id = db.saveSnapshot(sim.tick, name, { state: serialize(sim), config });
    record('save_snapshot', { id, label: name });
    return { id };
  },
  load_snapshot({ id }) {
    const snap = db.getSnapshot(Number(id));
    if (!snap) return { error: `no snapshot ${id}` };
    Object.assign(config, sanitizeConfig(snap.data.config), { running: config.running }); // keep play/pause as is
    sim = restore(snap.data.state, config);
    db.truncateLogAfter(sim.tick);
    db.saveState(serialize(sim));
    db.saveConfig(config);
    push('config', config);
    record('load_snapshot', { id: snap.id, tick: snap.tick });
    return {};
  },
  delete_snapshot({ id }) {
    if (!db.deleteSnapshot(Number(id))) return { error: `no snapshot ${id}` };
    db.compact();
    record('delete_snapshot', { id: Number(id) });
    return {};
  },
  // Not itself logged, so the event log can be emptied completely.
  clear_events() {
    db.clearEvents();
    db.compact();
    push('events_cleared', {});
    return {};
  },
  clear_history() {
    db.clearHistory();
    db.compact();
    record('clear_history', {});
    return {};
  },
  // Every dial back to its default (except play/pause), logged as one event.
  restore_defaults() {
    const changes = [];
    for (const [key, value] of Object.entries(defaultConfig())) {
      if (key === 'running' || config[key] === value) continue;
      changes.push({ key, from: config[key], to: value });
      config[key] = value;
    }
    db.saveConfig(config);
    push('config', config);
    record('restore_defaults', { changes });
    return { changed: changes.length };
  },
};

// --- HTTP ---
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid JSON')); }
    });
  });
}

const routes = {
  'GET /api/state': (req, res) => sendJson(res, snapshotForClient(sim)),
  'GET /api/dials': (req, res) => sendJson(res, { schema: DIALS, values: config }),
  'POST /api/dials': async (req, res) => {
    const errors = setDials(await readJson(req));
    pushState();
    sendJson(res, { values: config, errors }, errors.length ? 400 : 200);
  },
  'POST /api/action': async (req, res) => {
    const body = await readJson(req);
    const fn = actions[body.type];
    if (!fn) return sendJson(res, { error: `unknown action: ${body.type}` }, 400);
    const result = fn(body);
    pushState();
    sendJson(res, result, result.error ? 400 : 200);
  },
  'GET /api/log': (req, res, url) => {
    const p = url.searchParams;
    sendJson(res, db.getLog(Number(p.get('from') ?? 0), Number(p.get('to') ?? sim.tick), Number(p.get('agent')) || null));
  },
  'GET /api/events': (req, res, url) => sendJson(res, db.getEvents(Number(url.searchParams.get('limit')) || 50)),
  'GET /api/snapshots': (req, res) => sendJson(res, db.listSnapshots()),
  'GET /api/stream': (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshotForClient(sim))}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  },
};

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return sendJson(res, { error: 'forbidden' }, 403);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, { error: 'not found' }, 404);
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (route) return await route(req, res, url);
      if (url.pathname.startsWith('/api/')) return sendJson(res, { error: 'not found' }, 404);
      await serveStatic(res, url.pathname);
    } catch (err) {
      sendJson(res, { error: err.message }, 400);
    }
  })
  .on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`Port ${PORT} is already in use: another Sim World server is probably still running.`);
    console.error('Stop it first, or run on another port:  $env:PORT=3001; node server.js');
    process.exit(1);
  })
  .listen(PORT, 'localhost', () => {
    console.log(`Sim World running at http://localhost:${PORT}  (Ctrl+C to stop)`);
    loop();
  });

// State is saved every tick, so Ctrl+C loses nothing; just close the DB cleanly.
process.on('SIGINT', () => {
  db.close();
  console.log(`\nStopped at tick ${sim.tick} (day ${sim.clock.day}). Run node server.js to resume.`);
  process.exit(0);
});
