/**
 * Streams and rivers for tracks in the woods. Each one crosses the road once,
 * square on (a ford for a stream, a bridge for a river), and wanders off
 * through the trees either side, never coming back near the road. Where it
 * can't go any further it ends in a pond, or it runs off the edge of the world.
 *
 * Pure geometry, so it can be tested; the scene draws and animates it.
 */

import { TYRE_RADIUS } from './barriers';
import { type Track, type TrackPosition, type Vec2, locateOnTrack, turnRadii } from './Track';

export type WaterKind = 'stream' | 'river';

export const WATER_WIDTH: Record<WaterKind, number> = { stream: 36, river: 78 };
/** Spacing of the points along a water course's centre line, px. */
export const WATER_STEP = 8;

export interface Water {
  kind: WaterKind;
  width: number;
  /** Centre line from one end to the other, WATER_STEP px apart. */
  path: Vec2[];
  /** Which way it flows along `path`. */
  flow: 1 | -1;
  /** Where it crosses the road. */
  crossing: {
    /** Distance along the track, px. */
    along: number;
    /** Index of the crossing in `path`. */
    pathIndex: number;
    /** Rivers are bridged; streams are forded. */
    bridge: boolean;
    /** It runs straight across the road for this far either side of the centre line, px. */
    reach: number;
  };
  /** Ponds at the ends that didn't reach the edge of the world. */
  ponds: { x: number; y: number; r: number }[];
}

export interface WaterOptions {
  streams: number;
  rivers: number;
  /** Grass between kerb and barrier on this track, px. */
  runOff: number;
  /** The world: water stops at its edge. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Stretches of track (distances along it) to keep crossings away from: the grid, obstacles. */
  avoid: [number, number][];
}

/** Track length between crossings, px. */
const CROSSING_GAP = 2200;
const WALK_STEP = 24;

export function planWater(track: Track, rng: () => number, options: WaterOptions): Water[] {
  const { runOff } = options;
  const n = track.points.length;
  const radii = turnRadii(track, 4);
  const barrierZone = runOff + TYRE_RADIUS * 2;
  /** Whether a point is beyond the barriers from every bit of road, with `extra` px to spare. */
  const clear = (x: number, y: number, extra: number) => {
    const pos = locateOnTrack(track, x, y);
    return pos.distance - pos.halfWidth - track.kerbWidth >= barrierZone + extra;
  };
  const inside = (p: Vec2) =>
    p.x > options.bounds.minX && p.x < options.bounds.maxX && p.y > options.bounds.minY && p.y < options.bounds.maxY;

  const candidates: number[] = [];
  for (let i = 0; i < n; i += 2) candidates.push(i);
  shuffle(candidates, rng);
  const chosen: number[] = [];
  const waters: Water[] = [];
  const wanted: WaterKind[] = [
    ...new Array<WaterKind>(options.rivers).fill('river'),
    ...new Array<WaterKind>(options.streams).fill('stream'),
  ];

  for (const kind of wanted) {
    const width = WATER_WIDTH[kind];
    for (const i of candidates) {
      const along = i * track.spacing;
      if (options.avoid.some(([a, b]) => along >= a && along <= b)) continue;
      if (chosen.some((c) => circularDistance(c * track.spacing, along, track.length) < CROSSING_GAP)) continue;
      const halfOuter = track.halfWidths[i] + track.kerbWidth;
      const reach = halfOuter + barrierZone + width / 2 + 15;
      // Straight road either side, so the water crosses it square on.
      const span = Math.ceil((width / 2 + 120) / track.spacing);
      let straight = true;
      for (let k = -span; k <= span && straight; k++) straight = radii[(i + k + n) % n] > 900;
      if (!straight) continue;
      const p = track.points[i];
      const nrm = track.normals[i];
      const across = (t: number): Vec2 => ({ x: p.x + nrm.x * t, y: p.y + nrm.y * t });
      // Nothing else (another bit of road) near the straight part either side.
      let open = true;
      for (const side of [1, -1]) {
        for (let t = halfOuter; t <= reach + width / 2 && open; t += 12) {
          const q = across(side * t);
          const other = locateOnTrack(track, q.x, q.y);
          if (other.distance - other.halfWidth < t - track.halfWidths[i] - 1) open = false;
        }
      }
      if (!open || !inside(across(reach)) || !inside(across(-reach))) continue;

      const heading = Math.atan2(nrm.y, nrm.x);
      const length = kind === 'river' ? 2000 + rng() * 2000 : 1100 + rng() * 1600;
      const out = walk(across(reach), heading, width, length * 0.5, rng, clear, inside);
      const back = walk(across(-reach), heading + Math.PI, width, length * 0.5, rng, clear, inside);
      const straightPart: Vec2[] = [];
      for (let t = -reach; t <= reach; t += WATER_STEP) straightPart.push(across(t));
      const path = resampleOpen([...back.points.slice(1).reverse(), ...straightPart, ...out.points.slice(1)], WATER_STEP);
      let pathIndex = 0;
      path.forEach((q, k) => {
        if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(path[pathIndex].x - p.x, path[pathIndex].y - p.y)) pathIndex = k;
      });
      chosen.push(i);
      waters.push({
        kind,
        width,
        path,
        flow: rng() < 0.5 ? 1 : -1,
        crossing: { along, pathIndex, bridge: kind === 'river', reach },
        ponds: [out.pond, back.pond].filter((pond): pond is Water['ponds'][number] => pond !== null),
      });
      break;
    }
  }
  return waters;
}

/**
 * Wanders from `start` roughly along `heading`, turning gently, steering away
 * from the road. Stops at the edge of the world, after `length` px, or where
 * it can't go on (then ends in a pond if there's room).
 */
function walk(
  start: Vec2,
  heading: number,
  width: number,
  length: number,
  rng: () => number,
  clear: (x: number, y: number, extra: number) => boolean,
  inside: (p: Vec2) => boolean,
): { points: Vec2[]; pond: { x: number; y: number; r: number } | null } {
  const points = [start];
  let angle = heading;
  let bend = 0;
  let cur = start;
  for (let travelled = 0; travelled < length; travelled += WALK_STEP) {
    bend = bend * 0.85 + (rng() - 0.5) * 0.22;
    let next: Vec2 | null = null;
    for (const tweak of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const a = angle + bend + tweak;
      const q = { x: cur.x + Math.cos(a) * WALK_STEP, y: cur.y + Math.sin(a) * WALK_STEP };
      if (clear(q.x, q.y, width / 2 + 15)) {
        angle = a;
        next = q;
        break;
      }
    }
    if (!next) break;
    points.push(next);
    cur = next;
    if (!inside(cur)) return { points, pond: null };
  }
  // Ended in the woods: a pond, if one fits.
  for (const r of [width * 1.4 + 30, width + 20]) {
    const c = { x: cur.x + Math.cos(angle) * r * 0.6, y: cur.y + Math.sin(angle) * r * 0.6 };
    if (inside(c) && clear(c.x, c.y, r + 10)) return { points, pond: { x: c.x, y: c.y, r } };
  }
  return { points, pond: null };
}

/** Points evenly spaced along an open polyline. */
function resampleOpen(poly: Vec2[], spacing: number): Vec2[] {
  const out: Vec2[] = [poly[0]];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = spacing - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  return out;
}

/**
 * What a car on the track is driving on where a water course crosses the
 * road: water, or the bridge's planks. Null if it's nowhere near one.
 */
export function crossingSurface(track: Track, waters: Water[], pos: TrackPosition): 'water' | 'bridge' | null {
  for (const w of waters) {
    const d = circularDistance(pos.along, w.crossing.along, track.length);
    if (pos.distance > w.crossing.reach) continue;
    if (w.crossing.bridge) {
      // The bridge deck runs a little either side of the water, kerb to kerb.
      if (d <= w.width / 2 + BRIDGE_OVERHANG && pos.distance <= pos.halfWidth + track.kerbWidth + 2) return 'bridge';
      if (d <= w.width / 2) return 'water';
    } else if (d <= w.width / 2) {
      return 'water';
    }
  }
  return null;
}

/** How far the bridge deck reaches past each bank, px. */
export const BRIDGE_OVERHANG = 14;

/** Whether a point is in (or within `extra` px of) any water. Uses a grid built once per set of waters. */
export function inWater(waters: Water[], x: number, y: number, extra = 0): boolean {
  const grid = waterGrid(waters);
  const cx = Math.floor(x / WATER_CELL);
  const cy = Math.floor(y / WATER_CELL);
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const p of grid.get(gx * 100_000 + gy) ?? []) {
        if (Math.hypot(p.x - x, p.y - y) <= p.r + extra) return true;
      }
    }
  }
  return false;
}

const WATER_CELL = 128;
const grids = new WeakMap<Water[], Map<number, { x: number; y: number; r: number }[]>>();

function waterGrid(waters: Water[]): Map<number, { x: number; y: number; r: number }[]> {
  const existing = grids.get(waters);
  if (existing) return existing;
  const grid = new Map<number, { x: number; y: number; r: number }[]>();
  const put = (x: number, y: number, r: number) => {
    // A disc goes in every cell it could reach a query from (queries look one cell around).
    const span = Math.ceil(r / WATER_CELL);
    for (let gx = Math.floor(x / WATER_CELL) - span + 1; gx <= Math.floor(x / WATER_CELL) + span - 1; gx++) {
      for (let gy = Math.floor(y / WATER_CELL) - span + 1; gy <= Math.floor(y / WATER_CELL) + span - 1; gy++) {
        const key = gx * 100_000 + gy;
        const list = grid.get(key);
        if (list) list.push({ x, y, r });
        else grid.set(key, [{ x, y, r }]);
      }
    }
  };
  for (const w of waters) {
    for (const p of w.path) put(p.x, p.y, w.width / 2);
    for (const pond of w.ponds) put(pond.x, pond.y, pond.r);
  }
  grids.set(waters, grid);
  return grid;
}

function circularDistance(a: number, b: number, length: number): number {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
}

function shuffle<T>(list: T[], rng: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}
