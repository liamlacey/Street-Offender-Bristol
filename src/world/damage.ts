/**
 * What happens when something's hit hard enough: what it's made of, how
 * strong it is (how fast a vehicle must be going into it, scaled by the
 * vehicle's weight), how much it slows the vehicle as it gives way, and what
 * it leaves behind. Everything except the buildings (and big structures like
 * fountains) gives way in the end: trees split and fall, lamp posts and traffic
 * lights bend over and spark, walls crumble, benches smash, hedges are torn
 * through, their leaves and twigs strewn about. What's left stays where it fell, in the way. Pure, so it's tested.
 */

import { CAR_LENGTH, CAR_WIDTH, type CarState } from '../car/CarPhysics';
import type { Segment } from '../physics/collisions';

export type Material = 'wood' | 'electric' | 'metal' | 'iron' | 'glass' | 'stone' | 'plant' | 'timber' | 'plastic';

/** Things that stand in one place until they're knocked down. */
export type ThingKind = 'tree' | 'lamp' | 'signal' | 'beacon' | 'bollard' | 'postbox' | 'phone' | 'fountain' | 'stump';
/** Walls, by what OSM calls them. */
export type WallKind = 'wall' | 'hedge' | 'fence' | 'railing';

export interface Toughness {
  material: Material;
  /** How fast (px/s) a car (weight 1) must hit it, square on, to break it; Infinity for what won't break. */
  strength: number;
  /** How much of its speed the vehicle loses breaking through (0..1). */
  absorb: number;
}

export const THINGS: Record<Exclude<ThingKind, 'tree'>, Toughness> = {
  lamp: { material: 'electric', strength: 150, absorb: 0.25 },
  signal: { material: 'electric', strength: 170, absorb: 0.3 },
  beacon: { material: 'electric', strength: 110, absorb: 0.15 },
  bollard: { material: 'metal', strength: 210, absorb: 0.35 },
  postbox: { material: 'iron', strength: 300, absorb: 0.45 },
  phone: { material: 'glass', strength: 170, absorb: 0.35 },
  // A big stone fountain: a structure, not something to knock over.
  fountain: { material: 'stone', strength: Infinity, absorb: 0 },
  // What's left of a tree: it's not going anywhere.
  stump: { material: 'wood', strength: Infinity, absorb: 0 },
};

export const WALLS: Record<WallKind, Toughness & { /** How much of it a hit at its strength brings down, px. */ gap: number }> = {
  wall: { material: 'stone', strength: 200, absorb: 0.4, gap: 2 * 8 },
  hedge: { material: 'plant', strength: 80, absorb: 0.25, gap: 3 * 8 },
  fence: { material: 'timber', strength: 70, absorb: 0.15, gap: 2.5 * 8 },
  railing: { material: 'metal', strength: 130, absorb: 0.2, gap: 2.5 * 8 },
};

/** A bench smashes if hit this hard; slower, it's just shoved. */
export const BENCH_SMASH = 150;

/** A tree: the bigger it is, the harder it is to bring down; and it takes most of the speed out of whatever does. */
export function treeToughness(heightMetres: number): Toughness {
  return { material: 'wood', strength: Math.max(180, Math.min(420, 140 + heightMetres * 12)), absorb: 0.55 };
}

/** Whether a vehicle of `weight` (a car's is 1) going `speed` px/s into something breaks it. */
export function breaks(t: Toughness, speed: number, weight = 1): boolean {
  return speed * weight >= t.strength;
}

const CAR_RADIUS = CAR_WIDTH / 2;
const HULL = [-(CAR_LENGTH / 2 - CAR_RADIUS), 0, CAR_LENGTH / 2 - CAR_RADIUS];

/** How fast the car is going into (x, y) (0 if it's going away), if any of it is within `reach` px of it. */
export function impactSpeed(car: CarState, x: number, y: number, reach: number): number {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let touching = false;
  for (const o of HULL) {
    if (Math.hypot(car.x + cos * o - x, car.y + sin * o - y) < reach + CAR_RADIUS) touching = true;
  }
  if (!touching) return 0;
  const dx = x - car.x;
  const dy = y - car.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.max(0, (car.vx * dx + car.vy * dy) / len);
}

/** Slows a vehicle that's just broken through something. */
export function giveWay(car: CarState, t: Toughness): void {
  car.vx *= 1 - t.absorb;
  car.vy *= 1 - t.absorb;
}

/**
 * A wall hit at (x, y): what's left of it (the two ends either side of the
 * gap the hit makes, the harder the hit the wider), and where the gap is.
 */
export function crumble(seg: Segment, x: number, y: number, gap: number): { left: Segment[]; from: [number, number]; to: [number, number] } {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (y - seg.ay) * dy) / (len * len)));
  const t0 = Math.max(0, t - gap / 2 / len);
  const t1 = Math.min(1, t + gap / 2 / len);
  const at = (u: number): [number, number] => [seg.ax + dx * u, seg.ay + dy * u];
  const left: Segment[] = [];
  // Bits too short to stand on their own go too.
  if (t0 * len > 4) left.push({ ...seg, bx: at(t0)[0], by: at(t0)[1], gone: false });
  if ((1 - t1) * len > 4) left.push({ ...seg, ax: at(t1)[0], ay: at(t1)[1], gone: false });
  return { left, from: at(t0), to: at(t1) };
}

/** How wide a gap a hit makes in a wall: wider the harder it's hit, up to twice as wide. */
export function gapFor(kind: WallKind, speed: number, weight = 1): number {
  const w = WALLS[kind];
  return w.gap * Math.min(2, Math.max(1, (speed * weight) / w.strength));
}

export type DebrisKind = 'plank' | 'foliage' | 'twig' | 'rubble' | 'brick' | 'rail' | 'pole' | 'shortpole' | 'bollard' | 'postbox' | 'phonebox' | 'head';

/** A piece of what's broken, flying off: it ends up somewhere, in the way. */
export interface Debris {
  kind: DebrisKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  r: number;
  length?: number;
  /** 1 / mass, a car's being 1. */
  invMass: number;
}

const PIECES: Record<DebrisKind, { r: number; length?: number; invMass: number }> = {
  plank: { r: 1.6, length: 13, invMass: 14 },
  foliage: { r: 3, invMass: 30 },
  twig: { r: 1, length: 9, invMass: 30 },
  rubble: { r: 2.6, invMass: 9 },
  brick: { r: 2, invMass: 12 },
  rail: { r: 1.4, length: 18, invMass: 8 },
  pole: { r: 1.8, length: 44, invMass: 3 },
  shortpole: { r: 1.8, length: 22, invMass: 6 },
  bollard: { r: 2.4, invMass: 5 },
  postbox: { r: 4, invMass: 1.6 },
  phonebox: { r: 5.5, length: 12, invMass: 1.3 },
  head: { r: 2.5, invMass: 10 },
};

/**
 * The pieces something breaks into, hit at (x, y) by a vehicle going
 * (vx, vy): scattered mostly the way it was going, faster the harder the hit.
 */
export function debris(kind: DebrisKind, count: number, x: number, y: number, vx: number, vy: number, rand: () => number, spread = 8): Debris[] {
  const out: Debris[] = [];
  const speed = Math.hypot(vx, vy);
  const heading = Math.atan2(vy, vx);
  const p = PIECES[kind];
  for (let i = 0; i < count; i++) {
    const angle = heading + (rand() - 0.5) * 1.6;
    const v = speed * (0.35 + rand() * 0.5);
    out.push({
      kind,
      x: x + (rand() - 0.5) * spread,
      y: y + (rand() - 0.5) * spread,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      angle: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 12,
      ...p,
    });
  }
  return out;
}

/** What a standing thing leaves when it goes over, hit going (vx, vy): it falls the way it was hit. */
export function fallen(kind: Exclude<ThingKind, 'tree' | 'fountain' | 'stump'>, x: number, y: number, vx: number, vy: number, rand: () => number): Debris[] {
  const speed = Math.hypot(vx, vy) || 1;
  const ux = vx / speed;
  const uy = vy / speed;
  const lying = (piece: DebrisKind, along: number, push: number): Debris => ({
    kind: piece,
    // Lying from its foot the way it fell.
    x: x + ux * along,
    y: y + uy * along,
    vx: vx * push,
    vy: vy * push,
    angle: Math.atan2(uy, ux) + (rand() - 0.5) * 0.5,
    spin: (rand() - 0.5) * 2,
    ...PIECES[piece],
  });
  switch (kind) {
    case 'lamp':
      return [lying('pole', 22, 0.15)];
    case 'signal':
      return [lying('shortpole', 11, 0.2), lying('head', 24, 0.3)];
    case 'beacon':
      return [lying('shortpole', 10, 0.3)];
    case 'bollard':
      return [lying('bollard', 4, 0.5)];
    case 'postbox':
      return [lying('postbox', 4, 0.3)];
    case 'phone':
      return [lying('phonebox', 6, 0.25)];
  }
}

/**
 * Where a tree falls when it's brought down: it splits at the foot and goes
 * over the way it was hit, and away from the side it was hit on (hit off
 * centre, from (fromX, fromY), it topples to the other side), its trunk lying
 * along the ground (in the way) and its crown at the end of it.
 */
export function fallenTree(
  x: number,
  y: number,
  heightPx: number,
  vx: number,
  vy: number,
  fromX = x - vx,
  fromY = y - vy,
): { trunk: Segment; crownX: number; crownY: number; angle: number } {
  const speed = Math.hypot(vx, vy) || 1;
  // Which side of the vehicle's path the tree is on: it falls further that way.
  const side = Math.sign((vx * (y - fromY) - vy * (x - fromX)) / speed) || 1;
  const turn = side * 0.6;
  const ux = (vx / speed) * Math.cos(turn) - (vy / speed) * Math.sin(turn);
  const uy = (vx / speed) * Math.sin(turn) + (vy / speed) * Math.cos(turn);
  const length = Math.min(heightPx * 0.75, 14 * 8);
  return {
    trunk: { ax: x + ux * 4, ay: y + uy * 4, bx: x + ux * length, by: y + uy * length, r: 3 },
    crownX: x + ux * length,
    crownY: y + uy * length,
    angle: Math.atan2(uy, ux),
  };
}
