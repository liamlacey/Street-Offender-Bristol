/**
 * Track geometry, independent of Phaser so it can be unit tested.
 *
 * A track is defined as a closed loop of control points. These are smoothed
 * into a centre line (centripetal Catmull-Rom) and resampled at even spacing.
 * Everything else — what surface the car is on, where the start line is, and
 * later checkpoints and AI racing lines — is derived from that centre line.
 */

import type { SurfaceKind } from '../car/CarPhysics';
import type { CityGrid } from '../downtown/grid';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose extends Vec2 {
  heading: number;
}

export type TrackDifficulty = 'easy' | 'medium' | 'hard';

/** Something placed on the road that you have to drive round. */
export interface Obstacle {
  /** Distance along the track from the start line, px. */
  along: number;
  /** Sideways position of its centre from the centre line (+ = right of the driving direction), px. */
  offset: number;
  /** How far it reaches either side of its centre, across the road, px. */
  reach: number;
  /** Both get knocked about: loose tyres are heavier than cones. Nothing on the road is fixed. */
  kind: 'tyres' | 'cones';
}

export interface TrackDefinition {
  name: string;
  /** Road width in px, kerb to kerb (where `widths` doesn't say otherwise). */
  width: number;
  /**
   * For roads that widen and narrow: the width at points along the track
   * (distance from the start line), eased smoothly in between.
   */
  widthKnots?: { along: number; width: number }[];
  /** Kerb width in px, on each side of the road. */
  kerbWidth: number;
  /** Control points of the closed loop, in driving order. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Where the start/finish line is: distance along the loop from the first control point (default 0). */
  startAlong?: number;
  obstacles?: Obstacle[];
  /** Grass between the kerb and the barrier, px (default: the standard run-off). */
  runOff?: number;
  /** How hard the generator was asked to make it, for showing in the menus. */
  difficulty?: TrackDifficulty;
  /** Downtown: the street grid the track runs round (see downtown/grid.ts). */
  grid?: CityGrid;
}

export interface Track {
  name: string;
  /** The widest the road gets, px. Use `halfWidths` for the width at a point. */
  width: number;
  /** Half the road width at each centre-line sample. */
  halfWidths: number[];
  kerbWidth: number;
  /** Evenly spaced centre-line samples. The loop is closed: the last point connects back to the first. */
  points: Vec2[];
  /** Unit vectors pointing to the right of the driving direction, one per sample. */
  normals: Vec2[];
  spacing: number;
  length: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  obstacles: Obstacle[];
  runOff: number | undefined;
  /** Downtown: the street grid the track runs round. */
  grid: CityGrid | undefined;
}

export interface TrackPosition {
  /** Distance from the centre line in px. */
  distance: number;
  /** Distance along the track from the start line in px. */
  along: number;
  /** Driving direction of the track at this point. */
  heading: number;
  /** The closest point on the centre line. */
  x: number;
  y: number;
  /** Half the road width there. */
  halfWidth: number;
}

export function buildTrack(def: TrackDefinition, spacing = 32): Track {
  const dense = smoothLoop(def.points.map(([x, y]) => ({ x, y })), 24);
  const sampled = resampleLoop(dense, spacing);
  const n = sampled.length;
  // Rotate the loop so the first sample is on the start line.
  const shift = Math.round(((def.startAlong ?? 0) / loopLength(sampled)) * n) % n;
  const points = [...sampled.slice(shift), ...sampled.slice(0, shift)];
  const normals = points.map((_, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const len = Math.hypot(next.x - prev.x, next.y - prev.y);
    // Right-hand normal for a y-down screen: rotate the tangent 90° clockwise.
    return { x: -(next.y - prev.y) / len, y: (next.x - prev.x) / len };
  });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const halfWidths = sampleHalfWidths(def, points);
  return {
    name: def.name,
    width: Math.max(...halfWidths) * 2,
    halfWidths,
    kerbWidth: def.kerbWidth,
    points,
    normals,
    spacing: loopLength(points) / n,
    length: loopLength(points),
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
    obstacles: def.obstacles ?? [],
    runOff: def.runOff,
    grid: def.grid,
  };
}

/** Half the road width at each sample, eased smoothly between the width knots. */
function sampleHalfWidths(def: TrackDefinition, points: Vec2[]): number[] {
  const n = points.length;
  const knots = [...(def.widthKnots ?? [])].sort((a, b) => a.along - b.along);
  if (knots.length === 0) return new Array<number>(n).fill(def.width / 2);
  const length = loopLength(points);
  const spacing = length / n;
  return points.map((_, i) => {
    const along = i * spacing;
    // The knots either side of this point, wrapping round the loop.
    let next = knots.findIndex((k) => k.along > along);
    if (next === -1) next = 0;
    const prev = (next - 1 + knots.length) % knots.length;
    const a = knots[prev];
    const b = knots[next];
    const span = (b.along - a.along + length) % length || length;
    const t = (((along - a.along + length) % length) / span);
    const eased = (1 - Math.cos(Math.PI * t)) / 2;
    return (a.width + (b.width - a.width) * eased) / 2;
  });
}

/** Finds the closest point on the centre line to (x, y). */
export function locateOnTrack(track: Track, x: number, y: number): TrackPosition {
  // Search outwards ring by ring through a grid of the track's segments,
  // stopping once nothing in a further ring could be closer than the best so
  // far. Same answer as checking every segment, but only looks at a few.
  const grid = segmentGrid(track);
  const cx = Math.floor(x / grid.cell);
  const cy = Math.floor(y / grid.cell);
  const stamp = ++grid.stamp;
  let best: TrackPosition = { distance: Infinity, along: 0, heading: 0, x: 0, y: 0, halfWidth: track.width / 2 };
  let bestIndex = -1;
  for (let ring = 0; ring <= grid.maxRing; ring++) {
    for (let gx = cx - ring; gx <= cx + ring; gx++) {
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue; // just this ring
        for (const i of grid.cells.get(cellKey(gx, gy)) ?? []) {
          if (grid.seen[i] === stamp) continue;
          grid.seen[i] = stamp;
          const candidate = nearestOnSegment(track, i, x, y);
          // Ties go to the lower index, matching a plain front-to-back scan.
          if (candidate.distance < best.distance || (candidate.distance === best.distance && i < bestIndex)) {
            best = candidate;
            bestIndex = i;
          }
        }
      }
    }
    if (best.distance <= ring * grid.cell) break;
  }
  return best;
}

function nearestOnSegment(track: Track, i: number, x: number, y: number): TrackPosition {
  const { points } = track;
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  const px = a.x + dx * t;
  const py = a.y + dy * t;
  const halfWidth = track.halfWidths[i] + (track.halfWidths[(i + 1) % points.length] - track.halfWidths[i]) * t;
  return {
    distance: Math.hypot(x - px, y - py),
    along: (i + t) * track.spacing,
    heading: Math.atan2(dy, dx),
    x: px,
    y: py,
    halfWidth,
  };
}

interface SegmentGrid {
  cell: number;
  /** Segment indices in each cell the segment passes through. */
  cells: Map<number, number[]>;
  /** Rings needed to cover the whole track from anywhere near it. */
  maxRing: number;
  /** Per-segment marker so a segment in several cells is only checked once per search. */
  seen: Uint32Array;
  stamp: number;
}

const GRID_CELL = 256;
const grids = new WeakMap<Track, SegmentGrid>();

function cellKey(gx: number, gy: number): number {
  return (gx + 50_000) * 100_000 + (gy + 50_000);
}

/** Built once per track, on first use. */
function segmentGrid(track: Track): SegmentGrid {
  const existing = grids.get(track);
  if (existing) return existing;
  const { points } = track;
  const n = points.length;
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let gx = Math.floor(Math.min(a.x, b.x) / GRID_CELL); gx <= Math.floor(Math.max(a.x, b.x) / GRID_CELL); gx++) {
      for (let gy = Math.floor(Math.min(a.y, b.y) / GRID_CELL); gy <= Math.floor(Math.max(a.y, b.y) / GRID_CELL); gy++) {
        const key = cellKey(gx, gy);
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  }
  const { minX, minY, maxX, maxY } = track.bounds;
  // Generous: far enough to reach the whole track from well outside it.
  const maxRing = Math.ceil(Math.max(maxX - minX, maxY - minY) / GRID_CELL) + 64;
  const grid = { cell: GRID_CELL, cells, maxRing, seen: new Uint32Array(n), stamp: 0 };
  grids.set(track, grid);
  return grid;
}

export function surfaceAt(track: Track, x: number, y: number): SurfaceKind {
  return surfaceOf(track, locateOnTrack(track, x, y));
}

/** Surface at a located position (uses the road's width there). */
export function surfaceOf(track: Track, pos: TrackPosition): SurfaceKind {
  if (pos.distance <= pos.halfWidth) return 'road';
  if (pos.distance <= pos.halfWidth + track.kerbWidth) return 'kerb';
  return 'grass';
}

/**
 * Why a layout can't be raced, or null if it's fine: the road must never come
 * close enough to another part of itself to overlap (with some grass between),
 * and no corner can be so tight that the inside kerb folds over itself.
 */
export function layoutProblem(track: Track): string | null {
  const radii = turnRadii(track);
  for (let i = 0; i < radii.length; i++) {
    const halfOuter = track.halfWidths[i] + track.kerbWidth;
    if (radii[i] < halfOuter + 10) return `corner too tight (radius ${radii[i].toFixed(0)})`;
  }
  const clearance = minClearance(track);
  if (clearance < 60) return `road too close to itself (${clearance.toFixed(0)}px of grass)`;
  return null;
}

/** Smallest turning radius of the centre line, measured over 3 samples either side. */
export function minTurnRadius(track: Track): number {
  return Math.min(...turnRadii(track));
}

/** Turning radius at every sample (Infinity on a straight). */
export function turnRadii(track: Track, k = 3): number[] {
  const { points } = track;
  const n = points.length;
  return points.map((b, i) => {
    const a = points[(i - k + n) % n];
    const c = points[(i + k) % n];
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (cross < 1e-6) return Infinity;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    return (ab * bc * ca) / (2 * cross);
  });
}

/**
 * Least grass between the kerbs of any two parts of the loop that are far
 * apart when driving (e.g. the two sides of a hairpin), px. Uses a grid of
 * samples so only nearby ones are compared.
 */
export function minClearance(track: Track): number {
  const { points, halfWidths, kerbWidth } = track;
  const n = points.length;
  const maxOuter = track.width / 2 + kerbWidth;
  const skip = Math.ceil((maxOuter * 4) / track.spacing);
  const cell = maxOuter * 2 + 60;
  const cells = new Map<number, number[]>();
  points.forEach((p, i) => {
    const key = cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  let least = Infinity;
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of cells.get(cellKey(gx, gy)) ?? []) {
          const apart = Math.abs(i - j);
          if (j <= i || Math.min(apart, n - apart) < skip) continue;
          const gap =
            Math.hypot(p.x - points[j].x, p.y - points[j].y) - (halfWidths[i] + kerbWidth) - (halfWidths[j] + kerbWidth);
          if (gap < least) least = gap;
        }
      }
    }
  });
  return least;
}

/** Position and driving direction at a distance along the track (wraps around the loop). */
export function poseAt(track: Track, along: number): Pose {
  const n = track.points.length;
  const f = (((along / track.spacing) % n) + n) % n;
  const i = Math.floor(f);
  const a = track.points[i];
  const b = track.points[(i + 1) % n];
  const t = f - i;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Centripetal Catmull-Rom through a closed loop of points (no cusps or self-loops on uneven spacing). */
function smoothLoop(ctrl: Vec2[], samplesPerSegment: number): Vec2[] {
  const n = ctrl.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const t2 = t1 + Math.sqrt(Math.hypot(p2.x - p1.x, p2.y - p1.y));
    const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y));
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const a1 = lerpAt(p0, p1, t0, t1, t);
      const a2 = lerpAt(p1, p2, t1, t2, t);
      const a3 = lerpAt(p2, p3, t2, t3, t);
      const b1 = lerpAt(a1, a2, t0, t2, t);
      const b2 = lerpAt(a2, a3, t1, t3, t);
      out.push(lerpAt(b1, b2, t1, t2, t));
    }
  }
  return out;
}

function lerpAt(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  const k = (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Resamples a closed polyline so consecutive points are (almost exactly) `spacing` apart. */
export function resampleLoop(poly: Vec2[], spacing: number): Vec2[] {
  const total = loopLength(poly);
  const count = Math.max(3, Math.round(total / spacing));
  const step = total / count;
  const out: Vec2[] = [];
  let seg = 0;
  let segStart = 0; // distance along the loop where `seg` starts
  for (let k = 0; k < count; k++) {
    const target = k * step;
    for (;;) {
      const a = poly[seg];
      const b = poly[(seg + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (target <= segStart + len || seg === poly.length - 1) {
        const t = len === 0 ? 0 : (target - segStart) / len;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
      segStart += len;
      seg++;
    }
  }
  return out;
}

function loopLength(poly: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
