/**
 * The big shops with car parks: supermarkets, DIY and hardware stores,
 * builders' merchants, garden centres, the units on the retail parks and the
 * like, next to a car park. Worked out from OSM when the map's made. Each has
 * its door on the side facing the car park, and a trolley bay along its wall
 * to one side of the door, where the trolleys are left (see people.ts, for
 * the shoppers pushing them).
 */

import type { Pts, Tags } from './osm.ts';
import { pointInRing } from './osm.ts';

/** The shops people push a trolley round (OSM's `shop=*`). */
export const TROLLEY_SHOPS: ReadonlySet<string> = new Set([
  'supermarket', 'doityourself', 'hardware', 'garden_centre', 'department_store', 'wholesale', 'trade', 'variety_store',
  'houseware', 'frozen_food', 'interior_decoration', 'pet', 'furniture', 'bed', 'baby_goods', 'catalogue', 'general', 'toys',
]);

/** What a shop sells, if it's one with trolleys (`shop=*`, or a building that's a supermarket); and any shop at all, on a retail park. */
export function trolleyShop(t: Tags, retailPark = false): string | null {
  if (t.shop && TROLLEY_SHOPS.has(t.shop)) return t.shop;
  if (t.building === 'supermarket') return 'supermarket';
  if (retailPark && t.shop && t.shop !== 'vacant' && t.shop !== 'no') return t.shop;
  return null;
}

/** A big shop next to a car park (see the top of this file). */
export interface Store {
  name?: string;
  /** What it sells (OSM's `shop`). */
  kind: string;
  /** Its door: where (just outside), and which way out, radians. */
  door: [number, number, number];
  /**
   * Its trolley bay: where the first trolley stands, which way the row runs
   * (and the trolleys face: nested, each in the one in front), how many it
   * holds.
   */
  bay: [number, number, number, number];
  /** The car park's outline. */
  park: Pts;
}

/** A shop (its building's outline) that might have trolleys. */
export interface StoreCandidate {
  kind: string;
  name?: string;
  ring: Pts;
}

/** Big enough to have trolleys: its floor, m². A car park big enough to count, m². */
export const STORE_SIZE = 400;
const PARK_SIZE = 300;
/** A car park this near it, m, on the side it faces. */
const PARK_REACH = 25;
/** Its side facing the car park: at least this long, m. */
const FRONT = 8;
/** The trolleys in a bay: how far apart (nested), how far out from the wall, m; and how many at most. */
export const TROLLEY_GAP = 0.4;
const BAY_OUT = 1.3;
const BAY_MOST = 12;

/**
 * Which of the candidates are next to a car park (`parks`, their outlines),
 * and where each's door and trolley bay are. `clear` says whether a point's
 * clear for a trolley to stand (not in a building, nor on a road). `m` is px
 * per metre.
 */
export function findStores(candidates: StoreCandidate[], parks: Pts[], clear: (x: number, y: number) => boolean, m: number): Store[] {
  const stores: Store[] = [];
  const big = parks.filter((p) => Math.abs(area(p)) >= PARK_SIZE * m * m).map((p) => ({ ring: p, box: box(p) }));
  for (const c of candidates) {
    const ring = c.ring;
    if (Math.abs(area(ring)) < STORE_SIZE * m * m) continue;
    const [x0, y0, x1, y1] = box(ring);
    const reach = PARK_REACH * m;
    const near = big.filter(({ box: b }) => b[0] < x1 + reach && b[2] > x0 - reach && b[1] < y1 + reach && b[3] > y0 - reach);
    if (!near.length) continue;
    const samples = outline(ring, m);
    let best: { park: Pts; from: number; to: number } | null = null;
    for (const { ring: park } of near) {
      // Each point along the walls: whether it faces this car park, close by.
      const facing = samples.map(([x, y, nx, ny]) => {
        if (pointInRing(x + nx * m, y + ny * m, park)) return true;
        const [px, py, d] = nearestOn(park, x, y);
        return d <= reach && ((px - x) * nx + (py - y) * ny) / (d || 1) > 0.3;
      });
      const run = longestRun(facing);
      if (run && run[1] - run[0] >= FRONT && (!best || run[1] - run[0] > best.to - best.from)) best = { park, from: run[0], to: run[1] };
    }
    if (!best) continue;
    const n = samples.length;
    const at = (k: number) => samples[((k % n) + n) % n];
    // The door: in the middle of that side, just outside.
    const mid = Math.round((best.from + best.to) / 2);
    const [dx, dy, dnx, dny] = at(mid);
    const door: [number, number, number] = [round(dx + dnx * m), round(dy + dny * m), +Math.atan2(dny, dnx).toFixed(3)];
    // The trolley bay: along the wall, from near one end of that side towards the door (stopping short of it), wherever there's room.
    let bay: Store['bay'] | null = null;
    for (const [end, dir] of [[best.from + 2, 1], [best.to - 2, -1]] as const) {
      const room = Math.min(BAY_MOST, Math.floor((Math.abs(mid - end) - 3) / TROLLEY_GAP));
      if (room < 4) continue;
      const [ex, ey, enx, eny] = at(end);
      const [tx, ty] = [at(end + dir)[0] - ex, at(end + dir)[1] - ey];
      const tl = Math.hypot(tx, ty) || 1;
      const [ux, uy] = [tx / tl, ty / tl];
      const [bx, by] = [ex + enx * BAY_OUT * m, ey + eny * BAY_OUT * m];
      let fits = 0;
      while (fits < room && clear(bx + ux * fits * TROLLEY_GAP * m, by + uy * fits * TROLLEY_GAP * m)) fits++;
      if (fits >= 4 && (!bay || fits > bay[3])) bay = [round(bx), round(by), +Math.atan2(uy, ux).toFixed(3), fits];
    }
    if (!bay || !clear(door[0], door[1])) continue;
    stores.push({ ...(c.name ? { name: c.name } : {}), kind: c.kind, door, bay, park: best.park.map(round) });
  }
  return stores;
}

const round = (v: number) => Math.round(v * 10) / 10;

function area(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

function box(pts: Pts): [number, number, number, number] {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < pts.length; k += 2) b = [Math.min(b[0], pts[k]), Math.min(b[1], pts[k + 1]), Math.max(b[2], pts[k]), Math.max(b[3], pts[k + 1])];
  return b;
}

/** Points every metre round a ring, each with the way out from the wall there: x, y, nx, ny. */
function outline(ring: Pts, m: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  // Which way's out: to the right of the way round, for a ring going round clockwise (with y down), else the left.
  const sign = area(ring) > 0 ? -1 : 1;
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[(i + 2) % n], ring[(i + 3) % n]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    for (let d = 0; d < len; d += m) out.push([ax + ux * d, ay + uy * d, -uy * sign, ux * sign]);
  }
  return out;
}

/** The nearest point on a ring's edge to (x, y), and how far. */
function nearestOn(ring: Pts, x: number, y: number): [number, number, number] {
  let best: [number, number, number] = [x, y, Infinity];
  const n = ring.length;
  for (let i = 0; i < n; i += 2) {
    const [ax, ay, bx, by] = [ring[i], ring[i + 1], ring[(i + 2) % n], ring[(i + 3) % n]];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2)) : 0;
    const [px, py] = [ax + (bx - ax) * t, ay + (by - ay) * t];
    const d = Math.hypot(px - x, py - y);
    if (d < best[2]) best = [px, py, d];
  }
  return best;
}

/** The longest run of trues round a ring of them (gaps of a couple bridged): its first and last, as indices (the last may run past the end, round). */
function longestRun(flags: boolean[]): [number, number] | null {
  const n = flags.length;
  const start = flags.indexOf(false);
  if (start < 0) return n ? [0, n - 1] : null;
  let best: [number, number] | null = null;
  let from = -1;
  let gap = 0;
  for (let k = 1; k <= n; k++) {
    const i = start + k;
    if (flags[i % n]) {
      if (from < 0) from = i;
      gap = 0;
      if (!best || i - from > best[1] - best[0]) best = [from, i];
    } else if (from >= 0 && ++gap > 2) [from, gap] = [-1, 0];
  }
  return best;
}
