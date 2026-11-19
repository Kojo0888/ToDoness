/**
 * Is the connection unstable? (docs/unstable-connection FR-257, FR-258)
 *
 * Every request and connection check is a sample. A sample is bad when it got no answer, only
 * a partial one, or took `slowMs` or longer. Unstable: at least `badToUnstable` of the last
 * `windowSize` samples are bad. Stable again: `goodToStable` good samples in a row.
 */
export interface LinkSample {
  /** False: no answer in time, or an answer that could not be read (partial). */
  ok: boolean;
  /** How long the answer took. */
  ms: number;
}

export interface LinkQualityOptions {
  slowMs?: number;
  windowSize?: number;
  badToUnstable?: number;
  goodToStable?: number;
}

export interface LinkQuality {
  /** Adds a sample and returns whether the connection is unstable now. */
  record(sample: LinkSample): boolean;
}

export function createLinkQuality(opts: LinkQualityOptions = {}): LinkQuality {
  const { slowMs = 2000, windowSize = 6, badToUnstable = 2, goodToStable = 4 } = opts;
  let window: boolean[] = []; // true = bad
  let goodStreak = 0;
  let unstable = false;
  return {
    record({ ok, ms }) {
      const bad = !ok || ms >= slowMs;
      window = [...window, bad].slice(-windowSize);
      goodStreak = bad ? 0 : goodStreak + 1;
      if (!unstable) {
        unstable = window.filter(Boolean).length >= badToUnstable;
      } else if (goodStreak >= goodToStable) {
        unstable = false;
        window = []; // old bad samples must not bring it back at once
      }
      return unstable;
    },
  };
}
