/**
 * The boats on the harbour: moored at the berths along the quays and
 * pontoons (see src/map/berths.ts), a few of them now and then casting off
 * and heading across the water to a free berth somewhere else, and the
 * ferries going back and forth along their routes, calling at each stop.
 *
 * Where they can go is worked out on a grid over the water, 2 m a cell: the
 * water areas, less the pontoons, piers and the boats moored along them. The
 * bridges aren't in it (they're over the water, so the boats go under them).
 * A trip's way is found through it (A*, keeping out from the banks, then
 * pulled straight wherever there's room), and the boat steers along it, slowing
 * for the turns, keeping to starboard when another's coming, and slowing behind
 * one ahead. Casting off and coming alongside are a smooth curve out from (or
 * in to) the berth.
 *
 * They're solid, like the traffic: hit one (or knock a car into one) and it's
 * knocked adrift, drifting (a long way, on the water) and bumping off the
 * quays, the pontoons and the other boats; once it's come to a stop it waits a
 * moment, then motors back to its berth (or on to where it was going). Badly
 * damaged, it limps along; wrecked, it's left adrift. Pure, so it's tested; the
 * scene draws it (BoatLayer.ts) and does the damage.
 */

import type { Wreck } from '../car/dents';
import { BOAT_SIZE, type Berth, type BoatKind } from '../map/berths';
import type { GameMap, Pts } from '../map/osm';
import type { Body } from '../physics/collisions';
import { PAUSE, collideBodies } from './traffic';

export interface Boat extends Body {
  id: number;
  kind: BoatKind;
  /** Which of its kind's colours. */
  colour: number;
  x: number;
  y: number;
  angle: number;
  /** px/s. */
  speed: number;
  length: number;
  beam: number;
  mode: 'moored' | 'leaving' | 'underway' | 'arriving' | 'adrift';
  /** Always on the water (under the bridges): level 0. */
  level: 0;
  /** Its dents and scratches (see dents.ts). */
  wreck?: Wreck;
  /** Adrift: how long it's been still, s, and how long it's been trying to find a way back. */
  rest: number;
  lost: number;
  /** Badly damaged: it goes slower; wrecked: it's left adrift. */
  limping: boolean;
  broken: boolean;
  /** Its berth (moored, or leaving it), or where it's heading (underway, arriving): index in `berths`; -1 a ferry's stop. */
  berth: number;
  /** Underway: its way (x, y, ...) and how far along it's got (the next point). */
  path: number[];
  next: number;
  /** Casting off or coming alongside: the curve (x0, y0, c1x, c1y, c2x, c2y, x1, y1), how far along (0 to 1), and how long it takes, s. */
  curve: number[];
  t: number;
  span: number;
  /** How fast it goes, px/s, when it's under way. */
  cruise: number;
  /** A ferry: its route, the stop it's at or heading for, which way along the route, and how long it waits at a stop. */
  ferry?: { route: number; stop: number; dir: 1 | -1; dwell: number };
}

/** Grid cells, px (2 m). */
const CELL = 16;
/** How many cells clear of the bank, a moored boat, a pontoon, a way has to keep. */
const CLEAR = 2;
/** At most this many boats (not counting the ferries) are under way at once, and one casts off about this often, s. */
const MOST_MOVING = 5;
const EVERY = 18;
/** Ferries wait at each stop this long, s. */
const DWELL = 25;
/** How far ahead along its way a boat steers for, px. */
const AHEAD = 7 * 8;
/** Each kind's weight, against your car's 1. */
const MASS: Record<BoatKind, number> = { narrowboat: 11, barge: 23, cruiser: 4.5, yacht: 4, dinghy: 0.15, tug: 90, ferry: 11 };
/** Adrift: how quickly it slows on the water, along it and sideways (a hull slips along easily), and its spinning. */
const DRAG = 0.25;
const DRAG_SIDE = 0.7;
const DRAG_SPIN = 1;
/** Damage (the most any side's taken, see dents.ts) past which a boat limps along, and past which it's wrecked. */
const LIMP = 75;
const BROKEN = 150;

/** Each kind's colours (hull, then trim). */
export const BOAT_COLOURS: Record<BoatKind, [string, string][]> = {
  narrowboat: [['#1f4d36', '#c9a23a'], ['#7a1f24', '#d8c27a'], ['#1d3557', '#e0c060'], ['#2b2b2b', '#b8452f'], ['#4a2d5c', '#d9b44a'], ['#245c5a', '#e8d9a8']],
  barge: [['#1e2a3a', '#b8322b'], ['#2d4a2b', '#d8d0b0'], ['#5a1e1e', '#e7e2d0'], ['#203a5c', '#f0e6c8']],
  cruiser: [['#f2f2ee', '#1d3f6e'], ['#f4f4f0', '#8a1c1c'], ['#ecebe4', '#2b5b4a'], ['#f6f6f2', '#3a3a3a']],
  yacht: [['#f5f5f2', '#1b365d'], ['#e9ecef', '#9b1d20'], ['#1b2f4a', '#f5f5f2'], ['#f4f1e8', '#2e6b5e']],
  dinghy: [['#d94b2b', '#f2f2f2'], ['#e8c33a', '#2a2a2a'], ['#2f74b5', '#f2f2f2'], ['#f2f2f2', '#2b8c5a']],
  tug: [['#1c1c1c', '#b3261e'], ['#1d2b3a', '#c84a1d']],
  ferry: [['#f3c623', '#1f5fa8']],
};

/** A small, quick random number generator, for tests that want the same each time. */
type Rand = () => number;

/** Shore cells, px (1 m). */
const SHORE_CELL = 8;

/** Sets the cells (cols × rows, `cell` px, the first's corner at (ox, oy)) whose middles are inside the rings (even-odd) to `value`. */
function fillRings(cells: Uint8Array, cols: number, rows: number, cell: number, rings: Pts[], value: number, ox = 0, oy = 0): void {
  let [y0, y1] = [Infinity, -Infinity];
  for (const ring of rings) for (let i = 1; i < ring.length; i += 2) [y0, y1] = [Math.min(y0, ring[i]), Math.max(y1, ring[i])];
  const r0 = Math.max(0, Math.floor((y0 - oy) / cell));
  const r1 = Math.min(rows - 1, Math.ceil((y1 - oy) / cell));
  for (let r = r0; r <= r1; r++) {
    const y = oy + (r + 0.5) * cell;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) {
        const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - ox) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - ox) / cell - 0.5));
      for (let c = c0; c <= c1; c++) cells[r * cols + c] = value;
    }
  }
}

/**
 * The water as a grid: each cell's clearance, how many cells it is from the
 * nearest land, pontoon or moored boat (0 for those themselves).
 */
export class WaterGrid {
  readonly cols: number;
  readonly rows: number;
  readonly clear: Uint8Array;
  /** Where's water at all (the water areas less the pontoons and piers), a metre a cell, for boats knocked adrift to bump into the edge of. */
  private readonly wet: Uint8Array;
  private readonly wetCols: number;
  private readonly wetRows: number;
  /** Which stretch of open water each cell's in (those a boat can be under way in, joined up): 0 for none. */
  private readonly part: Uint16Array;
  /** For finding the ways: only the cells a find's been to (the water's big, and a find goes to little of it). */
  private readonly g = new Map<number, number>();
  private readonly from = new Map<number, number>();
  private readonly seen = new Map<number, number>();
  private search = 0;
  /** Where the grid's first cell's corner is, px: it covers only the water's extent (a big map's mostly dry). */
  private readonly ox: number;
  private readonly oy: number;

  constructor(map: GameMap, berths: Berth[] = []) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const a of map.areas) {
      if (a.kind !== 'water') continue;
      for (let i = 0; i < a.rings[0].length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, a.rings[0][i]), Math.min(y0, a.rings[0][i + 1]), Math.max(x1, a.rings[0][i]), Math.max(y1, a.rings[0][i + 1])];
    }
    if (x0 > x1) [x0, y0, x1, y1] = [0, 0, CELL, CELL];
    this.ox = Math.max(0, Math.floor(x0 / CELL) - 1) * CELL;
    this.oy = Math.max(0, Math.floor(y0 / CELL) - 1) * CELL;
    const [w, h] = [Math.min(map.width, x1 + 2 * CELL) - this.ox, Math.min(map.height, y1 + 2 * CELL) - this.oy];
    this.cols = Math.max(1, Math.ceil(w / CELL));
    this.rows = Math.max(1, Math.ceil(h / CELL));
    this.wetCols = this.cols * (CELL / SHORE_CELL);
    this.wetRows = this.rows * (CELL / SHORE_CELL);
    this.wet = new Uint8Array(this.wetCols * this.wetRows);
    const shore = (rings: Pts[], value: number) => fillRings(this.wet, this.wetCols, this.wetRows, SHORE_CELL, rings, value, this.ox, this.oy);
    for (const a of map.areas) if (a.kind === 'water') shore(a.rings, 1);
    for (const a of map.areas) if (a.kind === 'pontoon' || a.kind === 'pier') shore(a.rings, 0);
    // The ships moored for good (mapped as buildings), and anything else built out over the water.
    const built = map.buildings.filter((b) => b.solid);
    for (const b of built) shore(b.rings, 0);
    const wet = new Uint8Array(this.cols * this.rows);
    for (const a of map.areas) if (a.kind === 'water') this.fill(wet, a.rings, 1);
    for (const a of map.areas) if (a.kind === 'pontoon' || a.kind === 'pier') this.fill(wet, a.rings, 0);
    for (const b of built) this.fill(wet, b.rings, 0);
    // The moored boats (and where they will be), half a metre round.
    for (const b of berths) {
      const [L, W] = BOAT_SIZE[b.kind].map((m) => m * map.pxPerMetre + map.pxPerMetre);
      const [ux, uy] = [Math.cos(b.angle), Math.sin(b.angle)];
      const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]].flatMap(([p, q]) => [b.x + (ux * L * p) / 2 - (uy * W * q) / 2, b.y + (uy * L * p) / 2 + (ux * W * q) / 2]);
      this.fill(wet, [ring], 0);
    }
    // How far each cell is from the nearest dry one (the edge of the map's dry too), in cells.
    this.clear = new Uint8Array(wet.length);
    const queue = new Int32Array(wet.length);
    let [head, tail] = [0, 0];
    for (let i = 0; i < wet.length; i++) {
      const [c, r] = [i % this.cols, Math.floor(i / this.cols)];
      if (!wet[i]) continue;
      this.clear[i] = 255;
      if (c === 0 || r === 0 || c === this.cols - 1 || r === this.rows - 1) {
        this.clear[i] = 1;
        queue[tail++] = i;
      }
    }
    for (let i = 0; i < wet.length; i++) {
      if (!wet[i] || this.clear[i] === 1) continue;
      if (this.next(i, (j) => !wet[j])) {
        this.clear[i] = 1;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      this.next(i, (j) => {
        if (this.clear[j] > this.clear[i] + 1) {
          this.clear[j] = Math.min(254, this.clear[i] + 1);
          queue[tail++] = j;
        }
      });
    }
    this.part = new Uint16Array(wet.length);
    let parts = 0;
    for (let i = 0; i < wet.length; i++) {
      if (this.part[i] || this.clear[i] < CLEAR) continue;
      this.part[i] = Math.min(65535, ++parts);
      [head, tail] = [0, 0];
      queue[tail++] = i;
      while (head < tail) {
        this.next(queue[head++], (j) => {
          if (this.part[j] || this.clear[j] < CLEAR) return;
          this.part[j] = Math.min(65535, parts);
          queue[tail++] = j;
        });
      }
    }
  }

  /** Calls `fn` with each cell next to cell i (a diagonal one too), stopping if it returns true; whether it did. */
  private next(i: number, fn: (j: number) => boolean | void): boolean {
    const [c, r] = [i % this.cols, (i / this.cols) | 0];
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= this.rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if ((dc || dr) && cc >= 0 && cc < this.cols && fn(rr * this.cols + cc)) return true;
      }
    }
    return false;
  }

  private fill(cells: Uint8Array, rings: Pts[], value: number): void {
    fillRings(cells, this.cols, this.rows, CELL, rings, value, this.ox, this.oy);
  }

  /** Whether there's water at a point (not land, a pontoon or a pier). */
  water(x: number, y: number): boolean {
    const [c, r] = [Math.floor((x - this.ox) / SHORE_CELL), Math.floor((y - this.oy) / SHORE_CELL)];
    return c >= 0 && r >= 0 && c < this.wetCols && r < this.wetRows && this.wet[r * this.wetCols + c] === 1;
  }

  /** Whether there's water all along the line between two points. */
  wetLine(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (SHORE_CELL / 2));
    for (let k = 0; k <= steps; k++) if (!this.water(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)) return false;
    return true;
  }

  /** A point's clearance, cells (0 on land, or off the map). */
  at(x: number, y: number): number {
    const [c, r] = [Math.floor((x - this.ox) / CELL), Math.floor((y - this.oy) / CELL)];
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0;
    return this.clear[r * this.cols + c];
  }

  /** The nearest point to (x, y) a boat can be under way at, within `reach` px; null if none. */
  open(x: number, y: number, reach = 6 * 8): [number, number] | null {
    if (this.at(x, y) >= CLEAR) return [x, y];
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const n = Math.ceil(reach / CELL);
    const [c0, r0] = [Math.floor((x - this.ox) / CELL), Math.floor((y - this.oy) / CELL)];
    for (let r = r0 - n; r <= r0 + n; r++) {
      for (let c = c0 - n; c <= c0 + n; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.clear[r * this.cols + c] < CLEAR) continue;
        const [cx, cy] = [this.ox + (c + 0.5) * CELL, this.oy + (r + 0.5) * CELL];
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestD && d <= reach) [best, bestD] = [[cx, cy], d];
      }
    }
    return best;
  }

  /** Whether the straight line between two points keeps clear all the way. */
  sees(ax: number, ay: number, bx: number, by: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2));
    for (let k = 0; k <= steps; k++) if (this.at(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps) < CLEAR) return false;
    return true;
  }

  /**
   * A way across the water from one point to another (both where a boat can
   * be under way): x, y, ... from the first to the last; null if there's none.
   * It keeps out from the banks where there's room, and is pulled straight.
   */
  way(ax: number, ay: number, bx: number, by: number): number[] | null {
    const { cols, rows, clear } = this;
    if (this.at(ax, ay) < CLEAR || this.at(bx, by) < CLEAR) return null;
    const cell = (x: number, y: number) => Math.floor((y - this.oy) / CELL) * cols + Math.floor((x - this.ox) / CELL);
    const [start, goal] = [cell(ax, ay), cell(bx, by)];
    if (clear[start] < CLEAR || clear[goal] < CLEAR || this.part[start] !== this.part[goal]) return null;
    const [gc, gr] = [goal % cols, Math.floor(goal / cols)];
    const { g, from, seen } = this;
    g.clear();
    from.clear();
    seen.clear();
    // Each cell's marked with the search that's been to it: 2n once it's reached, 2n + 1 once it's done.
    const mark = (this.search += 2);
    const reached = (i: number) => (seen.get(i) ?? 0) >= mark;
    const heap = new Heap();
    const h = (i: number) => {
      const [dc, dr] = [Math.abs((i % cols) - gc), Math.abs(Math.floor(i / cols) - gr)];
      // Weighted (a little longer a way, perhaps, but found much quicker).
      return (Math.max(dc, dr) + 0.414 * Math.min(dc, dr)) * 1.6;
    };
    g.set(start, 0);
    from.set(start, -1);
    seen.set(start, mark);
    heap.push(start, h(start));
    while (heap.size) {
      const i = heap.pop();
      if (i === goal) break;
      if (seen.get(i) === mark + 1) continue;
      seen.set(i, mark + 1);
      const [c, r] = [i % cols, Math.floor(i / cols)];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const [cc, rr] = [c + dc, r + dr];
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = rr * cols + cc;
          if (seen.get(j) === mark + 1 || clear[j] < CLEAR) continue;
          // Out in the middle where there's room: near the banks costs more.
          const near = clear[j] >= 6 ? 0 : (6 - clear[j]) * 0.5;
          const cost = g.get(i)! + (dc && dr ? 1.414 : 1) * (1 + near);
          if (!reached(j) || cost < g.get(j)!) {
            seen.set(j, mark);
            g.set(j, cost);
            from.set(j, i);
            heap.push(j, cost + h(j));
          }
        }
      }
    }
    if (goal !== start && !reached(goal)) return null;
    const cells: number[] = [];
    for (let i = goal; i !== start; i = from.get(i)!) cells.push(i);
    cells.reverse();
    const pts: number[] = [ax, ay];
    for (const i of cells.slice(0, -1)) pts.push(this.ox + ((i % cols) + 0.5) * CELL, this.oy + (Math.floor(i / cols) + 0.5) * CELL);
    pts.push(bx, by);
    // Pulled straight: from each point kept, on to the furthest it can see.
    const out = [pts[0], pts[1]];
    let k = 0;
    const n = pts.length / 2;
    while (k < n - 1) {
      let far = k + 1;
      for (let j = n - 1; j > k + 1; j--) {
        if (this.sees(pts[k * 2], pts[k * 2 + 1], pts[j * 2], pts[j * 2 + 1])) {
          far = j;
          break;
        }
      }
      out.push(pts[far * 2], pts[far * 2 + 1]);
      k = far;
    }
    return out;
  }
}

/** A binary heap of cells by cost, cheapest first. */
class Heap {
  private items: number[] = [];
  private costs: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, cost: number): void {
    const { items, costs } = this;
    let i = items.length;
    items.push(item);
    costs.push(cost);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (costs[p] <= costs[i]) break;
      [items[p], items[i], costs[p], costs[i]] = [items[i], items[p], costs[i], costs[p]];
      i = p;
    }
  }
  pop(): number {
    const { items, costs } = this;
    const top = items[0];
    const [li, lc] = [items.pop()!, costs.pop()!];
    if (items.length) {
      items[0] = li;
      costs[0] = lc;
      let i = 0;
      for (;;) {
        const [a, b] = [i * 2 + 1, i * 2 + 2];
        let m = i;
        if (a < items.length && costs[a] < costs[m]) m = a;
        if (b < items.length && costs[b] < costs[m]) m = b;
        if (m === i) break;
        [items[m], items[i], costs[m], costs[i]] = [items[i], items[m], costs[i], costs[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A point on a cubic curve (x0, y0, c1x, c1y, c2x, c2y, x1, y1), and which way it's going there. */
export function onCurve(c: number[], t: number): [number, number, number] {
  const u = 1 - t;
  const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  const x = a * c[0] + b * c[2] + d * c[4] + e * c[6];
  const y = a * c[1] + b * c[3] + d * c[5] + e * c[7];
  const dx = 3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]);
  const dy = 3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]);
  return [x, y, Math.atan2(dy, dx)];
}

/** Whether it's somewhere (nothing's gone wrong with where it is, or how it's moving). */
function finite(b: Boat): boolean {
  return Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.angle) && Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.spin);
}

/** The difference between two angles, -π to π. */
function turn(a: number, b: number): number {
  let d = b - a;
  if (!Number.isFinite(d)) return 0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Boats {
  readonly boats: Boat[] = [];
  readonly grid: WaterGrid;
  readonly berths: Berth[];
  /** Which boat's at each berth (or on its way to it); -1 none. */
  private readonly taken: number[];
  /** Each ferry route's stops: x, y, angle. */
  private readonly stops: [number, number, number][][];
  private readonly px: number;
  private readonly rand: Rand;
  private nextId = 1;
  private clock: number;
  /** How many trips have ended at a berth (for the tests). */
  arrivals = 0;
  /** Boats knocked into each other since the scene last looked: where, and how hard (it dents them both). */
  readonly hits: { a: Boat; b: Boat; x: number; y: number; impulse: number }[] = [];
  /** Adrift boats that hit the shore since the scene last looked: where, and how hard. */
  readonly grounded: { boat: Boat; x: number; y: number; impulse: number }[] = [];

  constructor(map: GameMap, options: { rand?: Rand; occupied?: number } = {}) {
    this.rand = options.rand ?? Math.random;
    this.px = map.pxPerMetre;
    this.berths = map.berths ?? [];
    this.stops = (map.ferries ?? []).map((f) => {
      const out: [number, number, number][] = [];
      for (let i = 0; i + 2 < f.stops.length; i += 3) out.push([f.stops[i], f.stops[i + 1], f.stops[i + 2]]);
      return out;
    });
    const stopBerths: Berth[] = this.stops.flat().map(([x, y, angle]) => ({ x, y, angle, kind: 'ferry' }));
    this.grid = new WaterGrid(map, [...this.berths, ...stopBerths]);
    this.taken = this.berths.map(() => -1);
    const occupied = options.occupied ?? 0.8;
    this.berths.forEach((b, i) => {
      if (this.rand() < occupied || b.kind === 'tug' || b.kind === 'ferry') this.moor(this.add(b.kind, b.x, b.y, b.angle), i);
    });
    // A ferry on each route, waiting at its first stop.
    this.stops.forEach((stops, route) => {
      if (stops.length < 2) return;
      const [x, y, angle] = stops[0];
      const f = this.add('ferry', x, y, angle);
      f.ferry = { route, stop: 0, dir: 1, dwell: DWELL * this.rand() };
    });
    this.clock = EVERY * 0.3;
    // Some already out on the water.
    for (let k = 0; k < 3; k++) this.castOff(this.rand() * 0.6 + 0.2);
  }

  private add(kind: BoatKind, x: number, y: number, angle: number): Boat {
    const [L, W] = BOAT_SIZE[kind].map((m) => m * this.px);
    const boat: Boat = {
      id: this.nextId++,
      kind,
      colour: Math.floor(this.rand() * BOAT_COLOURS[kind].length),
      x,
      y,
      angle,
      speed: 0,
      length: L,
      beam: W,
      mode: 'moored',
      berth: -1,
      path: [],
      next: 0,
      curve: [],
      t: 0,
      span: 1,
      r: W / 2,
      vx: 0,
      vy: 0,
      invMass: 1 / MASS[kind],
      spin: 0,
      circles: Math.max(3, Math.ceil(L / (W * 0.7))),
      level: 0,
      rest: 0,
      lost: 0,
      limping: false,
      broken: false,
      cruise: (kind === 'ferry' ? 3.4 : kind === 'dinghy' ? 3.6 : kind === 'narrowboat' || kind === 'barge' ? 2.2 : 2.9) * this.px * (0.9 + this.rand() * 0.2),
    };
    this.boats.push(boat);
    return boat;
  }

  private moor(boat: Boat, berth: number): void {
    boat.mode = 'moored';
    boat.berth = berth;
    boat.speed = 0;
    this.taken[berth] = boat.id;
  }

  /** Where a boat lying at (x, y, angle) comes out to (or in from) the open water: ahead of it and out from the side it isn't moored on. */
  private offing(x: number, y: number, angle: number, L: number, W: number, ahead: 1 | -1): [number, number] | null {
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
    for (const side of [1, -1]) {
      const [nx, ny] = [-uy * side, ux * side];
      // The side with the open water.
      if (this.grid.at(x + nx * (W / 2 + 3 * this.px), y + ny * (W / 2 + 3 * this.px)) === 0) continue;
      for (const along of [L * 0.9, L * 0.5, 0]) {
        const p = this.grid.open(x + ux * along * ahead + nx * (W / 2 + 5 * this.px), y + uy * along * ahead + ny * (W / 2 + 5 * this.px), 3 * this.px);
        if (p) return p;
      }
    }
    return null;
  }

  /** One of the moored boats casts off for a free berth elsewhere (if one can get anywhere): `already` of the way there, if it's out on the water already. */
  private castOff(already = 0): void {
    const moored = this.boats.filter((b) => b.mode === 'moored' && !b.ferry && b.kind !== 'tug' && b.kind !== 'ferry');
    for (let tries = 0; tries < 6 && moored.length; tries++) {
      const boat = moored[Math.floor(this.rand() * moored.length)];
      const out = this.offing(boat.x, boat.y, boat.angle, boat.length, boat.beam, 1);
      if (!out) continue;
      // A free berth its size, a good way off.
      const free = this.berths
        .map((b, i) => [b, i] as const)
        .filter(([b, i]) => this.taken[i] < 0 && BOAT_SIZE[b.kind][0] * this.px >= boat.length - this.px && BOAT_SIZE[b.kind][1] * this.px >= boat.beam - 0.5 * this.px && Math.hypot(b.x - boat.x, b.y - boat.y) > 80 * this.px);
      if (!free.length) continue;
      const [to, index] = free[Math.floor(this.rand() * free.length)];
      const into = this.offing(to.x, to.y, to.angle, boat.length, boat.beam, -1);
      if (!into) continue;
      const way = this.grid.way(out[0], out[1], into[0], into[1]);
      if (!way) continue;
      this.taken[boat.berth] = -1;
      this.taken[index] = boat.id;
      boat.berth = index;
      boat.path = way;
      boat.next = 1;
      if (already > 0) {
        // Put out along the way already (that far along it), heading along it.
        let left = way.reduce((sum, _, i) => (i % 2 || i < 2 ? sum : sum + Math.hypot(way[i] - way[i - 2], way[i + 1] - way[i - 1])), 0) * already;
        let k = 1;
        for (; k < way.length / 2 - 1; k++) {
          const seg = Math.hypot(way[k * 2] - way[k * 2 - 2], way[k * 2 + 1] - way[k * 2 - 1]);
          if (left < seg) break;
          left -= seg;
        }
        const [ax, ay, bx, by] = [way[k * 2 - 2], way[k * 2 - 1], way[k * 2], way[k * 2 + 1]];
        const seg = Math.hypot(bx - ax, by - ay) || 1;
        const f = Math.min(1, left / seg);
        [boat.x, boat.y] = [ax + (bx - ax) * f, ay + (by - ay) * f];
        boat.angle = Math.atan2(by - ay, bx - ax);
        boat.next = k;
        boat.mode = 'underway';
        boat.speed = boat.cruise;
      } else {
        this.leave(boat, out);
      }
      return;
    }
  }

  /** Casting off: a curve out from where it's lying to the open water (the start of its way). */
  private leave(boat: Boat, out: [number, number]): void {
    const d = Math.hypot(out[0] - boat.x, out[1] - boat.y);
    // Out to the open water, ending up heading the way it's going (along its way).
    const p = boat.path;
    const toward = p.length >= 4 ? Math.atan2(p[3] - p[1], p[2] - p[0]) : Math.atan2(out[1] - boat.y, out[0] - boat.x);
    const k = d * 0.45;
    boat.curve = [boat.x, boat.y, boat.x + Math.cos(boat.angle) * k, boat.y + Math.sin(boat.angle) * k, out[0] - Math.cos(toward) * k * 0.5, out[1] - Math.sin(toward) * k * 0.5, out[0], out[1]];
    boat.mode = 'leaving';
    boat.t = 0;
    boat.span = Math.max(4, d / (1.1 * this.px));
  }

  /** Coming alongside: a curve in from where it's got to, ending at the berth, lying along it. */
  private comeAlongside(boat: Boat, x: number, y: number, angle: number): void {
    const d = Math.hypot(x - boat.x, y - boat.y);
    const k = d * 0.45;
    boat.curve = [boat.x, boat.y, boat.x + Math.cos(boat.angle) * k, boat.y + Math.sin(boat.angle) * k, x - Math.cos(angle) * k, y - Math.sin(angle) * k, x, y];
    boat.mode = 'arriving';
    boat.t = 0;
    boat.span = Math.max(4, d / (0.9 * this.px));
  }

  /** Where it's bound: its berth, or its ferry stop. */
  private bound(boat: Boat): [number, number, number] {
    if (boat.ferry) return this.stops[boat.ferry.route][boat.ferry.stop];
    const b = this.berths[boat.berth];
    return [b.x, b.y, b.angle];
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.clock -= dt;
    const moving = this.boats.filter((b) => !b.ferry && !b.broken && b.mode !== 'moored').length;
    if (this.clock <= 0) {
      this.clock = EVERY * (0.6 + this.rand() * 0.8);
      if (moving < MOST_MOVING) this.castOff();
    }
    for (const boat of this.boats) {
      const [x, y, angle] = [boat.x, boat.y, boat.angle];
      if (boat.mode === 'adrift') this.drift(boat, dt);
      else {
        if (boat.ferry && boat.mode === 'moored') this.ferryWaits(boat, dt);
        else if (boat.mode === 'leaving' || boat.mode === 'arriving') this.curving(boat, dt);
        else if (boat.mode === 'underway') this.steer(boat, dt);
        // How it's moving, for what it hits (or what hits it).
        boat.vx = (boat.x - x) / dt;
        boat.vy = (boat.y - y) / dt;
        boat.spin = turn(angle, boat.angle) / dt;
      }
      if (!finite(boat)) this.rescue(boat);
    }
    this.bump();
  }

  /** Something's gone wrong with one (it's lost where it is): it's put back where it's bound, and the rest go on. */
  private rescue(boat: Boat): void {
    console.error('boats: lost one', boat.id);
    [boat.x, boat.y, boat.angle] = this.bound(boat);
    [boat.vx, boat.vy, boat.spin, boat.speed] = [0, 0, 0, 0];
    boat.mode = 'moored';
    boat.curve = [];
    boat.path = [];
    if (boat.ferry) boat.ferry.dwell = DWELL;
  }

  /** The boats within `reach` of a point. */
  near(x: number, y: number, reach: number): Boat[] {
    return this.boats.filter((b) => Math.abs(b.x - x) < reach + b.length / 2 && Math.abs(b.y - y) < reach + b.length / 2);
  }

  /** It's been hit (how hard): knocked adrift, if that shifted it at all (a heavy one takes a lot more than a dinghy). */
  knock(boat: Boat, impulse: number): void {
    if (impulse * boat.invMass < 3) return;
    boat.mode = 'adrift';
    boat.rest = 0;
    boat.lost = 0;
    boat.speed = 0;
  }

  /** Its damage has changed (see dents.ts): badly enough, it limps along; worse, it's wrecked, and left adrift. */
  hurt(boat: Boat): void {
    const w = boat.wreck;
    if (!w) return;
    const worst = Math.max(w.taken.front, w.taken.rear, w.taken.left, w.taken.right);
    if (worst > LIMP) boat.limping = true;
    if (worst > BROKEN && !boat.broken) {
      boat.broken = true;
      // Its berth's free (it isn't going back); a ferry's route's left without it.
      if (!boat.ferry && this.taken[boat.berth] === boat.id) this.taken[boat.berth] = -1;
      boat.mode = 'adrift';
      boat.rest = 0;
    }
  }

  /** Knocked adrift: drifting, slowing on the water, bumping off the shore; when it's still a moment, it motors back. */
  private drift(boat: Boat, dt: number): void {
    const [cx, cy] = [Math.cos(boat.angle), Math.sin(boat.angle)];
    let f = boat.vx * cx + boat.vy * cy;
    let side = -boat.vx * cy + boat.vy * cx;
    f *= Math.exp(-DRAG * dt);
    side *= Math.exp(-DRAG_SIDE * dt);
    boat.vx = f * cx - side * cy;
    boat.vy = f * cy + side * cx;
    boat.spin *= Math.exp(-DRAG_SPIN * dt);
    boat.x += boat.vx * dt;
    boat.y += boat.vy * dt;
    boat.angle += boat.spin * dt;
    boat.speed = 0;
    this.shore(boat);
    if (boat.broken) return;
    if (Math.hypot(boat.vx, boat.vy) < 2 && Math.abs(boat.spin) < 0.05) boat.rest += dt;
    else boat.rest = 0;
    if (boat.rest > PAUSE) this.recover(boat, dt);
  }

  /** Bounces an adrift boat off the edge of the water (the quays, the banks, the pontoons). */
  private shore(boat: Boat): void {
    const [cx, cy] = [Math.cos(boat.angle), Math.sin(boat.angle)];
    const end = boat.length / 2 - boat.r;
    const n = boat.circles ?? 3;
    let strongest = 0;
    for (let k = 0; k < n; k++) {
      const along = -end + (2 * end * k) / (n - 1);
      const [px, py] = [boat.x + cx * along, boat.y + cy * along];
      // Which way's out of the dry, from round the edge of this circle of its hull.
      let [nx, ny, dry] = [0, 0, 0];
      for (let a = 0; a < 12; a++) {
        const [ox, oy] = [Math.cos((a * Math.PI) / 6), Math.sin((a * Math.PI) / 6)];
        if (this.grid.water(px + ox * boat.r, py + oy * boat.r)) continue;
        nx -= ox;
        ny -= oy;
        dry++;
      }
      const len = Math.hypot(nx, ny);
      if (!dry || len < 1e-6) continue;
      [nx, ny] = [nx / len, ny / len];
      // Pushed back out, and bounced off.
      const depth = Math.min(boat.r, (dry / 12) * boat.r);
      boat.x += nx * depth * 0.5;
      boat.y += ny * depth * 0.5;
      const vn = boat.vx * nx + boat.vy * ny;
      if (vn < 0) {
        boat.vx -= 1.3 * vn * nx;
        boat.vy -= 1.3 * vn * ny;
        // Turned by it, hit off its middle.
        boat.spin += (along * (nx * -cy + ny * cx) * -vn * 0.3) / (boat.length * boat.length / 12 + 1);
        if (-vn > strongest) {
          strongest = -vn;
          this.grounded.push({ boat, x: px - nx * boat.r, y: py - ny * boat.r, impulse: -vn / boat.invMass });
        }
      }
    }
  }

  /** It's come to a stop, adrift: back to its berth, its stop, or on to where it was going. */
  private recover(boat: Boat, dt: number): void {
    boat.lost += dt;
    const [x, y, angle] = this.bound(boat);
    const facing = Math.abs(turn(boat.angle, angle)) < Math.PI / 2 ? angle : angle + Math.PI;
    const lieAs = boat.ferry ? facing : angle;
    // Close, with nothing but water in the way: straight in alongside.
    if ((Math.hypot(x - boat.x, y - boat.y) < 25 * this.px && this.grid.wetLine(boat.x, boat.y, x, y)) || boat.lost > 12) {
      this.comeAlongside(boat, x, y, lieAs);
      return;
    }
    // Otherwise, a way round to it (tried every couple of seconds till there is one).
    if (boat.lost - dt > 0 && Math.floor(boat.lost / 2) === Math.floor((boat.lost - dt) / 2)) return;
    const from = this.grid.open(boat.x, boat.y, 10 * this.px);
    const into = this.offing(x, y, lieAs, boat.length, boat.beam, -1);
    const way = from && into ? this.grid.way(from[0], from[1], into[0], into[1]) : null;
    if (!way) return;
    boat.path = [boat.x, boat.y, ...way];
    boat.next = 1;
    boat.mode = 'underway';
    boat.speed = 0;
  }

  /** Boats adrift bump into the others (and knock them adrift too, hard enough). */
  private bump(): void {
    for (const a of this.boats) {
      if (a.mode !== 'adrift' || !finite(a)) continue;
      for (const b of this.boats) {
        if (a === b || (b.mode === 'adrift' && b.id < a.id) || !finite(b)) continue;
        const reach = (a.length + b.length) / 2;
        if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) continue;
        const at = { x: 0, y: 0 };
        const hit = collideBodies(a, b, 0.3, at);
        if (hit > 0) this.hits.push({ a, b, x: at.x, y: at.y, impulse: hit });
        if (b.mode !== 'adrift') this.knock(b, hit);
        if (hit > 0) a.rest = 0;
      }
    }
  }

  /** A ferry at a stop: when it's waited long enough, it's off to the next (if there's a way there, and no other ferry's at it). */
  private ferryWaits(boat: Boat, dt: number): void {
    const f = boat.ferry!;
    f.dwell -= dt;
    if (f.dwell > 0) return;
    const stops = this.stops[f.route];
    if (f.stop + f.dir < 0 || f.stop + f.dir >= stops.length) f.dir = f.dir === 1 ? -1 : 1;
    const next = f.stop + f.dir;
    const [x, y, angle] = stops[next];
    const busy = this.boats.some((o) => o !== boat && o.ferry && Math.hypot(o.x - x, o.y - y) < 12 * this.px);
    const out = this.offing(boat.x, boat.y, boat.angle, boat.length, boat.beam, 1);
    // In to the stop, facing whichever way's nearer the way it's heading (or the other, if there's no way in that way).
    const facing = Math.abs(turn(Math.atan2(y - boat.y, x - boat.x), angle)) < Math.PI / 2 ? angle : angle + Math.PI;
    let way: number[] | null = null;
    for (const a of [facing, facing + Math.PI]) {
      const into = this.offing(x, y, a, boat.length, boat.beam, -1);
      way = !busy && out && into ? this.grid.way(out[0], out[1], into[0], into[1]) : null;
      if (way) break;
    }
    if (!way) {
      f.dwell = 5;
      return;
    }
    f.stop = next;
    boat.path = way;
    boat.next = 1;
    this.leave(boat, out!);
  }

  private curving(boat: Boat, dt: number): void {
    boat.t = Math.min(1, boat.t + dt / boat.span);
    // Easing in and out of it.
    const s = boat.t * boat.t * (3 - 2 * boat.t);
    const [x, y, angle] = onCurve(boat.curve, s);
    boat.speed = Math.hypot(x - boat.x, y - boat.y) / Math.max(dt, 1e-6);
    [boat.x, boat.y] = [x, y];
    if (boat.t > 0.02) boat.angle = boat.mode === 'arriving' && boat.t > 0.98 ? this.bound(boat)[2] + (Math.abs(turn(angle, this.bound(boat)[2])) > Math.PI / 2 ? Math.PI : 0) : angle;
    if (boat.t < 1) return;
    if (boat.mode === 'leaving') {
      boat.mode = 'underway';
      boat.speed = 0.8 * this.px;
      return;
    }
    boat.speed = 0;
    if (boat.ferry) {
      boat.mode = 'moored';
      boat.ferry.dwell = DWELL * (0.8 + this.rand() * 0.4);
      return;
    }
    this.arrivals++;
    this.moor(boat, boat.berth);
  }

  /** Under way: steering for a point a little ahead along its way, slowing for the turns, for others, and as it gets there. */
  private steer(boat: Boat, dt: number): void {
    const p = boat.path;
    const n = p.length / 2;
    // On to the next point once it's close, or past it.
    while (boat.next < n - 1 && Math.hypot(p[boat.next * 2] - boat.x, p[boat.next * 2 + 1] - boat.y) < AHEAD * 0.6) boat.next++;
    const [ex, ey] = [p[(n - 1) * 2], p[(n - 1) * 2 + 1]];
    const left = Math.hypot(ex - boat.x, ey - boat.y);
    // There: in alongside.
    if (left < 2.5 * this.px || (boat.next === n - 1 && left < 4 * this.px)) {
      const [x, y, angle] = this.bound(boat);
      const facing = Math.abs(turn(boat.angle, angle)) < Math.PI / 2 ? angle : angle + Math.PI;
      this.comeAlongside(boat, x, y, boat.ferry ? facing : angle);
      return;
    }
    // The point ahead it's steering for: along the way from the last point to the next.
    const [ax, ay, bx, by] = [p[(boat.next - 1) * 2], p[(boat.next - 1) * 2 + 1], p[boat.next * 2], p[boat.next * 2 + 1]];
    const seg = Math.hypot(bx - ax, by - ay) || 1;
    const along = Math.max(0, ((boat.x - ax) * (bx - ax) + (boat.y - ay) * (by - ay)) / seg);
    let [tx, ty] = along + AHEAD < seg ? [ax + ((bx - ax) * (along + AHEAD)) / seg, ay + ((by - ay) * (along + AHEAD)) / seg] : [bx, by];
    // Others: slowing behind one ahead, keeping to starboard of one coming.
    const [ux, uy] = [Math.cos(boat.angle), Math.sin(boat.angle)];
    let limit = boat.cruise * (boat.limping ? 0.5 : 1);
    for (const o of this.boats) {
      if (o === boat || o.mode === 'moored') continue;
      const [dx, dy] = [o.x - boat.x, o.y - boat.y];
      const d = Math.hypot(dx, dy);
      if (d > 30 * this.px) continue;
      const ahead = (dx * ux + dy * uy) / (d || 1);
      if (ahead < 0.5) continue;
      const room = d - (boat.length + o.length) / 2;
      const head = Math.cos(o.angle) * ux + Math.sin(o.angle) * uy;
      if (head < -0.3) {
        // Head on: over to the right (y down: right of (ux, uy) is (-uy, ux)).
        const [rx, ry] = [tx - uy * 4 * this.px, ty + ux * 4 * this.px];
        if (this.grid.at(rx, ry) >= 2 && this.grid.sees(boat.x, boat.y, rx, ry)) [tx, ty] = [rx, ry];
        if (room < 6 * this.px) limit = Math.min(limit, 0.6 * this.px);
      } else if (room < 12 * this.px) {
        limit = Math.min(limit, Math.max(0, o.speed * (room / (12 * this.px))));
      }
    }
    const want = Math.atan2(ty - boat.y, tx - boat.x);
    const off = turn(boat.angle, want);
    // Slower for the turns, and coming up to its berth.
    const bend = boat.next < n - 1 ? Math.abs(turn(Math.atan2(by - ay, bx - ax), Math.atan2(p[boat.next * 2 + 3] - by, p[boat.next * 2 + 2] - bx))) : 0;
    const toBend = Math.hypot(bx - boat.x, by - boat.y);
    limit = Math.min(limit, boat.cruise * (1 - Math.min(0.65, Math.abs(off) * 0.8)), 0.9 * this.px + left * 0.25);
    if (toBend < 15 * this.px) limit = Math.min(limit, boat.cruise * (1 - Math.min(0.5, bend * 0.35)));
    const rate = limit > boat.speed ? 0.35 * this.px : 0.9 * this.px;
    boat.speed += Math.max(-rate * dt, Math.min(rate * dt, limit - boat.speed));
    // A boat turns slower the longer it is, and hardly at all when it's barely moving.
    const most = (0.55 - Math.min(0.3, boat.length / this.px / 80)) * Math.min(1, 0.3 + boat.speed / (1.5 * this.px));
    boat.angle += Math.max(-most * dt, Math.min(most * dt, off * 1.2 * dt));
    boat.x += Math.cos(boat.angle) * boat.speed * dt;
    boat.y += Math.sin(boat.angle) * boat.speed * dt;
  }
}
