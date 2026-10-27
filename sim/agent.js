// Agent status, needs and decision logic.

import { TILE, DIRS, get, set, inBounds, passable, findPath } from './world.js';

export const ACTIONS = ['eat', 'seek_water', 'sleep', 'wander'];

const clamp = (v) => Math.max(0, Math.min(100, v));

export function createAgent(id, world, cfg, rng) {
  let x, y;
  do {
    x = rng.int(world.size);
    y = rng.int(world.size);
  } while (get(world, x, y) !== TILE.GRASS);
  return {
    id, x, y,
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

// 1. Needs drift each tick; maxed-out needs hurt health.
export function updateNeeds(agent, cfg) {
  agent.hunger = clamp(agent.hunger + cfg.hungerRate);
  agent.thirst = clamp(agent.thirst + cfg.thirstRate);
  agent.energy = clamp(agent.energy - cfg.energyDrain);
  const maxed = (agent.hunger >= 100) + (agent.thirst >= 100) + (agent.energy <= 0);
  agent.health = clamp(maxed ? agent.health - cfg.healthDecay * maxed : agent.health + cfg.healthRegen);
}

// 2-3. Score every option and pick the best. Pure: no randomness, no mutation.
// This is the single swap point for a future LLM-driven policy.
export function decide(agent, world, cfg, clock) {
  const food = findPath(world, agent.x, agent.y, (x, y) => get(world, x, y) === TILE.FOOD);
  const water = findPath(world, agent.x, agent.y, (x, y) =>
    DIRS.some(([dx, dy]) => inBounds(world, x + dx, y + dy) && get(world, x + dx, y + dy) === TILE.WATER));

  const scores = {
    eat: food ? agent.hunger : -Infinity,
    seek_water: water ? agent.thirst : -Infinity,
    sleep: 100 - agent.energy + (clock.isNight ? cfg.nightSleepBonus : 0),
    wander: cfg.wanderScore,
  };
  if (agent.action in scores) scores[agent.action] += cfg.commitBonus;

  let action = ACTIONS[0];
  for (const a of ACTIONS) if (scores[a] > scores[action]) action = a;

  const path = action === 'eat' ? food : action === 'seek_water' ? water : null;
  return { action, path, scores };
}

// Carry out the decision: move one tile toward the target, or perform the action.
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
