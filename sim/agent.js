// Agent status, needs, life stages and decision logic.

import { TILE, DIRS, get, set, inBounds, passable, findPath } from './world.js';

export const ACTIONS = ['eat', 'seek_water', 'sleep', 'mate', 'wander'];

// Fixed shape of the life curve (see notes/DESIGN-population.md).
const CHILD_STRENGTH = 0.25; // strength at birth
const ELDER_STRENGTH = 0.5; // strength at the end of a natural lifespan
const LIFESPAN_SPREAD = 0.2; // each agent's lifespan is the dial ±20%

const clamp = (v) => Math.max(0, Math.min(100, v));

// opts: { x, y, sex, age, motherId, fatherId }. Missing position = random grass tile;
// missing sex = random; missing age = just grown up.
export function createAgent(id, world, cfg, rng, opts = {}) {
  let { x, y } = opts;
  if (x === undefined) {
    do {
      x = rng.int(world.size);
      y = rng.int(world.size);
    } while (get(world, x, y) !== TILE.GRASS);
  }
  const sex = opts.sex ?? (rng.next() < 0.5 ? 'F' : 'M');
  const lifespan = cfg.lifespan * (1 + LIFESPAN_SPREAD * (2 * rng.next() - 1));
  return {
    id, x, y, sex,
    age: opts.age ?? cfg.adultAge, // in days
    lifespan, // in days
    motherId: opts.motherId ?? null,
    fatherId: opts.fatherId ?? null,
    lastBirth: null, // world day of her last child
    lastFight: null, // world day of the last fight
    diedAt: null, // world day of death
    cause: null, // cause of death
    hunger: cfg.startHunger,
    thirst: cfg.startThirst,
    energy: cfg.startEnergy,
    health: 100,
    action: 'wander',
    target: null,
    scores: {},
    inventory: {},
    recent: [],
  };
}

export const isAlive = (a) => a.action !== 'dead';

export function stage(agent, cfg) {
  if (agent.age < cfg.adultAge) return 'child';
  return agent.age < elderStart(agent, cfg) ? 'adult' : 'elder';
}

// The last "adult age" days of a lifespan are old age.
const elderStart = (agent, cfg) => Math.max(cfg.adultAge, agent.lifespan - cfg.adultAge);

// 0..1: grows through childhood, 1 for adults, fades in old age.
export function strength(agent, cfg) {
  const A = cfg.adultAge;
  if (agent.age < A) return CHILD_STRENGTH + (1 - CHILD_STRENGTH) * (agent.age / A);
  const start = elderStart(agent, cfg);
  if (agent.age < start) return 1;
  const span = agent.lifespan - start;
  const t = span > 0 ? Math.min(1, (agent.age - start) / span) : 1;
  return 1 - (1 - ELDER_STRENGTH) * t;
}

export const fightPower = (agent, cfg) => strength(agent, cfg) * (agent.health / 100);

// Content: no need is pressing (all below the wander score). Stressed: hungry or thirsty.
export const isContent = (a, cfg) =>
  a.hunger < cfg.wanderScore && a.thirst < cfg.wanderScore && 100 - a.energy < cfg.wanderScore;
export const isStressed = (a, cfg) => a.hunger > cfg.wanderScore || a.thirst > cfg.wanderScore;

export function canMate(a, cfg, now) {
  if (!isAlive(a) || stage(a, cfg) !== 'adult' || !isContent(a, cfg)) return false;
  return a.sex === 'M' || a.lastBirth === null || now - a.lastBirth >= cfg.birthInterval;
}

// Parent/child or siblings (sharing a parent) never mate.
export function related(a, b) {
  return a.id === b.motherId || a.id === b.fatherId || b.id === a.motherId || b.id === a.fatherId ||
    (a.motherId !== null && a.motherId === b.motherId) || (a.fatherId !== null && a.fatherId === b.fatherId);
}

export const isPartner = (a, b, cfg, now) =>
  a.id !== b.id && a.sex !== b.sex && canMate(b, cfg, now) && !related(a, b);

export const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;

// 1. Age and needs drift each tick. Children and elders tire faster and heal slower;
// maxed-out needs and old age hurt health.
export function updateNeeds(agent, cfg) {
  const s = strength(agent, cfg);
  agent.age += 1 / cfg.ticksPerDay;
  agent.hunger = clamp(agent.hunger + cfg.hungerRate);
  agent.thirst = clamp(agent.thirst + cfg.thirstRate);
  agent.energy = clamp(agent.energy - cfg.energyDrain * (2 - s));
  const maxed = (agent.hunger >= 100) + (agent.thirst >= 100) + (agent.energy <= 0) + (agent.age >= agent.lifespan);
  agent.health = clamp(maxed ? agent.health - cfg.healthDecay * maxed : agent.health + cfg.healthRegen * s);
}

// Why an agent's health ran out (when not killed in a fight).
export function causeOfDeath(agent) {
  if (agent.age >= agent.lifespan) return 'old age';
  if (agent.hunger >= 100) return 'hunger';
  if (agent.thirst >= 100) return 'thirst';
  return 'exhaustion';
}

// 2-3. Score every option and pick the best. Pure: no randomness, no mutation.
// `agents` (everyone, read-only) is needed to find partners.
// This is the single swap point for a future LLM-driven policy.
export function decide(agent, world, cfg, clock, agents) {
  const food = findPath(world, agent.x, agent.y, (x, y) => get(world, x, y) === TILE.FOOD);
  const water = findPath(world, agent.x, agent.y, (x, y) =>
    DIRS.some(([dx, dy]) => inBounds(world, x + dx, y + dy) && get(world, x + dx, y + dy) === TILE.WATER));

  // Mating: only when content, grown up, and the population has room.
  let partner = null;
  const living = agents.filter(isAlive).length;
  if (living < cfg.maxAgents && canMate(agent, cfg, clock.now)) {
    const partners = agents.filter((b) => isPartner(agent, b, cfg, clock.now));
    if (partners.length) partner = findPath(world, agent.x, agent.y, (x, y) => partners.some((b) => near({ x, y }, b)));
  }

  const scores = {
    eat: food ? agent.hunger : -Infinity,
    seek_water: water ? agent.thirst : -Infinity,
    sleep: 100 - agent.energy + (clock.isNight ? cfg.nightSleepBonus : 0),
    // Beats wandering (even with its keep-going bonus) but never a real need.
    mate: partner ? cfg.wanderScore + cfg.commitBonus + 1 : -Infinity,
    wander: cfg.wanderScore,
  };
  if (agent.action in scores) scores[agent.action] += cfg.commitBonus;

  let action = ACTIONS[0];
  for (const a of ACTIONS) if (scores[a] > scores[action]) action = a;

  const path = { eat: food, seek_water: water, mate: partner }[action] ?? null;
  return { action, path, scores };
}

// Carry out the decision: move one tile toward the target, or perform the action.
// Mating itself happens in the interaction step once partners are side by side.
export function act(agent, decision, world, cfg, rng) {
  const { action, path } = decision;
  agent.target = path ? { x: path.tx, y: path.ty } : null;

  if (path && path.dist > 0) {
    agent.x = path.nx;
    agent.y = path.ny;
  } else if (action === 'eat') {
    set(world, agent.x, agent.y, TILE.GRASS);
    agent.hunger = clamp(agent.hunger - cfg.foodValue);
  } else if (action === 'seek_water') {
    agent.thirst = clamp(agent.thirst - cfg.drinkValue);
  } else if (action === 'sleep') {
    agent.energy = clamp(agent.energy + cfg.sleepRestore);
  } else if (action === 'wander') {
    const options = DIRS.filter(([dx, dy]) =>
      inBounds(world, agent.x + dx, agent.y + dy) && passable(get(world, agent.x + dx, agent.y + dy)));
    if (options.length) {
      const [dx, dy] = options[rng.int(options.length)];
      agent.x += dx;
      agent.y += dy;
    }
  }
}

// Track action changes for the status panel.
export function setAction(agent, action, tick, cfg) {
  if (agent.action !== action || agent.recent.length === 0) {
    agent.recent.unshift({ tick, action });
    agent.recent.length = Math.min(agent.recent.length, cfg.recentActions);
  }
  agent.action = action;
}
