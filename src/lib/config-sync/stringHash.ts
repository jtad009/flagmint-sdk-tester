/**
 * djb2 variant matching npm `string-hash` (and Go `evaluate.StringHash`).
 * Iterates right-to-left with XOR — required for rollout bucket parity.
 */
export function stringHash(input: string): number {
  let hash = 5381;
  let i = input.length;
  while (i) {
    hash = (hash * 33) ^ input.charCodeAt(--i);
  }
  return hash >>> 0;
}

/** Stable bucket in [0, 99] for percentage / variant rollouts. */
export function hashPercent(input: string): number {
  return stringHash(input) % 100;
}
