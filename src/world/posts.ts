/**
 * Where the emergency services' vehicles park: along the kerb of the roads
 * beside a police station, fire station or hospital (see Service), up on the
 * pavement a little, as they do. Pure, so it's tested.
 */

import type { GameMap, Pts, Service } from '../map/osm';
import { pointAlong } from './world';

const M = 8;

/** A kerbside place one parks: along which lane (and how far, its middle), how far over to the left of the lane's middle, px; where, and which way it faces; who's in it. */
export interface Kerbside<L extends KerbLane = KerbLane> {
  lane: L;
  s: number;
  off: number;
  x: number;
  y: number;
  angle: number;
  taken: number | null;
}

/** As much of a lane as this needs (see traffic.ts's Lane). */
export interface KerbLane {
  id: number;
  road: number;
  pts: Pts;
  length: number;
  /** The kerb lane (0), or one further out, of how many its way; the stop lines along it (px along). */
  index: number;
  count: number;
  stops: { s: number }[];
}

/**
 * How far into the road a parked one's side is (the rest of it's up on the
 * pavement), px; but always at least ROOM from the lane's middle, so a car
 * gets by (a narrow lane: further up on the pavement).
 */
export const IN_ROAD = 0.7 * M;
export const ROOM = 1.15 * M;
/**
 * How near the building (or its grounds' edge) the kerb is, at most (or, if
 * there's nowhere that near, FARTHER); how far from the junctions (the lanes'
 * ends), and the crossings, bus stops and the lights, at least, px.
 */
const NEAR = 25 * M;
const FARTHER = 45 * M;
const ENDS = 3 * M;
const CLEAR = 9 * M;

/**
 * The places by a service's buildings for its vehicles (`length` by `width`
 * px): along the kerb lanes given (those that may be parked along), facing
 * on along them, where the kerb's within NEAR of a building (on that side),
 * clear of the junctions, crossings, bus stops, the lights, the bays already
 * there (`avoid`) and the others' places (`others`); nearest the building
 * first, at most `most` of them.
 */
export function kerbsides<L extends KerbLane>(map: Pick<GameMap, 'roads' | 'crossings' | 'paint'>, lanes: L[], service: Service, length: number, width: number, avoid: { x: number; y: number }[], others: Kerbside<L>[], most: number): Kerbside<L>[] {
  const near = places(map, lanes, service, length, width, avoid, others, NEAR);
  return (near.length ? near : places(map, lanes, service, length, width, avoid, others, FARTHER))
    .sort((a, b) => a.d - b.d)
    .slice(0, most)
    .map((f) => f.spot);
}

function places<L extends KerbLane>(map: Pick<GameMap, 'roads' | 'crossings' | 'paint'>, lanes: L[], service: Service, length: number, width: number, avoid: { x: number; y: number }[], others: Kerbside<L>[], reach: number): { spot: Kerbside<L>; d: number }[] {
  const [x0, y0, x1, y1] = bounds(service.rings);
  const found: { spot: Kerbside<L>; d: number }[] = [];
  const crossings = map.crossings.filter((c) => c.x > x0 - 80 * M && c.x < x1 + 80 * M && c.y > y0 - 80 * M && c.y < y1 + 80 * M);
  const stops = (map.paint ?? []).filter((p) => p.kind === 'busstop' && p.x > x0 - 80 * M && p.x < x1 + 80 * M && p.y > y0 - 80 * M && p.y < y1 + 80 * M);
  for (const lane of lanes) {
    const road = map.roads[lane.road];
    // Along the kerb on its left (the kerb lane); on a one-way street, on its right too (the lane furthest out).
    const sides = [...(lane.index === 0 ? [1] : []), ...(road.oneway && lane.index === lane.count - 1 ? [-1] : [])];
    if (!sides.length || lane.length < length + 2 * ENDS) continue;
    if (!lane.pts.some((v, k) => (k % 2 ? v > y0 - reach - 20 * M && v < y1 + reach + 20 * M : v > x0 - reach - 20 * M && v < x1 + reach + 20 * M))) continue;
    for (const side of sides) {
      const placed: number[] = [];
      for (let s = ENDS + length / 2; s <= lane.length - ENDS - length / 2; s += M) {
        if (lane.stops.some((st) => Math.abs(st.s - s) < CLEAR + length / 2)) continue;
        if (placed.some((t) => Math.abs(t - s) < length + 1.5 * M)) continue;
        const [x, y, ux, uy] = pointAlong(lane.pts, s);
        // The kerb, that side (y down: the left of (ux, uy) is (uy, -ux)): from the road's middle, its half width.
        const [lx, ly] = [uy * side, -ux * side];
        const centre = distToLine(road.pts, x, y);
        // (Which side of the road's middle the lane is: the kerb's nearer on that side.)
        const toward = distToLine(road.pts, x + lx, y + ly) < centre ? -1 : 1;
        const kerb = road.width / 2 - centre * toward;
        if (kerb < width / 2) continue;
        const [kx, ky] = [x + lx * kerb, y + ly * kerb];
        // The building's on that side, near the kerb.
        const d = distToRings(service.rings, kx, ky);
        if (d > reach || d >= distToRings(service.rings, x - lx * kerb, y - ly * kerb)) continue;
        const off = Math.max(kerb - IN_ROAD, ROOM) + width / 2;
        const [px, py] = [x + lx * off, y + ly * off];
        // (Where the lane runs straight past it: on a bend, its ends would be out in the lane.)
        const h = length / 2 - width / 2;
        let bent = false;
        for (let t = -length / 2; t <= length / 2 && !bent; t += M) {
          const [qx, qy] = pointAlong(lane.pts, s + t);
          bent = distToSegment(px - ux * h, py - uy * h, px + ux * h, py + uy * h, qx, qy) < ROOM + width / 2 - 0.15 * M;
        }
        if (bent) continue;
        if (crossings.some((c) => Math.hypot(c.x - px, c.y - py) < CLEAR + length / 2)) continue;
        if (stops.some((p) => Math.hypot(p.x - px, p.y - py) < CLEAR + p.width / 2 + length / 2)) continue;
        if (avoid.some((a) => Math.hypot(a.x - px, a.y - py) < length)) continue;
        if ([...others, ...found.map((f) => f.spot)].some((o) => Math.hypot(o.x - px, o.y - py) < length + 1.5 * M)) continue;
        placed.push(s);
        found.push({ spot: { lane, s, off: off * side, x: px, y: py, angle: Math.atan2(uy, ux), taken: null }, d });
      }
    }
  }
  return found;
}

function bounds(rings: Pts[]): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (let k = 0; k + 1 < r.length; k += 2) b = [Math.min(b[0], r[k]), Math.min(b[1], r[k + 1]), Math.max(b[2], r[k]), Math.max(b[3], r[k + 1])];
  return b;
}

/** How far a point is from a line, px. */
function distToLine(pts: Pts, x: number, y: number): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) best = Math.min(best, distToSegment(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], x, y));
  return best;
}

/** How far a point is from the nearest of some outlines, px (0 inside one). */
function distToRings(rings: Pts[], x: number, y: number): number {
  let best = Infinity;
  for (const r of rings) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
      best = Math.min(best, distToSegment(r[j], r[j + 1], r[i], r[i + 1], x, y));
    }
    if (inside) return 0;
  }
  return best;
}

function distToSegment(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
  return Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
}
