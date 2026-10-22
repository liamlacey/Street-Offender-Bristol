/**
 * Where the parking bays are: in the car parks, and along the streets where
 * OSM maps parking lanes. The same bays are painted on the ground (see
 * paint.ts) and have cars parked in them (see traffic.ts). Pure, so it's
 * tested.
 */

import { type Area, type GameMap, type Lane, type Pts, type Road, pointInRing, ridgeAxis } from '../map/osm';
import { lineLength, pointAlong, subPolyline } from './world';
import { footprints, onFootprints, streetLifeWork } from './streetLife';
import { rectsOverlap } from './playgrounds';
import { homesWork } from './homes';
import { placesWork } from './places';
import { type Work, drain } from './work.ts';

/** A car park's bays: how wide, how deep, and the aisle between rows, px. */
export const BAY_WIDTH = 2.5 * 8;
export const BAY_DEPTH = 5 * 8;
/** The grid the car parks' bays are found in, px. */
const LOT_CELL = 8 * 8;
/** How far from an emergency service's station the street's kept clear of cars just parked along it, px. */
const KEEP_CLEAR = 40 * 8;
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
  /** What's parked there, if it's always the one kind (a lorry at a loading bay). */
  kind?: string;
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
    // The bays laid so far (middle, which way, half deep, half wide): none laid over another (where aisles meet, or one bends).
    const laid: [number, number, number, number, number][] = [];
    for (const r of aisles) {
      const p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const [ax, ay, bx, by] = [p[k], p[k + 1], p[k + 2], p[k + 3]];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < BAY_WIDTH) continue;
        const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
        const [nx, ny] = [-uy, ux];
        for (const side of [-1, 1]) {
          // Each bay: from the line before it to the line at d, out from the aisle's edge.
          for (let d = BAY_WIDTH * 1.5; d <= len - BAY_WIDTH / 2; d += BAY_WIDTH) {
            const line = (at: number) => {
              const [px, py] = [ax + ux * at, ay + uy * at];
              const [sx, sy] = [px + nx * side * (r.width / 2), py + ny * side * (r.width / 2)];
              return [sx, sy, sx + nx * side * BAY_DEPTH, sy + ny * side * BAY_DEPTH];
            };
            const [a, b] = [line(d - BAY_WIDTH), line(d)];
            // Only bays that are in the car park (not out over its edge, or a building), and not out on another road.
            if (![a, b].every(([sx, sy, ex, ey]) => inside(sx, sy) && inside(ex, ey) && !onRoad(ex, ey, r) && !onRoad((sx + ex) / 2, (sy + ey) / 2, r))) continue;
            const [cx, cy] = [(a[0] + a[2] + b[0] + b[2]) / 4, (a[1] + a[3] + b[1] + b[3]) / 4];
            const angle = Math.atan2(ny * side, nx * side);
            const bay: [number, number, number, number, number] = [cx, cy, angle, BAY_DEPTH / 2 - 1, BAY_WIDTH / 2 - 1];
            if (laid.some((o) => Math.abs(o[0] - cx) < 2 * BAY_DEPTH && Math.abs(o[1] - cy) < 2 * BAY_DEPTH && rectsOverlap(o, bay))) continue;
            laid.push(bay);
            lines.push(...a, ...b);
            spaces.push({ x: cx, y: cy, angle, length: BAY_DEPTH, taken: CAR_PARK_TAKEN, endOn: true });
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
    const length = parallel ? PARALLEL_BAY : depth;
    // (Not round a bend so tight the bay would stick out into the road: its corners, a little in, all by the kerb.)
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    const [hl, hw] = [length / 2 - 0.5 * 8, (parallel ? depth : BAY_WIDTH) / 2 - 0.5 * 8];
    const out = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]].some(([a, b]) => distanceTo(cx + ca * a - sa * b, cy + sa * a + ca * b, r.pts) < kerb - depth - 0.3 * 8);
    if (!out) spaces.push({ x: cx, y: cy, angle, length, taken, endOn: !parallel });
  }
  return { lines, spaces, edge, start, end };
}

/** Whether a point along a street is at a bus stop (its box is kept clear: no bays painted there, and no one parks). */
export function atBusStop(map: GameMap, x: number, y: number): boolean {
  return (map.paint ?? []).some((m) => m.kind === 'busstop' && Math.hypot(m.x - x, m.y - y) < m.width / 2 + 2 * 8);
}

/** A big shop's car park (see stores.ts): its index in the map's stores, or -1. */
export function storeOf(map: GameMap, a: Area): number {
  const ring = a.rings[0];
  return (map.stores ?? []).findIndex((st) => st.park.length === ring.length && Math.abs(st.park[0] - ring[0]) < 0.5 && Math.abs(st.park[1] - ring[1]) < 0.5);
}

/** A big shop's car park: one bay given over to a trolley shelter for every 25 or so (2 to 8), spread out over it, not by the door. */
const SPACES_PER_SHELTER = 25;
const SHELTERS_MOST = 8;

/** Which of a big shop's car park's bays are trolley shelters (no one parks in them), spread as far from each other and the door as they'll go. */
export function shelterSpaces(map: GameMap, store: number, spaces: Space[]): Space[] {
  const st = map.stores?.[store];
  if (!st || !spaces.length) return [];
  const want = Math.max(2, Math.min(SHELTERS_MOST, Math.round(spaces.length / SPACES_PER_SHELTER)));
  const taken: [number, number][] = [[st.door[0], st.door[1]]];
  const out: Space[] = [];
  while (out.length < want) {
    let best: Space | null = null;
    let far = 12 * 8;
    for (const s of spaces) {
      if (out.includes(s)) continue;
      const d = Math.min(...taken.map(([x, y]) => Math.hypot(s.x - x, s.y - y)));
      if (d > far) [best, far] = [s, d];
    }
    if (!best) break;
    out.push(best);
    taken.push([best.x, best.y]);
  }
  return out;
}

/** A row of trolleys: where the first stands, which way the row runs (each faces back along it, nested), how many it holds. */
export type TrolleyRow = [number, number, number, number];

/**
 * Each big shop's trolley rows: its bay by the door (see stores.ts), then
 * its shelters' (two rows in each, along the bay, filling towards its open
 * end, the aisle).
 */
export function trolleyRows(map: GameMap): TrolleyRow[][] {
  const rows: TrolleyRow[][] = (map.stores ?? []).map((st) => [st.bay]);
  for (const a of map.areas) {
    if (a.kind !== 'parking') continue;
    const k = storeOf(map, a);
    if (k < 0) continue;
    const { spaces } = carParkBays(map, a);
    for (const s of shelterSpaces(map, k, spaces)) {
      const [ux, uy] = [Math.cos(s.angle), Math.sin(s.angle)];
      // Its open end: the one with no bay beyond it.
      const beyond = (e: number) => spaces.filter((o) => Math.hypot(o.x - s.x - ux * e * s.length, o.y - s.y - uy * e * s.length) < BAY_WIDTH).length;
      const g = beyond(-1) <= beyond(1) ? -1 : 1;
      const [gx, gy] = [ux * g, uy * g];
      const start = s.length / 2 - 0.6 * 8;
      const count = Math.floor((s.length - 1.2 * 8) / (0.4 * 8)) + 1;
      for (const side of [-1, 1]) {
        const [ox, oy] = [-gy * side * 0.45 * 8, gx * side * 0.45 * 8];
        rows[k].push([Math.round((s.x - gx * start + ox) * 10) / 10, Math.round((s.y - gy * start + oy) * 10) / 10, +Math.atan2(gy, gx).toFixed(3), count]);
      }
    }
  }
  return rows;
}

/** Every bay on the map. */
export function parkingSpaces(map: GameMap): Space[] {
  return drain(parkingWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* parkingWork(map: GameMap): Work<Space[]> {
  const out: Space[] = [];
  // (None where a market's stalls are, nor a food cart, a performer and their crowd, the pigeons, an A-board: see streetLife.ts.)
  const taken = footprints(yield* streetLifeWork(map));
  const free = (s: Space) => !onFootprints(taken, s.x, s.y, s.angle, s.length / 2, s.endOn ? BAY_WIDTH / 2 : 1 * 8);
  for (const a of map.areas) {
    if (a.kind !== 'parking') continue;
    const { spaces } = carParkBays(map, a);
    // (Not the trolley shelters.)
    const store = storeOf(map, a);
    const shelters = store < 0 ? [] : shelterSpaces(map, store, spaces);
    out.push(...spaces.filter((s) => !shelters.includes(s) && free(s)));
    yield;
  }
  // (Not along the kerb where a car park's bays come right up to it; nor one over another, round a tight bend or a corner.)
  const lots = new Map<number, Space[]>();
  const cell = (x: number, y: number) => Math.floor(x / LOT_CELL) * 100003 + Math.floor(y / LOT_CELL);
  const keep = (s: Space) => {
    const k = cell(s.x, s.y);
    if (!lots.has(k)) lots.set(k, []);
    lots.get(k)!.push(s);
  };
  for (const s of out) keep(s);
  const box = (s: Space): [number, number, number, number, number] => [s.x, s.y, s.angle, s.length / 2 - 1, (s.endOn ? BAY_WIDTH : 2 * 8) / 2 - 1];
  const clearOfLots = (b: Space) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of lots.get(cell(b.x + i * LOT_CELL, b.y + j * LOT_CELL)) ?? []) if (Math.hypot(s.x - b.x, s.y - b.y) < BAY_DEPTH && rectsOverlap(box(s), box(b))) return false;
    return true;
  };
  // The drives in front of people's houses (see homes.ts); at the places (see places.ts), a lorry backed up to a loading bay, a car
  // at a lock-up garage. (Not over a car park's bays, nor each other.)
  for (const s of [...(yield* homesWork(map)).spaces, ...(yield* placesWork(map)).spaces]) {
    if (!free(s) || !clearOfLots(s)) continue;
    keep(s);
    out.push({ ...s });
  }
  for (const r of map.roads) {
    if (r.lanes?.some((l) => l.kind === 'parking')) yield;
    for (const lane of r.lanes ?? []) {
      if (lane.kind !== 'parking') continue;
      const s = r.laneSpans ?? [];
      for (let k = 0; k + 1 < s.length; k += 2) {
        for (const b of streetBays(r, lane, s[k], s[k + 1]).spaces) {
          if (atBusStop(map, b.x, b.y) || !free(b) || !clearOfLots(b)) continue;
          // (No one just parks outside a fire, police or ambulance station: the road's kept clear.)
          if (lane.unmarked && (map.services ?? []).some((v) => Math.hypot(v.x - b.x, v.y - b.y) < KEEP_CLEAR)) continue;
          keep(b);
          out.push(b);
        }
      }
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
