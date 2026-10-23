/**
 * The playgrounds (OSM's `leisure=playground`): what's in each, laid out
 * across it, clear of the buildings and roads and of each other: swings, a
 * slide, a roundabout, a climbing frame, a sandpit, a seesaw, spring riders.
 * Worked out from the map, the same every time (and in every region of it
 * the playground's in), so what's knocked about is the same thing. Pure, so
 * it's tested; each is a loose thing (see world.ts), and people play on them
 * (see people.ts).
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis } from '../map/osm';
import { type Work, drain, every } from './work.ts';
import { BoxGrid, distanceTo } from './geometry';

const M = 8;
/** Drawn bigger than life (as the people are), and so laid out: how much. */
export const PLAY_SCALE = 1.3;

export const PLAY_KINDS = ['swings', 'slide', 'roundabout', 'climbframe', 'sandpit', 'seesaw', 'springy'] as const;
export type PlayKind = (typeof PLAY_KINDS)[number];

/** What each takes up on the ground (along its angle, across it), px: with room round it to swing, or slide off the end. */
const S = PLAY_SCALE * M;
export const PLAY_SIZE: Record<PlayKind, [number, number]> = {
  swings: [4.4 * S, 3.6 * S],
  slide: [4.8 * S, 1.6 * S],
  roundabout: [3 * S, 3 * S],
  climbframe: [3 * S, 3 * S],
  sandpit: [3.2 * S, 3.2 * S],
  seesaw: [4 * S, 1.2 * S],
  springy: [1.4 * S, 1.4 * S],
};
/** In this order, as many as there's room for (a big playground has two of some). */
const ORDER: PlayKind[] = ['swings', 'slide', 'roundabout', 'climbframe', 'springy', 'sandpit', 'seesaw', 'springy', 'swings', 'climbframe'];
/** One for every this much of a playground, px², at most PLAY_MOST; none in one smaller than PLAY_LEAST. */
const PER = 40 * M * M;
const PLAY_MOST = 10;
const PLAY_LEAST = 20 * M * M;
/** This much clear between each, px. */
const APART = 1 * M;

export interface PlayThing {
  kind: PlayKind;
  x: number;
  y: number;
  angle: number;
}

const cache = new WeakMap<GameMap, PlayThing[]>();

/** What's been laid out for a map elsewhere (in the layout worker: see layout.ts), taken as worked out here. */
export function primePlaygrounds(map: GameMap, value: PlayThing[]): void {
  cache.set(map, value);
}

/** What's in the playgrounds on a map (worked out once for each). */
export function playgrounds(map: GameMap): PlayThing[] {
  return drain(playgroundsWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* playgroundsWork(map: GameMap): Work<PlayThing[]> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(4);
  const out: PlayThing[] = [];
  const bounded = (pts: Pts, pad: number) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, pts[k]), Math.min(y0, pts[k + 1]), Math.max(x1, pts[k]), Math.max(y1, pts[k + 1])];
    return { pts, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const within = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  const plays = (map.areas ?? []).filter((a) => a.kind === 'play');
  if (!plays.length) {
    cache.set(map, out);
    return out;
  }
  const solid = (map.buildings ?? []).filter((b) => !b.bottom).map((b) => bounded(b.rings[0], 0));
  const roads = map.roads.filter((r) => VEHICLE_ROADS.has(r.kind) || r.kind === 'rail').map((r) => ({ ...bounded(r.pts, r.width / 2 + M), reach: r.width / 2 + M }));
  const water = (map.areas ?? []).filter((a) => a.kind === 'water' || a.kind === 'pool').map((a) => bounded(a.rings[0], 0));
  // (Not on a tree's trunk; and out from under its crown, where there's room.)
  const trees: [number, number, number][] = [];
  for (let i = 0; i + 3 < (map.trees ?? []).length; i += 4) trees.push([map.trees[i], map.trees[i + 1], map.trees[i + 2]]);
  // (Each by where it is: each playground looks only at those round it.)
  const grids = { solid: new BoxGrid(solid), roads: new BoxGrid(roads), water: new BoxGrid(water), trees: new BoxGrid(trees.map(([x, y, r]) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, t: [x, y, r] as [number, number, number] }))) };
  yield;
  const seen = new Set<string>();
  for (const a of plays) {
    if (pause()) yield;
    const ring = a.rings[0];
    // (The same playground twice over: once.)
    const name = `${ring[0]},${ring[1]},${ring.length}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const area = Math.abs(ringArea(ring));
    if (area < PLAY_LEAST) continue;
    const box = bounded(ring, 0);
    const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1;
    const near = {
      solid: grids.solid.near(box.x0, box.y0, box.x1, box.y1, overlaps),
      roads: grids.roads.near(box.x0, box.y0, box.x1, box.y1, overlaps),
      water: grids.water.near(box.x0, box.y0, box.x1, box.y1, overlaps),
    };
    const nearTrees = grids.trees.near(box.x0, box.y0, box.x1, box.y1, ({ t: [x, y, r] }) => x > box.x0 - r && x < box.x1 + r && y > box.y0 - r && y < box.y1 + r).map((b) => b.t);
    const open = (x: number, y: number) =>
      !nearTrees.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 0.8 * M) &&
      a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0)) &&
      !near.solid.some((b) => within(x, y, b) && pointInRing(x, y, b.pts)) &&
      !near.water.some((b) => within(x, y, b) && pointInRing(x, y, b.pts)) &&
      !near.roads.some((r) => within(x, y, r) && distanceTo(x, y, r.pts) < r.reach);
    // Laid out square to the playground (along its longest side), on a grid a metre apart, tried in an order of its own.
    const { ux, uy } = ridgeAxis(ring);
    const angle = Math.atan2(uy, ux);
    const spots: [number, number, number][] = [];
    for (let x = box.x0 + M; x < box.x1 - M; x += M) for (let y = box.y0 + M; y < box.y1 - M; y += M) spots.push([x, y, hash(x, y)]);
    spots.sort((p, q) => p[2] - q[2]);
    const placed: { x: number; y: number; angle: number; hl: number; hw: number }[] = [];
    const want = Math.min(PLAY_MOST, Math.max(1, Math.floor(area / PER)));
    let tries = 0;
    const shaded = (x: number, y: number) => nearTrees.some(([tx, ty, r]) => Math.hypot(tx - x, ty - y) < r);
    // In the open first, then under the trees (the same for each thing put down: worked out once).
    const open1: [number, number, number][] = [];
    const under: [number, number, number][] = [];
    for (const [k, p] of spots.entries()) {
      (shaded(p[0], p[1]) ? under : open1).push(p);
      if (k % 400 === 399) yield;
    }
    yield;
    const order = [...open1, ...under];
    for (const kind of ORDER) {
      if (placed.length >= want) break;
      if (pause()) yield;
      const [len, wide] = PLAY_SIZE[kind];
      // Turned along the playground or across it, by where it is.
      for (const [x, y, h] of order) {
        if (++tries > 4000) break;
        if (tries % 150 === 0) yield;
        const turn = angle + (h % 2 ? Math.PI / 2 : 0) + (h % 4 >= 2 ? Math.PI : 0);
        const [hl, hw] = [len / 2, wide / 2];
        const [cx, cy] = [Math.cos(turn), Math.sin(turn)];
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]].map(([s, t]) => [x + cx * hl * s - cy * hw * t, y + cy * hl * s + cx * hw * t]);
        if (!corners.every(([px, py]) => open(px, py))) continue;
        if (placed.some((o) => rectsOverlap([x, y, turn, hl + APART / 2, hw + APART / 2], [o.x, o.y, o.angle, o.hl + APART / 2, o.hw + APART / 2]))) continue;
        placed.push({ x, y, angle: turn, hl, hw });
        out.push({ kind, x: r1(x), y: r1(y), angle: +turn.toFixed(3) });
        break;
      }
    }
  }
  cache.set(map, out);
  return out;
}

/** A number from where something is (the same for the same place). */
function hash(x: number, y: number): number {
  return Math.abs(Math.round(x * 7.31 + y * 13.17) * 2654435761) % 2147483647;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}


/** Whether two rectangles (x, y, angle, half along, half across) overlap (by their separating axes). */
export function rectsOverlap(a: [number, number, number, number, number], b: [number, number, number, number, number]): boolean {
  const axes = (r: typeof a) => [[Math.cos(r[2]), Math.sin(r[2])], [-Math.sin(r[2]), Math.cos(r[2])]];
  const reach = (r: typeof a, [ax, ay]: number[]) => {
    const [u, v] = axes(r);
    return r[3] * Math.abs(u[0] * ax + u[1] * ay) + r[4] * Math.abs(v[0] * ax + v[1] * ay);
  };
  for (const axis of [...axes(a), ...axes(b)]) {
    const d = Math.abs((b[0] - a[0]) * axis[0] + (b[1] - a[1]) * axis[1]);
    if (d > reach(a, axis) + reach(b, axis)) return false;
  }
  return true;
}
