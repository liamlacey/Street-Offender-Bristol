/**
 * Procedural track generation.
 *
 * Built like a real circuit from straights and corners:
 *   1. Scatter random points and take their convex hull: the hull's edges are
 *      long straights and its vertices are corners.
 *   2. Keep splitting the longest edge, pushing its middle in (mostly) or out,
 *      until there are as many corners as the difficulty asks for per length
 *      of track. That makes bends, chicanes and kinks, and leaves the
 *      remaining long edges as straights.
 *   3. Scale it so the lap is the length asked for.
 *   4. Round each corner off (tighter on harder tracks), and put extra points
 *      along each straight so the smoothing keeps it straight.
 *   5. On harder tracks, vary the road width and put loose obstacles (cones,
 *      tyres) on the road. Nothing fixed ever goes on the road.
 * The result must pass the same checks as a hand-made track (no overlapping
 * road, no corner too tight); failures are thrown away and another is tried.
 * The start line goes on the straightest stretch, with room for the grid, and
 * the road there is kept at full width.
 *
 * Generation is deterministic: the same location, length, difficulty and seed
 * always make the same track.
 */

import type { Location } from '../locations/locations';
import { type CityGrid, cityLoop } from '../downtown/grid';
import { RUN_OFF } from './barriers';
import {
  type Obstacle,
  type Track,
  type TrackDefinition,
  type TrackDifficulty,
  buildTrack,
  layoutProblem,
  turnRadii,
} from './Track';

export type TrackLength = 'short' | 'medium' | 'long';
export const TRACK_LENGTHS: TrackLength[] = ['short', 'medium', 'long'];
export const TRACK_DIFFICULTIES: TrackDifficulty[] = ['easy', 'medium', 'hard'];
export type { TrackDifficulty };

/** Lap length range for each setting, px (about 600 px per second of lap time at racing speed). */
const LENGTHS: Record<TrackLength, [number, number]> = {
  short: [16000, 20000],
  medium: [26000, 32000],
  long: [40000, 48000],
};

interface DifficultySettings {
  /** Corners per 10,000 px of track: more means fewer, shorter straights. */
  cornersPer10k: number;
  /** How much of each corner is rounded off, px: smaller = tighter. */
  cornerSize: [number, number];
  /** How deep bends are pushed into an edge, as a fraction of its length. */
  bendDepth: [number, number];
  /** Average road width, as a multiple of the location's usual width. */
  widthScale: number;
  /** How much of the location's width variation to use (0 = fixed width). */
  widthVariation: number;
  /** Track length per obstacle on the road, px, or null for none. */
  obstacleEvery: number | null;
  /** Share of obstacles that are loose tyres, heavier than cones (the rest are cones). */
  tyreShare: number;
  /** Grass between kerb and barrier, px. */
  runOff: number;
}

const DIFFICULTY: Record<TrackDifficulty, DifficultySettings> = {
  easy: {
    cornersPer10k: 4,
    cornerSize: [320, 650],
    bendDepth: [0.2, 0.45],
    widthScale: 1.1,
    widthVariation: 0,
    obstacleEvery: null,
    tyreShare: 0,
    runOff: RUN_OFF,
  },
  medium: {
    cornersPer10k: 6,
    cornerSize: [200, 480],
    bendDepth: [0.25, 0.6],
    widthScale: 1,
    widthVariation: 0.5,
    obstacleEvery: 6500,
    tyreShare: 0,
    runOff: 120,
  },
  hard: {
    cornersPer10k: 8.5,
    cornerSize: [130, 330],
    bendDepth: [0.3, 0.7],
    widthScale: 0.9,
    widthVariation: 1,
    obstacleEvery: 3000,
    tyreShare: 0.5,
    runOff: 85,
  },
};

const MAX_ATTEMPTS = 300;
/** Generated tracks are moved so their nearest point is this far from 0,0. */
const ORIGIN_MARGIN = 1000;
/** Spacing of the extra points that keep straights straight, px. */
const STRAIGHT_STEP = 350;
/** Narrowest the road may get, px (the grid and AI need room). */
const MIN_WIDTH = 150;
/** Distance between the points where the road width is set, px. */
const WIDTH_KNOT_SPACING = 700;
/** Stretch kept clear and full width for the grid behind the line, and just after it, px. */
const GRID_ZONE = { behind: 1400, ahead: 400 };

type P = [number, number];

export function generateTrack(
  location: Location,
  length: TrackLength,
  seed: number,
  difficulty: TrackDifficulty = 'medium',
): TrackDefinition {
  const rng = mulberry32(seed);
  const settings = DIFFICULTY[difficulty];
  const [lo, hi] = LENGTHS[length];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const target = lo + rng() * (hi - lo);
    const shape = location.layout.grid ? cityCandidate(location, difficulty, target, rng) : candidate(location, settings, target, rng);
    if (!shape) continue;
    const draft = buildTrack(shape);
    if (draft.length < lo * 0.92 || draft.length > hi * 1.08) continue;
    const startAlong = straightestStart(draft);
    const def = { ...shape, startAlong, widthKnots: widthKnots(shape, draft.length, location, settings, rng) };
    const track = buildTrack(def);
    if (layoutProblem(track) !== null) continue;
    return {
      ...def,
      obstacles: placeObstacles(track, settings, rng, location.layout.grid === true),
      runOff: Math.round(settings.runOff * location.layout.runOffScale),
      difficulty,
    };
  }
  // Practically never reached; a plain oval always works.
  return { ...oval(location, lo), runOff: Math.round(settings.runOff * location.layout.runOffScale), difficulty };
}

function candidate(location: Location, settings: DifficultySettings, target: number, rng: () => number): TrackDefinition | null {
  // 1. Hull of scattered points, in a randomly stretched box.
  const aspect = 0.55 + rng() * 0.45;
  const scattered: P[] = Array.from({ length: 12 }, () => [rng() * 2 - 1, (rng() * 2 - 1) * aspect]);
  let poly = convexHull(scattered);
  if (poly.length < 3) return null;

  // 2. Split the longest edge with a bend until there are enough corners.
  // Twistier locations have more corners (0.5 is standard).
  const corners = Math.round((target / 10000) * settings.cornersPer10k * location.layout.twistiness * 2);
  const [dMin, dMax] = settings.bendDepth;
  while (poly.length < corners) {
    let longest = 0;
    let longestLen = 0;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > longestLen) {
        longestLen = len;
        longest = i;
      }
    });
    const a = poly[longest];
    const b = poly[(longest + 1) % poly.length];
    // Inward normal for an anticlockwise hull (y down): rotate the edge 90° anticlockwise.
    const nx = (b[1] - a[1]) / longestLen;
    const ny = -(b[0] - a[0]) / longestLen;
    const push = longestLen * (rng() < 0.75 ? dMin + rng() * (dMax - dMin) : -(0.05 + rng() * 0.2));
    const t = 0.35 + rng() * 0.3;
    poly.splice(longest + 1, 0, [a[0] + (b[0] - a[0]) * t + nx * push, a[1] + (b[1] - a[1]) * t + ny * push]);
  }

  // 3. Scale so the lap comes out at the target length (rounding corners shortens it a little).
  const scale = (target / perimeter(poly)) * 1.04;
  poly = poly.map(([x, y]) => [x * scale, y * scale]);

  // 4. Round off the corners; add points along the straights.
  const [sMin, sMax] = settings.cornerSize;
  const points: P[] = [];
  poly.forEach((v, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const inLen = Math.hypot(v[0] - prev[0], v[1] - prev[1]);
    const outLen = Math.hypot(next[0] - v[0], next[1] - v[1]);
    const size = Math.min(sMin + rng() * (sMax - sMin), inLen * 0.45, outLen * 0.45);
    points.push(
      [v[0] + ((prev[0] - v[0]) / inLen) * size, v[1] + ((prev[1] - v[1]) / inLen) * size],
      [v[0] + ((next[0] - v[0]) / outLen) * size, v[1] + ((next[1] - v[1]) / outLen) * size],
    );
    // Straight from this corner's exit towards the next corner's entry.
    const straight = outLen - size * 2;
    const steps = Math.floor(straight / STRAIGHT_STEP);
    for (let k = 1; k < steps; k++) {
      const f = (size + (k * straight) / steps) / outLen;
      points.push([v[0] + (next[0] - v[0]) * f, v[1] + (next[1] - v[1]) * f]);
    }
  });

  // Clockwise or anticlockwise, so tracks don't all turn the same way.
  if (rng() < 0.5) points.reverse();
  return normalise(location, points, settings.widthScale);
}

/** Downtown: a loop round a patch of city blocks, along the streets (see downtown/grid.ts). */
function cityCandidate(location: Location, difficulty: TrackDifficulty, target: number, rng: () => number): TrackDefinition | null {
  const loop = cityLoop(rng, target * 1.04, difficulty);
  if (!loop) return null;
  if (rng() < 0.5) loop.points.reverse();
  return normalise(location, loop.points, 1, loop.grid);
}

/**
 * Road width along the track: a smooth random swell and pinch around the usual
 * width, held at exactly the usual width through the grid and the start.
 */
function widthKnots(
  def: TrackDefinition,
  length: number,
  location: Location,
  settings: DifficultySettings,
  rng: () => number,
): { along: number; width: number }[] | undefined {
  const base = def.width;
  const swing = base * location.road.widthVariation * settings.widthVariation;
  if (swing === 0) return undefined;
  const zoneEnd = length - GRID_ZONE.behind;
  const knots = [
    { along: 0, width: base },
    { along: GRID_ZONE.ahead, width: base },
    { along: zoneEnd, width: base },
  ];
  const count = Math.floor((zoneEnd - GRID_ZONE.ahead) / WIDTH_KNOT_SPACING);
  for (let k = 1; k < count; k++) {
    const along = GRID_ZONE.ahead + (k * (zoneEnd - GRID_ZONE.ahead)) / count;
    knots.push({ along: Math.round(along), width: Math.max(MIN_WIDTH, Math.round(base + swing * (rng() * 2 - 1))) });
  }
  return knots;
}

/**
 * Obstacles narrowing one side of the road, spaced along the track away from
 * the grid and the tightest corners (in town, only on the straights between
 * the junctions: road works). Each leaves a clear gap on the other side.
 */
function placeObstacles(track: Track, settings: DifficultySettings, rng: () => number, straightsOnly: boolean): Obstacle[] {
  if (settings.obstacleEvery === null) return [];
  const count = Math.floor(track.length / settings.obstacleEvery);
  const radii = turnRadii(track, 4);
  const n = track.points.length;
  const usable = track.length - GRID_ZONE.behind - GRID_ZONE.ahead - 400;
  const obstacles: Obstacle[] = [];
  for (let k = 0; k < count; k++) {
    const along = GRID_ZONE.ahead + 400 + ((k + 0.25 + rng() * 0.5) / count) * usable;
    const i = Math.round(along / track.spacing) % n;
    if (radii[i] < 350) continue; // not mid-hairpin
    if (straightsOnly) {
      const reach = Math.ceil(500 / track.spacing);
      let straight = true;
      for (let k = -reach; k <= reach; k++) if (radii[(i + k + n) % n] < 1500) straight = false;
      if (!straight) continue;
    }
    const half = track.halfWidths[i];
    const tyres = rng() < settings.tyreShare;
    // How much of the road it takes, from one edge in.
    const span = half * (tyres ? 0.5 + rng() * 0.25 : 0.6 + rng() * 0.35);
    const side = rng() < 0.5 ? -1 : 1;
    obstacles.push({
      along,
      offset: side * (half - span / 2),
      reach: span / 2,
      kind: tyres ? 'tyres' : 'cones',
    });
  }
  return obstacles;
}

function oval(location: Location, length: number): TrackDefinition {
  const rx = length / 5.5;
  const ry = rx * 0.6;
  const raw: P[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    raw.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return normalise(location, raw, 1);
}

/**
 * Moves the points (and any city streets with them) to positive coordinates
 * and wraps them up as a definition for this location.
 */
function normalise(location: Location, raw: P[], widthScale: number, grid?: CityGrid): TrackDefinition {
  const dx = ORIGIN_MARGIN - Math.min(...raw.map(([x]) => x));
  const dy = ORIGIN_MARGIN - Math.min(...raw.map(([, y]) => y));
  const def: TrackDefinition = {
    name: location.name,
    width: Math.round(location.road.width * widthScale),
    kerbWidth: location.road.kerbWidth,
    points: raw.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as const),
  };
  if (grid) def.grid = { xs: grid.xs.map((x) => Math.round(x + dx)), ys: grid.ys.map((y) => Math.round(y + dy)) };
  return def;
}

function perimeter(poly: P[]): number {
  return poly.reduce((sum, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return sum + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }, 0);
}

/** Convex hull (Andrew's monotone chain), anticlockwise on a y-down screen. */
function convexHull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: P[]) => {
    const out: P[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * Distance along the loop for the start line: where the road is straightest
 * from a little way past the line back through the whole grid behind it.
 */
function straightestStart(track: Track): number {
  const radii = turnRadii(track, 4);
  const n = radii.length;
  const behind = Math.ceil(320 / track.spacing);
  const ahead = Math.ceil(120 / track.spacing);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    let tightest = Infinity;
    for (let k = -behind; k <= ahead; k++) tightest = Math.min(tightest, radii[(i + k + n) % n]);
    if (tightest > bestScore) {
      bestScore = tightest;
      best = i;
    }
  }
  return best * track.spacing;
}

/** Small, fast seeded random number generator (returns 0..1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new track. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
