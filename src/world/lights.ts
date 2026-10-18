/**
 * The traffic lights' timing, British style: red, red and amber together,
 * green, amber, red. At a junction each group of lights (the ways in that
 * face each other) has its turn, with a moment of red all round between;
 * where people cross, they get a turn too, with every light red and the green
 * man lit. Pure, so it's tested; the same answers for the traffic and
 * people to come.
 */

import type { Controller } from '../map/osm';

export type Light = 'red' | 'redamber' | 'green' | 'amber';

/** Seconds. */
const GREEN = 12;
const AMBER = 3;
const RED_AMBER = 2;
const ALL_RED = 2;
const WALK = 8;

/** How long one go round a controller's lights takes, seconds. */
export function cycleLength(c: Controller): number {
  return c.groups * (RED_AMBER + GREEN + AMBER + ALL_RED) + (c.walk ? WALK + ALL_RED : 0);
}

/** Where a controller is in its cycle at `time` seconds: each starts at its own point, so they're not all in step. */
function phase(c: Controller, id: number, time: number): number {
  const length = cycleLength(c);
  return (((time + id * 7.3) % length) + length) % length;
}

/** What a group of a controller's lights shows at `time` seconds. */
export function lightAt(c: Controller, id: number, group: number, time: number): Light {
  const t = phase(c, id, time) - group * (RED_AMBER + GREEN + AMBER + ALL_RED);
  if (t < 0) return 'red';
  if (t < RED_AMBER) return 'redamber';
  if (t < RED_AMBER + GREEN) return 'green';
  if (t < RED_AMBER + GREEN + AMBER) return 'amber';
  return 'red';
}

/** Whether people may cross at a controller's crossings at `time` seconds (the green man). */
export function walkAt(c: Controller, id: number, time: number): boolean {
  if (!c.walk) return false;
  const t = phase(c, id, time) - c.groups * (RED_AMBER + GREEN + AMBER + ALL_RED);
  return t >= 0 && t < WALK;
}
