import type * as Phaser from 'phaser';
import type { Location } from '../locations/locations';
import { type ChunkLayers, ChunkedGraphics } from '../scenes/ChunkLayers';
import type { City, Street } from './city';

/** Road paint. */
const WHITE = 0xf2f2f2;
const YELLOW = 0xf2c230;
/** Width of a parking lane down each side of a street, px. */
export const PARKING_LANE = 30;
/** Zebra crossings: how deep (along the road) and the width of each stripe and gap, px. */
export const CROSSING = { depth: 34, stripe: 9 };
/** Gap between a junction's box and its crossings, and between a crossing and the stop line, px. */
export const CROSSING_GAP = 10;

/**
 * Draws all the city's streets, the race's and the side streets alike, so
 * the race runs on the grid itself: kerbs, then tarmac (with a square of it
 * at every junction), then the paint: a double yellow line down the middle,
 * lane lines (dashed between the lanes of the race's wider streets), the
 * edge of the parking lanes, and at both ends of every street a zebra
 * crossing and a stop line. The race's streets get patches, wear and
 * manholes. Kerbs, road and paint at three steps of `depth`, in chunks.
 */
export function drawStreets(scene: Phaser.Scene, city: City, location: Location, chunks: ChunkLayers, depth: number): void {
  const { surface, kerbColors } = location.road;
  const { streets, junctions } = city;
  /** The widest street meeting at each junction, and its kerb. */
  const widest = new Map<City['junctions'][number], Street>();
  for (const s of streets) {
    for (const j of [s.a, s.b]) {
      const w = widest.get(j);
      if (!w || s.width > w.width) widest.set(j, s);
    }
  }

  let g = new ChunkedGraphics(scene, chunks, depth);
  for (const s of streets) {
    g.fillStyle(kerbColors[0]);
    rect(g, s, s.width / 2 + s.kerb, 0, 0);
    g.fillStyle(0x7d7a73);
    // A darker line along the kerbs' outer edges.
    span(g, s, 0, length(s), s.width / 2 + s.kerb - 2, s.width / 2 + s.kerb);
    span(g, s, 0, length(s), -s.width / 2 - s.kerb, -s.width / 2 - s.kerb + 2);
  }
  for (const j of junctions) {
    const w = widest.get(j)!;
    const half = w.width / 2 + w.kerb;
    g.fillStyle(kerbColors[0]).fillRect(j.x - half, j.y - half, half * 2, half * 2);
  }

  g = new ChunkedGraphics(scene, chunks, depth + 0.01);
  g.fillStyle(surface);
  for (const s of streets) rect(g, s, s.width / 2, 0, 0);
  for (const j of junctions) {
    const half = widest.get(j)!.width / 2;
    g.fillRect(j.x - half, j.y - half, half * 2, half * 2);
  }
  // The race's streets: patched here and there, worn in the lanes, and manholes.
  let seed = 23;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const s of streets) {
    if (!s.onTrack) continue;
    const half = s.width / 2;
    const len = length(s);
    g.fillStyle(0xffffff, 0.035);
    for (const lane of [-0.62, -0.25, 0.25, 0.62]) span(g, s, s.box[0], len - s.box[1], lane * half - 8, lane * half + 8);
    for (let a = s.box[0] + 40; a < len - s.box[1] - 40; a += 60) {
      if (rand() < 0.15) {
        const across = (rand() * 2 - 1) * half * 0.7;
        const w = 20 + rand() * 40;
        g.fillStyle(0x000000, 0.1);
        span(g, s, a, a + 30 + rand() * 60, across - w / 2, across + w / 2);
      }
      if (rand() < 0.08) {
        const p = point(s, a, (rand() * 2 - 1) * half * 0.6);
        g.fillStyle(0x2f3236).fillCircle(p.x, p.y, 9);
        g.fillStyle(0x55585e).fillCircle(p.x, p.y, 6.5);
      }
    }
  }

  g = new ChunkedGraphics(scene, chunks, depth + 0.02);
  for (const s of streets) {
    const half = s.width / 2;
    const len = length(s);
    const [boxA, boxB] = s.box;
    // The lines run between the stop lines.
    const from = boxA + CROSSING_GAP * 2 + CROSSING.depth;
    const to = len - boxB - CROSSING_GAP * 2 - CROSSING.depth;
    if (to > from) {
      g.fillStyle(YELLOW, 0.85);
      span(g, s, from, to, -5, -2);
      span(g, s, from, to, 2, 5);
      g.fillStyle(WHITE, 0.75);
      for (const side of [1, -1]) {
        const edge = side * (half - PARKING_LANE);
        span(g, s, from, to, edge - 1, edge + 1);
        // On the race's four-lane streets, dashes between the lanes each way.
        if (s.onTrack) {
          const lane = side * (half - PARKING_LANE) / 2;
          for (let a = from; a < to; a += 64) span(g, s, a, Math.min(a + 32, to), lane - 1.5, lane + 1.5);
        }
      }
    }
    // A zebra crossing at each end, and before it the stop line for traffic coming in on the right.
    for (const [atA, box] of [[true, boxA], [false, boxB]] as const) {
      const mid = box + CROSSING_GAP + CROSSING.depth / 2;
      const along = atA ? mid : len - mid;
      g.fillStyle(WHITE, 0.85);
      for (let x = -half + 4; x < half - 4; x += CROSSING.stripe * 2) {
        span(g, s, along - CROSSING.depth / 2, along + CROSSING.depth / 2, x, Math.min(x + CROSSING.stripe, half - 4));
      }
      const stop = atA ? mid + CROSSING.depth / 2 + CROSSING_GAP : len - mid - CROSSING.depth / 2 - CROSSING_GAP;
      // Heading for a (from b) the right-hand side is the street's -side; heading for b, its +side.
      span(g, s, stop - 3, stop + 3, atA ? -half + 4 : 2, atA ? -2 : half - 4);
    }
  }
}

/** Wraps a difference in distance along a loop into -length/2 .. length/2. */
export function wrap(d: number, length: number): number {
  return ((((d + length / 2) % length) + length) % length) - length / 2;
}

function length(s: Street): number {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
}

/**
 * A point on a street, `along` px from its first junction (a) and `across` px
 * to the right of the way from a to b. Streets run from a to b left to right
 * or top to bottom: right of the way is +y for an east-west street and -x for
 * a north-south one.
 */
export function point(s: Street, along: number, across: number): { x: number; y: number } {
  return s.horizontal ? { x: s.a.x + along, y: s.a.y + across } : { x: s.a.x - across, y: s.a.y + along };
}

/** A rectangle along a street from `start` px after its first junction to `end` px before its second, `half` px either side. */
function rect(g: ChunkedGraphics, s: Street, half: number, start: number, end: number): void {
  span(g, s, start, length(s) - end, -half, half);
}

/** A rectangle on a street: `a0` to `a1` px along it from its first junction, `from` to `to` px across. */
function span(g: ChunkedGraphics, s: Street, a0: number, a1: number, from: number, to: number): void {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (s.horizontal) g.fillRect(s.a.x + a0, s.a.y + lo, a1 - a0, hi - lo);
  else g.fillRect(s.a.x - hi, s.a.y + a0, hi - lo, a1 - a0);
}
