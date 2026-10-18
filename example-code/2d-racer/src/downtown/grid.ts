/**
 * The street grid of a downtown, and the loop a race takes round it.
 *
 * The city is a grid of blocks (each column and row of blocks its own width,
 * so the streets aren't evenly spaced). The race follows the outline of a
 * random patch of blocks: grown block by block from the middle of town,
 * never leaving a hole or two blocks touching only at a corner, so its
 * outline is a single loop of streets with right-angle turns at the
 * junctions. Every other street is left to the city (see plan.ts).
 */

import type { TrackDifficulty } from '../track/Track';

/** Where the streets run: the x of each north-south street and the y of each east-west one, px. */
export interface CityGrid {
  xs: number[];
  ys: number[];
}

type P = [number, number];

/** How the blocks come out at each track difficulty. */
const BLOCKS: Record<TrackDifficulty, { size: [number, number]; corner: [number, number]; cornersPer10k: [number, number] }> = {
  // Big blocks and few corners: long straights.
  easy: { size: [1150, 1550], corner: [250, 300], cornersPer10k: [3, 5.5] },
  medium: { size: [1000, 1400], corner: [215, 265], cornersPer10k: [5, 7.5] },
  // Smaller blocks, and corner after corner.
  hard: { size: [880, 1250], corner: [185, 225], cornersPer10k: [6.5, 11] },
};

/** Blocks across the city each way (the race keeps a block or more from the edge). */
const BLOCKS_ACROSS = 20;
/** Spacing of the extra points that keep straights straight, px. */
const STRAIGHT_STEP = 350;

/**
 * A loop round a patch of city blocks about `target` px long (before its
 * corners are rounded off, which shortens it a little), as control points for
 * a track, and the city's streets. Null if this attempt didn't come out right.
 */
export function cityLoop(rng: () => number, target: number, difficulty: TrackDifficulty): { points: P[]; grid: CityGrid } | null {
  const settings = BLOCKS[difficulty];
  const [lo, hi] = settings.size;
  const lines = (count: number) => {
    const at = [0];
    for (let k = 0; k < count; k++) at.push(at[k] + Math.round(lo + rng() * (hi - lo)));
    return at;
  };
  const grid: CityGrid = { xs: lines(BLOCKS_ACROSS), ys: lines(BLOCKS_ACROSS) };

  const patch = growPatch(rng, grid, target);
  if (!patch) return null;
  const corners = turns(outline(patch)!);
  // Few enough corners (or enough) for the difficulty.
  const [cMin, cMax] = settings.cornersPer10k;
  if (corners.length < (cMin * target) / 10_000 || corners.length > (cMax * target) / 10_000) return null;
  const poly: P[] = corners.map(([i, j]) => [grid.xs[i], grid.ys[j]]);

  // Round off each corner and put points along the straights.
  const [sMin, sMax] = settings.corner;
  const points: P[] = [];
  poly.forEach((v, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const inLen = Math.hypot(v[0] - prev[0], v[1] - prev[1]);
    const outLen = Math.hypot(next[0] - v[0], next[1] - v[1]);
    const size = Math.min(sMin + rng() * (sMax - sMin), inLen * 0.42, outLen * 0.42);
    points.push(
      [v[0] + ((prev[0] - v[0]) / inLen) * size, v[1] + ((prev[1] - v[1]) / inLen) * size],
      [v[0] + ((next[0] - v[0]) / outLen) * size, v[1] + ((next[1] - v[1]) / outLen) * size],
    );
    const straight = outLen - size * 2;
    // At least a couple of points between corners, so the road runs straight down the street between them.
    const steps = Math.max(3, Math.floor(straight / STRAIGHT_STEP));
    for (let k = 1; k < steps; k++) {
      const f = (size + (k * straight) / steps) / outLen;
      points.push([v[0] + (next[0] - v[0]) * f, v[1] + (next[1] - v[1]) * f]);
    }
  });
  return { points, grid };
}

/** A block, by its column and row. */
const key = (i: number, j: number) => i * 1000 + j;

/** The junctions where a loop of junctions turns. */
function turns(loop: P[]): P[] {
  return loop.filter((v, i) => {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[(i + 1) % loop.length];
    return (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]) !== 0;
  });
}

/**
 * Grows a patch of blocks round the middle of town until its outline is
 * about `target` px long: starting from a rectangle of blocks, adding
 * rectangles onto its sides and now and then cutting notches out of them.
 */
function growPatch(rng: () => number, grid: CityGrid, target: number): Set<number> | null {
  const width = (i: number) => grid.xs[i + 1] - grid.xs[i];
  const height = (j: number) => grid.ys[j + 1] - grid.ys[j];
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const mid = BLOCKS_ACROSS / 2;
  const patch = new Set<number>();
  const w0 = int(1, 3);
  const h0 = int(1, 3);
  for (let i = 0; i < w0; i++) for (let j = 0; j < h0; j++) patch.add(key(mid - 1 + i, mid - 1 + j));
  // Outline length: every side of a block in the patch that faces a block outside it.
  const perimeter = () => {
    let sum = 0;
    for (const k of patch) {
      const i = Math.floor(k / 1000);
      const j = k % 1000;
      if (!patch.has(key(i - 1, j))) sum += height(j);
      if (!patch.has(key(i + 1, j))) sum += height(j);
      if (!patch.has(key(i, j - 1))) sum += width(i);
      if (!patch.has(key(i, j + 1))) sum += width(i);
    }
    return sum;
  };
  const inTown = (i: number, j: number) => i >= 2 && j >= 2 && i < BLOCKS_ACROSS - 2 && j < BLOCKS_ACROSS - 2;
  for (let step = 0; step < 200; step++) {
    const length = perimeter();
    if (length >= target) return length <= target * 1.06 ? patch : null;
    // A rectangle of blocks next to (or, to cut a notch, in) the patch, off one of its blocks.
    const cells = [...patch];
    const k = cells[Math.floor(rng() * cells.length)];
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][int(0, 3)];
    const carve = rng() < 0.25;
    const along = int(1, 3);
    const deep = int(1, 2);
    const i0 = Math.floor(k / 1000) + (carve ? 0 : dx);
    const j0 = (k % 1000) + (carve ? 0 : dy);
    const rect: number[] = [];
    for (let a = 0; a < along; a++) {
      for (let d = 0; d < deep; d++) {
        // Deep goes outwards (dx, dy); along runs across it.
        const i = i0 + dx * d * (carve ? -1 : 1) + (dx === 0 ? a : 0);
        const j = j0 + dy * d * (carve ? -1 : 1) + (dy === 0 ? a : 0);
        rect.push(key(i, j));
      }
    }
    if (rect.some((c) => !inTown(Math.floor(c / 1000), c % 1000))) continue;
    const changed = rect.filter((c) => patch.has(c) === carve);
    if (changed.length === 0) continue;
    for (const c of changed) carve ? patch.delete(c) : patch.add(c);
    // Keep it one piece with a single simple outline (and, cutting, longer).
    if (patch.size === 0 || !outline(patch) || (carve && perimeter() <= length)) {
      for (const c of changed) carve ? patch.add(c) : patch.delete(c);
    }
  }
  return null;
}

/**
 * The outline of a patch of blocks as a loop of street junctions (column,
 * row), or null if it isn't one simple loop (a hole in the patch, or two
 * blocks meeting only at a corner).
 */
export function outline(patch: Set<number>): P[] | null {
  // Each side of a patch block facing outwards is a street between two junctions.
  const next = new Map<number, number[]>();
  const link = (a: P, b: P) => {
    const ka = key(a[0], a[1]);
    const kb = key(b[0], b[1]);
    next.set(ka, [...(next.get(ka) ?? []), kb]);
    next.set(kb, [...(next.get(kb) ?? []), ka]);
  };
  let edges = 0;
  for (const k of patch) {
    const i = Math.floor(k / 1000);
    const j = k % 1000;
    if (!patch.has(key(i - 1, j))) (link([i, j], [i, j + 1]), edges++);
    if (!patch.has(key(i + 1, j))) (link([i + 1, j], [i + 1, j + 1]), edges++);
    if (!patch.has(key(i, j - 1))) (link([i, j], [i + 1, j]), edges++);
    if (!patch.has(key(i, j + 1))) (link([i, j + 1], [i + 1, j + 1]), edges++);
  }
  // A junction where four outline streets meet is two blocks touching at a corner.
  for (const ends of next.values()) if (ends.length !== 2) return null;
  // Walk round from any junction: a single loop visits every street once.
  const start = next.keys().next().value as number;
  const loop: P[] = [];
  let prev = -1;
  let at = start;
  do {
    loop.push([Math.floor(at / 1000), at % 1000]);
    const [a, b] = next.get(at)!;
    const step = a === prev ? b : a;
    prev = at;
    at = step;
  } while (at !== start && loop.length <= edges);
  return loop.length === edges ? loop : null;
}
