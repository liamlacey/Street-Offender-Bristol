import type { Difficulty } from '../settings';
import type { DriverProfile } from './AiDriver';

export const MIN_OPPONENTS = 1;
export const MAX_OPPONENTS = 20;

/** Names and colours for the field, in grid order. Red is kept for the player. */
const ROSTER: [name: string, color: number][] = [
  ['Blue', 0x2f6fde],
  ['Yellow', 0xf2c12e],
  ['Green', 0x2fb36b],
  ['Orange', 0xff8a1f],
  ['Purple', 0x8a4fd8],
  ['Cyan', 0x2ec4d6],
  ['Pink', 0xff6fb5],
  ['Lime', 0xa6e22e],
  ['White', 0xeeeeee],
  ['Navy', 0x23396e],
  ['Brown', 0x8a5a2b],
  ['Teal', 0x1f8a80],
  ['Gold', 0xc9a227],
  ['Violet', 0xc58cff],
  ['Black', 0x222222],
  ['Sky', 0x8cc8ff],
  ['Olive', 0x7a8a2b],
  ['Coral', 0xff7f6b],
  ['Mint', 0x9ef0c8],
  ['Silver', 0xa8b0b8],
];

/** The default three-car field (also used by the menu's background animation). */
export const AI_DRIVERS: DriverProfile[] = makeField(3);

/**
 * `count` drivers with paces spread from fastest to slowest, so a big field
 * strings out rather than running as a pack. Three drivers are 3% apart
 * (97%, 94%, 91%); bigger fields squeeze into 97%..85%.
 */
function makeField(count: number): DriverProfile[] {
  const step = Math.min(0.03, 0.12 / Math.max(1, count - 1));
  return ROSTER.slice(0, count).map(([name, color], i) => ({
    name,
    color,
    pace: 0.97 - i * step,
    wobble: 6 + ((i * 6) % 18),
  }));
}

/**
 * How each difficulty changes the field: how bravely the racing line takes
 * corners, and a multiplier on every driver's pace. On Docklands Classic the
 * leader laps in about 23.7s (easy), 22.3s (medium) and 20.4s (hard).
 */
export const DIFFICULTY: Record<Difficulty, { cornerFactor: number; pace: number }> = {
  easy: { cornerFactor: 0.5, pace: 0.95 },
  medium: { cornerFactor: 0.55, pace: 1 },
  hard: { cornerFactor: 0.8, pace: 1.03 },
};

/** The AI field for a difficulty and number of opponents. */
export function driversFor(difficulty: Difficulty, count = 3): DriverProfile[] {
  const { pace } = DIFFICULTY[difficulty];
  const clamped = Math.max(MIN_OPPONENTS, Math.min(MAX_OPPONENTS, count));
  return makeField(clamped).map((d) => ({ ...d, pace: d.pace * pace }));
}
