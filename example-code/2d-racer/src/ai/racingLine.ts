/**
 * The line an AI driver aims for, and how fast it can take each part of it.
 *
 * The racing line starts as the centre line and is repeatedly smoothed, each
 * point pulled towards the midpoint of its neighbours while staying on the
 * road. That straightens corners out: it swings wide, clips the apex and runs
 * out wide again, like a real racing line.
 */

import { DEFAULT_TUNING } from '../car/CarPhysics';
import type { Track, Vec2 } from '../track/Track';

export interface RacingLine {
  points: Vec2[];
  /** Sideways offset of each point from the centre line (+ = right of the driving direction). */
  offsets: number[];
  /**
   * Where a car's centre may be at each point: within the road (minus a
   * margin) and clear of obstacles. lo is the leftmost offset, hi the rightmost.
   */
  lo: number[];
  hi: number[];
  /** Fastest the line can be taken at each point (px/s), including braking for what's ahead. */
  speeds: number[];
}

export interface RacingLineOptions {
  /** How close to the road edge the line may go (px from the edge). */
  edgeMargin: number;
  /** Smoothing passes; more = straighter line. */
  iterations: number;
  /** Corner speed for a given radius, as a multiple of radius × turn rate. Higher = braver. */
  cornerFactor: number;
  /** Deceleration assumed when planning braking (px/s²), a little under the car's real brakes. */
  braking: number;
}

export const DEFAULT_LINE: RacingLineOptions = {
  edgeMargin: 26,
  iterations: 300,
  cornerFactor: 0.55,
  braking: 700,
};

export function buildRacingLine(track: Track, options: Partial<RacingLineOptions> = {}): RacingLine {
  const { edgeMargin, iterations, cornerFactor, braking } = { ...DEFAULT_LINE, ...options };
  const { points: centre, normals } = track;
  const n = centre.length;
  const { lo, hi } = allowedOffsets(track, edgeMargin);
  const offsets = lo.map((l, i) => (l + hi[i]) / 2);

  const at = (i: number) => ({
    x: centre[i].x + normals[i].x * offsets[i],
    y: centre[i].y + normals[i].y * offsets[i],
  });

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const prev = at((i - 1 + n) % n);
      const next = at((i + 1) % n);
      const mid = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
      // Only move sideways: keep each point level with its centre-line sample.
      const offset = (mid.x - centre[i].x) * normals[i].x + (mid.y - centre[i].y) * normals[i].y;
      offsets[i] = Math.max(lo[i], Math.min(hi[i], offset));
    }
  }

  const points = centre.map((_, i) => at(i));
  const speeds = points.map((_, i) => {
    const radius = turnRadius(points, i, 3);
    return Math.min(DEFAULT_TUNING.maxForwardSpeed, cornerFactor * DEFAULT_TUNING.maxTurnRate * radius);
  });

  // Work backwards from each corner so the car brakes in time for it. Two
  // passes round the loop so corners just after the start line are covered.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {
      const i = k;
      const next = (i + 1) % n;
      const ds = Math.hypot(points[next].x - points[i].x, points[next].y - points[i].y);
      speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[next] ** 2 + 2 * braking * ds));
    }
  }

  return { points, offsets, lo, hi, speeds };
}

/** How far a car's centre must stay from an obstacle's edge when passing it. */
const OBSTACLE_CLEARANCE = 30;
/** How far before and after an obstacle the car must already be clear of it, px. */
const OBSTACLE_RUN_UP = 160;

/** The road at each point minus a margin, with the side of any obstacle closed off around it. */
function allowedOffsets(track: Track, edgeMargin: number): { lo: number[]; hi: number[] } {
  const n = track.points.length;
  const hi = track.halfWidths.map((h) => h - edgeMargin);
  const lo = hi.map((h) => -h);
  for (const o of track.obstacles) {
    const k = Math.round(o.along / track.spacing);
    const window = Math.ceil((o.reach + OBSTACLE_RUN_UP) / track.spacing);
    for (let d = -window; d <= window; d++) {
      const i = (((k + d) % n) + n) % n;
      // Pass on the side with more road.
      if (o.offset > 0) hi[i] = Math.min(hi[i], o.offset - o.reach - OBSTACLE_CLEARANCE);
      else lo[i] = Math.max(lo[i], o.offset + o.reach + OBSTACLE_CLEARANCE);
    }
  }
  return { lo, hi };
}

/** Radius of the circle through the points k samples either side of i. */
function turnRadius(points: Vec2[], i: number, k: number): number {
  const n = points.length;
  const a = points[(i - k + n) % n];
  const b = points[i];
  const c = points[(i + k) % n];
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (cross < 1e-6) return Infinity;
  return (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) * Math.hypot(a.x - c.x, a.y - c.y)) / (2 * cross);
}
