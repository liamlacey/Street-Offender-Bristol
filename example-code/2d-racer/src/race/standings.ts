export interface RaceEntry {
  /** Race time when the car finished, or null if still racing. */
  finishTime: number | null;
  /** Distance raced (LapTracker.progress). */
  progress: number;
}

/**
 * Race order as indices into `entries`: finishers first in the order they
 * finished, then everyone else by how far they've got.
 */
export function raceOrder(entries: RaceEntry[]): number[] {
  return entries
    .map((_, i) => i)
    .sort((a, b) => {
      const ea = entries[a];
      const eb = entries[b];
      if (ea.finishTime !== null && eb.finishTime !== null) return ea.finishTime - eb.finishTime;
      if (ea.finishTime !== null) return -1;
      if (eb.finishTime !== null) return 1;
      return eb.progress - ea.progress;
    });
}

/** "1st", "2nd", "3rd", "4th"... */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
