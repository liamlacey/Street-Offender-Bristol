/**
 * The traffic: cars, vans and lorries driving Bristol's streets as the law
 * says. Each keeps to its lane (on the left), at a steady speed for the road,
 * slowing for the bends and the corners, keeping its distance from whatever's
 * ahead (another car, you), stopping at red lights and giving way at the end
 * of a minor road. More of it where there's more to go to (see the roads'
 * `activity`), and it comes and goes out of sight round you. Knocked about, a
 * driver stops a moment, then drives back into its lane and carries on.
 * Parked cars sit in the bays, and only move when they're hit. Pure (no
 * Phaser), so it's tested; GameScene draws it.
 */

import type { Wreck } from '../car/dents';
import type { BusRoute, GameMap, Pts, Road, RoadKind } from '../map/osm';
import { type Body, bodyHull } from '../physics/collisions';
import type { Light } from './lights';
import { type Space, parkingSpaces } from './parking';
import { Terrain } from './terrain';
import { lineLength, offsetLine, subPolyline } from './world';

const M = 8;

// --- The vehicles ---

export type VehicleKind = 'small' | 'hatch' | 'saloon' | 'estate' | 'suv' | 'van' | 'lorry' | 'bus' | 'double' | 'bike' | 'own';

/**
 * Each kind: how long and wide (px; real sizes, a tenth up, to match your car),
 * how heavy (your car's 1), how common in the traffic and parked, and which
 * colours it comes in.
 */
export const VEHICLES: Record<VehicleKind, { length: number; width: number; mass: number; traffic: number; parked: number; paint: 'car' | 'van' | 'lorry' | 'bus' | 'bike' }> = {
  small: { length: 3.7 * 1.1 * M, width: 1.65 * 1.1 * M, mass: 0.8, traffic: 0.18, parked: 0.22, paint: 'car' },
  hatch: { length: 4.1 * 1.1 * M, width: 1.75 * 1.1 * M, mass: 0.9, traffic: 0.26, parked: 0.27, paint: 'car' },
  saloon: { length: 4.7 * 1.1 * M, width: 1.82 * 1.1 * M, mass: 1, traffic: 0.14, parked: 0.14, paint: 'car' },
  estate: { length: 4.8 * 1.1 * M, width: 1.82 * 1.1 * M, mass: 1.05, traffic: 0.08, parked: 0.08, paint: 'car' },
  suv: { length: 4.6 * 1.1 * M, width: 1.92 * 1.1 * M, mass: 1.3, traffic: 0.15, parked: 0.17, paint: 'car' },
  van: { length: 5.3 * 1.1 * M, width: 2.0 * 1.1 * M, mass: 1.5, traffic: 0.14, parked: 0.12, paint: 'van' },
  lorry: { length: 8.5 * 1.1 * M, width: 2.5 * 1.1 * M, mass: 4, traffic: 0.05, parked: 0, paint: 'lorry' },
  // Buses only run their routes (see BusService): a single-decker and a double-decker.
  bus: { length: 12 * 1.1 * M, width: 2.55 * 1.1 * M, mass: 9, traffic: 0, parked: 0, paint: 'bus' },
  double: { length: 10.6 * 1.1 * M, width: 2.55 * 1.1 * M, mass: 11, traffic: 0, parked: 0, paint: 'bus' },
  // A bike and its rider (about 90 kg, against your car's tonne and more).
  bike: { length: 1.8 * 1.1 * M, width: 0.65 * 1.1 * M, mass: 0.08, traffic: 0.18, parked: 0, paint: 'bike' },
  // Yours: an armoured truck, armour plate on a lorry's chassis (about 8 tonnes), left where you got out of it.
  own: { length: 6.4 * 1.1 * M, width: 2.5 * 1.1 * M, mass: 6, traffic: 0, parked: 0, paint: 'car' },
};

/** The colours, about as common as on Britain's roads (grey, black and white the most); vans mostly white; lorries' cabs. */
export const COLOURS: Record<'car' | 'van' | 'lorry' | 'bus' | 'bike', [string, number][]> = {
  // A bike's frame.
  bike: [['#1d1e22', 20], ['#b8bcc1', 12], ['#22508f', 12], ['#b21f24', 10], ['#2f5d3a', 8], ['#e8e9eb', 8], ['#e07a1f', 5], ['#2a8fa3', 5], ['#e2c23b', 3]],
  // A bus whose route hasn't a colour mapped.
  bus: [['#3b6db3', 1]],
  car: [
    ['#73787e', 22], ['#1d1e22', 18], ['#e8e9eb', 15], ['#22508f', 13], ['#b8bcc1', 10], ['#b21f24', 9],
    ['#5b1e2b', 3], ['#2f5d3a', 3], ['#e07a1f', 2], ['#8a6a4c', 2], ['#e2c23b', 1.5], ['#2a8fa3', 1.5],
  ],
  van: [['#eceded', 72], ['#b8bcc1', 10], ['#73787e', 6], ['#22508f', 6], ['#1d1e22', 4], ['#b21f24', 2]],
  lorry: [['#eceded', 40], ['#22508f', 18], ['#b21f24', 15], ['#1d1e22', 12], ['#2f5d3a', 8], ['#e2c23b', 7]],
};

export interface Vehicle extends Body {
  id: number;
  kind: VehicleKind;
  /** Which of its kind's COLOURS. */
  colour: number;
  /** Driving along a lane; knocked about (sliding to a stop); finding its way back into its lane; or parked. */
  mode: 'drive' | 'knocked' | 'rejoin' | 'parked';
  /** Where it's going: the lane it's in, then the turns and lanes ahead. `s` is how far along the first it is. */
  route: Path[];
  s: number;
  /** The way it came (for which way it's pointing as it turns). */
  back: Path | null;
  /** Its speed along the way, px/s; and how fast this driver likes to go, against the road's usual speed (0.7 to 1.35). */
  speed: number;
  pace: number;
  /** How its speed wanders as it drives (two slow swells, each a rate and a phase: radians/s, radians). */
  wander: [number, number, number, number];
  /** Dawdling a moment (looking for a shop, or somewhere to park): seconds left, and how much slower. */
  dawdle: number;
  dawdleTo: number;
  /** Which level it's on: 0 the ground, 1 a bridge's deck. */
  level: number;
  /** Seconds stopped since it was knocked; seconds stuck behind the same thing. */
  rest: number;
  stuck: number;
  /** What it's waiting behind, by id (another vehicle's, or -1 for you), or undefined. */
  behind?: number;
  /** Slowing down (its brake lights on); which way it's about to turn (its indicators), -1 left, 1 right. */
  braking: boolean;
  turning: -1 | 0 | 1;
  /** A parked car's bay. */
  space?: Space;
  /** How long it is, px. */
  length: number;
  /** How hard it's accelerating (braking, below 0), px/s²; seconds before it moves off (-1 while it can't, 0 once it has); how briskly it drives (about 1). */
  accel: number;
  react: number;
  verve: number;
  /** Stopped at a red light; seconds it's been standing still. */
  atLight: boolean;
  still: number;
  /** Seconds left backing off out of a knot. */
  backing: number;
  /** How far it's over from the middle of its lane, px (+ to its left): in a bus lane, pulled in at a stop, changing lanes, overtaking; and how fast that's changing, px/s. */
  side: number;
  sideRate: number;
  /** Overtaking on a two-way road: what it's going past (by id), and how far out it goes to (px, to its right). */
  passing?: { id: number; out: number };
  /** Seconds before it'll change lanes again. */
  settle: number;
  /** Lets traffic out of side roads when it's queueing anyway. */
  courteous: boolean;
  /** Badly damaged: limping along with its hazards on; broken down (and smoking). */
  limping: boolean;
  broken: boolean;
  /** A parked car's alarm, seconds left going off. */
  alarm: number;
  /** Seconds it's been waiting to pull out at a give way. */
  waiting: number;
  /** Seconds it's been held up by you (it honks). */
  annoyed: number;
  /** Its dents, scratches and lost parts, once it's been hit. */
  wreck?: Wreck;
  /** A bus: the route it's running. */
  bus?: BusService;
  /** Its way runs out (a road off the map's edge): it drives on to the end, and goes. */
  ends?: boolean;
  /** A cyclist's rider's clothes (one of the people's looks). */
  rider?: number;
}

/** A bus on its route. */
export interface BusService {
  /** Which of the map's routes, its number and colour. */
  route: number;
  ref: string;
  colour: string;
  /** How far along the route's legs it's planned its way. */
  leg: number;
  /** The stops coming up on its way (which lane or turn they're on, and how far along), and those it's been to. */
  stops: { path: Path; s: number; index: number }[];
  served: Set<number>;
  /** Seconds left at the stop it's at (-1, not at one). */
  dwell: number;
  /** Whether it's waiting for someone alongside to pass before it moves back out from the kerb; and off its route (it goes, once out of sight). */
  yield: boolean;
  lost: boolean;
}

/** Something on the road that's in the way: your car, or a vehicle. */
interface Obstacle {
  id: number;
  x: number;
  y: number;
  angle: number;
  r: number;
  length: number;
  vx: number;
  vy: number;
  level: number;
}

/** You, as the traffic sees you. */
export interface Player {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  level: number;
  length: number;
  width: number;
}

// --- The roads ---

/** A way through the roads to drive along: a lane, or a turn from one to the next. */
export interface Path {
  pts: Pts;
  /** The distance along it at each point. */
  at: number[];
  length: number;
  level: number;
  /** A lane (not a turn). */
  lane?: Lane;
  /** Where it bends enough to slow for: distance along it, and how fast it can be taken there (px/s), ... */
  bends?: number[];
  /** A turn: which way it goes (-1 left, 1 right, 0 straight on). */
  turn?: -1 | 0 | 1;
}

export interface Lane extends Path {
  id: number;
  road: number;
  /** Which edge of the road network, which way along it (1 the way the road's drawn), and which lane of how many (0 nearest the kerb). */
  edge: number;
  dir: 1 | -1;
  index: number;
  count: number;
  /** The junctions it runs from and to. */
  from: number;
  to: number;
  /** The speed limit (as driven), px/s; how major the road is; how many vehicles it carries, per px. */
  speed: number;
  rank: number;
  density: number;
  /** Where the traffic lights' stop lines are along it (and which lights); and, where there's a box for bikes in front of it, how far on its front line is, px (where the bikes stop). */
  stops: { s: number; signal: number; box?: number }[];
  /** How busy the road is (see Road.activity). */
  activity: number;
  /** How wide a bus lane there is on its left (buses drive in it), px; 0 for none. */
  busLane: number;
  /** At its end, it gives way to the traffic on the road it joins. */
  giveWay: boolean;
  /** Where the bikes ride, px over from its middle (+ to its left): along the cycle lane, if it has one (`cycleLane`), else near the kerb; in the kerb lane only. */
  cycleAt: number;
  cycleLane: boolean;
  /** Along a cycle path (not a road): for bikes only. */
  path?: boolean;
  /** Its bounding box (x0, y0, x1, y1), px. */
  box?: [number, number, number, number];
}

interface Node {
  x: number;
  y: number;
  /** The lanes leaving it. */
  out: number[];
  /** How many edges meet here. */
  degree: number;
}

/** The roads traffic drives on: not service roads (car parks, driveways, yards), tracks, paths. */
const DRIVEN: ReadonlySet<RoadKind> = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'street']);
const RANK: Partial<Record<RoadKind, number>> = { trunk: 5, primary: 4, secondary: 3, tertiary: 2, street: 1 };
/** How fast it's usually driven, px/s (up to 30 mph on the main roads, a little under on the side streets); and never faster than MAX_SPEED (30 mph). */
const SPEED: Partial<Record<RoadKind, number>> = { trunk: 13.4 * M, primary: 12.5 * M, secondary: 12 * M, tertiary: 11.5 * M, street: 10.5 * M };
const MAX_SPEED = 13.4 * M;
/** How many vehicles a lane carries, per 100 m, on a quiet stretch; more where there's more to go to (up to TRAFFIC_BUSIEST times as many). */
const DENSITY: Partial<Record<RoadKind, number>> = { trunk: 3.6, primary: 3.2, secondary: 2.6, tertiary: 2.1, street: 1 };
const BUSIEST = 3;
/** How many bikes ride along a cycle path each way, per 100 m. */
const PATH_BIKES = 0.9;
/** How fast each kind's driven, against the road's usual speed (before the driver's own pace). */
const KIND_PACE: Record<VehicleKind, number> = { small: 1, hatch: 1, saloon: 1.02, estate: 0.99, suv: 0.98, van: 0.93, lorry: 0.85, bus: 0.85, double: 0.82, bike: 1, own: 1 };
/** How fast a cyclist rides on the flat, px/s (each faster or slower: see pace); how much less briskly they pull away than a car. */
const BIKE_SPEED = 5.3 * M;
const BIKE_ACCEL = 0.4;
/** How far a cyclist keeps from the kerb, px, where there's no cycle lane; and how much room a driver gives one going past, px (the Highway Code's 1.5 m). */
const BIKE_KERB = 0.8 * M;
const BIKE_ROOM = 1.5 * M;
/** A cyclist hit harder than this (an impulse, your car's mass × px/s) comes off. */
const UNSEAT = 1;
/** Up a hill, how much each kind slows for each 1 in 1 of it (a lorry labours; a car barely notices); and how strongly gravity holds it back pulling away. */
const CLIMB: Record<VehicleKind, number> = { small: 0.8, hatch: 0.6, saloon: 0.5, estate: 0.5, suv: 0.5, van: 1.3, lorry: 3, bus: 2.2, double: 2.4, bike: 7, own: 0.5 };
const GRAVITY = 9.81 * M;
/** Dawdling: how often a driver slows a moment, a second (more often the busier the street), and for how long. */
const DAWDLE = 0.003;
const DAWDLE_BUSY = 0.0015;
/** A lane's width, if the road doesn't say, px. */
const LANE = 3.2 * M;
/** Bends and turns are taken no faster than this sideways pull allows, px/s². */
const CORNERING = 3 * M;

/**
 * Where a path bends enough to slow for, every 2 m along it: how sharply it
 * turns over `window` px either side (so a kink in a road's line counts as the
 * gentle bend it is), and so how fast it can be taken.
 */
function bendsOf(p: Path, window: number): number[] {
  const out: number[] = [];
  if (p.length < 4) return out;
  for (let s = 0; s <= p.length; s += 2 * M) {
    const [a, b] = [Math.max(0, s - window), Math.min(p.length, s + window)];
    const [, , ax, ay] = pathAt(p, a + 0.01);
    const [, , bx, by] = pathAt(p, b - 0.01);
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (turn < 0.08 || b - a < 1) continue;
    const speed = Math.sqrt(CORNERING * ((b - a) / turn));
    if (speed < 18 * M) out.push(Math.round(s), Math.round(speed * 10) / 10);
  }
  return out;
}

/** The way along a path at a distance: [x, y, ux, uy]. */
export function pathAt(p: Path, s: number): [number, number, number, number] {
  const at = p.at;
  const n = at.length;
  if (n < 2) return [p.pts[0], p.pts[1], 1, 0];
  const d = Math.max(0, Math.min(p.length, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= d) lo = mid;
    else hi = mid;
  }
  const [ax, ay, bx, by] = [p.pts[lo * 2], p.pts[lo * 2 + 1], p.pts[hi * 2], p.pts[hi * 2 + 1]];
  const len = at[hi] - at[lo] || 1;
  const t = (d - at[lo]) / len;
  return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
}

function makePath(pts: Pts, level: number): Path {
  const at = [0];
  for (let k = 2; k < pts.length; k += 2) at.push(at[at.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
  return { pts, at, length: at[at.length - 1], level };
}

function reversed(pts: Pts): Pts {
  const out: Pts = [];
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
  return out;
}

/** How far along a path the nearest point to (x, y) is, and how far off it. */
function nearestOn(p: Path, x: number, y: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let k = 0; k + 3 < p.pts.length; k += 2) {
    const [ax, ay, bx, by] = [p.pts[k], p.pts[k + 1], p.pts[k + 2], p.pts[k + 3]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best.d) best = { s: p.at[k / 2] + t * Math.sqrt(len2), d };
  }
  return best;
}

/**
 * The network: the roads traffic drives, split at every junction into edges,
 * each with its lanes (on the left of the way they go: the kerb side, inside
 * any bus, cycle or parking lanes painted along it), drawn back from the
 * junctions to leave room for the turns across them.
 */
export function buildLanes(map: GameMap, paths = false, joins: Join[] = []): { lanes: Lane[]; nodes: Node[] } {
  // The roads; or (a network of their own, for the bikes) the cycle paths.
  const roads = map.roads
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => (paths ? r.kind === 'cycleway' : DRIVEN.has(r.kind)) && r.pts.length >= 4)
    // Each road with a point put in where a cycle path joins it (if it's not one of its points already): a junction for the bikes.
    .map(({ r, i }) => ({ r: !paths && joins.some((j) => j.road === i && j.t > 0 && j.t < 1) ? { ...r, pts: withJoins(r.pts, joins.filter((j) => j.road === i)) } : r, i }));
  const key = (x: number, y: number) => `${x},${y}`;
  const uses = new Map<string, number>();
  for (const { r } of roads) for (let k = 0; k < r.pts.length; k += 2) uses.set(key(r.pts[k], r.pts[k + 1]), (uses.get(key(r.pts[k], r.pts[k + 1])) ?? 0) + 1);
  // (Each way cut where a path joins it.)
  for (const j of joins) {
    const k = paths ? key(j.cx, j.cy) : key(j.px, j.py);
    uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const nodes: Node[] = [];
  const nodeAt = new Map<string, number>();
  const node = (x: number, y: number) => {
    const k = key(x, y);
    let id = nodeAt.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodeAt.set(k, id);
      nodes.push({ x, y, out: [], degree: 0 });
    }
    return id;
  };
  // The edges: each road, cut where it meets another.
  const edges: { road: Road; index: number; pts: Pts; a: number; b: number }[] = [];
  for (const { r, i } of roads) {
    let start = 0;
    const n = r.pts.length / 2;
    for (let k = 1; k < n; k++) {
      if (k < n - 1 && (uses.get(key(r.pts[k * 2], r.pts[k * 2 + 1])) ?? 0) < 2) continue;
      const pts = r.pts.slice(start * 2, k * 2 + 2);
      if (lineLength(pts) > 1) {
        const a = node(pts[0], pts[1]);
        const b = node(pts[pts.length - 2], pts[pts.length - 1]);
        nodes[a].degree++;
        nodes[b].degree++;
        edges.push({ road: r, index: i, pts, a, b });
      }
      start = k;
    }
  }
  // How far back from each junction the lanes stop: clear of the roads across it.
  const clear = nodes.map(() => 0);
  const away: { width: number; ux: number; uy: number }[][] = nodes.map(() => []);
  for (const e of edges) {
    for (const n of [e.a, e.b]) if (nodes[n].degree >= 3) clear[n] = Math.max(clear[n], e.road.width / 2 + 1.2 * M);
    // Which way each leaves its junctions.
    const p = e.pts;
    const k = p.length;
    for (const [n, x0, y0, x1, y1] of [[e.a, p[0], p[1], p[2], p[3]], [e.b, p[k - 2], p[k - 1], p[k - 4], p[k - 3]]]) {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      away[n].push({ width: e.road.width, ux: (x1 - x0) / len, uy: (y1 - y0) / len });
    }
  }
  // Where two roads leave a junction at a sharp angle, their carriageways overlap for a way out from it: the lanes stop beyond that.
  away.forEach((list, n) => {
    if (nodes[n].degree < 3) return;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const angle = Math.acos(Math.max(-1, Math.min(1, list[i].ux * list[j].ux + list[i].uy * list[j].uy)));
        if (angle > 1.4 || angle < 0.05) continue;
        clear[n] = Math.max(clear[n], Math.min(25 * M, (list[i].width + list[j].width) / 2 / Math.tan(angle)) + 1.2 * M);
      }
    }
  });

  // A cycle path stops short of the road it joins (its lanes do: the bikes give way there, and turn on onto it).
  if (paths) {
    for (const j of joins) {
      const n = nodeAt.get(key(j.cx, j.cy));
      if (n !== undefined) clear[n] = Math.max(clear[n], j.half + 1.2 * M - Math.hypot(j.cx - j.px, j.cy - j.py));
    }
  }

  const lanes: Lane[] = [];
  edges.forEach((e, edge) => {
    const r = e.road;
    const length = lineLength(e.pts);
    const trimA = Math.min(clear[e.a], length * 0.4);
    const trimB = Math.min(clear[e.b], length * 0.4);
    const middle = subPolyline(e.pts, trimA, length - trimB);
    if (middle.length < 4) return;
    // What's painted along each side (bus, cycle and parking lanes) isn't the traffic's.
    const reserved = (side: 1 | -1) => (r.lanes ?? []).filter((l) => l.side === side && l.kind !== 'shared').reduce((sum, l) => sum + l.width, 0);
    const [ahead, against] = r.lanesAcross ?? (r.oneway ? [r.width >= 7.5 * M ? 2 : 1, 0] : [1, 1]);
    for (const dir of [1, -1] as const) {
      const count = dir === 1 ? ahead : against;
      if (count < 1) continue;
      // Across the road from its left edge (as this way goes) to the middle (or the right edge, one-way).
      const left = r.width / 2;
      const right = r.oneway ? -r.width / 2 : 0;
      const resLeft = Math.min(reserved(dir), Math.max(0, left - right - count * 2.6 * M));
      const resRight = r.oneway ? Math.min(reserved(-1), Math.max(0, left - right - resLeft - count * 2.6 * M)) : 0;
      const each = Math.min(LANE * 1.4, (left - right - resLeft - resRight) / count);
      for (let index = 0; index < count; index++) {
        // On a narrow two-way street, over to the kerb, room to pass (no nearer it than a car's half width and a little).
        const offset = Math.max(left - resLeft - (index + 0.5) * each, r.oneway || count > 1 ? -Infinity : Math.min(left - resLeft - 1.1 * M, left * 0.6));
        const pts = dir === 1 ? offsetLine(middle, offset) : reversed(offsetLine(middle, -offset));
        const path = makePath(pts.map(round1), r.bridge ? 1 : 0);
        path.bends = bendsOf(path, 8 * M);
        const lane: Lane = {
          ...path,
          id: lanes.length,
          road: e.index,
          edge,
          dir,
          index,
          count,
          from: dir === 1 ? e.a : e.b,
          to: dir === 1 ? e.b : e.a,
          // Slower along a busy shopping street, or a narrow lane.
          speed: (SPEED[r.kind] ?? 8 * M) * (1 - Math.min(0.15, (r.activity ?? 0) * 0.005)) * (each < 2.9 * M ? 0.88 : 1),
          rank: RANK[r.kind] ?? 1,
          activity: r.activity ?? 0,
          busLane: index === 0 ? (r.lanes ?? []).filter((l) => l.kind === 'bus' && l.side === dir).reduce((w, l) => w + l.width, 0) : 0,
          ...cycling(r, dir, index, left, offset),
          density: paths ? PATH_BIKES / (100 * M) : ((DENSITY[r.kind] ?? 0.6) * Math.min(BUSIEST, 1 + (r.activity ?? 0) / 15)) / (100 * M),
          ...(paths ? { path: true } : {}),
          stops: [],
          giveWay: false,
        };
        lane.lane = lane;
        lanes.push(lane);
        nodes[lane.from].out.push(lane.id);
      }
    }
  });

  if (paths) return { lanes, nodes };
  // (Each lane's bounding box, and its road's half width: only the lanes near a point are looked along. A big map has thousands.)
  const near = (lane: Lane, x: number, y: number) => {
    const b = lane.box!;
    const r = map.roads[lane.road].width / 2 + M;
    return x > b[0] - r && x < b[2] + r && y > b[1] - r && y < b[3] + r;
  };
  for (const lane of lanes) {
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < lane.pts.length; i += 2) b = [Math.min(b[0], lane.pts[i]), Math.min(b[1], lane.pts[i + 1]), Math.max(b[2], lane.pts[i]), Math.max(b[3], lane.pts[i + 1])];
    lane.box = b;
  }
  // The traffic lights' stop lines, on the lanes coming to them.
  map.signals.forEach((sig, signal) => {
    const [x0, y0, x1, y1] = sig.stop;
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [ux, uy] = [Math.cos(sig.angle), Math.sin(sig.angle)];
    for (const lane of lanes) {
      if (!near(lane, mx, my)) continue;
      const { s, d } = nearestOn(lane, mx, my);
      if (d > map.roads[lane.road].width / 2 + M) continue;
      const [, , tx, ty] = pathAt(lane, s);
      if (tx * ux + ty * uy < 0.8) continue;
      lane.stops.push({ s, signal });
    }
  });
  // A box for bikes in front of a stop line (an advanced stop line): its front line, where they stop.
  for (const m of (map.paint ?? []).filter((p) => p.kind === 'asl')) {
    const [ux, uy] = [Math.cos(m.angle), Math.sin(m.angle)];
    for (const lane of lanes) {
      if (!near(lane, m.x, m.y)) continue;
      const { s, d } = nearestOn(lane, m.x, m.y);
      if (d > map.roads[lane.road].width / 2 + M) continue;
      const [, , tx, ty] = pathAt(lane, s);
      if (tx * ux + ty * uy < 0.8) continue;
      const st = lane.stops.find((st) => s - st.s > 0 && s - st.s < 8 * M);
      if (st) st.box = s - st.s;
    }
  }
  for (const lane of lanes) lane.stops.sort((a, b) => a.s - b.s);
  // Giving way: at the end of a minor road (to a more major one), or where it's painted.
  const giveWays = (map.paint ?? []).filter((m) => m.kind === 'giveway');
  // (The lanes at each junction, from it or to it.)
  const at = new Map<number, Lane[]>();
  for (const l of lanes) for (const n of [l.from, l.to]) at.set(n, [...(at.get(n) ?? []), l]);
  for (const lane of lanes) {
    const end = nodes[lane.to];
    if (end.degree >= 3 && !lane.stops.some((st) => st.s > lane.length - 25 * M)) {
      const others = (at.get(lane.to) ?? []).filter((l) => l.edge !== lane.edge);
      if (others.some((l) => l.rank > lane.rank)) lane.giveWay = true;
    }
    const [ex, ey] = [lane.pts[lane.pts.length - 2], lane.pts[lane.pts.length - 1]];
    if (giveWays.some((m) => Math.hypot(m.x - ex, m.y - ey) < 12 * M && Math.cos(m.angle) * (ex - lane.pts[lane.pts.length - 4]) + Math.sin(m.angle) * (ey - lane.pts[lane.pts.length - 3]) > 0)) lane.giveWay = true;
  }
  return { lanes, nodes };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Where a cycle path joins a road: a point of it on the road's line (`cx, cy`:
 * one of the road's points too; or the path's end, within 4 m of the road's
 * edge), and the point on the road's line there (`px, py`: on segment `seg` of
 * road `road`, `t` along it), and the road's half width, px.
 */
export interface Join {
  road: number;
  seg: number;
  t: number;
  px: number;
  py: number;
  cx: number;
  cy: number;
  half: number;
}

/** A path joining a road within this of one of its junctions (or another path's join) joins it there, px. */
const SNAP = 12 * M;

/** Where the cycle paths join the roads (on the same level). */
export function cycleJoins(map: GameMap): Join[] {
  const joins: Join[] = [];
  const roads = map.roads
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => DRIVEN.has(r.kind) && r.pts.length >= 4)
    .map(({ r, i }) => {
      let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < r.pts.length; k += 2) box = [Math.min(box[0], r.pts[k]), Math.min(box[1], r.pts[k + 1]), Math.max(box[2], r.pts[k]), Math.max(box[3], r.pts[k + 1])];
      return { r, i, box };
    });
  const at = new Map<string, { road: number; seg: number; t: number }>();
  const count = new Map<string, number>();
  for (const { r, i } of roads) {
    for (let k = 0; k < r.pts.length; k += 2) {
      const key = `${r.pts[k]},${r.pts[k + 1]}`;
      at.set(key, { road: i, seg: Math.min(k / 2, r.pts.length / 2 - 2), t: k + 2 < r.pts.length ? 0 : 1 });
      count.set(key, (count.get(key) ?? 0) + (k === 0 || k === r.pts.length - 2 ? 2 : 1));
    }
  }
  // The roads' junctions and ends.
  const junctions = [...count].filter(([, n]) => n >= 2).map(([key]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, ...at.get(key)! };
  });
  for (const c of map.roads) {
    if (c.kind !== 'cycleway' || c.pts.length < 4) continue;
    const n = c.pts.length;
    for (let k = 0; k < n; k += 2) {
      const [cx, cy] = [c.pts[k], c.pts[k + 1]];
      const shared = at.get(`${cx},${cy}`);
      if (shared) {
        const r = map.roads[shared.road];
        if (!!r.bridge === !!c.bridge) joins.push({ ...shared, px: cx, py: cy, cx, cy, half: r.width / 2 });
        continue;
      }
      if (k !== 0 && k !== n - 2) continue;
      // A path's end by a road: joined to the nearest point on it.
      let best: Join | null = null;
      let bestD = Infinity;
      for (const { r, i, box } of roads) {
        if (!!r.bridge !== !!c.bridge) continue;
        const reach = r.width / 2 + 4 * M;
        if (cx < box[0] - reach || cx > box[2] + reach || cy < box[1] - reach || cy > box[3] + reach) continue;
        for (let s = 0; s + 3 < r.pts.length; s += 2) {
          const [ax, ay, bx, by] = [r.pts[s], r.pts[s + 1], r.pts[s + 2], r.pts[s + 3]];
          const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
          const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len2));
          const [px, py] = [round1(ax + (bx - ax) * t), round1(ay + (by - ay) * t)];
          const d = Math.hypot(px - cx, py - cy) - r.width / 2;
          if (d < bestD && d < 4 * M) [best, bestD] = [{ road: i, seg: s / 2, t, px, py, cx, cy, half: r.width / 2 }, d];
        }
      }
      if (best) {
        // (At one of the road's points: that one. Near a junction, or another path's join: there, so the road isn't cut into scraps.)
        const r = map.roads[best.road];
        if (best.t === 0 || best.t === 1) [best.px, best.py] = [r.pts[(best.seg + best.t) * 2], r.pts[(best.seg + best.t) * 2 + 1]];
        const near = [...junctions, ...joins.map((j) => ({ x: j.px, y: j.py, road: j.road, seg: j.seg, t: j.t }))].find((q) => Math.hypot(q.x - best!.px, q.y - best!.py) < SNAP);
        if (near) Object.assign(best, { px: near.x, py: near.y, road: near.road, seg: near.seg, t: near.t });
        joins.push(best);
      }
    }
  }
  return joins;
}

/** A road's points with those where paths join it put in. */
function withJoins(pts: Pts, joins: Join[]): Pts {
  const out: number[] = [];
  for (let s = 0; s < pts.length / 2; s++) {
    out.push(pts[s * 2], pts[s * 2 + 1]);
    for (const j of joins.filter((j) => j.seg === s && j.t > 0 && j.t < 1).sort((a, b) => a.t - b.t)) out.push(j.px, j.py);
  }
  return out;
}

/**
 * Where the bikes ride along a lane (over from its middle, + to its left):
 * in the kerb lane, along the middle of the cycle lane (or a bus lane they
 * share) on its left, if there is one; otherwise near the kerb (in from any
 * parking bays). In the other lanes, along the middle.
 */
function cycling(r: Road, dir: 1 | -1, index: number, left: number, offset: number): { cycleAt: number; cycleLane: boolean } {
  if (index > 0) return { cycleAt: 0, cycleLane: false };
  const painted = (r.lanes ?? []).filter((l) => l.side === dir);
  // (Painted lanes are measured in from the kerb.)
  const lane = painted.find((l) => l.kind === 'cycle') ?? painted.find((l) => l.kind === 'bus' && l.bikes);
  if (lane) return { cycleAt: left - lane.width / 2 - offset, cycleLane: true };
  const bays = painted.filter((l) => l.kind === 'parking').reduce((w, l) => Math.max(w, l.width), 0);
  return { cycleAt: Math.max(0, left - bays - BIKE_KERB - offset), cycleLane: false };
}

/** The turn from the end of one lane to the start of the next: a smooth curve, and where it's sharpest. */
export function turnBetween(a: Lane, b: Lane): Path {
  const [ax, ay, aux, auy] = pathAt(a, a.length);
  const [bx, by, bux, buy] = pathAt(b, 0);
  const gap = Math.hypot(bx - ax, by - ay);
  const handle = Math.max(gap * 0.45, b.edge === a.edge ? 2.5 * M : 0);
  const [c1x, c1y, c2x, c2y] = [ax + aux * handle, ay + auy * handle, bx - bux * handle, by - buy * handle];
  const steps = Math.max(2, Math.ceil((gap + handle) / 6));
  const pts: Pts = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    pts.push(round1(u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx), round1(u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by));
  }
  const path = makePath(pts, a.level);
  const bend = Math.abs(Math.atan2(aux * buy - auy * bux, aux * bux + auy * buy));
  const cross = aux * buy - auy * bux;
  path.bends = bendsOf(path, Math.max(1.5 * M, Math.min(4 * M, path.length / 2)));
  path.turn = bend < 0.5 ? 0 : cross > 0 ? 1 : -1;
  return path;
}

// --- Driving ---

/**
 * Driving like people do in town: pulling away briskly, and braking late and
 * firmly (as it plans to, and at most), px/s²; quick on and off the accelerator
 * and brake, but never all at once, px/s³; how firmly it closes on the speed it
 * wants (1/s); and how it comes to a stop: no faster than this (px/s) for each
 * px it has left, so it still rolls the last bit up to the line or the car ahead.
 */
const ACCEL = 3.4 * M;
const BRAKE = 3.4 * M;
const HARDEST = 9 * M;
const JERK_ON = 6 * M;
const JERK_OFF = 12 * M;
const GAIN = 2.2;
const CLOSING = 1.3;
/** How far it stays back: stopped (behind a car, and at a line), and the time behind a moving one, s. */
const GAP = 2 * M;
const AT_LINE = 0.5 * M;
const HEADWAY = 1.3;
/** How long a driver takes to move off when it can (the lights change, the car ahead goes), seconds: the least, and up to how much more. */
const REACT = 0.25;
const REACT_MORE = 0.5;
/** How far ahead it looks, px: at least, at most. */
const LOOK_MIN = 14 * M;
const LOOK_MAX = 70 * M;
/** Giving way: how far from the junction it starts watching, and how fast it noses out when it's clear. */
const WATCH = 30 * M;
/** It pulls out only if nothing coming will reach the junction within this long, seconds (looking up to SIGHT px away). */
const CLEAR_TIME = 3.2;
const SIGHT = 70 * M;
const NOSE = 3 * M;
/** Buses: at most this many about at once, about one every BUS_EVERY px of route round you; how long one stays at a stop, s (at least, and up to how much more); how far beyond a stop its front stops, px. */
const MAX_BUSES = 8;
const BUS_EVERY = 250 * M;
const DWELL = 5;
const DWELL_MORE = 7;
const STOP_PAST = 4 * M;
/** How quickly a bus moves over to the kerb, or back out, px/s. */
const SIDLE = 1.2 * M;

/** Standing still this long, seconds, not for a red light or you: a knot (out of sight, it's undone). */
const GRIDLOCK = 25;
/** Damage (the most any side's taken, see dents.ts) past which a vehicle limps along, and past which it's broken down. */
const LIMP = 75;
const BROKEN = 150;

/** How quickly it moves over changing lanes or pulling out to overtake, px/s. */
const SHIFT = 2 * M;

/** Backing off, out of a knot nose to nose, px/s. */
const BACK_OFF = 1.2 * M;

/** Two turning into the same lane from different ways: within this far of it, the one further off lets the other in first. */
const MERGE = 25 * M;
/** Knocked: how long it waits before driving off again, seconds; and how quickly it slides to a stop. */
export const PAUSE = 1.6;
const SLIDE = 2.4;
/** Finding its way back: how fast, px/s; close enough to its lane to carry on (px, radians). */
const CREEP = 3.5 * M;
const BACK_IN = 0.9 * M;
const BACK_ANGLE = 0.3;

export interface TrafficView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TrafficOptions {
  /** The most vehicles driving at once, and buses. */
  max?: number;
  buses?: number;
  rand?: () => number;
}

export class Traffic {
  readonly lanes: Lane[];
  readonly nodes: Node[];
  readonly vehicles: Vehicle[] = [];
  readonly parked: Vehicle[] = [];
  private readonly turns = new Map<string, Path>();
  private readonly rand: () => number;
  private readonly max: number;
  private readonly maxBuses: number;
  private nextId = 0;
  private spawnTimer = 0;
  private started = false;
  private clock = 0;
  private readonly byId = new Map<number, Vehicle>();
  private readonly parkedById = new Map<number, Vehicle>();
  /** The lanes along each edge each way, kerb first; who's been waiting a while to pull out at each junction. */
  private readonly lanesOf = new Map<string, Lane[]>();
  private readonly waitingAt = new Map<number, Vehicle>();
  private readonly entering = new Map<number, { v: Vehicle; d: number; via: Path }[]>();
  private readonly terrain: Terrain;
  private readonly routes: BusRoute[];
  private readonly roadWidths: number[];
  private readonly routeLanes: { lane: Lane; leg: number }[][];
  /** How many there should be round you now. */
  target = 0;
  /** How often drivers have changed lanes, pulled out to overtake, and let someone out (for testing). */
  readonly stats = { laneChanges: 0, overtakes: 0, letOut: 0 };
  /** Vehicles that have bumped into each other since this was last emptied: where, and how hard (for their damage). */
  readonly hits: { a: Vehicle; b: Vehicle; x: number; y: number; impulse: number }[] = [];
  /** Cyclists knocked off their bikes since this was last emptied (and taken off the road): the bike, how it was going, and how hard it was hit. */
  readonly unseated: { bike: Vehicle; impulse: number }[] = [];

  constructor(map: GameMap, options: TrafficOptions = {}) {
    const joins = cycleJoins(map);
    ({ lanes: this.lanes, nodes: this.nodes } = buildLanes(map, false, joins));
    // And the cycle paths, a network of their own (numbered on from the roads'), joined to the roads where they meet them: for the bikes.
    {
      const paths = buildLanes(map, true, joins);
      const [lanes, nodes, edges] = [this.lanes.length, this.nodes.length, this.lanes.reduce((n, l) => Math.max(n, l.edge + 1), 0)];
      for (const n of paths.nodes) this.nodes.push({ ...n, out: n.out.map((i) => i + lanes) });
      for (const l of paths.lanes) {
        Object.assign(l, { id: l.id + lanes, from: l.from + nodes, to: l.to + nodes, edge: l.edge + edges });
        this.lanes.push(l);
      }
      const [roadAt, pathNodeAt] = [new Map<string, number>(), new Map<string, number>()];
      this.nodes.forEach((n, i) => (i < nodes ? roadAt : pathNodeAt).set(`${n.x},${n.y}`, i));
      const linked = new Set<number>();
      for (const j of joins) {
        const r = roadAt.get(`${j.px},${j.py}`) ?? -1;
        const c = pathNodeAt.get(`${j.cx},${j.cy}`) ?? -1;
        if (r < 0 || c < 0) continue;
        // Off the road onto the path, and off the path onto the road (giving way to the traffic).
        const [fromRoad, fromPath] = [this.nodes[r].out.slice(), this.nodes[c].out.filter((i) => this.lanes[i].path)];
        this.nodes[r].out.push(...fromPath.filter((i) => !this.nodes[r].out.includes(i)));
        this.nodes[c].out.push(...fromRoad.filter((i) => !this.nodes[c].out.includes(i)));
        linked.add(c);
      }
      for (const l of this.lanes) if (l.path && linked.has(l.to)) l.giveWay = true;
    }
    this.terrain = new Terrain(map.terrain, map.pxPerMetre, map.ledges);
    for (const l of this.lanes) {
      const k = `${l.edge}:${l.dir}`;
      this.lanesOf.set(k, [...(this.lanesOf.get(k) ?? []), l].sort((a, b) => a.index - b.index));
    }
    // The bus routes, and the lanes along each (and which of its legs each is on).
    this.routes = map.busRoutes ?? [];
    this.roadWidths = map.roads.map((r) => r.width);
    const lanesOfRoad = new Map<number, Lane[]>();
    for (const l of this.lanes) lanesOfRoad.set(l.road, [...(lanesOfRoad.get(l.road) ?? []), l]);
    this.routeLanes = this.routes.map((r) =>
      r.legs.flatMap((leg, k) => (leg < 0 ? [] : (lanesOfRoad.get(leg >> 1) ?? []).filter((l) => l.dir === (leg & 1 ? -1 : 1) && l.index === 0).map((lane) => ({ lane, leg: k })))),
    );
    this.rand = options.rand ?? Math.random;
    this.max = options.max ?? 55;
    this.maxBuses = options.buses ?? MAX_BUSES;
    // The parked cars: most of the bays taken, more where it's busier.
    for (const space of parkingSpaces(map)) {
      if (this.rand() > space.taken) continue;
      const kind = pick(this.rand, (Object.keys(VEHICLES) as VehicleKind[]).map((k) => [k, VEHICLES[k].parked * (space.length >= VEHICLES[k].length + 2 ? 1 : 0)]));
      if (!kind) continue;
      const v = this.make(kind, space.x, space.y, space.angle + (this.rand() < 0.5 && space.endOn ? Math.PI : 0), 0);
      v.mode = 'parked';
      v.space = space;
      v.damping = SLIDE;
      this.parked.push(v);
      this.parkedById.set(v.id, v);
    }
  }

  private make(kind: VehicleKind, x: number, y: number, angle: number, level: number): Vehicle {
    const k = VEHICLES[kind];
    const colours = COLOURS[k.paint];
    const colour = colours.indexOf(pick(this.rand, colours.map((c) => [c, c[1]]))!);
    return {
      id: this.nextId++,
      kind,
      colour,
      x,
      y,
      r: k.width / 2,
      length: k.length,
      angle,
      vx: 0,
      vy: 0,
      spin: 0,
      invMass: 1 / k.mass,
      mode: 'drive',
      route: [],
      s: 0,
      back: null,
      speed: 0,
      // Each driver their own pace: most about the usual, some slower, some in a hurry; heavier vehicles slower.
      pace: KIND_PACE[kind] * (0.8 + 0.2 * (this.rand() + this.rand())) * (this.rand() < 0.1 ? 1.12 : 1),
      wander: [(2 * Math.PI) / (6 + this.rand() * 8), this.rand() * 6.3, (2 * Math.PI) / (2.5 + this.rand() * 2.5), this.rand() * 6.3],
      dawdle: 0,
      dawdleTo: 1,
      level,
      rest: 0,
      stuck: 0,
      braking: false,
      turning: 0,
      annoyed: 0,
      waiting: 0,
      side: 0,
      sideRate: 0,
      settle: 0,
      courteous: this.rand() < 0.7,
      limping: false,
      broken: false,
      alarm: 0,
      backing: 0,
      atLight: false,
      still: 0,
      accel: 0,
      react: -1,
      verve: 0.8 + this.rand() * 0.5,
    };
  }

  /** A vehicle starting `s` along a lane, at the lane's speed. */
  spawn(lane: Lane, s: number, kind?: VehicleKind, bus?: { route: number; leg: number }): Vehicle {
    const major = lane.rank >= 3;
    // (Bikes in the kerb lane only, more where there's a cycle lane, fewer on the main roads.)
    const weight = (k: VehicleKind) =>
      k === 'lorry' && !major ? 0 : k === 'bike' ? (lane.index > 0 ? 0 : VEHICLES.bike.traffic * (lane.cycleLane ? 3 : 1) * (lane.rank >= 4 ? 0.6 : 1)) : VEHICLES[k].traffic;
    if (lane.path) kind = 'bike';
    kind ??= bus ? (this.rand() < 0.55 ? 'double' : 'bus') : pick(this.rand, (Object.keys(VEHICLES) as VehicleKind[]).map((k) => [k, weight(k)]))!;
    const v = this.make(kind, 0, 0, 0, lane.level);
    v.route = [lane];
    v.s = s;
    if (kind === 'bike') {
      v.side = lane.cycleAt;
      v.rider = Math.floor(this.rand() * 48);
    }
    if (bus) {
      const r = this.routes[bus.route];
      v.bus = { route: bus.route, ref: r.ref, colour: r.colour ?? COLOURS.bus[0][0], leg: bus.leg, stops: [], served: new Set(), dwell: -1, yield: false, lost: false };
      this.findStops(v, lane);
    }
    this.plan(v);
    v.speed = Math.min(Math.min(lane.speed, kind === 'bike' ? BIKE_SPEED : Infinity) * v.pace, MAX_SPEED, this.limitAhead(v));
    // Coming up behind another in its lane: no faster than it can follow it at.
    for (const o of this.vehicles) {
      if (o.route[0] !== lane || o.s <= s) continue;
      const gap = o.s - s - (o.length + v.length) / 2 - GAP;
      v.speed = Math.min(v.speed, o.speed + Math.sqrt(2 * BRAKE * Math.max(0, gap)) * 0.8);
    }
    this.pose(v);
    this.vehicles.push(v);
    return v;
  }

  /** Plans its way ahead far enough to look along: at each junction, a way on (mostly the bigger roads, mostly straight on). */
  private plan(v: Vehicle): void {
    let ahead = -v.s;
    for (const p of v.route) ahead += p.length;
    while (ahead < LOOK_MAX + 20 * M) {
      const last = v.route[v.route.length - 1];
      if (!last.lane) break;
      const next = v.bus && !v.bus.lost ? this.busNext(v, last.lane) : this.next(last.lane, v.kind === 'bike');
      if (!next) {
        v.ends = true;
        break;
      }
      const turn = this.turn(last.lane, next);
      if (turn.length > 0.5) v.route.push(turn);
      v.route.push(next);
      if (v.bus) this.findStops(v, next);
      ahead += turn.length + next.length;
    }
  }

  private turn(a: Lane, b: Lane): Path {
    const k = `${a.id}>${b.id}`;
    let t = this.turns.get(k);
    if (!t) this.turns.set(k, (t = turnBetween(a, b)));
    return t;
  }

  /**
   * A bus's way on from the end of a lane: along its route (onto the next road
   * on it if it's here, or on along the same one; looking a few legs ahead
   * where the route's broken).
   * Off its route (it's left the map's roads), it drives on as anyone would.
   */
  private busNext(v: Vehicle, a: Lane): Lane | null {
    const bus = v.bus!;
    const legs = this.routes[bus.route].legs;
    const out = this.nodes[a.to].out.map((i) => this.lanes[i]).filter((l) => l.edge !== a.edge);
    // The next road on the route first, if it's here (a road often runs on past where the route turns off it); then on along this one.
    const order = [...Array.from({ length: Math.max(0, Math.min(legs.length, bus.leg + 5) - bus.leg - 1) }, (_, i) => bus.leg + 1 + i), bus.leg];
    for (const k of order) {
      const leg = legs[k];
      if (leg < 0) continue;
      const on = out.filter((l) => l.road === leg >> 1 && l.dir === (leg & 1 ? -1 : 1));
      if (!on.length) continue;
      bus.leg = k;
      return on.sort((p, q) => p.index - q.index)[0];
    }
    bus.lost = true;
    return this.next(a);
  }

  /** The stops on a bus's route along a lane it's going to drive (in the order it'll come to them). */
  private findStops(v: Vehicle, lane: Lane): void {
    const bus = v.bus!;
    const stops = this.routes[bus.route].stops;
    const reach = this.roadWidth(lane) / 2 + 7 * M;
    const found: { path: Path; s: number; index: number }[] = [];
    for (let i = 0; i < stops.length / 2; i++) {
      if (bus.served.has(i) || bus.stops.some((q) => q.index === i)) continue;
      const { s, d } = nearestOn(lane, stops[i * 2], stops[i * 2 + 1]);
      if (d < reach && s > 1 && s < lane.length - 1) found.push({ path: lane, s, index: i });
    }
    bus.stops.push(...found.sort((p, q) => p.s - q.s));
  }

  private roadWidth(lane: Lane): number {
    return this.roadWidths[lane.road];
  }

  /** Which lane to take on from the end of one: never back the way it came unless the road ends. */
  private next(a: Lane, bike = false): Lane | null {
    const node = this.nodes[a.to];
    const [, , ux, uy] = pathAt(a, a.length);
    // (Only bikes onto the cycle paths.)
    const open = node.out.map((i) => this.lanes[i]).filter((l) => bike || !l.path);
    const onward = open.filter((l) => l.edge !== a.edge);
    const options = onward.length ? onward : open.filter((l) => l.edge === a.edge);
    if (!options.length) return null;
    // Which road to go along (each way along each edge), then which lane of it.
    const ways = new Map<string, Lane[]>();
    for (const l of options) {
      const k = `${l.edge}:${l.dir}`;
      ways.set(k, [...(ways.get(k) ?? []), l]);
    }
    const choice = pick(
      this.rand,
      [...ways.values()].map((ls) => {
        const [, , vx, vy] = pathAt(ls[0], 0);
        const straight = ux * vx + uy * vy;
        // (A cyclist off the road onto a cycle path, when there's one, as often as not.)
        return [ls, (ls[0].path && bike && !a.path ? 6 : 1 + ls[0].rank) * (straight > 0.7 ? 3 : straight > -0.3 ? 1.2 : 0.3)] as [Lane[], number];
      }),
    )!;
    const [, , vx, vy] = pathAt(choice[0], 0);
    const cross = ux * vy - uy * vx;
    const byKerb = [...choice].sort((p, q) => p.index - q.index);
    // A cyclist keeps to the kerb lane (but to turn right).
    if (bike && (ux * vx + uy * vy >= 0.7 || cross < 0)) return byKerb[0];
    // Turning left from the kerb lane, right from the one nearest the middle; straight on, any.
    if (ux * vx + uy * vy < 0.7) return cross < 0 ? byKerb[0] : byKerb[byKerb.length - 1];
    return byKerb[Math.floor(this.rand() * byKerb.length)];
  }

  /** Where a vehicle is and which way it's pointing, from how far along its way it is. */
  private pose(v: Vehicle): void {
    const [x, y] = this.along(v, 0);
    const reach = v.length * 0.35;
    const [fx, fy] = this.along(v, reach);
    const [bx, by] = this.along(v, -reach);
    v.x = x;
    v.y = y;
    if (Math.hypot(fx - bx, fy - by) > 1) v.angle = Math.atan2(fy - by, fx - bx);
    // Over from the middle of its lane (+ to its left), and turned a little the way it's moving over.
    if (v.side) {
      v.x += Math.sin(v.angle) * v.side;
      v.y -= Math.cos(v.angle) * v.side;
    }
    if (v.sideRate) v.angle -= Math.max(-0.35, Math.min(0.35, Math.atan2(v.sideRate, Math.max(v.speed, 2 * M))));
    v.vx = Math.cos(v.angle) * v.speed;
    v.vy = Math.sin(v.angle) * v.speed;
    v.spin = 0;
    v.level = v.route[0].level;
  }

  /** The point `d` px on (or back) from where it is along its way. */
  private along(v: Vehicle, d: number): [number, number, number] {
    let s = v.s + d;
    if (s < 0) {
      if (v.back) {
        const [x, y] = pathAt(v.back, v.back.length + s);
        return [x, y, v.back.level];
      }
      const [x, y, ux, uy] = pathAt(v.route[0], 0);
      return [x + ux * s, y + uy * s, v.route[0].level];
    }
    for (const p of v.route) {
      if (s <= p.length) {
        const [x, y] = pathAt(p, s);
        return [x, y, p.level];
      }
      s -= p.length;
    }
    const last = v.route[v.route.length - 1];
    const [x, y, ux, uy] = pathAt(last, last.length);
    return [x + ux * s, y + uy * s, last.level];
  }

  /** The fastest it should be going now to slow comfortably, in time, for the bends and the slower roads ahead. */
  private limitAhead(v: Vehicle): number {
    let limit = Infinity;
    let d = -v.s;
    for (const p of v.route) {
      if (d > LOOK_MAX) break;
      const bends = p.bends ?? [];
      for (let k = 0; k + 1 < bends.length; k += 2) {
        const at = d + bends[k];
        if (at < -v.length / 2) continue;
        limit = Math.min(limit, Math.sqrt(bends[k + 1] ** 2 + 2 * BRAKE * Math.max(0, at)));
      }
      if (p.lane && d > 0) limit = Math.min(limit, Math.sqrt(Math.min(p.lane.speed * v.pace, MAX_SPEED) ** 2 + 2 * BRAKE * d));
      d += p.length;
    }
    return limit;
  }

  /**
   * One step: the traffic drives on, the knocked about slide and find their
   * way back; then vehicles come into being out of sight round you, where the
   * roads would have them, and go once they're well behind.
   */
  update(dt: number, player: Player, view: TrafficView, light: (signal: number) => Light): void {
    this.clock += dt;
    this.byId.clear();
    for (const v of this.vehicles) this.byId.set(v.id, v);
    // Who's about to turn into which lane, and how far they have to go to get into it.
    this.entering.clear();
    for (const v of this.vehicles) {
      if (v.mode !== 'drive') continue;
      let d = -v.s;
      for (let k = 0; k < v.route.length && d < MERGE; k++) {
        const p = v.route[k];
        const next = v.route[k + 1];
        if (!p.lane && next?.lane) {
          const list = this.entering.get(next.lane.id) ?? [];
          list.push({ v, d: d + p.length, via: p });
          this.entering.set(next.lane.id, list);
          break;
        }
        d += p.length;
      }
    }
    this.waitingAt.clear();
    for (const v of this.vehicles) {
      const lane = v.route[0]?.lane;
      if (lane?.giveWay && v.waiting > 4) this.waitingAt.set(lane.to, v);
    }
    const obstacles = this.obstacles(player);
    for (const v of [...this.vehicles]) {
      try {
        if (v.mode === 'drive') this.drive(v, dt, obstacles, light);
        else if (v.mode === 'knocked') this.slide(v, dt);
        else if (v.mode === 'rejoin') this.rejoin(v, dt, obstacles, view);
        if (![v.x, v.y, v.angle, v.speed].every(Number.isFinite)) throw new Error('lost its way');
      } catch (e) {
        // Something's gone wrong with this one: it's taken off the road, and the rest drive on (the game mustn't stop).
        console.error('traffic:', e);
        this.remove(v);
      }
    }
    for (const v of this.parked) {
      if (v.mode === 'knocked') this.slide(v, dt);
      if (v.alarm > 0) v.alarm = Math.max(0, v.alarm - dt);
    }
    this.bump();
    this.populate(dt, player, view);
  }

  /** People out in the road (crossing it, or running): stopped for, like anything else in the way. */
  pedestrians: Obstacle[] = [];

  private obstacles(player: Player): Obstacle[] {
    const out: Obstacle[] = [{ id: -1, x: player.x, y: player.y, angle: player.heading, r: player.width / 2, length: player.length, vx: player.vx, vy: player.vy, level: player.level }, ...this.pedestrians];
    for (const v of this.vehicles) out.push(v);
    // Parked cars are by the kerb, out of the way: only those that have been knocked out of their bays count.
    for (const v of this.parked) if (v.mode !== 'parked' || !v.space || Math.hypot(v.x - v.space.x, v.y - v.space.y) > 0.5 * M) out.push(v);
    return out;
  }

  private drive(v: Vehicle, dt: number, obstacles: Obstacle[], light: (signal: number) => Light): void {
    const look = Math.min(LOOK_MAX, LOOK_MIN + v.speed * 3);
    // What's ahead: the nearest thing in the way (and how fast it's going our way), the lights, the junction to give way at, the road's end.
    let gap = Infinity;
    let lead = 0;
    let hold = GAP;
    let blocker: number | undefined;
    const front = v.length / 2;
    // Points along the way ahead (and which level each is on: what's under a bridge isn't in the way of what's on it).
    const samples: [number, number, number, number][] = [];
    for (let d = front - 4; d <= front + look; d += 6) samples.push([...this.along(v, d), d - front]);
    // Over from the middle of its lane (in a bus lane, out overtaking): it looks along where it is.
    if (v.side) for (const p of samples) [p[0], p[1]] = [p[0] + Math.sin(v.angle) * v.side, p[1] - Math.cos(v.angle) * v.side];
    for (const o of obstacles) {
      if (o.id === v.id) continue;
      if (Math.abs(o.x - v.x) > look + 60 || Math.abs(o.y - v.y) > look + 60) continue;
      // Waiting for each other: the one that's in front goes (it can't be in the way of the one behind it); side by side, the one with the right of way.
      if (o.id >= 0 && (o as Vehicle).behind === v.id) {
        const itsAhead = (o.x - v.x) * Math.cos(v.angle) + (o.y - v.y) * Math.sin(v.angle);
        const imAhead = (v.x - o.x) * Math.cos(o.angle) + (v.y - o.y) * Math.sin(o.angle);
        // (Head on, neither goes: they'd meet. Only a knot gets one edging past: see `stuck`.)
        const headOn = Math.cos(o.angle - v.angle) < -0.7;
        if (!headOn && (imAhead > itsAhead + M || (Math.abs(imAhead - itsAhead) <= M && this.priority(v) > this.priority(o as Vehicle)))) continue;
      }
      const end = Math.max(0, o.length / 2 - o.r);
      const [cx, cy] = [Math.cos(o.angle), Math.sin(o.angle)];
      // Oncoming, they squeeze past each other (mirrors in); the same way, it's kept well clear of.
      const oncoming = Math.cos(o.angle - v.angle) < -0.7;
      // Oncoming along another road: the other carriageway (two one-way roads drawn close where they join), not in the way.
      // (On a turn, the road it's turning onto.)
      const theirs = o.id >= 0 ? (o as Vehicle).route.find((p) => p.lane)?.lane : undefined;
      const mine = v.route.find((p) => p.lane)?.lane;
      if (oncoming && theirs && mine && theirs.road !== mine.road) continue;
      const reach = oncoming ? (v.r + o.r) * 0.8 : v.r + o.r * 0.85;
      for (const [x, y, level, d] of samples) {
        if (d >= gap) break;
        if (level !== o.level) continue;
        const t = Math.max(-end, Math.min(end, (x - o.x) * cx + (y - o.y) * cy));
        if (Math.hypot(x - o.x - cx * t, y - o.y - cy * t) > reach) continue;
        // It's in the way here.
        const [, , ux, uy] = this.direction(v, d + front);
        gap = Math.max(0, d - o.r * 0.5);
        lead = Math.max(0, o.vx * ux + o.vy * uy);
        blocker = o.id;
        break;
      }
    }
    // The lights, and the junctions to give way at, and the end of the way.
    let d = -v.s - front;
    let stopped = false;
    let waiting = false;
    for (const p of v.route) {
      if (d > look) break;
      const lane = p.lane;
      if (lane) {
        for (const st of lane.stops) {
          // (A cyclist on up into the box in front, if there is one.)
          const at = d + st.s + (v.kind === 'bike' ? (st.box ?? 0) : 0);
          if (at < -2) continue;
          const l = light(st.signal);
          const stop = l === 'red' || l === 'redamber' || (l === 'amber' && at > (v.speed * v.speed) / (2 * BRAKE * 1.5));
          if (stop && at < gap) {
            gap = Math.max(0, at - 1);
            lead = 0;
            hold = AT_LINE;
            blocker = undefined;
            stopped = true;
          }
        }
        const end = d + lane.length;
        if (lane.giveWay && end < WATCH && end > -1 && !this.clearAt(v, lane, obstacles)) {
          if (v.speed < 1) waiting = true;
          if (end < gap) {
            gap = Math.max(0, end - 0.5);
            lead = 0;
            hold = AT_LINE;
            blocker = undefined;
          }
        }
      }
      d += p.length;
    }
    // Not into a junction with no room on the far side (it'd block it): wait at the end of the lane till there is.
    {
      let d = -v.s - front;
      for (let k = 0; k + 1 < v.route.length && d < look; k++) {
        const p = v.route[k];
        const exit = v.route[k + 1];
        if (p.lane && !exit.lane && v.route[k + 2]?.lane && this.nodes[p.lane.to].degree >= 3) {
          const end = d + p.length;
          if (end > -1 && end < gap && !this.roomIn(v, exit, v.route[k + 2].lane!)) {
            gap = Math.max(0, end - 0.5);
            lead = 0;
            hold = AT_LINE;
            blocker = undefined;
          }
          break;
        }
        d += p.length;
      }
    }
    // A bus: pulling in at its next stop, and waiting there a while for people to get on and off.
    let atStop = false;
    if (v.bus) {
      const bus = v.bus;
      let d = -v.s - front;
      const next = bus.stops[0];
      for (const p of v.route) {
        if (!next || d > look + STOP_PAST) break;
        if (p === next.path) {
          const at = d + next.s + STOP_PAST;
          if (at < -2 * M) {
            // Missed it (it came on at the stop, or couldn't stop in time): on to the next.
            bus.served.add(next.index);
            bus.stops.shift();
          } else if (bus.dwell < 0 && at < 1 * M && v.speed < 1) {
            bus.dwell = DWELL + this.rand() * DWELL_MORE;
          } else if (at < gap && bus.dwell !== 0) {
            gap = Math.max(0, at);
            lead = 0;
            hold = AT_LINE * 0.5;
            blocker = undefined;
          }
          atStop = at < 30 * M;
          break;
        }
        d += p.length;
      }
      if (bus.dwell > 0) {
        bus.dwell = Math.max(0, bus.dwell - dt);
        gap = 0;
        lead = 0;
        hold = AT_LINE * 0.5;
      } else if (bus.dwell === 0) {
        // Off again.
        if (next) bus.served.add(next.index);
        bus.stops.shift();
        bus.dwell = -1;
      }
    }
    // Turning into a lane another's turning into from another way, and it's nearer: in after it.
    for (const list of this.entering.values()) {
      const mine = list.find((e) => e.v === v);
      if (!mine) continue;
      for (const e of list) {
        if (e.v === v || e.via === mine.via || e.d > mine.d || (e.d === mine.d && e.v.id > v.id)) continue;
        // Only one that's on its way in (not one waiting at a line, or held up: that'd be waiting on each other).
        if (e.v.speed < 1.5 * M && e.v.route[0] !== e.via) continue;
        const room = mine.d - e.d - front - e.v.length / 2;
        if (room < gap) {
          gap = Math.max(0, room);
          lead = 0;
          hold = GAP * 0.5;
          blocker = e.v.id;
        }
      }
    }

    // Queueing anyway, and someone's been waiting a while to pull out of a side road just ahead: it stops short and lets them out.
    const here = v.route[0].lane;
    if (v.courteous && here && !here.giveWay) {
      const w = this.waitingAt.get(here.to);
      const end = here.length - v.s - front;
      const queueing = v.speed < 3 * M || (blocker !== undefined && lead < 2 * M && gap < 25 * M);
      if (w && w !== v && w.route[0].lane?.edge !== here.edge && queueing && end > -1 && end < 20 * M && end < gap) {
        if (gap - end > 2 * M) this.stats.letOut++;
        gap = Math.max(0, end - 1);
        lead = 0;
        hold = AT_LINE;
        blocker = undefined;
      }
    }
    // Changing lanes, and overtaking.
    this.manoeuvre(v, dt, blocker, gap, lead, obstacles);
    if (v.passing) {
      // Out past it: the obstruction's no longer in the way (and what's ahead in the other lane is seen as it's looked for).
      if (blocker === v.passing.id) {
        gap = Infinity;
        blocker = undefined;
      }
    }

    // The speed it likes: the road's, at its own pace, never quite steady (it swells and eases off a little as it drives)...
    const lane = v.route.find((p) => p.lane)?.lane;
    const [w1, p1, w2, p2] = v.wander;
    const bike = v.kind === 'bike';
    let cruise = Math.min(lane?.speed ?? 8 * M, bike ? BIKE_SPEED : Infinity) * v.pace * (1 + 0.06 * Math.sin(this.clock * w1 + p1) + 0.035 * Math.sin(this.clock * w2 + p2));
    // ...slower up a hill (a lorry much slower), a little quicker down one...
    const [gx, gy] = this.terrain.slope(v.x, v.y);
    const grade = gx * Math.cos(v.angle) + gy * Math.sin(v.angle);
    cruise *= grade > 0 ? Math.max(0.45, 1 - CLIMB[v.kind] * grade) : 1 + Math.min(0.05, -grade * 0.3);
    cruise = Math.min(cruise, MAX_SPEED);
    if (v.bus?.yield) cruise *= 0.6;
    // Badly damaged: it limps along.
    if (v.limping) cruise *= 0.55;
    // ...and now and then it dawdles a moment (more often along a busy street).
    if (v.dawdle > 0) {
      v.dawdle -= dt;
      cruise *= v.dawdleTo;
    } else if (lane && v.route[0].lane && v.speed > 3 * M && this.rand() < (DAWDLE + DAWDLE_BUSY * Math.min(30, lane.activity)) * dt) {
      v.dawdle = 2 + this.rand() * 3;
      v.dawdleTo = 0.55 + this.rand() * 0.25;
    }
    let want = Math.min(cruise, this.limitAhead(v));
    // ...and for what's ahead: dropping back to a couple of seconds behind a moving car, and rolling gently up to a stop.
    let urgent = false;
    if (gap < Infinity) {
      const room = gap - hold - lead * HEADWAY;
      // (A brisk driver brakes later, and harder.)
      const brake = BRAKE * v.verve;
      want = Math.min(want, room >= 0 ? Math.min(Math.sqrt(lead * lead + 2 * brake * room), lead + CLOSING * room) : Math.max(0, lead + CLOSING * room));
      // Left it late (something pulled out, the lights changed): brake as hard as it takes.
      const need = v.speed > lead ? (v.speed ** 2 - lead ** 2) / (2 * Math.max(gap - hold * 0.5, 0.1)) : 0;
      urgent = need > BRAKE * 1.4;
    }
    // Moving off: a moment to react first.
    if (v.speed < 0.3 && want < 1) v.react = -1;
    else if (v.speed < 0.3 && v.react < 0) v.react = REACT + this.rand() * REACT_MORE;
    if (v.react > 0) {
      v.react = Math.max(0, v.react - dt);
      want = 0;
    }
    // Onto the accelerator or brake, and off it, smoothly: easing towards the speed it wants.
    // Pulling away: less briskly as it gets up to speed, and up a hill.
    const top = Math.max(ACCEL * 0.35, ACCEL * v.verve * (1 - 0.4 * Math.min(1, v.speed / Math.max(cruise, 1))) - GRAVITY * Math.max(0, grade) * 0.5) * (bike ? BIKE_ACCEL : 1);
    const target = urgent ? -Math.min(HARDEST, ((v.speed ** 2 - lead ** 2) / (2 * Math.max(gap - hold * 0.5, 0.1))) * 1.1) : Math.max(-BRAKE * 1.6 * v.verve, Math.min(top, (want - v.speed) * GAIN));
    const jerk = urgent ? 40 * M : target > v.accel ? (v.accel < 0 ? JERK_OFF : JERK_ON * v.verve) : JERK_OFF;
    v.accel += Math.max(-jerk * dt, Math.min(jerk * dt, target - v.accel));
    v.speed = Math.max(0, v.speed + v.accel * dt);
    if (gap < hold * 0.4 && v.speed > lead) v.speed = lead;
    // Stopped: the foot stays on the brake until it's time to go.
    if (v.speed === 0 && v.accel < 0) v.accel = 0;
    v.braking = v.accel < -0.4 * M || (v.speed < 1 && want < 1);
    v.waiting = waiting ? v.waiting + dt : 0;
    v.atLight = stopped;
    v.still = v.speed < 1 ? v.still + dt : 0;
    // Stuck behind the same thing a long while: it's not moving and nor are we (a knot at a junction): edge past.
    v.behind = blocker;
    v.annoyed = blocker === -1 && v.speed < 2 ? v.annoyed + dt : Math.min(0, v.annoyed + dt);
    if (v.speed < 1 && blocker !== undefined && blocker >= 0 && !stopped && this.knotted(v)) v.stuck += dt;
    else v.stuck = 0;
    // Knotted: nose to nose, the one with less right of way backs off a few metres; any other way, one edges past.
    const other = blocker !== undefined ? this.byId.get(blocker) : undefined;
    const headOn = other !== undefined && Math.cos(other.angle - v.angle) < -0.7;
    if (v.stuck > 3 && headOn && this.priority(v) < this.priority(other) && this.roomBehind(v)) v.backing = 3;
    else if ((v.stuck > 6 && !headOn) || (v.stuck > 10 && headOn && this.priority(v) < this.priority(other))) v.speed = NOSE;
    if (v.backing > 0 && !this.roomBehind(v)) v.backing = 0;
    if (v.backing > 0) {
      v.backing -= dt;
      v.speed = 0;
      v.s = Math.max(0, v.s - BACK_OFF * dt);
      v.stuck = 0;
    }
    this.sidle(v, dt, atStop, obstacles);
    v.s += v.speed * dt;
    while (v.route.length > 1 && v.s > v.route[0].length) {
      v.s -= v.route[0].length;
      v.back = v.route.shift()!;
    }
    this.plan(v);
    // The way it's turning next, its indicator on as it comes up (a bus pulling in to a stop, or out from one).
    v.turning = 0;
    if (v.bus && (v.bus.dwell > 0 && v.bus.dwell < 2)) v.turning = 1;
    else if (v.bus && atStop && v.bus.dwell < 0) v.turning = -1;
    if (!v.turning && Math.abs(v.sideRate) > 0.5 * M && !v.bus) v.turning = v.sideRate > 0 ? -1 : 1;
    let ahead = -v.s;
    for (const p of v.turning ? [] : v.route) {
      if (ahead > 30 * M) break;
      if (p.turn) {
        v.turning = p.turn;
        break;
      }
      ahead += p.length;
    }
    this.pose(v);
  }

  /** Whether it's in a knot: waiting on one that's waiting on one ... that's waiting on it (not just in a queue). */
  private knotted(v: Vehicle): boolean {
    let id = v.behind;
    for (let k = 0; k < 8; k++) {
      if (id === undefined || id < 0) return false;
      if (id === v.id) return true;
      id = this.byId.get(id)?.behind;
    }
    return false;
  }

  /** Who goes first, when two are waiting for each other: the one already turning across the junction, then the bigger road. */
  private priority(v: Vehicle): number {
    return (v.route[0]?.lane ? 0 : 10) + (v.route.find((p) => p.lane)?.lane?.rank ?? 0) - v.id * 1e-6;
  }

  /** The way along its route `d` px from where it is. */
  private direction(v: Vehicle, d: number): [number, number, number, number] {
    let s = v.s + d;
    for (const p of v.route) {
      if (s <= p.length) return pathAt(p, s);
      s -= p.length;
    }
    const last = v.route[v.route.length - 1];
    return pathAt(last, last.length);
  }

  /**
   * Whether a vehicle that's been standing still a long while is in a knot
   * that won't untie: not queued for a red light, or behind you. (Out of sight,
   * it's taken off the road, and the knot's undone.)
   */
  private gridlocked(v: Vehicle): boolean {
    let o: Vehicle | undefined = v;
    for (let k = 0; k < 30 && o; k++) {
      if (o.atLight || o.behind === -1 || o.bus?.dwell) return false;
      if (o.behind === undefined) return !o.atLight && o.waiting === 0 ? o.still > GRIDLOCK : false;
      o = this.byId.get(o.behind);
    }
    return true;
  }

  /** Whether there's room to back up a few metres: nothing close behind. */
  private roomBehind(v: Vehicle): boolean {
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    for (const o of [...this.vehicles, ...this.parked]) {
      if (o === v || o.level !== v.level) continue;
      const [dx, dy] = [o.x - v.x, o.y - v.y];
      const behind = -(dx * cx + dy * cy);
      const across = Math.abs(dx * cy - dy * cx);
      if (behind > 0 && behind < (v.length + o.length) / 2 + 4 * M && across < (v.r + o.r) * 0.9) return false;
    }
    return true;
  }

  private vehicleById(id: number): Vehicle | undefined {
    return this.byId.get(id) ?? this.parkedById.get(id);
  }

  /** Whether something in the way's stuck there (not just queueing): stopped at a bus stop, broken down, knocked into the road, or parked across it. */
  private obstructs(b: Vehicle): boolean {
    if (b.mode !== 'drive' || b.broken) return true;
    if (b.bus && b.bus.dwell > 0) return true;
    return b.speed < 1 && !b.atLight && b.behind === undefined && b.waiting === 0 && b.still > 2;
  }

  private besideLane(lane: Lane, d: number): Lane | undefined {
    return this.lanesOf.get(`${lane.edge}:${lane.dir}`)?.find((l) => l.index === lane.index + d);
  }

  /** The lane the other way along the same road, nearest the middle (where it'd overtake). */
  private oppositeLane(lane: Lane): Lane | undefined {
    const list = this.lanesOf.get(`${lane.edge}:${-lane.dir}`);
    return list?.[list.length - 1];
  }

  /**
   * Changing lanes, and overtaking: into the lane for the turn coming up; out
   * of a slow or stopped one into the lane beside it, if it's moving better; on
   * a two-way road, out past something stopped in the road (a bus at a stop, a
   * broken-down or knocked car) when nothing's coming; back in once past.
   */
  private manoeuvre(v: Vehicle, dt: number, blocker: number | undefined, gap: number, lead: number, obstacles: Obstacle[]): void {
    v.settle = Math.max(0, v.settle - dt);
    const lane = v.route[0].lane;
    if (!lane || v.bus || v.limping || v.kind === 'bike') {
      v.passing = undefined;
      return;
    }
    const toEnd = lane.length - v.s;
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    if (v.passing) {
      const b = this.vehicleById(v.passing.id);
      const along = b ? (b.x - v.x) * cx + (b.y - v.y) * cy : -Infinity;
      const left = b ? along + (v.length + b.length) / 2 + GAP : 0;
      const other = this.oppositeLane(lane);
      // Past it (and room in front of it), or back in before it gets going alongside if something's coming.
      if (!b || left < 0 || toEnd < 8 * M || (along > 0 && other && !this.oncomingClear(v, other, left, obstacles))) {
        v.passing = undefined;
        v.settle = 2;
      }
      return;
    }
    if (v.settle > 0) return;
    // Into the lane for the turn ahead (left from the kerb lane, right from the one nearest the middle).
    const turn = v.route[1];
    if (lane.count > 1 && turn && !turn.lane && turn.turn && toEnd > 10 * M && toEnd < 150 * M) {
      const want = turn.turn < 0 ? 0 : lane.count - 1;
      const to = lane.index !== want ? this.besideLane(lane, Math.sign(want - lane.index)) : undefined;
      if (to && this.laneClear(v, to, obstacles)) return this.shiftLane(v, to);
    }
    const b = blocker !== undefined && blocker >= 0 ? this.vehicleById(blocker) : undefined;
    if (!b || gap > 40 * M || toEnd < 25 * M) return;
    const stuck = this.obstructs(b);
    // A cyclist ahead (and slower): it's gone round, as something stuck in the road would be.
    const cyclist = b.kind === 'bike' && b.mode === 'drive';
    if (!stuck && !cyclist && lead > lane.speed * v.pace * 0.6) return;
    if (lane.count > 1) {
      for (const d of [1, -1]) {
        const to = this.besideLane(lane, d);
        if (to && this.laneClear(v, to, obstacles) && this.freerAhead(v, to, gap, obstacles)) return this.shiftLane(v, to);
      }
    } else if ((stuck || cyclist) && gap < 18 * M) {
      const other = this.oppositeLane(lane);
      const pass = gap + b.length + v.length / 2 + 2 * GAP;
      if (other && toEnd > pass + 10 * M && this.oncomingClear(v, other, pass, obstacles)) {
        const [x, y] = pathAt(lane, v.s);
        const full = nearestOn(other, x, y).d;
        // Past a cyclist, only as far out as it takes to give them room (a car's width from them, and a metre and a half).
        v.passing = { id: b.id, out: cyclist ? Math.min(full, Math.max(0.5 * M, v.r + b.r + BIKE_ROOM - (b.side - v.side))) : full };
        this.stats.overtakes++;
      }
    }
  }

  /** Into the lane beside: it carries on along that one, from level with where it is (it moves over to it smoothly, its offset taken up). */
  private shiftLane(v: Vehicle, to: Lane): void {
    const from = v.route[0];
    const [x, y] = pathAt(from, v.s);
    const { s } = nearestOn(to, x, y);
    const [tx, ty, ux, uy] = pathAt(to, s);
    v.side += (x - tx) * uy - (y - ty) * ux;
    const onward = v.route.slice(1).find((p) => p.lane)?.lane;
    v.route = [to];
    v.s = s;
    v.ends = false;
    if (onward && onward.from === to.to) {
      const t = this.turn(to, onward);
      if (t.length > 0.5) v.route.push(t);
      v.route.push(onward);
    }
    this.plan(v);
    v.settle = 3 + this.rand() * 3;
    this.stats.laneChanges++;
  }

  /** Whether there's a gap in a lane beside it to move into: nothing alongside, nor close behind coming faster, nor just ahead. */
  private laneClear(v: Vehicle, to: Lane, obstacles: Obstacle[]): boolean {
    const [x, y] = pathAt(v.route[0], v.s);
    const at = nearestOn(to, x, y).s;
    for (const o of obstacles) {
      if (o.id === v.id || o.level !== v.level || Math.abs(o.x - x) > 60 * M || Math.abs(o.y - y) > 60 * M) continue;
      const n = nearestOn(to, o.x, o.y);
      if (n.d > 1.6 * M + o.r * 0.6) continue;
      const along = n.s - at;
      const speed = Math.hypot(o.vx, o.vy);
      const rear = (v.length + o.length) / 2 + GAP + Math.max(0, speed - v.speed) * 2;
      const ahead = (v.length + o.length) / 2 + GAP + Math.max(0, v.speed - speed) * 1.5;
      if (along > -rear && along < ahead) return false;
    }
    return true;
  }

  /** Whether the lane beside is moving better ahead: nothing in it within the gap it has now and a bit more. */
  private freerAhead(v: Vehicle, to: Lane, gap: number, obstacles: Obstacle[]): boolean {
    const [x, y] = pathAt(v.route[0], v.s);
    const at = nearestOn(to, x, y).s;
    for (const o of obstacles) {
      if (o.id === v.id || o.level !== v.level || Math.abs(o.x - x) > 60 * M || Math.abs(o.y - y) > 60 * M) continue;
      const n = nearestOn(to, o.x, o.y);
      if (n.d > 1.6 * M + o.r * 0.6) continue;
      const along = n.s - at;
      if (along > 0 && along < gap + 8 * M + v.length) return false;
    }
    return true;
  }

  /** Whether nothing's coming the other way (or in the way) along `lane` for long enough to get `length` px past something. */
  private oncomingClear(v: Vehicle, lane: Lane, length: number, obstacles: Obstacle[]): boolean {
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    const speed = Math.max(v.speed, 6 * M);
    const time = length / speed + 1.5;
    for (const o of obstacles) {
      if (o.id === v.id || o.level !== v.level) continue;
      const ahead = (o.x - v.x) * cx + (o.y - v.y) * cy;
      if (ahead < -v.length || ahead > 200 * M) continue;
      if (nearestOn(lane, o.x, o.y).d > 1.6 * M + o.r) continue;
      const coming = Math.max(0, -(o.vx * cx + o.vy * cy));
      if (ahead < length + v.length + coming * time + 2 * M) return false;
    }
    return true;
  }

  /** Moving over in its lane (or out of it, overtaking): smoothly, and only when nothing's there. */
  private sidle(v: Vehicle, dt: number, atStop: boolean, obstacles: Obstacle[]): void {
    const lane = v.route[0].lane;
    let want = 0;
    let rate = SHIFT;
    if (v.bus) {
      // Over to the kerb: in a bus lane, or pulled in to a stop (through a turn, as it was).
      want = lane ? (lane.busLane ? lane.busLane * 0.85 : atStop || v.bus.dwell > 0 ? 0.7 * M : 0) : v.side;
      rate = SIDLE;
    }
    if (v.passing) want = -v.passing.out;
    // A cyclist: over in the cycle lane, or near the kerb (through a turn, as they were).
    if (v.kind === 'bike') {
      want = lane ? lane.cycleAt : v.side;
      rate = SIDLE;
    }
    // Something alongside where it'd move to: it waits (easing off to let it by).
    const move = want - v.side;
    const blocked = Math.abs(move) > 0.5 && this.beside(v, obstacles, Math.sign(move), Math.abs(move));
    if (blocked) want = v.side;
    if (v.bus) v.bus.yield = blocked;
    const step = Math.max(-rate * dt, Math.min(rate * dt, want - v.side));
    v.side += step;
    v.sideRate = dt > 0 ? step / dt : 0;
  }

  /** Whether anything's beside it on one side (+1 its left, -1 its right) within `reach` px of moving over. */
  private beside(v: Vehicle, obstacles: Obstacle[], side: number, reach: number): boolean {
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    for (const o of obstacles) {
      if (o.id === v.id || o.level !== v.level) continue;
      const [dx, dy] = [o.x - v.x, o.y - v.y];
      const along = dx * cx + dy * cy;
      const left = dx * cy - dy * cx;
      const over = left * side;
      if (Math.abs(along) < (v.length + o.length) / 2 + 0.5 * M && over > 0 && over < reach + v.r + o.r + 0.3 * M) return true;
    }
    return false;
  }

  /** Whether there's room for a vehicle on a lane, past the turn into it: nothing stopped (or nearly) within its length and a gap of its start, or in the turn. */
  private roomIn(v: Vehicle, turn: Path, lane: Lane): boolean {
    const need = v.length + GAP * 1.5;
    for (const o of this.vehicles) {
      if (o === v || o.mode !== 'drive' || o.speed > 2 * M) continue;
      if (o.route[0] === turn) return false;
      if (o.route[0] === lane && o.s - o.length / 2 < need) return false;
    }
    return true;
  }

  /** Whether it's clear to go at the end of a lane that gives way: nothing coming to the junction, or in it. */
  private clearAt(v: Vehicle, lane: Lane, obstacles: Obstacle[]): boolean {
    const node = this.nodes[lane.to];
    for (const o of obstacles) {
      if (o.id === v.id || o.level !== v.level) continue;
      const dx = node.x - o.x;
      const dy = node.y - o.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SIGHT) continue;
      // Queued behind us, or alongside on the same road: not in the way.
      if (o.id >= 0) {
        const other = o as Vehicle;
        if (other.mode === 'parked') continue;
        const head = other.route[0];
        if (head === lane || (head?.lane && head.lane.edge === lane.edge && head.lane.dir === lane.dir)) continue;
      }
      const speed = Math.hypot(o.vx, o.vy);
      // Coming: on its way to the junction, there within the time it takes to pull out (less the longer it's waited: it takes a smaller gap; and traffic crawling in a queue lets it out).
      const time = CLEAR_TIME * Math.max(0.45, 1 - v.waiting / 30);
      const coming = speed > 2 * M && (o.vx * dx + o.vy * dy) / (speed * Math.max(dist, 1)) > 0.3 && dist / speed < time;
      // Something stopped by the junction isn't coming: if it's in the way, it's seen as that (and waited behind).
      if (coming || (dist < 6 * M && speed > 1.5 * M)) return false;
    }
    return true;
  }

  /** Knocked: sliding to a stop (it skids sideways more than it rolls), then a moment before it goes on. */
  private slide(v: Vehicle, dt: number): void {
    const [cx, cy] = [Math.cos(v.angle), Math.sin(v.angle)];
    let f = v.vx * cx + v.vy * cy;
    let side = -v.vx * cy + v.vy * cx;
    f *= Math.exp(-SLIDE * dt);
    side *= Math.exp(-SLIDE * 3 * dt);
    v.vx = f * cx - side * cy;
    v.vy = f * cy + side * cx;
    v.spin *= Math.exp(-SLIDE * 1.5 * dt);
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.angle += v.spin * dt;
    v.speed = 0;
    v.braking = true;
    if (Math.hypot(v.vx, v.vy) < 4 && Math.abs(v.spin) < 0.1) {
      v.vx = v.vy = v.spin = 0;
      v.rest += dt;
    } else v.rest = 0;
    if (v.rest > PAUSE) {
      v.rest = 0;
      v.mode = v.space || v.broken ? 'parked' : 'rejoin';
      v.stuck = 0;
    }
  }

  /** Knocked out of its lane: drives gently back into it (reversing out first if it's pointing the wrong way), then carries on. */
  private rejoin(v: Vehicle, dt: number, obstacles: Obstacle[], view: TrafficView): void {
    const lane = v.route.find((p) => p.lane)?.lane;
    if (!lane) return this.remove(v);
    const { s, d } = nearestOn(lane, v.x, v.y);
    const [, , ux, uy] = pathAt(lane, s);
    const off = Math.abs(Math.atan2(Math.sin(v.angle) * ux - Math.cos(v.angle) * uy, Math.cos(v.angle) * ux + Math.sin(v.angle) * uy));
    v.stuck += dt;
    if ((d < BACK_IN && off < BACK_ANGLE) || (v.stuck > 12 && !this.inView(v.x, v.y, view, 40))) {
      // Back in its lane: on its way again.
      v.route = v.route.slice(v.route.indexOf(lane));
      v.s = Math.min(s, lane.length - 0.1);
      v.back = null;
      v.mode = 'drive';
      v.speed = 0;
      v.stuck = 0;
      this.plan(v);
      this.pose(v);
      return;
    }
    const after = v.route.slice(v.route.indexOf(lane) + 1);
    if (s > lane.length - 2 * M && after.some((p) => p.lane)) {
      // Past the end of its lane: aim for the next.
      v.route = after;
      return;
    }
    const [tx, ty] = pathAt(lane, Math.min(lane.length, s + Math.max(5 * M, v.length)));
    const aim = Math.atan2(ty - v.y, tx - v.x);
    const err = Math.atan2(Math.sin(aim - v.angle), Math.cos(aim - v.angle));
    const reverse = Math.abs(err) > 1.9;
    // Something in the way of where it's going: wait.
    const [hx, hy] = [Math.cos(v.angle) * (reverse ? -1 : 1), Math.sin(v.angle) * (reverse ? -1 : 1)];
    const reach = v.length / 2 + 1.2 * M;
    const blocked = obstacles.some((o) => o.id !== v.id && o.level === v.level && Math.hypot(v.x + hx * reach - o.x, v.y + hy * reach - o.y) < o.r + o.length / 2);
    const speed = blocked ? 0 : reverse ? -CREEP * 0.6 : CREEP;
    const steer = Math.max(-0.6, Math.min(0.6, reverse ? -err : err));
    v.angle += (speed / (v.length * 0.6)) * Math.tan(steer) * dt;
    v.x += Math.cos(v.angle) * speed * dt;
    v.y += Math.sin(v.angle) * speed * dt;
    v.vx = Math.cos(v.angle) * speed;
    v.vy = Math.sin(v.angle) * speed;
    v.braking = speed === 0;
    v.turning = err > 0.2 ? 1 : err < -0.2 ? -1 : 0;
  }

  /** The knocked-about against everything else (a car shunted into the next). */
  private bump(): void {
    const loose = this.loose();
    if (!loose.length) return;
    const all = [...this.vehicles, ...this.parked];
    for (const a of loose) {
      for (const b of all) {
        if (a === b || a.level !== b.level) continue;
        if (Math.abs(a.x - b.x) > (a.length + b.length) / 2 || Math.abs(a.y - b.y) > (a.length + b.length) / 2) continue;
        const at = { x: 0, y: 0 };
        const hit = collideBodies(a, b, 0.3, at);
        if (hit > 0) this.hits.push({ a, b, x: at.x, y: at.y, impulse: hit });
        for (const v of [a, b]) if (v.kind === 'bike' && hit > UNSEAT) this.unseat(v, hit);
        if (hit > 15) {
          for (const v of [a, b]) {
            if (v.mode === 'drive' || v.mode === 'parked' || v.mode === 'rejoin') v.mode = 'knocked';
            v.rest = 0;
          }
        }
      }
    }
  }

  /** The vehicles (driving and parked) within `reach` of a point. */
  near(x: number, y: number, reach: number): Vehicle[] {
    const out: Vehicle[] = [];
    for (const list of [this.vehicles, this.parked]) for (const v of list) if (Math.abs(v.x - x) < reach && Math.abs(v.y - y) < reach) out.push(v);
    return out;
  }

  /** Those knocked about, or finding their way back: they bump into things. */
  loose(): Vehicle[] {
    return [...this.vehicles, ...this.parked].filter((v) => v.mode === 'knocked' || v.mode === 'rejoin');
  }

  /** Its damage has changed (see dents.ts): badly enough, it limps along with its hazards on; worse, it's broken down where it is, smoking. */
  hurt(v: Vehicle): void {
    const w = v.wreck;
    if (!w || v.space) return;
    const worst = Math.max(w.taken.front, w.taken.rear, w.taken.left, w.taken.right);
    if (worst > LIMP) v.limping = true;
    if (worst > BROKEN && !v.broken) {
      v.broken = true;
      v.passing = undefined;
      if (v.mode !== 'knocked') v.mode = 'parked';
      v.speed = 0;
    }
  }

  /** You've hit it (how hard): it's knocked about, and stops a moment. */
  knock(v: Vehicle, impulse: number): void {
    if (v.kind === 'bike' && impulse > UNSEAT) return this.unseat(v, impulse);
    if (impulse < 4) return;
    v.mode = 'knocked';
    v.rest = 0;
    v.speed = 0;
  }

  /** Taken out of the traffic (or off its parking place): you've got in it. */
  take(v: Vehicle): void {
    this.remove(v);
    const i = this.parked.indexOf(v);
    if (i >= 0) this.parked.splice(i, 1);
    this.parkedById.delete(v.id);
  }

  /** A vehicle you've got out of, left where it is (as a parked one, but not in a bay: it's in the way, and gone round). */
  leave(kind: VehicleKind, x: number, y: number, angle: number, level: number, extra: Partial<Vehicle> = {}): Vehicle {
    const v = this.make(kind, x, y, angle, level);
    Object.assign(v, extra, { mode: 'parked', damping: SLIDE, speed: 0, vx: 0, vy: 0, spin: 0 });
    this.parked.push(v);
    this.parkedById.set(v.id, v);
    return v;
  }

  /** A cyclist knocked off their bike: taken off the road (the bike and its rider go down on it: see `unseated`). */
  private unseat(v: Vehicle, impulse: number): void {
    if (!this.vehicles.includes(v)) return;
    this.remove(v);
    this.unseated.push({ bike: v, impulse });
  }

  private remove(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  private inView(x: number, y: number, view: TrafficView, pad: number): boolean {
    return x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
  }

  /** Fills the streets round you at once next time (you've jumped somewhere else). */
  refill(): void {
    this.started = false;
  }

  /** Keeps the streets round you as busy as they should be: new vehicles out of sight, gone once they're far off. */
  private populate(dt: number, player: Player, view: TrafficView): void {
    const half = Math.hypot(view.x1 - view.x0, view.y1 - view.y0) / 2;
    const near = half + 30 * M;
    const far = near + 40 * M;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      // At the end of its way (off the edge of the map: it drives off it), or a bus off its route once out of sight.
      const gone = v.mode === 'drive' && ((v.route.length === 1 && v.s >= v.route[0].length - 0.5) || (v.bus?.lost && !this.inView(v.x, v.y, view, 60)));
      if (gone || Math.hypot(v.x - player.x, v.y - player.y) > far || (v.still > GRIDLOCK && this.gridlocked(v) && !this.inView(v.x, v.y, view, 80))) this.vehicles.splice(i, 1);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 && this.started) return;
    this.spawnTimer = 0.2;
    // How many the lanes round you should have, and where.
    const candidates: [Lane, number][] = [];
    let expected = 0;
    for (const lane of this.lanes) {
      const [x0, y0] = [lane.pts[0], lane.pts[1]];
      const [x1, y1] = [lane.pts[lane.pts.length - 2], lane.pts[lane.pts.length - 1]];
      if (Math.min(Math.hypot(x0 - player.x, y0 - player.y), Math.hypot(x1 - player.x, y1 - player.y)) > near + lane.length) continue;
      expected += lane.density * Math.min(lane.length, 2 * near);
      candidates.push([lane, lane.density * lane.length]);
    }
    const target = Math.min(this.max, Math.round(expected * 0.9));
    this.target = target;
    // At the start, fill the streets (in view too); after, a few at a time, out of sight.
    const tries = this.started ? 6 : target * 4;
    for (let k = 0; k < tries && this.vehicles.length < target; k++) {
      const lane = pick(this.rand, candidates);
      if (!lane) break;
      const s = this.rand() * lane.length;
      const [x, y] = pathAt(lane, s);
      const dist = Math.hypot(x - player.x, y - player.y);
      // Not right by you (at the start, not within 25 m: no one appears just ahead of you and has to brake hard).
      if (dist > near || dist < (this.started ? 10 : 25) * M) continue;
      if (this.started && this.inView(x, y, view, 50)) continue;
      // Room for it.
      if (this.vehicles.some((v) => Math.hypot(v.x - x, v.y - y) < 7 * M)) continue;
      this.spawn(lane, s);
    }
    this.spawnBuses(player, view, near);
    this.started = true;
  }

  /** Buses on the routes round you: about one every BUS_EVERY px of them, coming into being out of sight on one of them, partway along. */
  private spawnBuses(player: Player, view: TrafficView, near: number): void {
    const buses = this.vehicles.filter((v) => v.bus).length;
    const candidates: [{ route: number; lane: Lane; leg: number }, number][] = [];
    let length = 0;
    this.routeLanes.forEach((lanes, route) => {
      for (const { lane, leg } of lanes) {
        const [x0, y0] = [lane.pts[0], lane.pts[1]];
        if (Math.hypot(x0 - player.x, y0 - player.y) > near + lane.length) continue;
        candidates.push([{ route, lane, leg }, lane.length]);
        length += lane.length;
      }
    });
    // Routes share roads (a dozen along the main streets): a bus for every so much road, not route.
    const target = Math.min(this.maxBuses, Math.round(Math.sqrt(length / BUS_EVERY) * 2));
    for (let k = 0; k < (this.started ? 2 : target * 4) && this.vehicles.filter((v) => v.bus).length < Math.max(target, buses); k++) {
      if (this.vehicles.filter((v) => v.bus).length >= target) break;
      const c = pick(this.rand, candidates);
      if (!c) break;
      const s = this.rand() * c.lane.length;
      const [x, y] = pathAt(c.lane, s);
      const dist = Math.hypot(x - player.x, y - player.y);
      if (dist > near || dist < (this.started ? 10 : 25) * M) continue;
      if (this.started && this.inView(x, y, view, 50)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - x, v.y - y) < 14 * M)) continue;
      this.spawn(c.lane, s, undefined, { route: c.route, leg: c.leg });
    }
  }
}

/** Picks one of some things by weight. */
function pick<T>(rand: () => number, weighted: [T, number][]): T | undefined {
  let total = 0;
  for (const [, w] of weighted) total += w;
  if (total <= 0) return undefined;
  let r = rand() * total;
  for (const [item, w] of weighted) {
    r -= w;
    if (r < 0) return item;
  }
  return weighted[weighted.length - 1][0];
}

/** Two long bodies bumping: both move and both turn. Returns the impulse. */
export function collideBodies(a: Body, b: Body, restitution = 0.3, contactOut?: { x: number; y: number }): number {
  let strongest = 0;
  const inertia = (body: Body) => (12 * body.invMass) / ((body.length ?? body.r * 2) ** 2 + (body.r * 2) ** 2);
  for (const pa of bodyHull(a)) {
    for (const pb of bodyHull(b)) {
      const ax = a.x + Math.cos(a.angle) * pa;
      const ay = a.y + Math.sin(a.angle) * pa;
      const bx = b.x + Math.cos(b.angle) * pb;
      const by = b.y + Math.sin(b.angle) * pb;
      const dx = ax - bx;
      const dy = ay - by;
      const dist = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (dist >= min || dist < 1e-6) continue;
      const [nx, ny] = [dx / dist, dy / dist];
      const depth = min - dist;
      const total = a.invMass + b.invMass;
      a.x += nx * depth * (a.invMass / total);
      a.y += ny * depth * (a.invMass / total);
      b.x -= nx * depth * (b.invMass / total);
      b.y -= ny * depth * (b.invMass / total);
      // Where they touch, from each one's middle.
      const [px, py] = [ax - nx * a.r, ay - ny * a.r];
      const [rax, ray, rbx, rby] = [px - a.x, py - a.y, px - b.x, py - b.y];
      const va = [a.vx - a.spin * ray, a.vy + a.spin * rax];
      const vb = [b.vx - b.spin * rby, b.vy + b.spin * rbx];
      const vn = (va[0] - vb[0]) * nx + (va[1] - vb[1]) * ny;
      if (vn >= 0) continue;
      const ra = rax * ny - ray * nx;
      const rb = rbx * ny - rby * nx;
      const j = (-(1 + restitution) * vn) / (a.invMass + b.invMass + ra * ra * inertia(a) + rb * rb * inertia(b));
      a.vx += nx * j * a.invMass;
      a.vy += ny * j * a.invMass;
      a.spin += ra * j * inertia(a);
      b.vx -= nx * j * b.invMass;
      b.vy -= ny * j * b.invMass;
      b.spin -= rb * j * inertia(b);
      if (j > strongest) {
        strongest = j;
        if (contactOut) Object.assign(contactOut, { x: px, y: py });
      }
    }
  }
  return strongest;
}
