# CLAUDE.md: Sim World

A minimal 2D open-world simulation that runs locally and is viewed and controlled from a browser (`http://localhost:3000`). An agent lives in the world. We store time, the agent's status and its behavior history. The world is operated through browser "god mode" dials, so changes never require editing code.

## Hard constraints (read first)

1. **Everything stays inside this project folder.** Never touch system files.
2. **No global installs.** Never run `npm install -g`, `pip install` outside a venv, or change PATH or system settings.
3. **Keep the npm cache local.** Create `.npmrc` containing `cache=./.npm-cache` before any `npm install`.
4. **Prefer zero dependencies.** Use Node built-ins wherever possible (`http`, `node:sqlite`, server-sent events instead of WebSockets). Ask before adding any package.
5. Deleting the project folder must remove everything this project created.
6. Plain 2D graphics only (canvas, colored squares). No assets, no frameworks, no build step.

## First step: check the environment

Run `node --version`.
- Node 22+: use built-in `node:sqlite` (`DatabaseSync`). No package needed.
- Older Node: use `better-sqlite3`, installed locally only (with the `.npmrc` cache setting above).

Tell the user which path was chosen.

## Core design principle

**Separate simulation from display.** The server runs the world in discrete ticks. The browser only draws the current state and sends dial changes. This allows pause, speed control, replay and reproducible runs.

## Project structure

```
sim-world/
  CLAUDE.md
  .npmrc                 # cache=./.npm-cache
  package.json
  server.js              # HTTP server + tick loop + API (localhost:3000)
  /sim
    world.js             # grid map (default 40x40): grass, water, tree, food
    agent.js             # status + decision logic
    clock.js             # tick -> in-world day / hour, day/night
    dials.js             # dial schema (single source of truth)
    rng.js               # seeded RNG for reproducible runs
    db.js                # SQLite access layer
    sim.js               # sim state, per-tick step, serialize/restore
  /data
    world.db             # SQLite file (gitignored)
  /public
    index.html           # canvas view + status panel
    app.js               # rendering + API client
    god.js               # builds the dial panel from /api/dials
    style.css
```

## Data model (SQLite, `data/world.db`)

| Table | Purpose |
|---|---|
| `config` | Current dial values (key, value) |
| `world_state` | Current tick, clock (day/hour), RNG state and world grid (single row) |
| `agent_state` | Current agent status: position, hunger, thirst, energy, health, action, inventory |
| `tick_log` | Time series: tick, day, hour, agent status, action chosen |
| `events` | God-mode actions, each stamped with the tick when it happened |
| `snapshots` | Full save points (world grid + agent + config as JSON) so a run can be resumed or restored |

The server must resume from the latest state on restart.

## Time

- A tick is the base unit. Tick count, in-world day and hour, and speed multiplier are all stored.
- Day length (ticks per day) is a dial.
- The view shows day/night.

## Agent behavior (v1: rule-based, deterministic)

Each tick:
1. Update needs (hunger rises, energy falls, rates come from dials).
2. Score options: `eat`, `sleep`, `seek_water`, `wander`.
3. Pick the highest score and move one tile toward the target, or perform the action.
4. Write status and chosen action to `tick_log`.

Keep the decision step behind a single function (`decide(agent, world, config)`) so it can later be swapped for an LLM-driven decision and the two compared.

## God mode (browser dials)

**Dials are defined once in `sim/dials.js`** as a schema: `key, label, type, min, max, default`. The UI builds its controls from this list via `GET /api/dials`. Adding a dial is a one-line change and needs no UI code.

Initial dials:
- Play/pause, speed multiplier
- Day length
- Hunger rate, energy drain rate
- Food regrowth rate, food scarcity
- Weather/event toggle (simple, e.g. "drought" reduces regrowth)

Actions (buttons): spawn food at clicked tile, add a second agent, reset with seed, save snapshot, load snapshot.

Every dial change and action is written to `events` with the current tick. Changes apply on the next tick with no restart.

## API (suggested)

- `GET  /api/state`: world + agent + clock
- `GET  /api/stream`: server-sent events, state pushed each tick
- `GET  /api/dials`, `POST /api/dials`: schema + values, update values
- `POST /api/action`: spawn food, add agent, reset, snapshot, load
- `GET  /api/log?from=&to=`: history for charts

## Build order

1. Static map rendered on canvas, one agent wandering.
2. Clock plus hunger and energy.
3. Decision logic plus `tick_log`.
4. SQLite persistence and resume on restart.
5. Dial panel (schema-driven) plus `events` logging.
6. Snapshots, plus a simple status/history readout in the UI.

Stop after steps 1 to 3 and let the user review before continuing.

## Conventions

- Plain modern JavaScript (ES modules), small files, short comments.
- All randomness through `rng.js` (seeded) so runs are reproducible.
- No magic numbers: tunable values go in `dials.js`.
- Run with `node server.js`, then open `http://localhost:3000`.
- Keep a short "How to run" section updated at the bottom of this file.

## Out of scope for now

Fancy graphics, multiplayer, auth, cloud services, ML/LLM agents (design for them, don't build them).

## How to run

Requires Node 22.5+ (uses built-in `node:sqlite`; no `npm install` needed).

```bash
node server.js
```

Open `http://localhost:3000`. Stop with Ctrl+C. History: `GET /api/log?from=1&to=100&agent=1`, events: `GET /api/events`.
Status: build steps 1–6 done. State is saved every tick; restarting resumes exactly where it stopped.
To start over: use **Reset world** in the browser (or stop the server and delete `data/`).
Private notes: `notes/` is gitignored and belongs to the user. Keep `notes/HISTORY.md` updated with what was done and decided in each session.
Note: the project root is this folder (no `sim-world/` subfolder); `sim/sim.js` holds the tick step.
