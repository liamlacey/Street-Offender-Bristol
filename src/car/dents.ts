/**
 * Damage to vehicles (yours, the traffic, the parked cars): where a hit lands
 * on the body and how hard, and what it does there. A glancing touch
 * scratches the paint; harder, the paint chips off and the panel dents; a big
 * hit crumples the corner or side in. Lights smash, wing mirrors and hubcaps
 * come off, and the bumper comes loose and falls off as the end of the car
 * takes more. How hard is the impulse of the hit (it grows with the speed the
 * two came together at, and with the weight of what hit it), less for a
 * sturdier vehicle. It all adds up, hit after hit. Pure, so it's tested; the
 * scene paints it (see dentArt.ts) and drops the parts.
 *
 * Positions on the body are from its middle: u forward along it, v across it
 * (+ the right-hand side, as y is down with the vehicle facing along x).
 */

export type Side = 'front' | 'rear' | 'left' | 'right';
export type Part = 'bumperFront' | 'bumperRear' | 'mirrorLeft' | 'mirrorRight' | 'lightFrontLeft' | 'lightFrontRight' | 'lightRearLeft' | 'lightRearRight' | 'hubcap';

/** Something done to the paintwork or the body. */
export interface Mark {
  kind: 'scratch' | 'chip' | 'dent' | 'crumple' | 'crack';
  u: number;
  v: number;
  /** How big (a scratch's length, a dent's radius, how far a crumple's pushed in), px. */
  size: number;
  /** Which way (a scratch's), radians; and which side of the body it's on. */
  angle: number;
  side: Side;
  /** For its jagged edges and scatter, the same every time it's drawn. */
  seed: number;
}

/** A vehicle's damage so far. */
export interface Wreck {
  /** How much each side's taken, all told. */
  taken: Record<Side, number>;
  marks: Mark[];
  /** What's come off or broken. */
  lost: Part[];
  /** Goes up by one with each change, so the picture's painted again. */
  version: number;
  /** When it was last hit, seconds, and how hard (a car pressed against something isn't hit over and over). */
  last: number;
  lastForce: number;
}

export interface Shape {
  length: number;
  width: number;
  /** How much a hit takes to do the same damage, against a car's 1 (a lorry's built heavier). */
  stiffness: number;
  /** Where its wing mirrors and windscreen are along it (u, from its middle), px. */
  mirror: number;
  screen: number;
}

/** What a hit did: the new marks, and what fell off or broke (and where, on the body). */
export interface Outcome {
  marks: Mark[];
  lost: { part: Part; u: number; v: number }[];
}

/** How hard a hit (impulse ÷ stiffness) does each: below SCRATCH, nothing. */
export const SCRATCH = 7;
export const CHIP = 16;
export const DENT = 28;
export const CRUMPLE = 75;
/** A light breaks, a mirror or hubcap comes off, hit this hard near it. */
const LIGHT = 30;
const MIRROR = 22;
const HUBCAP = 45;
/** An end's bumper hangs loose once it's taken this much, and falls off at BUMPER_OFF. */
const BUMPER_OFF = 160;
/** Most marks kept on a body (the faintest go first). */
const MOST_MARKS = 48;
/** Hits closer together than this, seconds, are the same hit (unless harder). */
const SAME_HIT = 0.15;

export function newWreck(): Wreck {
  return { taken: { front: 0, rear: 0, left: 0, right: 0 }, marks: [], lost: [], version: 0, last: -1, lastForce: 0 };
}

/** A point in the world, on a body at (x, y) facing `angle`: [u, v]. */
export function toBody(px: number, py: number, x: number, y: number, angle: number): [number, number] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [(px - x) * c + (py - y) * s, -(px - x) * s + (py - y) * c];
}

/** And back: a point on the body, in the world. */
export function toWorld(u: number, v: number, x: number, y: number, angle: number): [number, number] {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [x + u * c - v * s, y + u * s + v * c];
}

/** Where on its outline a hit at (u, v) lands, and which side that is. */
export function onOutline(shape: Shape, u: number, v: number): { u: number; v: number; side: Side } {
  const [hl, hw] = [shape.length / 2, shape.width / 2];
  const cu = Math.max(-hl, Math.min(hl, u));
  const cv = Math.max(-hw, Math.min(hw, v));
  // Whichever edge it's nearer, for its shape.
  if ((hl - Math.abs(cu)) / hl < (hw - Math.abs(cv)) / hw) return { u: Math.sign(cu || 1) * hl, v: cv, side: cu >= 0 ? 'front' : 'rear' };
  return { u: cu, v: Math.sign(cv || 1) * hw, side: cv >= 0 ? 'right' : 'left' };
}

/**
 * A hit at (u, v) on the body, with this impulse: what it does, added to the
 * wreck. `time` (seconds) is when, `rand` for where the scratches and chips fall.
 */
export function hit(w: Wreck, shape: Shape, u: number, v: number, impulse: number, time: number, rand: () => number): Outcome {
  const out: Outcome = { marks: [], lost: [] };
  const force = impulse / shape.stiffness;
  if (force < SCRATCH) return out;
  // Pressed against something, it's the one hit, unless this is harder.
  if (time - w.last < SAME_HIT && force < w.lastForce * 1.5) return out;
  w.last = time;
  w.lastForce = force;
  const at = onOutline(shape, u, v);
  w.taken[at.side] += force;
  const [hl, hw] = [shape.length / 2, shape.width / 2];
  const end = at.side === 'front' || at.side === 'rear';
  // Along the edge it's on.
  const along = end ? Math.PI / 2 : 0;
  const seed = () => Math.floor(rand() * 1e9);
  const mark = (kind: Mark['kind'], du: number, dv: number, size: number, angle = along) =>
    out.marks.push({ kind, u: Math.max(-hl, Math.min(hl, at.u + du)), v: Math.max(-hw, Math.min(hw, at.v + dv)), size, angle, side: at.side, seed: seed() });
  // Scratches along the edge, more and longer the harder.
  const scratches = Math.min(5, 1 + Math.floor(force / 15));
  for (let k = 0; k < scratches; k++) {
    const off = (rand() - 0.5) * Math.min(14, 4 + force * 0.1);
    mark('scratch', end ? 0 : off, end ? off : 0, Math.min(18, 3 + force * 0.14) * (0.6 + rand() * 0.6), along + (rand() - 0.5) * 0.5);
  }
  if (force >= CHIP) {
    for (let k = 0; k < Math.min(8, Math.floor(force / 10)); k++) {
      const r = 2 + force * 0.05;
      mark('chip', (rand() - 0.5) * r * 2, (rand() - 0.5) * r * 2, 0.5 + rand() * 1.1);
    }
  }
  if (force >= DENT) mark('dent', 0, 0, Math.min(hw * 0.9, 2.5 + (force - DENT) * 0.07));
  if (force >= CRUMPLE) mark('crumple', 0, 0, Math.min(end ? hl * 0.35 : hw * 0.45, 1.5 + (force - CRUMPLE) * 0.05));
  // The windscreen cracks, hit hard from the front.
  if (at.side === 'front' && force >= CRUMPLE) mark('crack', shape.screen - at.u, -at.v * 0.5, Math.min(hw * 0.8, 3 + (force - CRUMPLE) * 0.04));

  const lose = (part: Part, pu: number, pv: number) => {
    if (w.lost.includes(part)) return;
    w.lost.push(part);
    out.lost.push({ part, u: pu, v: pv });
  };
  // The lights, at the corners of the ends.
  if (end && force >= LIGHT) {
    const front = at.side === 'front';
    for (const right of [false, true]) {
      const lv = (right ? 1 : -1) * (hw - 3.5);
      if (Math.abs(at.v - lv) < 5 + force * 0.04) lose(`light${front ? 'Front' : 'Rear'}${right ? 'Right' : 'Left'}` as Part, at.u, lv);
    }
  }
  // A wing mirror, by the windscreen, hit from the side.
  if (!end && force >= MIRROR && Math.abs(at.u - shape.mirror) < 6) lose(at.side === 'left' ? 'mirrorLeft' : 'mirrorRight', at.u, at.v);
  // A hubcap, hit by a wheel.
  if (!end && force >= HUBCAP && WHEELS.some((f) => Math.abs(at.u - f * shape.length) < 5) && rand() < 0.5) {
    w.lost = w.lost.filter((p) => p !== 'hubcap');
    out.lost.push({ part: 'hubcap', u: at.u, v: at.v });
  }
  // The bumper: once an end's taken enough, it's off.
  for (const [side, part] of [['front', 'bumperFront'], ['rear', 'bumperRear']] as const) {
    if (w.taken[side] >= BUMPER_OFF) lose(part, side === 'front' ? hl : -hl, 0);
  }

  w.marks.push(...out.marks);
  if (w.marks.length > MOST_MARKS) {
    // The faintest scratches and chips go; dents and crumples stay.
    const keep = w.marks.filter((m) => m.kind !== 'scratch' && m.kind !== 'chip');
    const light = w.marks.filter((m) => m.kind === 'scratch' || m.kind === 'chip');
    w.marks = [...keep, ...light.slice(-(MOST_MARKS - keep.length))];
  }
  w.version++;
  return out;
}

/** Where the wheels are along a car, from its middle, as a fraction of its length. */
export const WHEELS = [-0.32, 0.27];

/** How sturdy each kind is (a car's 1); yours is built tougher (twice), so it takes a fair knocking before it shows. */
export const STIFFNESS: Record<string, number> = { small: 0.9, hatch: 1, saloon: 1.05, estate: 1.05, suv: 1.3, van: 1.3, lorry: 2.2, bus: 3, double: 3.2, player: 2, own: 2 };
