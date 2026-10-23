/**
 * Life in the parks (and on the playing fields): where there's a kick-about
 * or a game of frisbee on the open grass, where the ice-cream cart stands
 * by a path, and where the pigeons peck about. Worked out from the map, the
 * same every time (and in every region of it the park's in). Pure, so it's
 * tested; people.ts brings it to life, and the carts are loose things (see
 * world.ts).
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing } from '../map/osm';
import type { SportGame } from './sports';
import { type Work, drain, every } from './work.ts';

const M = 8;
/** A game for every this much of a park, px² (at most GAMES in one); a playing field always has one. */
const PER_GAME = 2500 * M * M;
const GAMES = 4;
/** How much open grass each game needs round it (a radius), px. */
const ROOM: Record<ParkGame, number> = { football: 7 * M, frisbee: 9 * M };
/** An ice-cream cart in a park this big, px²; a second in one ten times that. */
const CART_PARK = 4000 * M * M;
/** Pigeons in a park this big, px². */
const FLOCK_PARK = 3000 * M * M;

/** A park's game, or one on a pitch or a court (see sports.ts). */
export type ParkGame = 'football' | 'frisbee';
export type Game = ParkGame | SportGame;

export interface ParkLife {
  /** The games on the grass: where (their middle), which way they're played (a frisbee's thrown along it), which. */
  games: { x: number; y: number; angle: number; kind: ParkGame }[];
  /** The ice-cream carts, by a path: where, which way the serving side faces. */
  carts: { x: number; y: number; angle: number }[];
  /** Where the pigeons peck about. */
  flocks: { x: number; y: number }[];
}

const cache = new WeakMap<GameMap, ParkLife>();

/** The park life on a map (worked out once for each). */
export function parkLife(map: GameMap): ParkLife {
  return drain(parkLifeWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* parkLifeWork(map: GameMap): Work<ParkLife> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(4);
  const life: ParkLife = { games: [], carts: [], flocks: [] };
  const bounded = (pts: Pts, pad: number) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, pts[k]), Math.min(y0, pts[k + 1]), Math.max(x1, pts[k]), Math.max(y1, pts[k + 1])];
    return { pts, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const within = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  // (A pitch for a sport has its own game: see sports.ts.)
  const parks = (map.areas ?? []).filter((a) => a.kind === 'park' || (a.kind === 'pitch' && !a.sport));
  if (!parks.length) {
    cache.set(map, life);
    return life;
  }
  const solid = (map.buildings ?? []).filter((b) => !b.bottom).map((b) => bounded(b.rings[0], 3 * M));
  const roads = map.roads.filter((r) => !r.bridge && !r.tunnel).map((r) => ({ ...bounded(r.pts, r.width / 2 + 3 * M), reach: r.width / 2 + (VEHICLE_ROADS.has(r.kind) || r.kind === 'rail' ? 5 : 2) * M, path: r.kind === 'footway' || r.kind === 'cycleway' || r.kind === 'pedestrian' }));
  const others = (map.areas ?? []).filter((a) => a.kind !== 'park' && a.kind !== 'pitch' && a.kind !== 'grass').map((a) => bounded(a.rings[0], M));
  const trees: [number, number, number][] = [];
  for (let i = 0; i + 3 < (map.trees ?? []).length; i += 4) trees.push([map.trees[i], map.trees[i + 1], map.trees[i + 2]]);
  const seen = new Set<string>();
  for (const a of parks) {
    if (pause()) yield;
    const ring = a.rings[0];
    const name = `${ring[0]},${ring[1]},${ring.length}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const area = Math.abs(ringArea(ring));
    const box = bounded(ring, 0);
    const overlaps = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1;
    const near = { solid: solid.filter(overlaps), roads: roads.filter(overlaps), others: others.filter(overlaps), trees: trees.filter(([x, y, r]) => x > box.x0 - r && x < box.x1 + r && y > box.y0 - r && y < box.y1 + r) };
    const inside = (x: number, y: number) => a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0));
    /** Open grass: in the park, not by a building or a road or on a path, not in anything else (a playground, a pond), not under a tree. */
    const grass = (x: number, y: number) =>
      inside(x, y) &&
      !near.solid.some((b) => within(x, y, b) && (pointInRing(x, y, b.pts) || distanceTo(x, y, [...b.pts, b.pts[0], b.pts[1]]) < 3 * M)) &&
      !near.roads.some((r) => within(x, y, r) && distanceTo(x, y, r.pts) < r.reach) &&
      !near.others.some((b) => within(x, y, b) && pointInRing(x, y, b.pts)) &&
      !near.trees.some(([tx, ty, r]) => Math.hypot(tx - x, ty - y) < r + 1 * M);
    let seed = hash(ring[0], ring[1]) || 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // The games: on open grass, room all round.
    const want = a.kind === 'pitch' ? 1 : Math.min(GAMES, Math.floor(area / PER_GAME));
    for (let k = 0, tries = 0; k < want && tries < want * 40; tries++) {
      const kind: ParkGame = a.kind === 'pitch' || rand() < 0.55 ? 'football' : 'frisbee';
      const [x, y] = [box.x0 + rand() * (box.x1 - box.x0), box.y0 + rand() * (box.y1 - box.y0)];
      const room = ROOM[kind];
      const ring8 = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [x + Math.cos((i * Math.PI) / 4) * room, y + Math.sin((i * Math.PI) / 4) * room]);
      if (!grass(x, y) || !ring8.every(([px, py]) => grass(px, py))) continue;
      if (life.games.some((g) => Math.hypot(g.x - x, g.y - y) < ROOM[g.kind] + room)) continue;
      life.games.push({ x: r1(x), y: r1(y), angle: +(rand() * Math.PI).toFixed(3), kind });
      k++;
    }
    if (a.kind !== 'park') continue;
    // The ice-cream carts: by a path through the park, near its middle (and, in a big park, another well away from it).
    if (area >= CART_PARK) {
      const [cx, cy] = centroid(ring);
      const paths = near.roads.filter((r) => r.path);
      const spots: [number, number, number, number][] = [];
      for (const r of paths) {
        for (let i = 0; i + 3 < r.pts.length; i += 2) {
          const [ax, ay, bx, by] = [r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]];
          const len = Math.hypot(bx - ax, by - ay);
          for (let d = 0; d < len; d += 4 * M) {
            const [x, y] = [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len];
            if (inside(x, y)) spots.push([x, y, (bx - ax) / len, (by - ay) / len]);
          }
        }
      }
      spots.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
      const carts = area >= CART_PARK * 10 ? 2 : 1;
      let placed = 0;
      for (const [x, y, ux, uy] of spots) {
        if (placed >= carts) break;
        // To one side of the path, on the grass, its serving side to the path.
        for (const side of [1, -1]) {
          const [px, py] = [x - uy * side * 2.6 * M, y + ux * side * 2.6 * M];
          if (!inside(px, py) || near.solid.some((b) => within(px, py, b) && pointInRing(px, py, b.pts)) || near.others.some((b) => within(px, py, b) && pointInRing(px, py, b.pts))) continue;
          if (near.trees.some(([tx, ty]) => Math.hypot(tx - px, ty - py) < 1.5 * M)) continue;
          if (near.roads.some((r) => within(px, py, r) && distanceTo(px, py, r.pts) < 2 * M)) continue;
          if (life.carts.some((c) => Math.hypot(c.x - px, c.y - py) < 120 * M)) continue;
          life.carts.push({ x: r1(px), y: r1(py), angle: +Math.atan2(uy * side, -ux * side).toFixed(3) });
          placed++;
          break;
        }
      }
    }
    // The pigeons: on the grass near the middle (or anywhere open).
    if (area >= FLOCK_PARK) {
      const [cx, cy] = centroid(ring);
      for (let tries = 0; tries < 30; tries++) {
        const [x, y] = tries ? [box.x0 + rand() * (box.x1 - box.x0), box.y0 + rand() * (box.y1 - box.y0)] : [cx, cy];
        if (!grass(x, y) || life.games.some((g) => Math.hypot(g.x - x, g.y - y) < ROOM[g.kind] + 4 * M)) continue;
        life.flocks.push({ x: r1(x), y: r1(y) });
        break;
      }
    }
  }
  cache.set(map, life);
  return life;
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

function centroid(pts: Pts): [number, number] {
  let [x, y] = [0, 0];
  for (let i = 0; i + 1 < pts.length; i += 2) [x, y] = [x + pts[i], y + pts[i + 1]];
  return [x / (pts.length / 2), y / (pts.length / 2)];
}

function distanceTo(x: number, y: number, pts: Pts): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
  }
  return best;
}
