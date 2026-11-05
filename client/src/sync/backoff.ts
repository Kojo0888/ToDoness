const BASE_MS = 1000;
const MAX_MS = 5 * 60_000;

/**
 * How long to wait before retry number `attempt` (0, 1, 2 …): 1 s, 2 s, 4 s …
 * up to 5 minutes, with up to 20% random variation so many browsers do not all
 * come back at the same moment.
 */
export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const steps = Math.min(Math.max(0, attempt), 30);
  const base = Math.min(MAX_MS, BASE_MS * 2 ** steps);
  return Math.round(base * (0.8 + 0.4 * random()));
}
