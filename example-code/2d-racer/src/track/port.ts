/**
 * The lay of the land at the docks: a working port around the circuit.
 *
 * Nearest the track there's a grass verge (its width wanders along the lap);
 * beyond that, concrete yards; and further out, the dock water, with straight
 * quay walls, because the land is laid out on a grid of square plots like a
 * real port. From that come the straight runs of quay where ships and boats
 * moor, service roads and a railway siding across the yards, and open water
 * for tugboats.
 *
 * Pure geometry, so it can be tested; the scene draws and animates it.
 */

import type { Track, TrackPosition, Vec2 } from './Track';
import { locateOnTrack } from './Track';

/** Size of a plot of land or water, px. */
export const PORT_CELL = 128;

/** A straight line between two points: a road, the railway, or a tugboat's run. */
export interface Route {
  from: Vec2;
  to: Vec2;
}

/** A straight stretch of quay wall, and which way the water is from it (a unit vector). */
export interface Quay {
  from: Vec2;
  to: Vec2;
  water: Vec2;
}

export interface Port {
  /** The grid of plots covering the world: its top-left corner and size. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** 1 where a plot is land, 0 where it's dock water; row by row. */
  land: number[];
  /** Width of the grass verge beyond the barrier line at each track sample, px. */
  verge: number[];
  quays: Quay[];
  /** Straight runs across the yards with room for a road or railway, longest first. */
  lanes: Route[];
  /** Open water for tugboats to cross. */
  tugRoutes: Route[];
}

export interface PortOptions {
  /** Distance from the road edge to the back of the barrier, px. */
  barrierZone: number;
  /** The world: the port covers it. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  tugs: number;
}

/** Narrowest and widest the grass verge gets beyond the barriers, px. */
const VERGE: [number, number] = [12, 50];
/** Samples between the points where the verge width is set. */
const VERGE_STEP = 24;
/** Concrete between the verge and the water: at least this, plus up to `QUAY_SPREAD` more. */
const QUAY_MIN = 140;
const QUAY_SPREAD = 380;
/** Plots between the points of the noise that shapes the coast. */
const NOISE_STEP = 6;
const LANE_CLEARANCE = 50;

export function planPort(track: Track, rng: () => number, options: PortOptions): Port {
  const { barrierZone, bounds } = options;
  const n = track.points.length;

  // The verge: a smooth wander between narrow and wide, all the way round.
  const knots = Array.from({ length: Math.ceil(n / VERGE_STEP) }, () => VERGE[0] + rng() * (VERGE[1] - VERGE[0]));
  const verge = Array.from({ length: n }, (_, i) => {
    const f = i / VERGE_STEP;
    const k = Math.floor(f);
    const t = (1 - Math.cos((f - k) * Math.PI)) / 2;
    return knots[k % knots.length] * (1 - t) + knots[(k + 1) % knots.length] * t;
  });

  const x0 = bounds.minX;
  const y0 = bounds.minY;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / PORT_CELL);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / PORT_CELL);
  const noiseCols = Math.ceil(cols / NOISE_STEP) + 2;
  const noise = Array.from({ length: (Math.ceil(rows / NOISE_STEP) + 2) * noiseCols }, () => rng());
  const smooth = (c: number, r: number) => {
    const fx = c / NOISE_STEP;
    const fy = r / NOISE_STEP;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (a: number, b: number) => noise[(iy + b) * noiseCols + ix + a];
    return (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty;
  };

  // Each plot is land if it's near enough the track, the coast wandering in and out.
  const edge: number[] = [];
  const land: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * PORT_CELL;
      const y = y0 + (r + 0.5) * PORT_CELL;
      const pos = locateOnTrack(track, x, y);
      const i = Math.floor(pos.along / track.spacing) % n;
      const beyond = pos.distance - pos.halfWidth - track.kerbWidth - barrierZone - verge[i];
      edge.push(beyond);
      land.push(beyond < QUAY_MIN + smooth(c, r) * QUAY_SPREAD ? 1 : 0);
    }
  }
  tidy(land, edge, cols, rows);

  const port: Port = { x0, y0, cols, rows, land, verge, quays: [], lanes: [], tugRoutes: [] };
  port.quays = findQuays(port);
  port.lanes = findLanes(port, track, barrierZone);
  port.tugRoutes = findTugRoutes(port, rng, options.tugs);
  return port;
}

/**
 * Small enclosed ponds become land and small islands far from the track
 * become water, so the docks are made of proper basins and quays.
 */
function tidy(land: number[], edge: number[], cols: number, rows: number): void {
  const seen = new Uint8Array(land.length);
  for (let start = 0; start < land.length; start++) {
    if (seen[start]) continue;
    const kind = land[start];
    const group: number[] = [];
    let open = false; // water reaching the edge of the world (the open harbour)
    let nearTrack = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const k = stack.pop()!;
      group.push(k);
      const c = k % cols;
      const r = Math.floor(k / cols);
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) open = true;
      if (edge[k] < 200) nearTrack = true;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nk = nr * cols + nc;
        if (!seen[nk] && land[nk] === kind) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    const flip = kind === 0 ? !open && group.length < 16 : !nearTrack && group.length < 10;
    if (flip) for (const k of group) land[k] = 1 - kind;
  }
}

/** Whether a point is on land (anywhere off the port's grid counts as water). */
export function isLand(port: Port, x: number, y: number): boolean {
  const c = Math.floor((x - port.x0) / PORT_CELL);
  const r = Math.floor((y - port.y0) / PORT_CELL);
  if (c < 0 || r < 0 || c >= port.cols || r >= port.rows) return false;
  return port.land[r * port.cols + c] === 1;
}

/** Width of the grass verge beyond the barriers at a located point, px. */
export function vergeAt(port: Port, track: Track, pos: TrackPosition): number {
  return port.verge[Math.floor(pos.along / track.spacing) % port.verge.length];
}

/** How far a point is beyond the grass verge (negative: on the verge or nearer the road), px. */
export function beyondVerge(port: Port, track: Track, barrierZone: number, x: number, y: number): number {
  const pos = locateOnTrack(track, x, y);
  return pos.distance - pos.halfWidth - track.kerbWidth - barrierZone - vergeAt(port, track, pos);
}

/** Runs of quay wall at least two plots long, along the edges between land and water. */
function findQuays(port: Port): Quay[] {
  const { cols, rows, x0, y0 } = port;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : port.land[r * cols + c]);
  const quays: Quay[] = [];
  const runs = (count: number, length: number, isEdge: (a: number, b: number) => boolean, make: (a: number, from: number, to: number) => Quay) => {
    for (let a = 0; a < count; a++) {
      let start = -1;
      for (let b = 0; b <= length; b++) {
        const on = b < length && isEdge(a, b);
        if (on && start < 0) start = b;
        if (!on && start >= 0) {
          if (b - start >= 2) quays.push(make(a, start, b));
          start = -1;
        }
      }
    }
  };
  const X = (c: number) => x0 + c * PORT_CELL;
  const Y = (r: number) => y0 + r * PORT_CELL;
  // Water below the land, above it, to the right, to the left.
  runs(rows, cols, (r, c) => at(c, r) === 1 && at(c, r + 1) === 0, (r, a, b) => ({ from: { x: X(a), y: Y(r + 1) }, to: { x: X(b), y: Y(r + 1) }, water: { x: 0, y: 1 } }));
  runs(rows, cols, (r, c) => at(c, r) === 1 && at(c, r - 1) === 0, (r, a, b) => ({ from: { x: X(a), y: Y(r) }, to: { x: X(b), y: Y(r) }, water: { x: 0, y: -1 } }));
  runs(cols, rows, (c, r) => at(c, r) === 1 && at(c + 1, r) === 0, (c, a, b) => ({ from: { x: X(c + 1), y: Y(a) }, to: { x: X(c + 1), y: Y(b) }, water: { x: 1, y: 0 } }));
  runs(cols, rows, (c, r) => at(c, r) === 1 && at(c - 1, r) === 0, (c, a, b) => ({ from: { x: X(c), y: Y(a) }, to: { x: X(c), y: Y(b) }, water: { x: -1, y: 0 } }));
  return quays.sort((p, q) => len(q) - len(p));
}

/**
 * Straight runs along the middle of a row or column of plots that stay on
 * concrete all the way (clear of the verge and the water), at least six plots
 * long, longest first.
 */
function findLanes(port: Port, track: Track, barrierZone: number): Route[] {
  const { cols, rows, x0, y0 } = port;
  const lanes: Route[] = [];
  const clear = (x: number, y: number) => {
    if (!isLand(port, x, y) || !isLand(port, x, y - PORT_CELL / 2 + 8) || !isLand(port, x, y + PORT_CELL / 2 - 8)) return false;
    return beyondVerge(port, track, barrierZone, x, y) >= LANE_CLEARANCE;
  };
  const clearV = (x: number, y: number) => {
    if (!isLand(port, x, y) || !isLand(port, x - PORT_CELL / 2 + 8, y) || !isLand(port, x + PORT_CELL / 2 - 8, y)) return false;
    return beyondVerge(port, track, barrierZone, x, y) >= LANE_CLEARANCE;
  };
  const plotClear = (cx: number, cy: number, horizontal: boolean) => {
    for (let t = 0; t <= PORT_CELL; t += 32) {
      const ok = horizontal ? clear(cx + t, cy) : clearV(cx, cy + t);
      if (!ok) return false;
    }
    return true;
  };
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const ok = c < cols && plotClear(x0 + c * PORT_CELL, y0 + (r + 0.5) * PORT_CELL, true);
      if (ok && start < 0) start = c;
      if (!ok && start >= 0) {
        if (c - start >= 6) lanes.push({ from: { x: x0 + start * PORT_CELL + 24, y: y0 + (r + 0.5) * PORT_CELL }, to: { x: x0 + c * PORT_CELL - 24, y: y0 + (r + 0.5) * PORT_CELL } });
        start = -1;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      const ok = r < rows && plotClear(x0 + (c + 0.5) * PORT_CELL, y0 + r * PORT_CELL, false);
      if (ok && start < 0) start = r;
      if (!ok && start >= 0) {
        if (r - start >= 6) lanes.push({ from: { x: x0 + (c + 0.5) * PORT_CELL, y: y0 + start * PORT_CELL + 24 }, to: { x: x0 + (c + 0.5) * PORT_CELL, y: y0 + r * PORT_CELL - 24 } });
        start = -1;
      }
    }
  }
  return lanes.sort((a, b) => len(b) - len(a));
}

/** Straight crossings of open water, well clear of the quays. */
function findTugRoutes(port: Port, rng: () => number, count: number): Route[] {
  const { cols, rows, x0, y0 } = port;
  const open = (x: number, y: number) => {
    for (const [dx, dy] of [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]]) if (isLand(port, x + dx, y + dy)) return false;
    return true;
  };
  const routes: Route[] = [];
  for (let attempt = 0; attempt < count * 40 && routes.length < count; attempt++) {
    const from = { x: x0 + rng() * cols * PORT_CELL, y: y0 + rng() * rows * PORT_CELL };
    const a = rng() * Math.PI * 2;
    const distance = 600 + rng() * 1400;
    const to = { x: from.x + Math.cos(a) * distance, y: from.y + Math.sin(a) * distance };
    let ok = true;
    for (let t = 0; t <= distance && ok; t += 32) ok = open(from.x + Math.cos(a) * t, from.y + Math.sin(a) * t);
    if (ok) routes.push({ from, to });
  }
  return routes;
}

function len(route: Route): number {
  return Math.hypot(route.to.x - route.from.x, route.to.y - route.from.y);
}
