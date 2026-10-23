/**
 * Work done a little at a time: a generator that pauses (yields) now and
 * then in its long loops, so making a region of the map ready (see
 * src/world/streamer.ts) can be spread over many frames while you drive,
 * a few milliseconds each, rather than stopping the game; or run straight
 * through (the tests, and anything wanting it at once).
 */

export type Work<T = void> = Generator<void, T, void>;

/** Runs it straight through. */
export function drain<T>(work: Work<T>): T {
  for (;;) {
    const r = work.next();
    if (r.done) return r.value;
  }
}

/** Runs it for about `ms` milliseconds (at least a step): done, and its result, or not yet. */
export function runFor<T>(work: Work<T>, ms: number): { done: true; value: T } | { done: false } {
  const until = performance.now() + ms;
  for (;;) {
    const r = work.next();
    if (r.done) return { done: true, value: r.value };
    if (performance.now() >= until) return { done: false };
  }
}

/** When any of them last paused, ms (see `every`). */
let paused = 0;
/** No pause sooner than this after the last, ms: each one's a little garbage, and some loops pause every time round. */
const BETWEEN = 0.25;

/** A pause every `n` times it's called (for the long loops), if it's been a moment since the last: `if (tick()) yield;`. */
export function every(n: number): () => boolean {
  let k = 0;
  return () => {
    if (++k % n !== 0) return false;
    const now = performance.now();
    if (now - paused < BETWEEN) return false;
    paused = now;
    return true;
  };
}
