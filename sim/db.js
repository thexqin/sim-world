// SQLite access layer (built-in node:sqlite). The server opens one DB;
// tests can open their own file.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS world_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick INTEGER NOT NULL, day INTEGER NOT NULL, hour REAL NOT NULL,
    rng_state INTEGER NOT NULL, next_agent_id INTEGER NOT NULL,
    size INTEGER NOT NULL, grid TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_state (
    id INTEGER PRIMARY KEY,
    x INTEGER, y INTEGER,
    hunger REAL, thirst REAL, energy REAL, health REAL,
    action TEXT, target TEXT, scores TEXT, inventory TEXT, recent TEXT
  );
  CREATE TABLE IF NOT EXISTS tick_log (
    tick INTEGER NOT NULL, day INTEGER NOT NULL, hour REAL NOT NULL,
    agent_id INTEGER NOT NULL,
    x INTEGER, y INTEGER,
    hunger REAL, thirst REAL, energy REAL, health REAL,
    action TEXT,
    PRIMARY KEY (tick, agent_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tick INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tick INTEGER NOT NULL, label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    data TEXT NOT NULL
  );
`;

// Columns added after the first release; older databases get them on startup (old rows read as NULL).
const ADDED_COLUMNS = {
  world_state: { births: 'INTEGER DEFAULT 0', deaths: 'INTEGER DEFAULT 0' },
  agent_state: {
    sex: 'TEXT', age: 'REAL', lifespan: 'REAL', mother_id: 'INTEGER', father_id: 'INTEGER',
    last_birth: 'REAL', last_fight: 'REAL', died_at: 'REAL', cause: 'TEXT',
  },
  tick_log: { sex: 'TEXT', age: 'REAL' },
};

const r2 = (v) => Math.round(v * 100) / 100;
const json = (v) => JSON.stringify(v ?? null);

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [col, type] of Object.entries(cols)) {
      if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  }

  const q = {
    insertLog: db.prepare(`INSERT OR REPLACE INTO tick_log
      (tick, day, hour, agent_id, x, y, hunger, thirst, energy, health, action, sex, age)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    upsertWorld: db.prepare(`INSERT OR REPLACE INTO world_state
      (id, tick, day, hour, rng_state, next_agent_id, size, grid, births, deaths) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertAgent: db.prepare(`INSERT INTO agent_state
      (id, x, y, hunger, thirst, energy, health, action, target, scores, inventory, recent,
       sex, age, lifespan, mother_id, father_id, last_birth, last_fight, died_at, cause)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    upsertConfig: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
    insertEvent: db.prepare('INSERT INTO events (tick, kind, data) VALUES (?, ?, ?)'),
    insertSnapshot: db.prepare('INSERT INTO snapshots (tick, label, data) VALUES (?, ?, ?)'),
  };

  function tx(fn) {
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function writeState(s) {
    q.upsertWorld.run(s.tick, s.clock.day, s.clock.hour, s.rngState, s.nextAgentId, s.world.size, s.world.grid,
      s.stats?.births ?? 0, s.stats?.deaths ?? 0);
    db.exec('DELETE FROM agent_state');
    for (const a of s.agents) {
      q.insertAgent.run(a.id, a.x, a.y, a.hunger, a.thirst, a.energy, a.health, a.action,
        json(a.target), json(a.scores), json(a.inventory), json(a.recent),
        a.sex ?? null, a.age ?? null, a.lifespan ?? null, a.motherId ?? null, a.fatherId ?? null,
        a.lastBirth ?? null, a.lastFight ?? null, a.diedAt ?? null, a.cause ?? null);
    }
  }

  return {
    // Latest full state (shape of sim.serialize()), or null for a fresh database.
    loadState() {
      const w = db.prepare('SELECT * FROM world_state WHERE id = 1').get();
      if (!w) return null;
      const agents = db.prepare('SELECT * FROM agent_state ORDER BY id').all().map((a) => ({
        id: a.id, x: a.x, y: a.y,
        hunger: a.hunger, thirst: a.thirst, energy: a.energy, health: a.health, action: a.action,
        target: JSON.parse(a.target), scores: JSON.parse(a.scores) ?? {},
        inventory: JSON.parse(a.inventory) ?? {}, recent: JSON.parse(a.recent) ?? [],
        sex: a.sex, age: a.age, lifespan: a.lifespan, motherId: a.mother_id, fatherId: a.father_id,
        lastBirth: a.last_birth, lastFight: a.last_fight, diedAt: a.died_at, cause: a.cause,
      }));
      return {
        tick: w.tick, clock: { day: w.day, hour: w.hour }, rngState: w.rng_state,
        nextAgentId: w.next_agent_id, world: { size: w.size, grid: w.grid }, agents,
        stats: { births: w.births ?? 0, deaths: w.deaths ?? 0 },
      };
    },

    saveState(state) {
      tx(() => writeState(state));
    },

    // One tick: log rows + current state, atomically.
    saveTick(state, rows) {
      tx(() => {
        for (const { tick, day, hour, agent: a } of rows) {
          q.insertLog.run(tick, day, r2(hour), a.id, a.x, a.y, r2(a.hunger), r2(a.thirst), r2(a.energy), r2(a.health), a.action,
            a.sex ?? null, a.age === undefined ? null : r2(a.age));
        }
        writeState(state);
      });
    },

    // Wipe the current run (world, agents, history). Events and snapshots are kept.
    clearRun() {
      db.exec('DELETE FROM tick_log; DELETE FROM agent_state; DELETE FROM world_state;');
    },

    // Drop history after a tick (used when loading an earlier snapshot).
    truncateLogAfter(tick) {
      db.prepare('DELETE FROM tick_log WHERE tick > ?').run(tick);
    },

    loadConfig() {
      const rows = db.prepare('SELECT key, value FROM config').all();
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    },

    saveConfig(cfg) {
      tx(() => {
        for (const [k, v] of Object.entries(cfg)) q.upsertConfig.run(k, json(v));
      });
    },

    logEvent(tick, kind, data) {
      const { lastInsertRowid } = q.insertEvent.run(tick, kind, json(data));
      return { id: Number(lastInsertRowid), tick, kind, data };
    },

    getEvents(limit) {
      return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit)
        .map((e) => ({ ...e, data: JSON.parse(e.data) }));
    },

    getLog(from, to, agentId) {
      if (agentId) {
        return db.prepare('SELECT * FROM tick_log WHERE tick BETWEEN ? AND ? AND agent_id = ? ORDER BY tick').all(from, to, agentId);
      }
      return db.prepare('SELECT * FROM tick_log WHERE tick BETWEEN ? AND ? ORDER BY tick, agent_id').all(from, to);
    },

    saveSnapshot(tick, label, data) {
      const { lastInsertRowid } = q.insertSnapshot.run(tick, label, JSON.stringify(data));
      return Number(lastInsertRowid);
    },

    listSnapshots() {
      return db.prepare('SELECT id, tick, label, created_at FROM snapshots ORDER BY id DESC').all();
    },

    getSnapshot(id) {
      const row = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
      return row ? { ...row, data: JSON.parse(row.data) } : null;
    },

    // Returns true if a snapshot was deleted.
    deleteSnapshot(id) {
      return db.prepare('DELETE FROM snapshots WHERE id = ?').run(id).changes > 0;
    },

    clearEvents() {
      db.exec('DELETE FROM events');
    },

    // Wipe the tick-by-tick history (the current world itself is kept).
    clearHistory() {
      db.exec('DELETE FROM tick_log');
    },

    // Reclaim disk space after big deletes.
    compact() {
      db.exec('VACUUM');
    },

    close() {
      db.close();
    },
  };
}
