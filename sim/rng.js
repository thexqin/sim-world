// Seeded RNG (mulberry32). All randomness goes through here so runs are reproducible.
// `state` can be read and restored to resume a run exactly.

export function createRng(seed) {
  let s = seed >>> 0;
  const rng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(rng.next() * n);
    },
    get state() {
      return s;
    },
    set state(v) {
      s = v >>> 0;
    },
  };
  return rng;
}
