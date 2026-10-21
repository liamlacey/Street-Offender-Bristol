/**
 * What happens when something's hit hard enough: what it's made of, how
 * strong it is (how fast a vehicle must be going into it, scaled by the
 * vehicle's weight), how much it slows the vehicle as it gives way, and what
 * it leaves behind. Everything except the buildings gives way in the end: trees
 * split and fall, lamp posts and traffic lights bend over and spark, statues
 * come off their plinths, fountains and bridges' parapets are smashed, the
 * harbour's cranes topple, walls crumble, benches smash, hedges are torn
 * through, their leaves and twigs strewn about. What's left stays where it fell, in the way. Pure, so it's tested.
 */

import { type CarState, carHull } from '../car/CarPhysics';
import type { Segment } from '../physics/collisions';

export type Material = 'wood' | 'electric' | 'metal' | 'iron' | 'glass' | 'stone' | 'plant' | 'timber' | 'plastic';

/** Things that stand in one place until they're knocked down. */
export type ThingKind = 'tree' | 'lamp' | 'signal' | 'beacon' | 'bollard' | 'mooring' | 'postbox' | 'phone' | 'meter' | 'pump' | 'clock' | 'lifering' | 'bikes' | 'fountain' | 'statue' | 'crane' | 'stump';
/** What doesn't topple like the street furniture: a tree (it splits and falls its own way), and what's left of one (low enough to drive over). */
export type Structure = 'tree' | 'stump';
/** Walls, by what OSM calls them (and a bridge's parapets). */
export type WallKind = 'wall' | 'hedge' | 'fence' | 'railing' | 'gate' | 'liftgate' | 'chain' | 'shelter' | 'parapet';

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
  // A mooring bollard on a quay: cast iron, set deep in the stone. It takes a big hit.
  mooring: { material: 'iron', strength: 380, absorb: 0.5 },
  postbox: { material: 'iron', strength: 300, absorb: 0.45 },
  phone: { material: 'glass', strength: 170, absorb: 0.35 },
  // A pay-and-display machine: a metal box of electrics on a post, with a little screen.
  meter: { material: 'electric', strength: 160, absorb: 0.25 },
  // A petrol pump: a cabinet of electrics and pipework, with a screen.
  pump: { material: 'electric', strength: 180, absorb: 0.35 },
  // A street clock on its pole.
  clock: { material: 'electric', strength: 170, absorb: 0.3 },
  // A life ring on its post by the water.
  lifering: { material: 'timber', strength: 110, absorb: 0.15 },
  // A row of bike stands: steel hoops set in the ground.
  bikes: { material: 'metal', strength: 140, absorb: 0.2 },
  // A big stone fountain, smashed to rubble; a statue knocked off its plinth: it takes a very big hit.
  fountain: { material: 'stone', strength: 310, absorb: 0.6 },
  statue: { material: 'stone', strength: 290, absorb: 0.55 },
  // The harbour's cranes: iron, set in the quay: it takes a very big hit to bring one down.
  crane: { material: 'iron', strength: 330, absorb: 0.75 },
  // What's left of a tree: it's not going anywhere.
  stump: { material: 'wood', strength: Infinity, absorb: 0 },
};

export const WALLS: Record<WallKind, Toughness & { /** How much of it a hit at its strength brings down, px. */ gap: number }> = {
  wall: { material: 'stone', strength: 200, absorb: 0.4, gap: 2 * 8 },
  hedge: { material: 'plant', strength: 80, absorb: 0.25, gap: 3 * 8 },
  fence: { material: 'timber', strength: 70, absorb: 0.15, gap: 2.5 * 8 },
  railing: { material: 'metal', strength: 130, absorb: 0.2, gap: 2.5 * 8 },
  // Gates and barriers across a way give way all at once (their gap's wider than they are).
  gate: { material: 'metal', strength: 150, absorb: 0.25, gap: 20 * 8 },
  liftgate: { material: 'plastic', strength: 60, absorb: 0.05, gap: 20 * 8 },
  chain: { material: 'metal', strength: 50, absorb: 0.05, gap: 20 * 8 },
  // A bus shelter: glass panes in a steel frame, smashed all at once.
  shelter: { material: 'glass', strength: 140, absorb: 0.25, gap: 20 * 8 },
  // A bridge's stone parapet: knocked through, and there's nothing between you and the drop.
  parapet: { material: 'stone', strength: 260, absorb: 0.45, gap: 2.5 * 8 },
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


/**
 * How fast the car is going into (x, y) (0 if it's going away), if any of it
 * is within `reach` px of it; less, if what's there is moving the same way
 * at (vx, vy).
 */
export function impactSpeed(car: CarState, x: number, y: number, reach: number, vx = 0, vy = 0): number {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let touching = false;
  const { radius, offsets } = carHull(car);
  for (const o of offsets) {
    if (Math.hypot(car.x + cos * o - x, car.y + sin * o - y) < reach + radius) touching = true;
  }
  if (!touching) return 0;
  const dx = x - car.x;
  const dy = y - car.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.max(0, ((car.vx - vx) * dx + (car.vy - vy) * dy) / len);
}

/** Slows a vehicle (of `weight`, a car's 1) that's just broken through something: a heavy one hardly. */
export function giveWay(car: CarState, t: Toughness, weight = 1): void {
  const k = 1 - t.absorb / Math.max(1, weight);
  car.vx *= k;
  car.vy *= k;
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

export type DebrisKind = 'pump' | 'meter' | 'clockface' | 'post' | 'ring' | 'plastic' | 'arm' | 'log' | 'billet' | 'splinter' | 'plank' | 'foliage' | 'twig' | 'glass' | 'rubble' | 'brick' | 'rail' | 'pole' | 'shortpole' | 'bollard' | 'postbox' | 'phonebox' | 'head' | 'bumper' | 'mirror' | 'hubcap' | 'lens' | 'bike';

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
  meter: { r: 3, length: 8, invMass: 4 },
  pump: { r: 3.5, length: 12, invMass: 2.5 },
  clockface: { r: 3, invMass: 8 },
  post: { r: 1.6, length: 12, invMass: 10 },
  ring: { r: 2.5, invMass: 20 },
  plastic: { r: 1.2, invMass: 30 },
  arm: { r: 1.2, length: 20, invMass: 12 },
  log: { r: 3, length: 22, invMass: 3 },
  billet: { r: 2.6, length: 10, invMass: 7 },
  splinter: { r: 0.8, length: 6, invMass: 30 },
  plank: { r: 1.6, length: 13, invMass: 14 },
  foliage: { r: 3, invMass: 30 },
  twig: { r: 1, length: 9, invMass: 30 },
  glass: { r: 0.8, invMass: 40 },
  rubble: { r: 2.6, invMass: 9 },
  brick: { r: 2, invMass: 12 },
  rail: { r: 1.4, length: 18, invMass: 8 },
  pole: { r: 1.8, length: 44, invMass: 3 },
  shortpole: { r: 1.8, length: 22, invMass: 6 },
  bollard: { r: 2.4, invMass: 5 },
  postbox: { r: 4, invMass: 1.6 },
  phonebox: { r: 5.5, length: 12, invMass: 1.3 },
  head: { r: 2.5, invMass: 10 },
  // Off a car: a bumper, a wing mirror, a hubcap, bits of a light's lens.
  bumper: { r: 1.6, length: 16, invMass: 6 },
  mirror: { r: 1.4, invMass: 25 },
  hubcap: { r: 2.2, invMass: 20 },
  lens: { r: 0.8, invMass: 40 },
  // A bike on its side: off a cyclist knocked down, or out of a rack knocked over.
  bike: { r: 2.4, length: 13, invMass: 12 },
};

/** How many bikes are locked to a rack (the same each time for the same rack): none to four. */
export function racked(x: number, y: number): number {
  const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
  return Math.floor(h * 5);
}

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
export function fallen(kind: Exclude<ThingKind, Structure>, x: number, y: number, vx: number, vy: number, rand: () => number): Debris[] {
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
    case 'mooring':
      return [lying('bollard', 4, 0.2)];
    case 'postbox':
      return [lying('postbox', 4, 0.3)];
    case 'phone':
      return [lying('phonebox', 6, 0.25)];
    case 'meter':
      return [lying('meter', 5, 0.3)];
    case 'pump':
      return [lying('pump', 6, 0.25)];
    case 'clock':
      return [lying('shortpole', 11, 0.2), lying('clockface', 26, 0.3)];
    case 'lifering':
      return [lying('post', 6, 0.2), lying('ring', 12, 0.6)];
    case 'bikes':
      // Its stands, and the bikes locked to them.
      return [lying('rail', 6, 0.3), lying('rail', 2, 0.4), lying('rail', 9, 0.35), ...Array.from({ length: racked(x, y) }, (_, i) => lying('bike', 3 + i * 3, 0.25 + i * 0.05))];
    case 'fountain':
      return [lying('rubble', 0, 0.2), lying('rubble', 6, 0.3), lying('rubble', 12, 0.35), lying('brick', 4, 0.4), lying('brick', 9, 0.45), lying('rubble', -5, 0.15)];
    case 'statue':
      return [lying('rubble', 2, 0.15), lying('rubble', 9, 0.2), lying('brick', 14, 0.25), lying('rubble', 18, 0.3)];
    case 'crane':
      return [lying('rubble', 2, 0.05), lying('pole', 16, 0.05), lying('pole', 42, 0.05), lying('rail', 28, 0.08), lying('rail', 56, 0.08), lying('shortpole', 66, 0.1)];
  }
}

/**
 * What's already been broken breaks up further, hit again: and much more
 * easily than it broke the first time, being loose (nothing holding it to the
 * ground) and smaller, the smaller the easier, down to bits too small to break.
 * What each piece is, how strong (as `Toughness`), and what it breaks into.
 */
export const BREAKUP: Partial<Record<DebrisKind | 'bench' | 'picnic' | 'gritbin' | 'planter' | 'block' | 'trolley' | 'foodcart', Toughness & { into: [DebrisKind, number][] }>> = {
  // A shopping trolley, hit hard: mangled, its basket's wires and its handle in bits.
  trolley: { material: 'metal', strength: 170, absorb: 0.06, into: [['rail', 3], ['plastic', 2]] },
  // A food cart: its panels and its parasol in bits.
  foodcart: { material: 'timber', strength: 160, absorb: 0.2, into: [['plank', 5], ['plastic', 4], ['rail', 2]] },
  // A bench and a picnic table, standing loose: smashed to planks.
  bench: { material: 'timber', strength: BENCH_SMASH, absorb: 0.12, into: [['plank', 5]] },
  picnic: { material: 'timber', strength: BENCH_SMASH, absorb: 0.15, into: [['plank', 7]] },
  // A grit bin: a plastic box, split open (its grit everywhere).
  gritbin: { material: 'plastic', strength: 150, absorb: 0.15, into: [['plastic', 5]] },
  // A stone planter and a concrete block: heavy, shoved more than broken, but hit hard enough they crack up.
  planter: { material: 'stone', strength: 230, absorb: 0.3, into: [['rubble', 4], ['foliage', 4]] },
  block: { material: 'stone', strength: 300, absorb: 0.4, into: [['rubble', 7]] },
  // A log off a fallen trunk splits in two, and the halves into splinters.
  log: { material: 'wood', strength: 85, absorb: 0.2, into: [['billet', 2], ['splinter', 2]] },
  billet: { material: 'wood', strength: 65, absorb: 0.08, into: [['splinter', 4]] },
  plank: { material: 'timber', strength: 110, absorb: 0.04, into: [['splinter', 3]] },
  // A fallen lamp post snaps in two where it's hit, and a short pole into bent bits.
  pole: { material: 'metal', strength: 120, absorb: 0.15, into: [['shortpole', 2]] },
  shortpole: { material: 'metal', strength: 100, absorb: 0.08, into: [['rail', 2]] },
  // A traffic light's head and a fallen phone box are smashed up: glass, and their frames.
  head: { material: 'glass', strength: 80, absorb: 0.05, into: [['glass', 5], ['rail', 1]] },
  phonebox: { material: 'glass', strength: 120, absorb: 0.25, into: [['glass', 10], ['rail', 3]] },
  // A bumper off a car, run over: snapped into bits; a mirror, smashed.
  bumper: { material: 'plastic', strength: 90, absorb: 0.04, into: [['plastic', 4]] },
  mirror: { material: 'glass', strength: 50, absorb: 0.02, into: [['glass', 2], ['plastic', 1]] },
};

/**
 * A fallen tree's trunk, lying loose without its roots, gives way much more
 * easily than the tree did standing (but no more easily than the logs it
 * breaks into).
 */
export function lyingTrunk(standing: Toughness): Toughness {
  return { material: 'wood', strength: Math.max(BREAKUP.log!.strength + 5, standing.strength * 0.4), absorb: 0.3 };
}

/**
 * A fallen trunk hit hard enough: it's split into logs where it lay, end to
 * end along it, nudged the way the vehicle was going (vx, vy).
 */
export function logs(trunk: Segment, vx: number, vy: number, rand: () => number): Debris[] {
  const dx = trunk.bx - trunk.ax;
  const dy = trunk.by - trunk.ay;
  const len = Math.hypot(dx, dy);
  const count = Math.max(2, Math.min(5, Math.round(len / PIECES.log.length!)));
  const angle = Math.atan2(dy, dx);
  const out: Debris[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const push = 0.15 + rand() * 0.2;
    out.push({
      kind: 'log',
      x: trunk.ax + dx * t,
      y: trunk.ay + dy * t,
      vx: vx * push,
      vy: vy * push,
      angle: angle + (rand() - 0.5) * 0.4,
      spin: (rand() - 0.5) * 3,
      ...PIECES.log,
    });
  }
  return out;
}

/** A fallen tree's crown, lying on the ground, is torn apart driven through faster than this, px/s. */
export const CROWN_BREAK = 90;

/** How long something takes to topple over from standing, seconds: the taller it is, the longer (as a falling pole does, with the root of its height). */
export function toppleTime(heightMetres: number): number {
  return Math.max(0.35, Math.min(1.6, 0.4 * Math.sqrt(heightMetres)));
}

/** How the things that stand go over: how tall they are, px, how far from their foot their top ends up lying, px, and whether there's a pole between. */
export const TOPPLE: Record<Exclude<ThingKind, Structure>, { height: number; reach: number; pole: boolean }> = {
  lamp: { height: 5.5 * 8, reach: 42, pole: true },
  signal: { height: 3.5 * 8, reach: 24, pole: true },
  beacon: { height: 2.6 * 8, reach: 18, pole: true },
  bollard: { height: 1 * 8, reach: 4, pole: false },
  mooring: { height: 0.7 * 8, reach: 4, pole: false },
  postbox: { height: 1.6 * 8, reach: 4, pole: false },
  phone: { height: 2.5 * 8, reach: 6, pole: false },
  meter: { height: 1.6 * 8, reach: 8, pole: false },
  pump: { height: 1.9 * 8, reach: 8, pole: false },
  clock: { height: 3.5 * 8, reach: 26, pole: true },
  lifering: { height: 1.5 * 8, reach: 10, pole: true },
  bikes: { height: 0.8 * 8, reach: 4, pole: false },
  fountain: { height: 1.2 * 8, reach: 6, pole: false },
  statue: { height: 3 * 8, reach: 16, pole: false },
  crane: { height: 9 * 8, reach: 40, pole: true },
};

/** The glass that breaks when something goes over: how many shards, and how far along the way it fell they land (where its lamp, lenses or panes hit the ground), px. */
const GLASS: Partial<Record<ThingKind, { count: number; at: number }>> = {
  lamp: { count: 10, at: 42 },
  signal: { count: 6, at: 24 },
  beacon: { count: 6, at: 18 },
  phone: { count: 14, at: 6 },
  meter: { count: 4, at: 8 },
  pump: { count: 5, at: 8 },
  clock: { count: 6, at: 26 },
};

/** The broken glass a standing thing leaves when it goes over, hit going (vx, vy): its lamp's (or lenses', or panes') shards, where they hit the ground. */
export function shards(kind: ThingKind, x: number, y: number, vx: number, vy: number, rand: () => number): Debris[] {
  const glass = GLASS[kind];
  if (!glass) return [];
  const speed = Math.hypot(vx, vy) || 1;
  return debris('glass', glass.count, x + (vx / speed) * glass.at, y + (vy / speed) * glass.at, vx * 0.25, vy * 0.25, rand, 14);
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
