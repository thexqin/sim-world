// Dial schema: the single source of truth for every tunable value.
// The UI builds its controls, hover tips and the Guide pane from this list (GET /api/dials).
// section: heading the dial is listed under in the Guide.
// group: 'main' dials are shown up front, 'advanced' ones are tucked away.
// reset: true means the dial only takes effect on the next world reset.
// help: plain-English explanation shown on hover and in the Guide.

const TIME = 'Time & playback';
const NEEDS = 'Needs (hunger, thirst, energy, health)';
const DECIDE = 'How the agent decides';
const FOOD = 'Food & weather';
const WORLD = 'New world (applied on reset)';
const DISPLAY = 'Display';

export const DIALS = [
  // Time & playback
  { key: 'running', label: 'Running', type: 'bool', default: true, group: 'main', section: TIME,
    help: 'Play or pause the world. While paused nothing changes, but you can still turn dials, drop food and save snapshots.' },
  { key: 'speed', label: 'Speed multiplier', type: 'number', min: 0.25, max: 20, step: 0.25, default: 1, group: 'main', section: TIME,
    help: 'How fast time runs. 1 is normal (4 ticks per second), 2 is twice as fast, 0.5 is half speed. It only changes how quickly you see things happen, not what happens.' },
  { key: 'baseTickMs', label: 'Base tick length (ms)', type: 'number', min: 20, max: 2000, step: 10, default: 250, group: 'advanced', section: TIME,
    help: 'Real time between ticks at speed 1, in milliseconds. 250 ms means 4 ticks per second. Most people should use the speed multiplier instead.' },
  { key: 'ticksPerDay', label: 'Day length (ticks)', type: 'number', min: 24, max: 2000, step: 1, default: 240, group: 'main', section: TIME,
    help: 'How many ticks make one full 24-hour day. At 240 a day lasts about a minute at speed 1. Needs change per tick, not per hour, so a longer day also means the agent gets hungrier within one day. Changing it keeps the current time of day.' },
  { key: 'startHour', label: 'Hour the run starts', type: 'number', min: 0, max: 23, step: 1, default: 7, group: 'advanced', reset: true, section: TIME,
    help: 'The clock time (0–23) when a new world begins. 7 means the world starts at 07:00 in the morning.' },
  { key: 'nightStartHour', label: 'Night starts (hour)', type: 'number', min: 0, max: 24, step: 1, default: 20, group: 'advanced', section: TIME,
    help: 'Hour when night begins. At night the map goes dark and the agent gets a bonus toward sleeping.' },
  { key: 'nightEndHour', label: 'Night ends (hour)', type: 'number', min: 0, max: 24, step: 1, default: 6, group: 'advanced', section: TIME,
    help: 'Hour when night ends and day begins.' },
  { key: 'twilightHours', label: 'Twilight length (hours)', type: 'number', min: 0, max: 4, step: 0.5, default: 1.5, group: 'advanced', section: TIME,
    help: 'How many hours the map takes to fade to dark before night, and back to light after it. Only changes the look, not behavior.' },
  { key: 'nightDarkness', label: 'Night darkness', type: 'number', min: 0, max: 0.9, step: 0.05, default: 0.6, group: 'advanced', section: TIME,
    help: 'How dark the map looks at night, from 0 (no shading) to 0.9 (very dark). Only changes the look.' },

  // Needs
  { key: 'hungerRate', label: 'Hunger rate', type: 'number', min: 0, max: 5, step: 0.05, default: 0.4, group: 'main', section: NEEDS,
    help: 'How much hunger goes up every tick. Hunger runs from 0 (full) to 100 (starving). At 0.4 it takes 250 ticks, about one day, to go from full to starving.' },
  { key: 'thirstRate', label: 'Thirst rate', type: 'number', min: 0, max: 5, step: 0.05, default: 0.5, group: 'main', section: NEEDS,
    help: 'How much thirst goes up every tick, on the same 0–100 scale. At 0.5 it takes 200 ticks to go from not thirsty to parched.' },
  { key: 'energyDrain', label: 'Energy drain rate', type: 'number', min: 0, max: 5, step: 0.05, default: 0.3, group: 'main', section: NEEDS,
    help: 'How much energy goes down every tick. Energy runs from 100 (fully rested) to 0 (exhausted). It drains even while sleeping; sleep just restores more than it drains.' },
  { key: 'sleepRestore', label: 'Energy restored per sleep tick', type: 'number', min: 0, max: 10, step: 0.1, default: 1.2, group: 'advanced', section: NEEDS,
    help: 'Energy gained for each tick spent asleep. The real gain is this minus the energy drain rate, so with defaults sleep adds 0.9 per tick.' },
  { key: 'foodValue', label: 'Hunger removed per food', type: 'number', min: 0, max: 100, step: 1, default: 35, group: 'advanced', section: NEEDS,
    help: 'How much hunger one berry removes. The berry disappears when eaten.' },
  { key: 'drinkValue', label: 'Thirst removed per drink', type: 'number', min: 0, max: 100, step: 1, default: 25, group: 'advanced', section: NEEDS,
    help: 'How much thirst one tick of drinking removes. The agent drinks while standing next to water and keeps drinking until something else matters more. Water never runs out.' },
  { key: 'healthDecay', label: 'Health lost per maxed need', type: 'number', min: 0, max: 10, step: 0.1, default: 0.5, group: 'advanced', section: NEEDS,
    help: 'Health lost each tick for every need at its limit (hunger 100, thirst 100 or energy 0). Two maxed needs hurt twice as fast. At health 0 the agent dies, turns grey and stops.' },
  { key: 'healthRegen', label: 'Health regen per tick', type: 'number', min: 0, max: 5, step: 0.01, default: 0.05, group: 'advanced', section: NEEDS,
    help: 'Health recovered each tick while no need is at its limit.' },
  { key: 'startHunger', label: 'Starting hunger', type: 'number', min: 0, max: 100, step: 1, default: 20, group: 'advanced', section: NEEDS,
    help: 'Hunger of a newly created agent (on reset or when you press Add agent).' },
  { key: 'startThirst', label: 'Starting thirst', type: 'number', min: 0, max: 100, step: 1, default: 20, group: 'advanced', section: NEEDS,
    help: 'Thirst of a newly created agent.' },
  { key: 'startEnergy', label: 'Starting energy', type: 'number', min: 0, max: 100, step: 1, default: 80, group: 'advanced', section: NEEDS,
    help: 'Energy of a newly created agent.' },

  // Decision scoring
  { key: 'wanderScore', label: 'Wander base score', type: 'number', min: 0, max: 100, step: 1, default: 35, group: 'advanced', section: DECIDE,
    help: 'The fixed score for wandering. A need has to score higher than this before the agent acts on it. Higher makes the agent relaxed (waits until quite hungry before eating); lower makes it fussy (eats or drinks at the first sign of need).' },
  { key: 'nightSleepBonus', label: 'Sleep bonus at night', type: 'number', min: 0, max: 100, step: 1, default: 30, group: 'advanced', section: DECIDE,
    help: 'Extra points added to the sleep score during the night, so the agent tends to sleep at night instead of in the middle of the day. Set to 0 and it only sleeps when tired.' },
  { key: 'commitBonus', label: 'Bonus for keeping current action', type: 'number', min: 0, max: 50, step: 1, default: 10, group: 'advanced', section: DECIDE,
    help: 'Extra points for whatever the agent is already doing. This stops it flipping back and forth every tick when two choices score about the same. Higher makes it more stubborn.' },

  // Food & weather
  { key: 'foodRegrowth', label: 'Food regrowth rate', type: 'number', min: 0, max: 1, step: 0.01, default: 0.15, group: 'main', section: FOOD,
    help: 'The chance each tick that one new berry grows. 0.15 means roughly one new berry every 7 ticks. Berries stop growing once the map holds its maximum (see Food scarcity).' },
  { key: 'foodScarcity', label: 'Food scarcity', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, group: 'main', section: FOOD,
    help: 'How scarce food is, from 0 (plenty) to 1 (none). It lowers the most berries that can be on the map at once. A new world also starts half full, so this affects the starting amount too.' },
  { key: 'maxFoodDensity', label: 'Max food per grass tile', type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.06, group: 'advanced', section: FOOD,
    help: 'The share of grass tiles that can hold a berry before scarcity is applied. Maximum berries = grass tiles × this × (1 − scarcity). With defaults that is about 55 berries.' },
  { key: 'foodTreeBias', label: 'Food preference for tree edges', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5, group: 'advanced', section: FOOD,
    help: 'Berries like to grow next to trees. 0 means they grow anywhere on grass; 1 means only next to trees; 0.5 means spots away from trees are half as likely.' },
  { key: 'drought', label: 'Drought (cuts regrowth)', type: 'bool', default: false, group: 'main', section: FOOD,
    help: 'Turn on a drought. During a drought berries grow much more slowly (see Regrowth multiplier in drought). Berries already on the map stay.' },
  { key: 'droughtFactor', label: 'Regrowth multiplier in drought', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2, group: 'advanced', section: FOOD,
    help: 'How much regrowth is kept during a drought. 0.2 means berries grow at one fifth of the normal rate; 0 means no new berries at all.' },

  // World generation (used on reset)
  { key: 'seed', label: 'Seed', type: 'number', min: 0, max: 999999, step: 1, default: 42, group: 'main', reset: true, section: WORLD,
    help: 'The number that decides the random map and every random choice in the world. The same seed with the same dials and the same actions always plays out exactly the same. Pick a new seed and press Reset world for a different map.' },
  { key: 'worldSize', label: 'World size (tiles)', type: 'number', min: 10, max: 100, step: 1, default: 40, group: 'advanced', reset: true, section: WORLD,
    help: 'Width and height of the square map, in tiles.' },
  { key: 'lakeCount', label: 'Lakes', type: 'number', min: 0, max: 20, step: 1, default: 4, group: 'advanced', reset: true, section: WORLD,
    help: 'How many lakes are placed. Lakes can overlap. With 0 lakes there is no water and the agent will eventually die of thirst.' },
  { key: 'lakeMinRadius', label: 'Lake min radius', type: 'number', min: 1, max: 10, step: 0.5, default: 2, group: 'advanced', reset: true, section: WORLD,
    help: 'Smallest lake size, as a radius in tiles.' },
  { key: 'lakeMaxRadius', label: 'Lake max radius', type: 'number', min: 1, max: 15, step: 0.5, default: 5, group: 'advanced', reset: true, section: WORLD,
    help: 'Largest lake size, as a radius in tiles.' },
  { key: 'treeDensity', label: 'Tree density', type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.08, group: 'advanced', reset: true, section: WORLD,
    help: 'The share of land tiles that become trees. Trees block movement, and berries prefer to grow next to them.' },

  // Display / history
  { key: 'recentActions', label: 'Recent actions kept per agent', type: 'number', min: 1, max: 50, step: 1, default: 10, group: 'advanced', section: DISPLAY,
    help: 'How many past changes of action each agent remembers for the status panel.' },
  { key: 'historyTicks', label: 'History chart length (ticks)', type: 'number', min: 50, max: 5000, step: 10, default: 480, group: 'advanced', section: DISPLAY,
    help: 'How far back the history chart reaches. 480 ticks is two days at the default day length.' },
  { key: 'maxPushPerSec', label: 'Max browser updates per second', type: 'number', min: 1, max: 60, step: 1, default: 30, group: 'advanced', section: DISPLAY,
    help: 'The most times per second the server sends a new picture to the browser. At high speeds the world runs faster than this and some frames are skipped. It never changes the simulation itself.' },
];

const BY_KEY = new Map(DIALS.map((d) => [d.key, d]));

export function defaultConfig() {
  return Object.fromEntries(DIALS.map((d) => [d.key, d.default]));
}

// Validate one value against the schema. Returns { value } or { error }.
export function coerce(key, raw) {
  const d = BY_KEY.get(key);
  if (!d) return { error: `unknown dial: ${key}` };
  if (d.type === 'bool') return { value: raw === true || raw === 'true' || raw === 1 };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: `${key} must be a number` };
  return { value: Math.min(d.max, Math.max(d.min, n)) };
}

// Defaults overlaid with any valid stored values (unknown or bad keys are dropped).
export function sanitizeConfig(stored = {}) {
  const cfg = defaultConfig();
  for (const [k, v] of Object.entries(stored)) {
    const r = coerce(k, v);
    if (!r.error) cfg[k] = r.value;
  }
  return cfg;
}
