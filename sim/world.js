// Grid map: grass, water, tree, food. Generation, regrowth and pathfinding.

export const TILE = { GRASS: 0, WATER: 1, TREE: 2, FOOD: 3 };
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // fixed order keeps runs deterministic

export const passable = (t) => t === TILE.GRASS || t === TILE.FOOD;

export function createWorld(cfg, rng) {
  const size = cfg.worldSize;
  const grid = new Array(size * size).fill(TILE.GRASS);
  const world = { size, grid, foodCount: 0 };

  // Lakes: rough discs of water.
  for (let i = 0; i < cfg.lakeCount; i++) {
    const cx = rng.int(size);
    const cy = rng.int(size);
    const r = cfg.lakeMinRadius + rng.next() * (cfg.lakeMaxRadius - cfg.lakeMinRadius);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r * (0.75 + 0.5 * rng.next())) grid[y * size + x] = TILE.WATER;
      }
    }
  }

  // Trees scattered on grass.
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === TILE.GRASS && rng.next() < cfg.treeDensity) grid[i] = TILE.TREE;
  }

  // Start half full of food.
  const target = Math.floor(maxFood(world, cfg) / 2);
  for (let tries = 0; world.foodCount < target && tries < target * 50; tries++) spawnFood(world, cfg, rng);

  return world;
}

// Rebuild a world from a saved grid string (one digit per tile).
export function worldFromGrid(size, gridStr) {
  const grid = Array.from(gridStr, Number);
  return { size, grid, foodCount: grid.filter((t) => t === TILE.FOOD).length };
}

export function get(world, x, y) {
  return world.grid[y * world.size + x];
}

export function set(world, x, y, t) {
  const i = y * world.size + x;
  if (world.grid[i] === TILE.FOOD) world.foodCount--;
  if (t === TILE.FOOD) world.foodCount++;
  world.grid[i] = t;
}

export function inBounds(world, x, y) {
  return x >= 0 && y >= 0 && x < world.size && y < world.size;
}

export function maxFood(world, cfg) {
  const grass = world.grid.filter(passable).length;
  return Math.floor(grass * cfg.maxFoodDensity * (1 - cfg.foodScarcity));
}

// Place one food on a grass tile, preferring spots next to trees (berry bushes).
function spawnFood(world, cfg, rng) {
  const { size } = world;
  const x = rng.int(size);
  const y = rng.int(size);
  if (get(world, x, y) !== TILE.GRASS) return false;
  const nearTree = DIRS.some(([dx, dy]) => inBounds(world, x + dx, y + dy) && get(world, x + dx, y + dy) === TILE.TREE);
  if (!nearTree && rng.next() < cfg.foodTreeBias) return false;
  set(world, x, y, TILE.FOOD);
  return true;
}

export function regrow(world, cfg, rng) {
  if (world.foodCount >= maxFood(world, cfg)) return;
  const chance = cfg.foodRegrowth * (cfg.drought ? cfg.droughtFactor : 1);
  if (rng.next() >= chance) return;
  for (let tries = 0; tries < 50; tries++) if (spawnFood(world, cfg, rng)) return;
}

// Breadth-first search to the nearest tile satisfying isGoal(x, y).
// Returns { tx, ty, nx, ny, dist }: target, next step, path length. null if unreachable.
export function findPath(world, sx, sy, isGoal) {
  if (isGoal(sx, sy)) return { tx: sx, ty: sy, nx: sx, ny: sy, dist: 0 };
  const { size, grid } = world;
  const start = sy * size + sx;
  const prev = new Int32Array(size * size).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % size;
    const cy = (cur - cx) / size;
    for (const [dx, dy] of DIRS) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(world, x, y)) continue;
      const ni = y * size + x;
      if (prev[ni] !== -1 || !passable(grid[ni])) continue;
      prev[ni] = cur;
      if (isGoal(x, y)) {
        let s = ni;
        let dist = 1;
        while (prev[s] !== start) {
          s = prev[s];
          dist++;
        }
        return { tx: x, ty: y, nx: s % size, ny: Math.floor(s / size), dist };
      }
      queue.push(ni);
    }
  }
  return null;
}
