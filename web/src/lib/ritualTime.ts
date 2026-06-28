/**
 * Ritual Chain uses millisecond timestamps in `block.timestamp` (not Unix seconds).
 * All bounty deadlines must be stored and compared in milliseconds.
 */
export function nowMs(): number {
  return Date.now();
}

/** Detect seconds vs ms for display (legacy bounties may use seconds). */
export function toDisplayMs(value: bigint | number): number {
  const n = Number(value);
  if (n > 1_000_000_000_000) return n;
  return n * 1000;
}