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
import type { GameMap, Pts, Road, RoadKind } from '../map/osm';
import type { Body } from '../physics/collisions';
import type { Light } from './lights';
import { type Space, parkingSpaces } from './parking';
import { Terrain } from './terrain';
import { lineLength, offsetLine, subPolyline } from './world';

const M = 8;

// --- The vehicles ---

export type VehicleKind = 'small' | 'hatch' | 'saloon' | 'estate' | 'suv' | 'van' | 'lorry';

/**
 * Each kind: how long and wide (px; real sizes, a tenth up, to match your car),
 * how heavy (your car's 1), how common in the traffic and parked, and which
 * colours it comes in.
 */
export const VEHICLES: Record<VehicleKind, { length: number; width: number; mass: number; traffic: number; parked: number; paint: 'car' | 'van' | 'lorry' }> = {
  small: { length: 3.7 * 1.1 * M, width: 1.65 * 1.1 * M, mass: 0.8, traffic: 0.18, parked: 0.22, paint: 'car' },
  hatch: { length: 4.1 * 1.1 * M, width: 1.75 * 1.1 * M, mass: 0.9, traffic: 0.26, parked: 0.27, paint: 'car' },
  saloon: { length: 4.7 * 1.1 * M, width: 1.82 * 1.1 * M, mass: 1, traffic: 0.14, parked: 0.14, paint: 'car' },
  estate: { length: 4.8 * 1.1 * M, width: 1.82 * 1.1 * M, mass: 1.05, traffic: 0.08, parked: 0.08, paint: 'car' },
  suv: { length: 4.6 * 1.1 * M, width: 1.92 * 1.1 * M, mass: 1.3, traffic: 0.15, parked: 0.17, paint: 'car' },
  van: { length: 5.3 * 1.1 * M, width: 2.0 * 1.1 * M, mass: 1.5, traffic: 0.14, parked: 0.12, paint: 'van' },
  lorry: { length: 8.5 * 1.1 * M, width: 2.5 * 1.1 * M, mass: 4, traffic: 0.05, parked: 0, paint: 'lorry' },
};

/** The colours, about as common as on Britain's roads (grey, black and white the most); vans mostly white; lorries' cabs. */
export const COLOURS: Record<'car' | 'van' | 'lorry', [string, number][]> = {
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
  /** Seconds it's been held up by you (it honks). */
  annoyed: number;
  /** Its dents, scratches and lost parts, once it's been hit. */
  wreck?: Wreck;
  /** Its way runs out (a one-way road off the map's edge): it stops at the end, and goes once out of sight. */
  ends?: boolean;
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
  /** Where the traffic lights' stop lines are along it (and which lights). */
  stops: { s: number; signal: number }[];
  /** How busy the road is (see Road.activity). */
  activity: number;
  /** At its end, it gives way to the traffic on the road it joins. */
  giveWay: boolean;
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
/** How fast each kind's driven, against the road's usual speed (before the driver's own pace). */
const KIND_PACE: Record<VehicleKind, number> = { small: 1, hatch: 1, saloon: 1.02, estate: 0.99, suv: 0.98, van: 0.93, lorry: 0.85 };
/** Up a hill, how much each kind slows for each 1 in 1 of it (a lorry labours; a car barely notices); and how strongly gravity holds it back pulling away. */
const CLIMB: Record<VehicleKind, number> = { small: 0.8, hatch: 0.6, saloon: 0.5, estate: 0.5, suv: 0.5, van: 1.3, lorry: 3 };
const GRAVITY = 9.81 * M;
/** Dawdling: how often a driver slows a moment, a second (more often the busier the street), and for how long. */
const DAWDLE = 0.003;
const DAWDLE_BUSY = 0.0015;
/** A lane's width, if the road doesn't say, px. */
const LANE = 3.2 * M;
/** Bends and turns are taken no faster than this sideways pull allows, px/s². */
const CORNERING = 2.2 * M;

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
export function buildLanes(map: GameMap): { lanes: Lane[]; nodes: Node[] } {
  const roads = map.roads.map((r, i) => ({ r, i })).filter(({ r }) => DRIVEN.has(r.kind) && r.pts.length >= 4);
  const key = (x: number, y: number) => `${x},${y}`;
  const uses = new Map<string, number>();
  for (const { r } of roads) for (let k = 0; k < r.pts.length; k += 2) uses.set(key(r.pts[k], r.pts[k + 1]), (uses.get(key(r.pts[k], r.pts[k + 1])) ?? 0) + 1);
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
  for (const e of edges) {
    for (const n of [e.a, e.b]) if (nodes[n].degree >= 3) clear[n] = Math.max(clear[n], e.road.width / 2 + 1.2 * M);
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
        const offset = left - resLeft - (index + 0.5) * each;
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
          density: ((DENSITY[r.kind] ?? 0.6) * Math.min(BUSIEST, 1 + (r.activity ?? 0) / 15)) / (100 * M),
          stops: [],
          giveWay: false,
        };
        lane.lane = lane;
        lanes.push(lane);
        nodes[lane.from].out.push(lane.id);
      }
    }
  });

  // The traffic lights' stop lines, on the lanes coming to them.
  map.signals.forEach((sig, signal) => {
    const [x0, y0, x1, y1] = sig.stop;
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [ux, uy] = [Math.cos(sig.angle), Math.sin(sig.angle)];
    for (const lane of lanes) {
      const { s, d } = nearestOn(lane, mx, my);
      if (d > map.roads[lane.road].width / 2 + M) continue;
      const [, , tx, ty] = pathAt(lane, s);
      if (tx * ux + ty * uy < 0.8) continue;
      lane.stops.push({ s, signal });
    }
  });
  for (const lane of lanes) lane.stops.sort((a, b) => a.s - b.s);
  // Giving way: at the end of a minor road (to a more major one), or where it's painted.
  const giveWays = (map.paint ?? []).filter((m) => m.kind === 'giveway');
  for (const lane of lanes) {
    const end = nodes[lane.to];
    if (end.degree >= 3 && !lane.stops.some((st) => st.s > lane.length - 25 * M)) {
      const others = lanes.filter((l) => (l.from === lane.to || l.to === lane.to) && l.edge !== lane.edge);
      if (others.some((l) => l.rank > lane.rank)) lane.giveWay = true;
    }
    const [ex, ey] = [lane.pts[lane.pts.length - 2], lane.pts[lane.pts.length - 1]];
    if (giveWays.some((m) => Math.hypot(m.x - ex, m.y - ey) < 12 * M && Math.cos(m.angle) * (ex - lane.pts[lane.pts.length - 4]) + Math.sin(m.angle) * (ey - lane.pts[lane.pts.length - 3]) > 0)) lane.giveWay = true;
  }
  return { lanes, nodes };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

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
 * Driving smoothly: how hard it pulls away at most, and brakes as it plans to
 * (comfortably) and at most, px/s²; how quickly it gets on or off the
 * accelerator and brake (never all at once), px/s³; how firmly it closes on the
 * speed it wants (1/s); and how it eases into a stop: no faster than this
 * (px/s) for each px it has left, so it rolls up to the line or the car ahead.
 */
const ACCEL = 2.2 * M;
const BRAKE = 2.2 * M;
const HARDEST = 9 * M;
const JERK_ON = 2.5 * M;
const JERK_OFF = 5 * M;
const GAIN = 1.6;
const CLOSING = 0.9;
/** How far it stays back: stopped (behind a car, and at a line), and the time behind a moving one, s. */
const GAP = 2 * M;
const AT_LINE = 0.5 * M;
const HEADWAY = 1.5;
/** How long a driver takes to move off when it can (the lights change, the car ahead goes), seconds: the least, and up to how much more. */
const REACT = 0.35;
const REACT_MORE = 0.7;
/** How far ahead it looks, px: at least, at most. */
const LOOK_MIN = 14 * M;
const LOOK_MAX = 70 * M;
/** Giving way: how far from the junction it starts watching, and how fast it noses out when it's clear. */
const WATCH = 30 * M;
/** It pulls out only if nothing coming will reach the junction within this long, seconds (looking up to SIGHT px away). */
const CLEAR_TIME = 4.5;
const SIGHT = 70 * M;
const NOSE = 3 * M;
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
  /** The most vehicles driving at once. */
  max?: number;
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
  private nextId = 0;
  private spawnTimer = 0;
  private started = false;
  private clock = 0;
  private readonly byId = new Map<number, Vehicle>();
  private readonly entering = new Map<number, { v: Vehicle; d: number; via: Path }[]>();
  private readonly terrain: Terrain;
  /** How many there should be round you now. */
  target = 0;
  /** Vehicles that have bumped into each other since this was last emptied: where, and how hard (for their damage). */
  readonly hits: { a: Vehicle; b: Vehicle; x: number; y: number; impulse: number }[] = [];

  constructor(map: GameMap, options: TrafficOptions = {}) {
    ({ lanes: this.lanes, nodes: this.nodes } = buildLanes(map));
    this.terrain = new Terrain(map.terrain, map.pxPerMetre);
    this.rand = options.rand ?? Math.random;
    this.max = options.max ?? 55;
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
      accel: 0,
      react: -1,
      verve: 0.8 + this.rand() * 0.4,
    };
  }

  /** A vehicle starting `s` along a lane, at the lane's speed. */
  spawn(lane: Lane, s: number, kind?: VehicleKind): Vehicle {
    const major = lane.rank >= 3;
    kind ??= pick(this.rand, (Object.keys(VEHICLES) as VehicleKind[]).map((k) => [k, k === 'lorry' && !major ? 0 : VEHICLES[k].traffic]))!;
    const v = this.make(kind, 0, 0, 0, lane.level);
    v.route = [lane];
    v.s = s;
    this.plan(v);
    v.speed = Math.min(lane.speed * v.pace, MAX_SPEED, this.limitAhead(v));
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
      const next = this.next(last.lane);
      if (!next) {
        v.ends = true;
        break;
      }
      const turn = this.turn(last.lane, next);
      if (turn.length > 0.5) v.route.push(turn);
      v.route.push(next);
      ahead += turn.length + next.length;
    }
  }

  private turn(a: Lane, b: Lane): Path {
    const k = `${a.id}>${b.id}`;
    let t = this.turns.get(k);
    if (!t) this.turns.set(k, (t = turnBetween(a, b)));
    return t;
  }

  /** Which lane to take on from the end of one: never back the way it came unless the road ends. */
  private next(a: Lane): Lane | null {
    const node = this.nodes[a.to];
    const [, , ux, uy] = pathAt(a, a.length);
    const onward = node.out.map((i) => this.lanes[i]).filter((l) => l.edge !== a.edge);
    const options = onward.length ? onward : node.out.map((i) => this.lanes[i]).filter((l) => l.edge === a.edge);
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
        return [ls, (1 + ls[0].rank) * (straight > 0.7 ? 3 : straight > -0.3 ? 1.2 : 0.3)] as [Lane[], number];
      }),
    )!;
    const [, , vx, vy] = pathAt(choice[0], 0);
    const cross = ux * vy - uy * vx;
    const byKerb = [...choice].sort((p, q) => p.index - q.index);
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
    for (const v of this.parked) if (v.mode === 'knocked') this.slide(v, dt);
    this.bump();
    this.populate(dt, player, view);
  }

  private obstacles(player: Player): Obstacle[] {
    const out: Obstacle[] = [{ id: -1, x: player.x, y: player.y, angle: player.heading, r: player.width / 2, length: player.length, vx: player.vx, vy: player.vy, level: player.level }];
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
    for (const o of obstacles) {
      if (o.id === v.id) continue;
      if (Math.abs(o.x - v.x) > look + 60 || Math.abs(o.y - v.y) > look + 60) continue;
      // Waiting for each other: the one that's in front goes (it can't be in the way of the one behind it); side by side, the one with the right of way.
      if (o.id >= 0 && (o as Vehicle).behind === v.id) {
        const itsAhead = (o.x - v.x) * Math.cos(v.angle) + (o.y - v.y) * Math.sin(v.angle);
        const imAhead = (v.x - o.x) * Math.cos(o.angle) + (v.y - o.y) * Math.sin(o.angle);
        if (imAhead > itsAhead + M || (Math.abs(imAhead - itsAhead) <= M && this.priority(v) > this.priority(o as Vehicle))) continue;
      }
      const end = Math.max(0, o.length / 2 - o.r);
      const [cx, cy] = [Math.cos(o.angle), Math.sin(o.angle)];
      const reach = v.r + o.r * 0.85;
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
    for (const p of v.route) {
      if (d > look) break;
      const lane = p.lane;
      if (lane) {
        for (const st of lane.stops) {
          const at = d + st.s;
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
    // Turning into a lane another's turning into from another way, and it's nearer: in after it.
    for (const list of this.entering.values()) {
      const mine = list.find((e) => e.v === v);
      if (!mine) continue;
      for (const e of list) {
        if (e.v === v || e.via === mine.via || e.d > mine.d || (e.d === mine.d && e.v.id > v.id)) continue;
        const room = mine.d - e.d - front - e.v.length / 2;
        if (room < gap) {
          gap = Math.max(0, room);
          lead = 0;
          hold = GAP * 0.5;
          blocker = e.v.id;
        }
      }
    }
    if (v.ends) {
      let left = -v.s - front;
      for (const p of v.route) left += p.length;
      if (left < gap) {
        gap = Math.max(0, left);
        lead = 0;
        hold = AT_LINE;
      }
    }

    // The speed it wants: its usual for the road (drifting a little, as a driver's does), slowing in time for the bends ahead...
    // The speed it likes: the road's, at its own pace, never quite steady (it swells and eases off a little as it drives)...
    const lane = v.route.find((p) => p.lane)?.lane;
    const [w1, p1, w2, p2] = v.wander;
    let cruise = (lane?.speed ?? 8 * M) * v.pace * (1 + 0.06 * Math.sin(this.clock * w1 + p1) + 0.035 * Math.sin(this.clock * w2 + p2));
    // ...slower up a hill (a lorry much slower), a little quicker down one...
    const [gx, gy] = this.terrain.slope(v.x, v.y);
    const grade = gx * Math.cos(v.angle) + gy * Math.sin(v.angle);
    cruise *= grade > 0 ? Math.max(0.45, 1 - CLIMB[v.kind] * grade) : 1 + Math.min(0.05, -grade * 0.3);
    cruise = Math.min(cruise, MAX_SPEED);
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
      want = Math.min(want, room >= 0 ? Math.min(Math.sqrt(lead * lead + 2 * BRAKE * room), lead + CLOSING * room) : Math.max(0, lead + CLOSING * room));
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
    const top = Math.max(ACCEL * 0.35, ACCEL * v.verve * (1 - 0.4 * Math.min(1, v.speed / Math.max(cruise, 1))) - GRAVITY * Math.max(0, grade) * 0.5);
    const target = urgent ? -Math.min(HARDEST, ((v.speed ** 2 - lead ** 2) / (2 * Math.max(gap - hold * 0.5, 0.1))) * 1.1) : Math.max(-BRAKE * 1.6, Math.min(top, (want - v.speed) * GAIN));
    const jerk = urgent ? 40 * M : target > v.accel ? (v.accel < 0 ? JERK_OFF : JERK_ON * v.verve) : JERK_OFF;
    v.accel += Math.max(-jerk * dt, Math.min(jerk * dt, target - v.accel));
    v.speed = Math.max(0, v.speed + v.accel * dt);
    if (gap < hold * 0.4 && v.speed > lead) v.speed = lead;
    // Stopped: the foot stays on the brake until it's time to go.
    if (v.speed === 0 && v.accel < 0) v.accel = 0;
    v.braking = v.accel < -0.4 * M || (v.speed < 1 && want < 1);
    // Stuck behind the same thing a long while: it's not moving and nor are we (a knot at a junction): edge past.
    v.behind = blocker;
    v.annoyed = blocker === -1 && v.speed < 2 ? v.annoyed + dt : Math.min(0, v.annoyed + dt);
    if (v.speed < 1 && blocker !== undefined && blocker >= 0 && !stopped && this.knotted(v)) v.stuck += dt;
    else v.stuck = 0;
    if (v.stuck > 6 && this.priority(v) >= 0) v.speed = NOSE;
    v.s += v.speed * dt;
    while (v.route.length > 1 && v.s > v.route[0].length) {
      v.s -= v.route[0].length;
      v.back = v.route.shift()!;
    }
    this.plan(v);
    // The way it's turning next, its indicator on as it comes up.
    v.turning = 0;
    let ahead = -v.s;
    for (const p of v.route) {
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
      const coming = speed > 4 && (o.vx * dx + o.vy * dy) / (speed * Math.max(dist, 1)) > 0.3 && dist / speed < CLEAR_TIME;
      if (coming || dist < 6 * M) return false;
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
      v.mode = v.space ? 'parked' : 'rejoin';
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
    const loose = [...this.vehicles, ...this.parked].filter((v) => v.mode === 'knocked' || v.mode === 'rejoin');
    if (!loose.length) return;
    const all = [...this.vehicles, ...this.parked];
    for (const a of loose) {
      for (const b of all) {
        if (a === b || a.level !== b.level) continue;
        if (Math.abs(a.x - b.x) > (a.length + b.length) / 2 || Math.abs(a.y - b.y) > (a.length + b.length) / 2) continue;
        const at = { x: 0, y: 0 };
        const hit = collideBodies(a, b, 0.3, at);
        if (hit > 0) this.hits.push({ a, b, x: at.x, y: at.y, impulse: hit });
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

  /** You've hit it (how hard): it's knocked about, and stops a moment. */
  knock(v: Vehicle, impulse: number): void {
    if (impulse < 4) return;
    v.mode = 'knocked';
    v.rest = 0;
    v.speed = 0;
  }

  private remove(v: Vehicle): void {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  private inView(x: number, y: number, view: TrafficView, pad: number): boolean {
    return x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
  }

  /** Keeps the streets round you as busy as they should be: new vehicles out of sight, gone once they're far off. */
  private populate(dt: number, player: Player, view: TrafficView): void {
    const half = Math.hypot(view.x1 - view.x0, view.y1 - view.y0) / 2;
    const near = half + 30 * M;
    const far = near + 40 * M;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const gone = v.route.length === 1 && v.s >= v.route[0].length - 0.5 && v.mode === 'drive' && !this.inView(v.x, v.y, view, 60);
      if (gone || Math.hypot(v.x - player.x, v.y - player.y) > far) this.vehicles.splice(i, 1);
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
    this.started = true;
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
  const hull = (body: Body) => {
    const end = Math.max(0, (body.length ?? 0) / 2 - body.r);
    return end ? [-end, 0, end] : [0];
  };
  const inertia = (body: Body) => (12 * body.invMass) / ((body.length ?? body.r * 2) ** 2 + (body.r * 2) ** 2);
  for (const pa of hull(a)) {
    for (const pb of hull(b)) {
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
