/**
 * Where the parking bays are: in the car parks, and along the streets where
 * OSM maps parking lanes. The same bays are painted on the ground (see
 * paint.ts) and have cars parked in them (see traffic.ts). Pure, so it's
 * tested.
 */

import { type Area, type GameMap, type Lane, type Pts, type Road, pointInRing, ridgeAxis } from '../map/osm';
import { lineLength, pointAlong, subPolyline } from './world';
import { type Work, drain } from './work';

/** A car park's bays: how wide, how deep, and the aisle between rows, px. */
export const BAY_WIDTH = 2.5 * 8;
export const BAY_DEPTH = 5 * 8;
export const BAY_AISLE = 6 * 8;
/** Bays along a street stop short of its ends (the junctions), px; parallel ones are this long. */
export const BAYS_FROM_END = 8 * 8;
const PARALLEL_BAY = 6 * 8;

/** A bay a car can park in: its middle, which way a car in it points, how long it is, how likely it's taken; parked end on (either way round). */
export interface Space {
  x: number;
  y: number;
  angle: number;
  length: number;
  taken: number;
  endOn: boolean;
}

/** The bays' lines (x0, y0, x1, y1, ...) and the bays between them. */
export interface Bays {
  lines: number[];
  spaces: Space[];
}

/** How likely a bay's taken: a car park's, and a street's (more, the busier the street). */
const CAR_PARK_TAKEN = 0.65;
const streetTaken = (r: Road) => Math.min(0.92, 0.55 + (r.activity ?? 0) * 0.012);

/**
 * A car park's bays: along both sides of each aisle mapped through it
 * (`service=parking_aisle`), a line every 2.5 m out 5 m from the aisle's
 * edge; or, where none's mapped, in double rows with 6 m aisles between,
 * lined up with its longest side. Kept inside its outline, and off the roads
 * through it.
 */
const boxes = new WeakMap<Road, [number, number, number, number]>();

/** A road's bounding box (worked out once). */
function boxOf(r: Road): [number, number, number, number] {
  let b = boxes.get(r);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < r.pts.length; k += 2) b = [Math.min(b[0], r.pts[k]), Math.min(b[1], r.pts[k + 1]), Math.max(b[2], r.pts[k]), Math.max(b[3], r.pts[k + 1])];
    boxes.set(r, b);
  }
  return b;
}

export function carParkBays(map: GameMap, a: Area): Bays {
  const lines: number[] = [];
  const spaces: Space[] = [];
  const ring = a.rings[0];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && a.rings.every((r, i) => pointInRing(x, y, r) === (i === 0));
  // (Only the roads anywhere near it are looked at: a big map has thousands.)
  const nearby = map.roads.filter((r) => {
    const b = boxOf(r);
    return b[0] < x1 + 80 && b[2] > x0 - 80 && b[1] < y1 + 80 && b[3] > y0 - 80;
  });
  const aisles = nearby.filter((r) => r.aisle && r.pts.some((v, k) => k % 2 === 0 && inside(v, r.pts[k + 1])));
  // The roads through it (its aisles and any other): no bay's painted out onto one.
  const through = nearby.filter((r) => r.kind !== 'footway' && r.kind !== 'steps' && r.pts.some((v, k) => k % 2 === 0 && v > x0 - 80 && v < x1 + 80 && r.pts[k + 1] > y0 - 80 && r.pts[k + 1] < y1 + 80));
  const onRoad = (x: number, y: number, own: Road | null) => through.some((r) => r !== own && distanceTo(x, y, r.pts) < r.width / 2);
  if (aisles.length) {
    for (const r of aisles) {
      const p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const [ax, ay, bx, by] = [p[k], p[k + 1], p[k + 2], p[k + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < BAY_WIDTH) continue;
        const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
        const [nx, ny] = [-uy, ux];
        for (const side of [-1, 1]) {
          let last = -Infinity;
          for (let d = BAY_WIDTH / 2; d <= len - BAY_WIDTH / 2; d += BAY_WIDTH) {
            const [px, py] = [ax + ux * d, ay + uy * d];
            const [sx, sy] = [px + nx * side * (r.width / 2), py + ny * side * (r.width / 2)];
            const [ex, ey] = [sx + nx * side * BAY_DEPTH, sy + ny * side * BAY_DEPTH];
            // Only bays that are in the car park (not out over its edge, or a building), and not out on another road.
            if (!inside(ex, ey) || !inside(sx, sy) || onRoad(ex, ey, r) || onRoad((sx + ex) / 2, (sy + ey) / 2, r)) continue;
            lines.push(sx, sy, ex, ey);
            // A bay between this line and the last.
            if (d - last < BAY_WIDTH * 1.01) {
              const [cx, cy] = [sx + nx * side * (BAY_DEPTH / 2) - ux * (BAY_WIDTH / 2), sy + ny * side * (BAY_DEPTH / 2) - uy * (BAY_WIDTH / 2)];
              spaces.push({ x: cx, y: cy, angle: Math.atan2(ny * side, nx * side), length: BAY_DEPTH, taken: CAR_PARK_TAKEN, endOn: true });
            }
            last = d;
          }
        }
      }
    }
  } else {
    const { ux, uy } = ridgeAxis(ring);
    const [nx, ny] = [-uy, ux];
    let [lo, hi, ulo, uhi] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) {
      const [n, u] = [ring[k] * nx + ring[k + 1] * ny, ring[k] * ux + ring[k + 1] * uy];
      [lo, hi, ulo, uhi] = [Math.min(lo, n), Math.max(hi, n), Math.min(ulo, u), Math.max(uhi, u)];
    }
    const at = (u: number, n: number): [number, number] => [ux * u + nx * n, uy * u + ny * n];
    // Rows of bays across the car park: two back to back, then an aisle; a single row if that's all there's room for.
    for (let o = lo + 8; o + BAY_DEPTH <= hi - 8; o += 2 * BAY_DEPTH + BAY_AISLE) {
      const rows = o + 2 * BAY_DEPTH <= hi - 8 ? 2 : 1;
      let last = -Infinity;
      for (let u = ulo + BAY_WIDTH; u < uhi; u += BAY_WIDTH) {
        const [mx, my] = at(u, o + (rows * BAY_DEPTH) / 2);
        if (through.some((r) => distanceTo(mx, my, r.pts) < r.width / 2 + 4)) continue;
        lines.push(...at(u, o), ...at(u, o + rows * BAY_DEPTH));
        if (u - last < BAY_WIDTH * 1.01) {
          for (let row = 0; row < rows; row++) {
            const [cx, cy] = at(u - BAY_WIDTH / 2, o + BAY_DEPTH * (row + 0.5));
            // Painted over its edge (it's clipped to the car park): no car there.
            if (inside(cx, cy) && inside(...at(u - BAY_WIDTH / 2, o + BAY_DEPTH * row + 4)) && inside(...at(u - BAY_WIDTH / 2, o + BAY_DEPTH * (row + 1) - 4))) {
              spaces.push({ x: cx, y: cy, angle: Math.atan2(ny, nx), length: BAY_DEPTH, taken: CAR_PARK_TAKEN, endOn: true });
            }
          }
        }
        last = u;
      }
      if (rows === 2) lines.push(...at(ulo, o + BAY_DEPTH), ...at(uhi, o + BAY_DEPTH));
    }
  }
  return { lines, spaces };
}

/**
 * The bays of a parking lane along a street, between `from` and `to` px
 * along it: the lines across (from the kerb out), the outer edge of parallel
 * ones, and the bays between them.
 */
export function streetBays(r: Road, lane: Lane, from: number, to: number): Bays & { edge?: Pts; start: number; end: number } {
  const lines: number[] = [];
  const spaces: Space[] = [];
  const length = lineLength(r.pts);
  const start = Math.max(from, BAYS_FROM_END);
  const end = Math.min(to, length - BAYS_FROM_END);
  if (end - start < 6 * 8) return { lines, spaces, start, end };
  const kerb = r.width / 2;
  const depth = lane.width;
  const parallel = lane.bays === 'parallel';
  const step = parallel ? PARALLEL_BAY : BAY_WIDTH;
  const slant = lane.bays === 'diagonal' ? depth * 0.8 : 0;
  const taken = lane.loading ? 0.25 : streetTaken(r);
  let edge: Pts | undefined;
  if (parallel) edge = subPolyline(r.pts, start, end);
  for (let d = start; d <= end; d += step) {
    const [x, y, tx, ty] = pointAlong(r.pts, d);
    const [nx, ny] = [ty * lane.side, -tx * lane.side];
    const t = slant * lane.side;
    lines.push(x + nx * kerb, y + ny * kerb, x + nx * (kerb - depth) + tx * t, y + ny * (kerb - depth) + ty * t);
    if (d + step > end + 0.5) break;
    // The bay from here to the next line.
    const [mx, my, mtx, mty] = pointAlong(r.pts, d + step / 2);
    const [mnx, mny] = [mty * lane.side, -mtx * lane.side];
    const [cx, cy] = [mx + mnx * (kerb - depth / 2) + mtx * (t / 2), my + mny * (kerb - depth / 2) + mty * (t / 2)];
    // Parallel: facing the way the traffic on that side goes; end on or slanted: in from the road, along the lines.
    const angle = parallel ? Math.atan2(mty * lane.side, mtx * lane.side) : Math.atan2(mny * depth - mty * t, mnx * depth - mtx * t);
    spaces.push({ x: cx, y: cy, angle, length: parallel ? PARALLEL_BAY : depth, taken, endOn: !parallel });
  }
  return { lines, spaces, edge, start, end };
}

/** Whether a point along a street is at a bus stop (its box is kept clear: no bays painted there, and no one parks). */
export function atBusStop(map: GameMap, x: number, y: number): boolean {
  return (map.paint ?? []).some((m) => m.kind === 'busstop' && Math.hypot(m.x - x, m.y - y) < m.width / 2 + 2 * 8);
}

/** Every bay on the map. */
export function parkingSpaces(map: GameMap): Space[] {
  return drain(parkingWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* parkingWork(map: GameMap): Work<Space[]> {
  const out: Space[] = [];
  for (const a of map.areas) {
    if (a.kind !== 'parking') continue;
    out.push(...carParkBays(map, a).spaces);
    yield;
  }
  for (const r of map.roads) {
    if (r.lanes?.some((l) => l.kind === 'parking')) yield;
    for (const lane of r.lanes ?? []) {
      if (lane.kind !== 'parking') continue;
      const s = r.laneSpans ?? [];
      for (let k = 0; k + 1 < s.length; k += 2) out.push(...streetBays(r, lane, s[k], s[k + 1]).spaces.filter((b) => !atBusStop(map, b.x, b.y)));
    }
  }
  return out;
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
