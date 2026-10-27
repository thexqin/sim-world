// Simulation state and the per-tick step. Knows nothing about HTTP, SQLite or drawing.

import { createRng } from './rng.js';
import { TILE, DIRS, createWorld, worldFromGrid, regrow, get, set, inBounds, passable } from './world.js';
import {
  createAgent, updateNeeds, decide, act, setAction, isAlive, stage, strength, fightPower,
  isStressed, canMate, isPartner, near, causeOfDeath,
} from './agent.js';
import { createClock, advanceClock, clockInfo } from './clock.js';

const FIGHT_COOLDOWN_DAYS = 1 / 24; // one in-world hour between fights per agent
const BODY_DAYS = 1; // bodies vanish one in-world day after death

export function createSim(config) {
  const rng = createRng(config.seed);
  const world = createWorld(config, rng);
  const sim = {
    tick: 0, clock: createClock(config), config, rng, world, agents: [], nextAgentId: 1,
    stats: { births: 0, deaths: 0 },
  };
  // Two unrelated couples, so their children can pair up without being family.
  for (const sex of ['F', 'M', 'F', 'M']) addAgent(sim, { sex });
  return sim;
}

export function addAgent(sim, opts) {
  const agent = createAgent(sim.nextAgentId++, sim.world, sim.config, sim.rng, opts);
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

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function die(sim, agent, cause, clock, events) {
  setAction(agent, 'dead', sim.tick, sim.config);
  agent.health = 0;
  agent.target = null;
  agent.cause = cause;
  agent.diedAt = clock.now;
  sim.stats.deaths++;
  events.push({ kind: 'death', data: { id: agent.id, sex: agent.sex, age: r1(agent.age), cause } });
}

// Same-sex grown-ups side by side may fight when one of them is hungry or thirsty.
function resolveFights(sim, clock, events) {
  const { config: cfg, rng } = sim;
  const ready = (a) => isAlive(a) && stage(a, cfg) !== 'child' &&
    (a.lastFight === null || clock.now - a.lastFight >= FIGHT_COOLDOWN_DAYS);
  const fighters = sim.agents.filter(ready);
  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      const a = fighters[i];
      const b = fighters[j];
      if (!ready(a) || !ready(b) || a.sex !== b.sex || !near(a, b)) continue;
      if (!isStressed(a, cfg) && !isStressed(b, cfg)) continue;
      if (rng.next() >= cfg.aggression) continue;

      const pa = fightPower(a, cfg);
      const pb = fightPower(b, cfg);
      const aWins = rng.next() < (pa + pb > 0 ? pa / (pa + pb) : 0.5);
      const [winner, loser] = aWins ? [a, b] : [b, a];
      loser.health = Math.max(0, loser.health - cfg.fightDamage * strength(winner, cfg));
      a.lastFight = b.lastFight = clock.now;
      setAction(a, 'fight', sim.tick, cfg);
      setAction(b, 'fight', sim.tick, cfg);
      if (loser.health <= 0) die(sim, loser, 'fight', clock, events);
    }
  }
}

// A content woman and man side by side (not family, population has room) have a child.
function resolveBirths(sim, clock, events) {
  const { config: cfg, world } = sim;
  const women = sim.agents.filter((a) => a.sex === 'F');
  for (const mother of women) {
    if (sim.agents.filter(isAlive).length >= cfg.maxAgents) return;
    if (!canMate(mother, cfg, clock.now)) continue;
    const father = sim.agents.find((m) => m.sex === 'M' && near(mother, m) && isPartner(mother, m, cfg, clock.now));
    if (!father) continue;

    const spot = DIRS.map(([dx, dy]) => [mother.x + dx, mother.y + dy])
      .find(([x, y]) => inBounds(world, x, y) && passable(get(world, x, y))) ?? [mother.x, mother.y];
    const child = addAgent(sim, { x: spot[0], y: spot[1], age: 0, motherId: mother.id, fatherId: father.id });
    mother.lastBirth = clock.now;
    setAction(mother, 'mate', sim.tick, cfg);
    setAction(father, 'mate', sim.tick, cfg);
    sim.stats.births++;
    events.push({ kind: 'birth', data: { id: child.id, sex: child.sex, motherId: mother.id, fatherId: father.id } });
  }
}

// Advance one tick. Returns { rows } for tick_log and life { events } (births, deaths).
export function step(sim) {
  const { config, rng, world } = sim;
  sim.tick++;
  advanceClock(sim.clock, config);
  const clock = clockInfo(sim.clock, config);
  regrow(world, config, rng);
  const events = [];

  // 1-3. Each living agent ages, then decides and acts.
  const active = sim.agents.filter(isAlive);
  for (const a of active) {
    updateNeeds(a, config);
    if (a.health <= 0) {
      die(sim, a, causeOfDeath(a), clock, events);
      continue;
    }
    const d = decide(a, world, config, clock, sim.agents);
    a.scores = d.scores;
    setAction(a, d.action, sim.tick, config);
    act(a, d, world, config, rng);
  }

  // Interactions, in agent-id order so runs stay reproducible.
  resolveFights(sim, clock, events);
  const before = sim.agents.length;
  resolveBirths(sim, clock, events);
  const newborns = sim.agents.slice(before);

  // Old bodies vanish.
  sim.agents = sim.agents.filter((a) => isAlive(a) || clock.now - a.diedAt < BODY_DAYS);

  // 4. Everyone who was alive this tick (the dead once, on the tick they die) plus newborns.
  const rows = [...active, ...newborns].map((agent) => ({ tick: sim.tick, day: clock.day, hour: clock.hour, agent }));
  return { rows, events };
}

// Plain data for saving (SQLite state, snapshots). Config is stored separately.
export function serialize(sim) {
  return {
    tick: sim.tick,
    clock: { ...sim.clock },
    rngState: sim.rng.state,
    nextAgentId: sim.nextAgentId,
    stats: { ...sim.stats },
    world: { size: sim.world.size, grid: sim.world.grid.join('') },
    agents: sim.agents.map((a) => structuredClone(a)),
  };
}

// Also upgrades saves from before sex and age existed: those agents become grown-ups
// (the first a woman, then alternating) with the standard lifespan.
export function restore(state, config) {
  const rng = createRng(0);
  rng.state = state.rngState;
  const now = clockInfo(state.clock, config).now;
  return {
    tick: state.tick,
    clock: { ...state.clock },
    config,
    rng,
    world: worldFromGrid(state.world.size, state.world.grid),
    agents: state.agents.map((a, i) => ({
      ...a,
      sex: a.sex ?? (i % 2 ? 'M' : 'F'),
      age: a.age ?? config.adultAge,
      lifespan: a.lifespan ?? config.lifespan,
      motherId: a.motherId ?? null,
      fatherId: a.fatherId ?? null,
      lastBirth: a.lastBirth ?? null,
      lastFight: a.lastFight ?? null,
      diedAt: a.action === 'dead' ? (a.diedAt ?? now) : null,
      cause: a.cause ?? null,
      scores: a.scores ?? {},
      recent: a.recent ?? [],
      inventory: a.inventory ?? {},
    })),
    nextAgentId: state.nextAgentId,
    stats: { births: 0, deaths: 0, ...state.stats },
  };
}

// Compact JSON for the browser.
export function snapshotForClient(sim) {
  const cfg = sim.config;
  return {
    tick: sim.tick,
    clock: clockInfo(sim.clock, cfg),
    running: cfg.running,
    size: sim.world.size,
    grid: sim.world.grid.join(''),
    foodCount: sim.world.foodCount,
    population: sim.agents.filter(isAlive).length,
    births: sim.stats.births,
    deaths: sim.stats.deaths,
    agents: sim.agents.map((a) => ({
      id: a.id, x: a.x, y: a.y, sex: a.sex, action: a.action, target: a.target,
      age: r1(a.age), lifespan: r1(a.lifespan), stage: isAlive(a) ? stage(a, cfg) : 'dead',
      strength: r2(strength(a, cfg)), motherId: a.motherId, fatherId: a.fatherId, cause: a.cause,
      hunger: r1(a.hunger), thirst: r1(a.thirst), energy: r1(a.energy), health: r1(a.health),
      scores: Object.fromEntries(Object.entries(a.scores).map(([k, v]) => [k, Number.isFinite(v) ? r1(v) : null])),
      recent: a.recent,
    })),
  };
}
