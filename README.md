# Sim World

A tiny 2D world that runs on your own computer and that you watch and control from a web browser.

A small band of creatures called **agents**, women and men, live on a grid of grass, lakes and trees. Each one gets hungry, thirsty and tired, and has to find berries, water and rest to stay alive. They grow up, have children, compete, fight, grow old and die. You play god: change the rules of the world with dials while it runs, drop food, add creatures, and save and rewind moments in time.

- No dependencies: plain Node.js and plain JavaScript, no `npm install`, no build step.
- Everything stays in this folder. Delete the folder and it's gone.
- Runs are reproducible: the same seed and the same actions always play out the same way.

## Demo

https://github.com/user-attachments/assets/1f158d80-ac22-46e1-a728-c13c91ac8899

https://github.com/user-attachments/assets/17c30a66-6d29-4889-91b8-89e4446dbc13

## How this was made

This project was written by **[Claude Code](https://claude.com/claude-code)**, Anthropic's AI coding agent.

- **Xiao Qin** set the direction and guided the work: the idea, the design rules (no dependencies, everything local, simulation separate from display), the feature list, the build order, and what to change. Xiao also reviewed and tested every step in the browser.
- **Claude Code** wrote the code and documentation: the simulation, server, database, browser interface, in-app Guide, and this README.

The original brief is in [CLAUDE.md](CLAUDE.md).

## Requirements

- [Node.js](https://nodejs.org/) **22.5 or newer**. It uses Node's built-in SQLite module (`node:sqlite`).

Check your version with:

```bash
node --version
```

## Getting started

### Option 1: download (no git needed)

1. Install [Node.js](https://nodejs.org/) 22.5 or newer, if you don't have it.
2. Download the latest `sim-world-vX.Y.Z.zip` from the [Releases page](https://github.com/thexqin/sim-world/releases) and unzip it anywhere.
3. Start it:
   - **Windows:** double-click `start.cmd`.
   - **macOS / Linux:** in a terminal inside the folder, run `sh start.sh`.

The launcher checks your Node.js version, starts the world and opens it in your browser.

### Option 2: clone with git

```bash
git clone https://github.com/thexqin/sim-world.git
cd sim-world
node server.js
```

Then open **http://localhost:3000** in your browser.

- Press **Ctrl+C** in the terminal to stop the server.
- Run `node server.js` again to carry on exactly where you left off: the world is saved after every tick.
- Need a different port? Set `PORT` first (`PORT=3001 node server.js` on macOS/Linux, `$env:PORT=3001; node server.js` in PowerShell).

## How it works

The world moves forward in small steps called **ticks** (4 per second at normal speed). Every tick, each agent:

1. **Gets needier.** Hunger and thirst go up, energy goes down. Each need runs from 0 to 100.
2. **Scores its options.**
   - eat = its hunger
   - drink = its thirst
   - sleep = 100 − energy, plus a bonus at night
   - mate = just above wandering, when it is content and a partner is available
   - wander = a fixed score
3. **Does the highest-scoring thing.** It walks one tile along the shortest path to the nearest berry, lake edge or partner, or eats, drinks, sleeps or wanders.

If hunger or thirst reaches 100, or energy reaches 0, the agent loses health. At 0 health it dies.

### Life, family and fights

- **Women** (circles) and **men** (squares) each have an age and a **strength** from 0 to 1. Children start weak and grow to full strength at the *Adult age*. Elders fade in their last days. Weaker agents tire faster and heal more slowly.
- **Children:** an adult woman and man who are both content (no pressing need) and not family walk to each other, and a baby is born next to the mother. Each mother waits a *Birth interval* between children, and the population is capped at *Max agents*.
- **Fights:** two grown-ups of the same sex side by side may fight when one is hungry or thirsty. The stronger and healthier one usually wins, and fights can kill.
- **Death** comes from hunger, thirst, exhaustion, old age (around the *Lifespan*) or a fight.
- A new world starts with **two unrelated couples**. Once everyone is related, no more children are born and the group can die out. **Add agent** brings in a newcomer.

Berries regrow over time, mostly next to trees. A day/night cycle darkens the map at night, when agents prefer to sleep.

The map grows to fit your browser window. The open page has a **📖 Guide** button that explains all of this in more detail, including every dial. Hovering over any control also shows a short explanation.

## God mode

From the panel on the right you can:

- **Turn dials** while the world runs: speed, day length, hunger/thirst/energy rates, adult age, lifespan, birth interval, population cap, aggression, fight damage, food regrowth and scarcity, drought, and many advanced settings. Changes apply on the next tick.
- **Click the map** to drop a berry on empty grass.
- **Add or remove agents**, and click an agent to see its age, strength, family and history.
- **Reset the world** with a new seed for a new random map.
- **Save, load and delete snapshots**: save points you can jump back to.
- **Read or clear the event log**: every change you make, stamped with the tick it happened.
- **View or clear the history chart** of an agent's needs over time.

## Where data is stored

Everything is kept in one SQLite file, `data/world.db`, inside the project folder. That file holds:

- the current world
- the dial settings
- the tick-by-tick history
- the event log
- your snapshots

It is not committed to git. To start completely fresh, stop the server and delete the `data` folder.

## Project layout

```
server.js        HTTP server, tick loop and API (http://localhost:3000)
start.cmd        one-click launcher for Windows
start.sh         launcher for macOS / Linux
sim/
  world.js       grid map: grass, water, trees, food; pathfinding
  agent.js       needs and decision logic (decide() is the swap point for other policies)
  clock.js       in-world day, hour, day/night
  dials.js       every tunable setting, with its help text (single source of truth)
  rng.js         seeded random number generator
  sim.js         simulation state, per-tick step, save/restore
  db.js          SQLite storage
public/
  index.html     page layout and the Guide
  app.js         draws the world, status panel and history chart
  god.js         builds the god-mode panel from the dial list
  style.css
```

The simulation runs only on the server; the browser just draws what it is sent and passes on your changes. That separation is what makes pause, speed control, snapshots and reproducible runs straightforward.

**Adding a dial** takes one entry in `sim/dials.js`. Its slider, hover tip and Guide entry appear automatically.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/state` | Current world, agents and clock |
| GET | `/api/stream` | Live updates (server-sent events) |
| GET | `/api/dials` | Dial definitions and current values |
| POST | `/api/dials` | Change dials, e.g. `{"speed": 2}` |
| POST | `/api/action` | `spawn_food`, `add_agent`, `remove_agent`, `reset`, `save_snapshot`, `load_snapshot`, `delete_snapshot`, `clear_events`, `clear_history` |
| GET | `/api/log?from=&to=&agent=` | Tick-by-tick history |
| GET | `/api/events?limit=` | Event log, newest first |
| GET | `/api/snapshots` | List of snapshots |

The server only listens on `localhost`, so other computers on your network can't reach it.

## License

[MIT](LICENSE)
