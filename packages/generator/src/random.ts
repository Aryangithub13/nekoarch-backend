/** FNV-1a over UTF-16 code units: fixed integer arithmetic, no platform entropy. */
export function hashSeed(value: string): number {
  let state = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { state = Math.imul(state ^ value.charCodeAt(i), 0x01000193); }
  return state >>> 0;
}

/** Centralized Mulberry32 source. It is for layout variation, not secret tokens. */
export function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
