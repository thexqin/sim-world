// Simulation state and the per-tick step. Knows nothing about HTTP, SQLite or drawing.

import { createRng } from './rng.js';
import { TILE, createWorld, worldFromGrid, regrow, get, set, inBounds } from './world.js';
import { createAgent, updateNeeds, decide, act, setAction } from './agent.js';
import { createClock, advanceClock, clockInfo } from './clock.js';

export function createSim(config) {
  const rng = createRng(config.seed);
  const world = createWorld(config, rng);
  const sim = { tick: 0, clock: createClock(config), config, rng, world, agents: [], nextAgentId: 1 };
  addAgent(sim);
  return sim;
}

export function addAgent(sim) {
  const agent = createAgent(sim.nextAgentId++, sim.world, sim.config, sim.rng);
  sim.agents.push(agent);
  return agent;
}

// Returns true if an agent with that id was removed.
export function removeAgent(sim, id) {
  const before = sim.agents.length;
  sim.agents = sim.agents.filter((a) => a.id !== id);
  return sim.agents.length < before;
}

export function spawnFoodAt(sim, x, y) {
  if (!inBounds(sim.world, x, y) || get(sim.world, x, y) !== TILE.GRASS) return false;
  set(sim.world, x, y, TILE.FOOD);
  return true;
}

// Advance one tick. Returns rows for tick_log.
export function step(sim) {
  const { config, rng, world } = sim;
  sim.tick++;
  advanceClock(sim.clock, config);
  const clock = clockInfo(sim.clock, config);
  regrow(world, config, rng);

  const rows = [];
  for (const a of sim.agents) {
    if (a.action === 'dead') continue; // the dead are logged once, on the tick they die
    updateNeeds(a, config);
    if (a.health <= 0) {
      setAction(a, 'dead', sim.tick, config);
      a.target = null;
    } else {
      const d = decide(a, world, config, clock);
      a.scores = d.scores;
      setAction(a, d.action, sim.tick, config);
      act(a, d, world, config, rng);
    }
    rows.push({ tick: sim.tick, day: clock.day, hour: clock.hour, agent: a });
  }
  return rows;
}

// Plain data for saving (SQLite state, snapshots). Config is stored separately.
export function serialize(sim) {
  return {
    tick: sim.tick,
    clock: { ...sim.clock },
    rngState: sim.rng.state,
    nextAgentId: sim.nextAgentId,
    world: { size: sim.world.size, grid: sim.world.grid.join('') },
    agents: sim.agents.map((a) => structuredClone(a)),
  };
}

export function restore(state, config) {
  const rng = createRng(0);
  rng.state = state.rngState;
  return {
    tick: state.tick,
    clock: { ...state.clock },
    config,
    rng,
    world: worldFromGrid(state.world.size, state.world.grid),
    agents: state.agents.map((a) => ({ ...a, scores: a.scores ?? {}, recent: a.recent ?? [], inventory: a.inventory ?? {} })),
    nextAgentId: state.nextAgentId,
  };
}

const r1 = (v) => Math.round(v * 10) / 10;

// Compact JSON for the browser.
export function snapshotForClient(sim) {
  return {
    tick: sim.tick,
    clock: clockInfo(sim.clock, sim.config),
    running: sim.config.running,
    size: sim.world.size,
    grid: sim.world.grid.join(''),
    foodCount: sim.world.foodCount,
    agents: sim.agents.map((a) => ({
      id: a.id, x: a.x, y: a.y, action: a.action, target: a.target,
      hunger: r1(a.hunger), thirst: r1(a.thirst), energy: r1(a.energy), health: r1(a.health),
      scores: Object.fromEntries(Object.entries(a.scores).map(([k, v]) => [k, Number.isFinite(v) ? r1(v) : null])),
      recent: a.recent,
    })),
  };
}
