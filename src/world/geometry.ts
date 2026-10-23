/**
 * Distances to lines, in the tight loops of laying the world out (see places, homes, parks, sites, parking): squared till the
 * end, one square root, and nothing made along the way (Math.hypot, and a pair made for each point, are far slower, and a
 * region's made from millions of these).
 */

import type { Pts } from '../map/osm';

/** How far (x, y) is from a polyline (its nearest segment). */
export function distanceTo(x: number, y: number, pts: Pts): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = distToSeg2(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** How far (x, y) is from a segment. */
export function distToSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(distToSeg2(x, y, ax, ay, bx, by));
}

/** The same, squared. */
function distToSeg2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - x;
  const ey = ay + dy * t - y;
  return ex * ex + ey * ey;
}

/** Things with a box round them (x0, y0, x1, y1), by the squares of the map they reach into: those near a box found at once. */
export class BoxGrid<T extends { x0: number; y0: number; x1: number; y1: number }> {
  private readonly cells = new Map<number, number[]>();

  constructor(
    private readonly items: T[],
    private readonly cell = 64 * 8,
  ) {
    items.forEach((b, k) => {
      for (let i = Math.floor(b.x0 / cell); i <= Math.floor(b.x1 / cell); i++) {
        for (let j = Math.floor(b.y0 / cell); j <= Math.floor(b.y1 / cell); j++) {
          const key = i * 100003 + j;
          const list = this.cells.get(key);
          if (list) list.push(k);
          else this.cells.set(key, [k]);
        }
      }
    });
  }

  /** Those whose boxes overlap this one (in the order they were given), as `keep` says. */
  near(x0: number, y0: number, x1: number, y1: number, keep: (b: T) => boolean): T[] {
    const found = new Set<number>();
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
      for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) for (const k of this.cells.get(i * 100003 + j) ?? []) found.add(k);
    }
    return [...found].sort((a, b) => a - b).map((k) => this.items[k]).filter(keep);
  }
}
