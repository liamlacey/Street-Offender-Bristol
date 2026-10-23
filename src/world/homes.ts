/**
 * People's homes: each house's front garden (between it and the pavement)
 * and back garden (behind it, to half way to the house behind, or to the
 * road or path or whatever else is there), worked out from the map: which
 * buildings are houses (OSM's `building=house`, `terrace`,
 * `semidetached_house`, `detached`, `bungalow`, `residential`; or small and
 * untagged where people live), which way each faces (to its nearest
 * street), and how far there is in front and behind. In them:
 *
 * - the garden walls, fences and hedges: along the front (a gap for the gate,
 *   and the drive), between the houses, and along the back (each the same
 *   down a street, and knocked down like any other);
 * - a drive, where there's room in front, a car on it more often than not;
 *   a patio behind;
 * - the wheelie bins out the front; and out the back the shed, the table and
 *   chairs, the washing line, the barbecue, the trampoline, the greenhouse,
 *   the paddling pool, the kids' playhouse, a bike, pots: all of it loose,
 *   and smashed up if it's hit (see world.ts and damage.ts).
 *
 * The same every time (and in every region of the map the house is in),
 * from where each house is; pure, so it's tested.
 */

import { type Area, type GameMap, type Pts, type Road, pointInRing, ridgeAxis } from '../map/osm';
import { type Work, every } from './work.ts';
import { distToSeg } from './geometry';

const M = 8;

/** What's in the gardens (see world.ts for how heavy each is, and damage.ts for what it breaks into). */
export const HOME_KINDS = ['wheelie', 'recyclebox', 'gardenset', 'shed', 'trampoline', 'washline', 'bbq', 'pushbike', 'paddling', 'greenhouse', 'playhouse', 'plantpot'] as const;
export type HomeKind = (typeof HOME_KINDS)[number];

/** What each takes up, along its angle and across it, px. */
export const HOME_SIZE: Record<HomeKind, [number, number]> = {
  wheelie: [0.75 * M, 0.6 * M],
  recyclebox: [0.6 * M, 0.45 * M],
  gardenset: [1.8 * M, 1.8 * M],
  shed: [2.4 * M, 1.8 * M],
  trampoline: [3.2 * M, 3.2 * M],
  washline: [2.6 * M, 2.6 * M],
  bbq: [0.9 * M, 0.6 * M],
  pushbike: [1.7 * M, 0.5 * M],
  paddling: [1.8 * M, 1.8 * M],
  greenhouse: [2.5 * M, 1.9 * M],
  playhouse: [1.4 * M, 1.4 * M],
  plantpot: [0.5 * M, 0.5 * M],
};

/** The wheelie bins' colours (which council bin it is): black, green, blue, brown. */
export const WHEELIE_COLOURS = 4;

export interface HomeThing {
  kind: HomeKind;
  x: number;
  y: number;
  angle: number;
  /** Which colour (a wheelie bin). */
  variant?: number;
}

export interface GardenLine {
  kind: 'wall' | 'fence' | 'hedge';
  pts: Pts;
  /** How tall, px. */
  height: number;
}

/** A house's plot: where it is, which way it faces, and how deep its gardens are, px. */
export interface Plot {
  building: number;
  /** Its middle; the way out of its front door (unit), and along its front (unit: `front` turned a quarter to the left, y down). */
  x: number;
  y: number;
  fx: number;
  fy: number;
  sx: number;
  sy: number;
  /** Its walls, out from its middle: front, back (negative), and its sides along `s`. */
  front: number;
  back: number;
  s0: number;
  s1: number;
  /** How deep its front and back gardens are, px (0: none). */
  frontDepth: number;
  backDepth: number;
}

export interface Homes {
  plots: Plot[];
  things: HomeThing[];
  lines: GardenLine[];
  /** The drives and the patios, outlines (x, y, ...). */
  drives: Pts[];
  patios: Pts[];
  /** Where a car's parked on a drive (nose in), and how likely one's there. */
  spaces: { x: number; y: number; angle: number; length: number; taken: number; endOn: boolean }[];
}

/** Which buildings are houses, by OSM's `building=*`. */
const HOUSES: ReadonlySet<string> = new Set(['house', 'terrace', 'semidetached_house', 'detached', 'bungalow', 'residential']);
/** An untagged building (`building=yes`) is taken for a house if it's where people live and no bigger than this, px². */
const SMALL_HOUSE = 220 * M * M;
/** The streets a house faces (not a service road, a lane at the back, or a path). */
const FRONTS: ReadonlySet<Road['kind']> = new Set(['street', 'tertiary', 'secondary', 'primary', 'trunk']);
/** How far a house looks for the street it faces, and how deep its gardens can be, front and back, px. */
const FACING = 45 * M;
const FRONT_MOST = 12 * M;
const BACK_MOST = 25 * M;
/** The least a garden has to be, front and back, px, to be one. */
const FRONT_LEAST = 1.2 * M;
const BACK_LEAST = 2.5 * M;
/** What a garden doesn't reach into (where it's mapped). */
const NOT_GARDEN: ReadonlySet<Area['kind']> = new Set(['water', 'pool', 'parking', 'plaza', 'pitch', 'play', 'forecourt', 'yard', 'platform', 'pier', 'pontoon', 'slipway', 'dirt', 'brownfield', 'island']);
/** The pavement beside a road, px (as drawn: see ground.ts). */
const PAVEMENT = 2.4 * M;
/** A grid's squares, px. */
const CELL = 16 * M;
const STEP = 1 * M;

const cache = new WeakMap<GameMap, Homes>();

/** What's been laid out for a map elsewhere (in the layout worker: see layout.ts), taken as worked out here. */
export function primeHomes(map: GameMap, value: Homes): void {
  cache.set(map, value);
}

/** The gardens of the houses on a map (worked out once for each), a little at a time (see work.ts). */
export function* homesWork(map: GameMap): Work<Homes> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(60);
  const out: Homes = { plots: [], things: [], lines: [], drives: [], patios: [], spaces: [] };
  const key = (i: number, j: number) => i * 100003 + j;
  // The buildings, roads and areas, by the squares they're in.
  const buildings = new Map<number, number[]>();
  const add = <T>(grid: Map<number, T[]>, item: T, x0: number, y0: number, x1: number, y1: number) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
        const k = key(i, j);
        const list = grid.get(k);
        if (list) list.push(item);
        else grid.set(k, [item]);
      }
    }
  };
  const all = map.buildings ?? [];
  const boxes = all.map((b) => bounds(b.rings[0]));
  all.forEach((b, i) => {
    if (b.solid && !b.bottom) add(buildings, i, ...boxes[i]);
  });
  // (Each road a piece at a time: its segments, with how far either side of its middle it reaches, pavement and all.)
  interface Seg {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    reach: number;
    road: number;
  }
  const segs = new Map<number, Seg[]>();
  (map.roads ?? []).forEach((r, road) => {
    if (r.tunnel || r.bridge) return;
    const reach = r.width / 2 + (r.pavement ? PAVEMENT : 0);
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const s = { ax: r.pts[k], ay: r.pts[k + 1], bx: r.pts[k + 2], by: r.pts[k + 3], reach, road };
      add(segs, s, Math.min(s.ax, s.bx) - reach, Math.min(s.ay, s.by) - reach, Math.max(s.ax, s.bx) + reach, Math.max(s.ay, s.by) + reach);
    }
  });
  const areas = new Map<number, Area[]>();
  const lived = new Map<number, Area[]>();
  for (const a of map.areas ?? []) {
    if (NOT_GARDEN.has(a.kind)) add(areas, a, ...bounds(a.rings[0]));
    if (a.kind === 'gardens') add(lived, a, ...bounds(a.rings[0]));
  }
  yield;
  const inArea = (grid: Map<number, Area[]>, x: number, y: number) => {
    for (const a of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) if (a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0))) return true;
    return false;
  };
  const inBuilding = (x: number, y: number, but: number): number => {
    for (const i of buildings.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      if (i === but) continue;
      const [x0, y0, x1, y1] = boxes[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (pointInRing(x, y, map.buildings[i].rings[0])) return i;
    }
    return -1;
  };
  // On a road or a path (or its pavement), and which.
  const onWay = (x: number, y: number, fronts: boolean): number => {
    for (const s of segs.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      if (fronts && !FRONTS.has(map.roads[s.road].kind)) continue;
      if (distToSeg(x, y, s.ax, s.ay, s.bx, s.by) < s.reach) return s.road;
    }
    return -1;
  };
  // The nearest street, and the nearest point on it.
  const street = (x: number, y: number): { x: number; y: number; road: number } | null => {
    let best: { x: number; y: number; road: number; d: number } | null = null;
    for (let i = Math.floor((x - FACING) / CELL); i <= Math.floor((x + FACING) / CELL); i++) {
      for (let j = Math.floor((y - FACING) / CELL); j <= Math.floor((y + FACING) / CELL); j++) {
        for (const s of segs.get(key(i, j)) ?? []) {
          if (!FRONTS.has(map.roads[s.road].kind)) continue;
          const [px, py] = nearestOnSeg(x, y, s.ax, s.ay, s.bx, s.by);
          const d = Math.hypot(px - x, py - y);
          if (d < FACING && (!best || d < best.d)) best = { x: px, y: py, road: s.road, d };
        }
      }
    }
    return best;
  };

  const houses: number[] = [];
  all.forEach((b, i) => {
    if (!b.solid || b.bottom || !b.drawn) return;
    if (HOUSES.has(b.kind)) houses.push(i);
    else if (b.kind === 'yes') {
      const [x0, y0, x1, y1] = boxes[i];
      const area = Math.abs(ringArea(b.rings[0]));
      if (area <= SMALL_HOUSE && area > 25 * M * M && inArea(lived, (x0 + x1) / 2, (y0 + y1) / 2)) houses.push(i);
    }
  });
  // The ones whose back gardens meet, back to back: the back fence is put up once, by the one with the lower id.
  const fencedBack = new Set<string>();

  for (const i of houses) {
    if (pause()) yield;
    const b = map.buildings[i];
    const ring = b.rings[0];
    const c = middle(ring);
    const near = street(c.x, c.y);
    if (!near) continue;
    // Which way it faces: the one of its sides' four ways that's most towards the street.
    const { ux, uy } = ridgeAxis(ring);
    const [nx, ny] = unit(near.x - c.x, near.y - c.y);
    let [fx, fy] = [ux, uy];
    for (const [ax, ay] of [[ux, uy], [-ux, -uy], [-uy, ux], [uy, -ux]]) if (ax * nx + ay * ny > fx * nx + fy * ny) [fx, fy] = [ax, ay];
    // (Turned well away from the street, it's not facing it: no garden made out for it.)
    if (fx * nx + fy * ny < 0.6) continue;
    const [sx, sy] = [fy, -fx];
    let [front, back, s0, s1] = [-Infinity, Infinity, Infinity, -Infinity];
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const [dx, dy] = [ring[k] - c.x, ring[k + 1] - c.y];
      const f = dx * fx + dy * fy;
      const s = dx * sx + dy * sy;
      [front, back, s0, s1] = [Math.max(front, f), Math.min(back, f), Math.min(s0, s), Math.max(s1, s)];
    }
    if (s1 - s0 < 3 * M) continue;
    const at = (s: number, f: number): [number, number] => [c.x + sx * s + fx * f, c.y + sy * s + fy * f];
    // How far it's clear out from a face, along it (the narrowest of three looks, across it), px; and what's there.
    const clear = (from: number, way: 1 | -1, most: number) => {
      let depth = most;
      let hit = -1;
      let building = false;
      for (const s of [s0 + 0.5 * M, (s0 + s1) / 2, s1 - 0.5 * M]) {
        for (let d = STEP; d < depth; d += STEP) {
          const [x, y] = at(s, from + way * d);
          const other = inBuilding(x, y, i);
          if (other >= 0) {
            // A shed or a garage in the garden isn't the end of it.
            const k = map.buildings[other].kind;
            if (k === 'shed' || k === 'garage' || k === 'garages') continue;
            depth = d;
            hit = other;
            building = true;
            break;
          }
          if (onWay(x, y, false) >= 0 || inArea(areas, x, y)) {
            depth = d;
            hit = -1;
            building = false;
            break;
          }
        }
      }
      return { depth, hit, building };
    };
    const ahead = clear(front, 1, FRONT_MOST);
    const behind = clear(back, -1, BACK_MOST * 2);
    // Back to back with another house: half way to it. Otherwise up to what's there, a little short.
    const frontDepth = ahead.building ? ahead.depth / 2 : ahead.depth - 0.3 * M;
    const backDepth = Math.min(BACK_MOST, behind.building ? behind.depth / 2 : behind.depth - 0.5 * M);
    const plot: Plot = { building: i, x: c.x, y: c.y, fx, fy, sx, sy, front, back, s0, s1, frontDepth: frontDepth >= FRONT_LEAST ? frontDepth : 0, backDepth: backDepth >= BACK_LEAST ? backDepth : 0 };
    if (!plot.frontDepth && !plot.backDepth) continue;
    out.plots.push(plot);
    const rand = seeded(hash(Math.round(c.x), Math.round(c.y)));
    // The way the street's gardens are kept: the same down each street (by the street, and which side of it).
    const side = (near.x - c.x) * (map.roads[near.road].pts[2] - map.roads[near.road].pts[0]) - (near.y - c.y) * (map.roads[near.road].pts[3] - map.roads[near.road].pts[1]) > 0 ? 1 : 0;
    const style = seeded(near.road * 7919 + side * 104729 + 13)();
    const width = s1 - s0;
    const things: HomeThing[] = [];
    const taken: [number, number, number][] = [];
    // Something put down in the garden, at (s, f) from its middle, clear of what's there already (and of the house, and inside
    // the plot): or not, if there's no room.
    const put = (kind: HomeKind, s: number, f: number, turn: number, f0: number, f1: number, variant?: number): boolean => {
      const [len, wide] = HOME_SIZE[kind];
      const r = Math.max(len, wide) / 2;
      const along = Math.abs(Math.cos(turn)) * len / 2 + Math.abs(Math.sin(turn)) * wide / 2;
      const across = Math.abs(Math.sin(turn)) * len / 2 + Math.abs(Math.cos(turn)) * wide / 2;
      if (s - along < s0 + 0.2 * M || s + along > s1 - 0.2 * M || f - across < Math.min(f0, f1) + 0.2 * M || f + across > Math.max(f0, f1) - 0.2 * M) return false;
      if (taken.some(([ts, tf, tr]) => Math.hypot(ts - s, tf - f) < tr + r)) return false;
      const [x, y] = at(s, f);
      if (inBuilding(x, y, -1) >= 0) return false;
      taken.push([s, f, r]);
      // (Its angle, along the house's front, turned as asked.)
      things.push({ kind, x: r1(x), y: r1(y), angle: +(Math.atan2(sy, sx) + turn).toFixed(3), ...(variant === undefined ? {} : { variant }) });
      return true;
    };
    const line = (kind: GardenLine['kind'], height: number, a: [number, number], z: [number, number]) => {
      const [ax, ay] = at(...a);
      const [zx, zy] = at(...z);
      if (Math.hypot(zx - ax, zy - ay) < 0.8 * M) return;
      out.lines.push({ kind, pts: [r1(ax), r1(ay), r1(zx), r1(zy)], height });
    };

    if (plot.frontDepth) {
      const [f0, f1] = [front, front + plot.frontDepth];
      // The front wall (low brick), hedge or fence, along the pavement; a gap for the gate, and one for the drive.
      const kind: GardenLine['kind'] = style < 0.5 ? 'wall' : style < 0.75 ? 'hedge' : 'fence';
      const height = kind === 'wall' ? 0.9 * M : kind === 'hedge' ? 1.1 * M : 1 * M;
      const drive = plot.frontDepth >= 5 * M && width >= 5.5 * M && b.kind !== 'terrace' && rand() < 0.85;
      const driveAt = rand() < 0.5 ? s0 + 1.6 * M : s1 - 1.6 * M;
      const gateAt = drive ? (driveAt < (s0 + s1) / 2 ? s1 - 1.2 * M : s0 + 1.2 * M) : s0 + 1 * M + rand() * (width - 2 * M);
      const gaps = [[gateAt - 0.5 * M, gateAt + 0.5 * M], ...(drive ? [[driveAt - 1.5 * M, driveAt + 1.5 * M]] : [])].sort((p, q) => p[0] - q[0]);
      let from = s0;
      for (const [g0, g1] of gaps) {
        line(kind, height, [from, f1], [g0, f1]);
        from = g1;
      }
      line(kind, height, [from, f1], [s1, f1]);
      // Between it and the next door's (on its one side: next door's puts up the other).
      line(kind, height, [s0, front], [s0, f1]);
      if (drive) {
        const [a0, a1] = [driveAt - 1.5 * M, driveAt + 1.5 * M];
        out.drives.push([...at(a0, front), ...at(a1, front), ...at(a1, f1), ...at(a0, f1)].map(r1));
        // A car on it, nose in, more often than not.
        const [cx, cy] = at(driveAt, front + Math.min(plot.frontDepth, 6 * M) / 2 + 0.2 * M);
        if (plot.frontDepth >= 5.2 * M) out.spaces.push({ x: r1(cx), y: r1(cy), angle: +Math.atan2(-fy, -fx).toFixed(3), length: 4.6 * M, taken: 0.7, endOn: true });
        taken.push([driveAt, (f0 + f1) / 2, 0]);
        for (let f = front; f < f1; f += 1 * M) taken.push([driveAt, f, 1.5 * M]);
      }
      // The wheelie bins, by the front wall (and a recycling box); and now and then a pot or two.
      const bins = 1 + Math.floor(rand() * 3);
      const binsAt = gateAt < (s0 + s1) / 2 ? s1 - 0.6 * M : s0 + 0.6 * M;
      for (let k = 0; k < bins; k++) put('wheelie', binsAt + (binsAt > gateAt ? -1 : 1) * k * 0.75 * M, f1 - 0.65 * M, Math.PI / 2, f0, f1, Math.floor(rand() * WHEELIE_COLOURS));
      if (rand() < 0.5) put('recyclebox', binsAt + (binsAt > gateAt ? -1 : 1) * bins * 0.75 * M, f1 - 0.55 * M, 0, f0, f1);
      if (rand() < 0.4) put('plantpot', gateAt + (rand() < 0.5 ? -0.9 : 0.9) * M, front + 0.5 * M, 0, f0, f1);
    }

    if (plot.backDepth) {
      const [f0, f1] = [back - plot.backDepth, back];
      // The fences between the gardens (on its one side; on the other too where there's no house next door), and along the back.
      const fence = style < 0.8 ? 'fence' : style < 0.95 ? 'hedge' : 'wall';
      const height = fence === 'hedge' ? 2 * M : 1.8 * M;
      line(fence, height, [s0, back], [s0, f0]);
      const [ex, ey] = at(s1 + 0.6 * M, (back + front) / 2);
      if (inBuilding(ex, ey, i) < 0) line(fence, height, [s1, back], [s1, f0]);
      const pair = behind.building ? `${Math.min(i, behind.hit)}/${Math.max(i, behind.hit)}` : '';
      if (!behind.building || !fencedBack.has(pair)) {
        line(fence, height, [s0, f0], [s1, f0]);
        if (pair) fencedBack.add(pair);
      }
      // A patio, along the back of the house, in a garden deep enough for it; its table and chairs on it.
      const deep = plot.backDepth;
      if (deep >= 6 * M && rand() < 0.75) {
        const p = Math.min(3 * M, deep * 0.3);
        out.patios.push([...at(s0, back), ...at(s1, back), ...at(s1, back - p), ...at(s0, back - p)].map(r1));
        if (rand() < 0.6) put('gardenset', s0 + width * (0.3 + rand() * 0.4), back - p / 2, 0, f0, f1);
        if (rand() < 0.35) put('bbq', s0 + 0.8 * M + rand() * (width - 1.6 * M), back - p + 0.6 * M, 0, f0, f1);
      }
      // Down the garden: the shed at the far end; then whatever else (the deeper and wider, the more).
      if (deep >= 7 * M && rand() < 0.55) put('shed', rand() < 0.5 ? s0 + 1.4 * M : s1 - 1.4 * M, f0 + 1.2 * M, rand() < 0.5 ? 0 : Math.PI, f0, f1);
      const wants: [HomeKind, number][] = [
        ['washline', 0.45],
        ['trampoline', deep >= 9 * M && width >= 4.5 * M ? 0.25 : 0],
        ['greenhouse', deep >= 10 * M ? 0.15 : 0],
        ['playhouse', 0.1],
        ['paddling', 0.08],
        ['pushbike', 0.2],
        ['plantpot', 0.5],
        ['plantpot', 0.3],
      ];
      for (const [kind, chance] of wants) {
        if (rand() >= chance) continue;
        // A few tries, about the garden.
        for (let tries = 0; tries < 6; tries++) {
          const turn = kind === 'pushbike' ? Math.PI / 2 + (rand() - 0.5) * 0.6 : kind === 'greenhouse' || kind === 'playhouse' ? 0 : rand() * Math.PI;
          if (put(kind, s0 + rand() * width, f0 + rand() * deep, turn, f0, f1)) break;
        }
      }
    }
    out.things.push(...things);
  }
  cache.set(map, out);
  return out;
}

function bounds(pts: Pts): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < pts.length; k += 2) {
    x0 = Math.min(x0, pts[k]);
    y0 = Math.min(y0, pts[k + 1]);
    x1 = Math.max(x1, pts[k]);
    y1 = Math.max(y1, pts[k + 1]);
  }
  return [x0, y0, x1, y1];
}

/** The middle of an outline (its corners', averaged). */
function middle(pts: Pts): { x: number; y: number } {
  let [x, y] = [0, 0];
  const n = pts.length / 2;
  for (let k = 0; k + 1 < pts.length; k += 2) {
    x += pts[k];
    y += pts[k + 1];
  }
  return { x: x / n, y: y / n };
}

function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

function unit(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

function nearestOnSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}


function hash(x: number, y: number): number {
  return (Math.abs(Math.round(x * 7.31 + y * 13.17) * 2654435761) % 2147483646) + 1;
}

function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

