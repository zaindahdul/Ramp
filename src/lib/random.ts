// Small deterministic PRNG (mulberry32) so seed data and mock extractions are
// reproducible.

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    weighted: (entries) => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, weight] of entries) {
        r -= weight;
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}

export function seedFromHex(hex: string): number {
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}
