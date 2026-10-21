/**
 * Life on the busy pedestrian streets and squares (those with plenty of
 * shops, cafés and the like along them): where the buskers and street
 * performers, the charity fundraisers and the Big Issue sellers have their
 * pitches, where the food carts stand, where the pigeons peck about, and the
 * shops' A-boards out in front; and the open-air markets' stalls. Worked out
 * from the map, the same every time (and in every region of it the street's
 * in), so a cart knocked about is the same cart. Pure, so it's tested;
 * people.ts brings it to life, and the carts, the stalls and the A-boards are
 * loose things (see world.ts).
 */

import { type GameMap, type Pts, VEHICLE_ROADS, pointInRing, ridgeAxis } from '../map/osm';
import { type Work, drain, every } from './work.ts';

const M = 8;
/** A pedestrian street is busy with this many shops and the like within 25 m of it per 100 m (Broadmead, East Street, Corn Street have 15 to 30). */
export const BUSY_STREET = 12;
const VENUE_REACH = 25 * M;
/** Along a busy street, something every this far (a pitch, a cart, a flock, or now and then nothing), px; and its first this far in. */
const EVERY = 28 * M;
const FIRST = 10 * M;
/** A busy square: at least this big, px², with at least this many shops and the like within 30 m; something for every 350 m² of it (at most 6). */
const SQUARE = 300 * M * M;
const SQUARE_VENUES = 4;
const PER_SQUARE = 350 * M * M;

/** The acts: playing the guitar, the violin, the drums; juggling; a living statue; and two charity fundraisers (with clipboards), and a Big Issue seller. */
export const ACTS = ['guitar', 'violin', 'drums', 'juggler', 'statue', 'charity', 'bigissue'] as const;
export type Act = (typeof ACTS)[number];
/** The food carts: hot dogs, coffee, ice cream, crêpes. The market stalls' canopies: how many colours. */
export const CARTS = 4;
export const STALLS = 6;
/** A market stall: how wide (along its row), how deep, px; its rows this far apart (back to back, then an aisle), and at most this many in a market. */
const STALL_WIDE = 3 * M;
const STALL_DEEP = 2.5 * M;
const STALL_ROWS = 4 * M;
const STALLS_MOST = 40;

export interface StreetLife {
  /** The pitches: where the performer stands, which way they face (the crowd's in front), what they do. */
  pitches: { x: number; y: number; angle: number; act: Act }[];
  /** The food carts: where, which way the serving side faces, which kind. */
  carts: { x: number; y: number; angle: number; kind: number }[];
  /** Where the pigeons peck about. */
  flocks: { x: number; y: number }[];
  /** The market stalls: where, which way they face (the browsers' side), which colour. */
  stalls: { x: number; y: number; angle: number; kind: number }[];
  /** The A-boards out in front of the shops: where, which way (along the street). */
  boards: { x: number; y: number; angle: number }[];
}

const cache = new WeakMap<GameMap, StreetLife>();

/** How busy each pedestrian street is: the shops and the like within 25 m of it, per 100 m of it (counted as at least 50 m). */
export function pedestrianBusy(map: GameMap, pts: Pts): number {
  const v = map.venues ?? [];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, pts[k]), Math.min(y0, pts[k + 1]), Math.max(x1, pts[k]), Math.max(y1, pts[k + 1])];
  let n = 0;
  for (let i = 0; i + 2 < v.length; i += 3) {
    if (v[i + 2] !== 0 || v[i] < x0 - VENUE_REACH || v[i] > x1 + VENUE_REACH || v[i + 1] < y0 - VENUE_REACH || v[i + 1] > y1 + VENUE_REACH) continue;
    if (distanceTo(v[i], v[i + 1], pts) < VENUE_REACH) n++;
  }
  return (n / Math.max(lengthOf(pts), 50 * M)) * 100 * M;
}

/** The street life on a map (worked out once for each). */
export function streetLife(map: GameMap): StreetLife {
  return drain(streetLifeWork(map));
}

/** The same, a little at a time (see work.ts). */
export function* streetLifeWork(map: GameMap): Work<StreetLife> {
  const had = cache.get(map);
  if (had) return had;
  const pause = every(10);
  const life: StreetLife = { pitches: [], carts: [], flocks: [], stalls: [], boards: [] };
  // (Each with its bounds, to look only at those it might be in.)
  const bounded = (pts: Pts, pad: number) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < pts.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, pts[k]), Math.min(y0, pts[k + 1]), Math.max(x1, pts[k]), Math.max(y1, pts[k + 1])];
    return { pts, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  };
  const solid = (map.buildings ?? []).filter((b) => b.solid && !b.bottom).map((b) => bounded(b.rings[0], 0));
  const roads = map.roads.filter((r) => VEHICLE_ROADS.has(r.kind) || (r.kind === 'rail' && !r.tunnel)).map((r) => ({ ...bounded(r.pts, r.width / 2 + 2 * M), reach: r.width / 2 + 2 * M }));
  const within = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  /** Clear ground for something: not in a building, nor out on a road, nor within `apart` of anything else. */
  const clearFor = (x: number, y: number, apart: number) =>
    !solid.some((b) => within(x, y, b) && pointInRing(x, y, b.pts)) &&
    !roads.some((r) => within(x, y, r) && distanceTo(x, y, r.pts) < r.reach) &&
    ![...life.pitches, ...life.carts, ...life.flocks, ...life.stalls].some((o) => Math.hypot(o.x - x, o.y - y) < apart);
  const clear = (x: number, y: number) => clearFor(x, y, 12 * M) && !life.boards.some((o) => Math.hypot(o.x - x, o.y - y) < 2 * M);
  /** One thing or another, by where it is: a pitch, a cart, a flock (or, a quarter of the time, nothing). */
  const place = (x: number, y: number, ax: number, ay: number, half: number) => {
    const h = hash(x, y);
    const what = h % 4;
    if (what === 3) return;
    const side = (h >> 2) % 2 ? 1 : -1;
    // To one side (a cart and a performer), its front facing across; or in the middle (pigeons).
    const out = what === 2 ? 0 : Math.max(0, half - (what === 1 ? 1.2 : 0.8) * M);
    const [px, py] = [x - ay * side * out, y + ax * side * out];
    if (!clear(px, py)) return;
    const angle = Math.atan2(ax * side, -ay * side) + Math.PI;
    if (what === 0) life.pitches.push({ x: r1(px), y: r1(py), angle: +angle.toFixed(3), act: ACTS[(h >> 3) % ACTS.length] });
    else if (what === 1) life.carts.push({ x: r1(px), y: r1(py), angle: +angle.toFixed(3), kind: (h >> 3) % CARTS });
    else life.flocks.push({ x: r1(px), y: r1(py) });
  };
  for (const r of map.roads) {
    if (r.kind !== 'pedestrian' || r.bridge) continue;
    if (pause()) yield;
    if (pedestrianBusy(map, r.pts) < BUSY_STREET) continue;
    const length = lengthOf(r.pts);
    for (let d = FIRST; d < length - FIRST / 2; d += EVERY) {
      const [x, y, ax, ay] = pointAt(r.pts, d);
      place(x, y, ax, ay, r.width / 2);
    }
    // The shops' A-boards (about half of them have one): on the street in front, near its edge on their side, along it.
    const half = r.width / 2;
    const v = map.venues ?? [];
    for (let i = 0; i + 2 < v.length; i += 3) {
      if (v[i + 2] !== 0 || hash(v[i], v[i + 1]) % 2) continue;
      const { along, distance } = nearestAlong(r.pts, v[i], v[i + 1]);
      if (distance > VENUE_REACH || distance < half || along < 2 * M || along > length - 2 * M) continue;
      const [x, y, ax, ay] = pointAt(r.pts, along);
      const side = -(v[i] - x) * ay + (v[i + 1] - y) * ax >= 0 ? 1 : -1;
      const [bx, by] = [x - ay * side * (half - 0.6 * M), y + ax * side * (half - 0.6 * M)];
      if (!clearFor(bx, by, 2 * M) || life.boards.some((o) => Math.hypot(o.x - bx, o.y - by) < 3 * M)) continue;
      life.boards.push({ x: r1(bx), y: r1(by), angle: +Math.atan2(ay, ax).toFixed(3) });
    }
  }
  const v = map.venues ?? [];
  for (const a of map.areas ?? []) {
    if (a.kind !== 'plaza') continue;
    if (pause()) yield;
    const ring = a.rings[0];
    const area = Math.abs(ringArea(ring));
    if (area < SQUARE) continue;
    const box = bounded(ring, 30 * M);
    let near = 0;
    for (let i = 0; i + 2 < v.length; i += 3) if (v[i + 2] === 0 && within(v[i], v[i + 1], box) && (pointInRing(v[i], v[i + 1], ring) || distanceTo(v[i], v[i + 1], [...ring, ring[0], ring[1]]) < 30 * M)) near++;
    if (near < SQUARE_VENUES) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 1 < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
    // (Points in it as the same each time: by where it is.)
    let seed = hash(ring[0], ring[1]) || 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const want = Math.min(6, Math.floor(area / PER_SQUARE));
    for (let k = 0, tries = 0; k < want && tries < want * 10; tries++) {
      const [x, y] = [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)];
      if (!a.rings.every((ri, i) => pointInRing(x, y, ri) === (i === 0)) || !pointInRing(x, y, ring)) continue;
      const before = life.pitches.length + life.carts.length + life.flocks.length;
      const turn = rand() * Math.PI * 2;
      place(x, y, Math.cos(turn), Math.sin(turn), 0);
      if (life.pitches.length + life.carts.length + life.flocks.length > before) k++;
    }
  }
  // The open-air markets: rows of stalls, back to back with an aisle between each pair, along the market's length, wherever there's room.
  for (const market of map.markets ?? []) {
    yield;
    const ring = market.ring;
    const { ux, uy } = ridgeAxis(ring);
    const [nx, ny] = [-uy, ux];
    let [lo, hi, ulo, uhi] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const [n, u] = [ring[k] * nx + ring[k + 1] * ny, ring[k] * ux + ring[k + 1] * uy];
      [lo, hi, ulo, uhi] = [Math.min(lo, n), Math.max(hi, n), Math.min(ulo, u), Math.max(uhi, u)];
    }
    const at = (u: number, n: number): [number, number] => [ux * u + nx * n, uy * u + ny * n];
    let count = 0;
    for (let row = 0, n = lo + STALL_DEEP / 2 + M; n < hi - STALL_DEEP / 2 && count < STALLS_MOST; row++, n += row % 2 ? STALL_DEEP : STALL_ROWS) {
      // Facing out from the pair they're in: the aisle.
      const facing = row % 2 ? 1 : -1;
      for (let u = ulo + STALL_WIDE / 2 + M; u < uhi - STALL_WIDE / 2 && count < STALLS_MOST; u += STALL_WIDE + 0.3 * M) {
        const [x, y] = at(u, n);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => at(u + (a * STALL_WIDE) / 2, n + (b * STALL_DEEP) / 2));
        if (!corners.every(([cx, cy]) => pointInRing(cx, cy, ring) && clearFor(cx, cy, 0))) continue;
        if (!clearFor(x, y, 0) || life.stalls.some((o) => Math.hypot(o.x - x, o.y - y) < STALL_WIDE)) continue;
        life.stalls.push({ x: r1(x), y: r1(y), angle: +Math.atan2(ny * facing, nx * facing).toFixed(3), kind: hash(x, y) % STALLS });
        count++;
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

function lengthOf(pts: Pts): number {
  let l = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) l += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return l;
}

/** The point `d` along a line, and which way it runs there. */
function pointAt(pts: Pts, d: number): [number, number, number, number] {
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const len = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
    if (d <= len || k + 4 >= pts.length) {
      const t = len ? Math.min(1, d / len) : 0;
      return [pts[k] + (pts[k + 2] - pts[k]) * t, pts[k + 1] + (pts[k + 3] - pts[k + 1]) * t, (pts[k + 2] - pts[k]) / (len || 1), (pts[k + 3] - pts[k + 1]) / (len || 1)];
    }
    d -= len;
  }
  return [pts[0], pts[1], 1, 0];
}

function ringArea(pts: Pts): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
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

/** How far along a line the point nearest (x, y) is, and how far it is from it. */
function nearestAlong(pts: Pts, x: number, y: number): { along: number; distance: number } {
  let [best, along, run] = [Infinity, 0, 0];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < best) [best, along] = [d, run + t * len];
    run += len;
  }
  return { along, distance: best };
}

/**
 * What the street life takes up on the ground, as circles (x, y, r) and
 * rectangles (x, y, angle, half its length along the angle, half across): a
 * stall, a cart, a performer and the crowd in front of them, the pigeons, an
 * A-board. No one parks there (see parking.ts).
 */
export function footprints(life: StreetLife): { circles: [number, number, number][]; rects: [number, number, number, number, number][] } {
  const circles: [number, number, number][] = [];
  const rects: [number, number, number, number, number][] = [];
  // (A stall's angle is the way it faces: it's wide across that.)
  for (const s of life.stalls) rects.push([s.x, s.y, s.angle, STALL_DEEP / 2 + 0.5 * M, STALL_WIDE / 2 + 0.3 * M]);
  for (const c of life.carts) circles.push([c.x, c.y, 1.6 * M]);
  for (const p of life.pitches) circles.push([p.x, p.y, 1 * M], [p.x + Math.cos(p.angle) * 3 * M, p.y + Math.sin(p.angle) * 3 * M, 2 * M]);
  for (const f of life.flocks) circles.push([f.x, f.y, 3 * M]);
  for (const b of life.boards) circles.push([b.x, b.y, 0.6 * M]);
  return { circles, rects };
}

/** Whether a rectangle (x, y, angle, half along, half across) overlaps any of the footprints. */
export function onFootprints(f: ReturnType<typeof footprints>, x: number, y: number, angle: number, hl: number, hw: number): boolean {
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  for (const [cx, cy, r] of f.circles) {
    if (Math.abs(cx - x) > hl + hw + r || Math.abs(cy - y) > hl + hw + r) continue;
    const [a, b] = [(cx - x) * ux + (cy - y) * uy, -(cx - x) * uy + (cy - y) * ux];
    if (Math.hypot(Math.max(0, Math.abs(a) - hl), Math.max(0, Math.abs(b) - hw)) < r) return true;
  }
  for (const [rx, ry, ra, rl, rw] of f.rects) {
    if (Math.abs(rx - x) > hl + hw + rl + rw || Math.abs(ry - y) > hl + hw + rl + rw) continue;
    if (rectsOverlap([x, y, angle, hl, hw], [rx, ry, ra, rl, rw])) return true;
  }
  return false;
}

/** Whether two rectangles (x, y, angle, half along, half across) overlap (by their separating axes). */
function rectsOverlap(a: [number, number, number, number, number], b: [number, number, number, number, number]): boolean {
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
