/**
 * The lie of the land: the ground's height anywhere on the map, smoothly
 * between the grid's points (but not across a sharp drop: a ledge's edge is a
 * step), and how steep it is there. Pure, so it's tested.
 */

import type { Ledge, TerrainData } from '../map/osm';
import { type Work, drain } from './work.ts';

/** The cuts' index's cells, px. */
const CUT_CELL = 32;

/**
 * The ledges' lines (see findLedges), to tell whether the straight way between
 * two points crosses one: the ground either side of one isn't mixed.
 */
export class Cuts {
  /** Each line's ends: ax, ay, bx, by, ... */
  private readonly lines: number[] = [];
  private readonly cells = new Map<number, number[]>();

  constructor(ledges: Ledge[] | undefined) {
    for (const l of ledges ?? []) {
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const [ax, ay, bx, by] = [l.pts[k], l.pts[k + 1], l.pts[k + 2], l.pts[k + 3]];
        const n = this.lines.push(ax, ay, bx, by) / 4 - 1;
        for (let cx = Math.floor(Math.min(ax, bx) / CUT_CELL); cx <= Math.floor(Math.max(ax, bx) / CUT_CELL); cx++) {
          for (let cy = Math.floor(Math.min(ay, by) / CUT_CELL); cy <= Math.floor(Math.max(ay, by) / CUT_CELL); cy++) {
            const key = cx * 100_000 + cy;
            const cell = this.cells.get(key);
            if (cell) cell.push(n);
            else this.cells.set(key, [n]);
          }
        }
      }
    }
  }

  get none(): boolean {
    return this.lines.length === 0;
  }

  /** Whether the straight way from (x0, y0) to (x1, y1) crosses one. */
  crosses(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let cx = Math.floor(Math.min(x0, x1) / CUT_CELL); cx <= Math.floor(Math.max(x0, x1) / CUT_CELL); cx++) {
      for (let cy = Math.floor(Math.min(y0, y1) / CUT_CELL); cy <= Math.floor(Math.max(y0, y1) / CUT_CELL); cy++) {
        for (const n of this.cells.get(cx * 100_000 + cy) ?? []) {
          const l = this.lines;
          if (meet(x0, y0, x1, y1, l[n * 4], l[n * 4 + 1], l[n * 4 + 2], l[n * 4 + 3])) return true;
        }
      }
    }
    return false;
  }

  /** Whether one runs through (or along the edge of) the square from (x, y), `size` px across. */
  inSquare(x: number, y: number, size: number): boolean {
    const [x1, y1] = [x + size, y + size];
    for (let cx = Math.floor(x / CUT_CELL); cx <= Math.floor(x1 / CUT_CELL); cx++) {
      for (let cy = Math.floor(y / CUT_CELL); cy <= Math.floor(y1 / CUT_CELL); cy++) {
        for (const n of this.cells.get(cx * 100_000 + cy) ?? []) {
          const l = this.lines;
          const [ax, ay, bx, by] = [l[n * 4], l[n * 4 + 1], l[n * 4 + 2], l[n * 4 + 3]];
          // An end inside, or crossing a side.
          if ((ax >= x && ax <= x1 && ay >= y && ay <= y1) || (bx >= x && bx <= x1 && by >= y && by <= y1)) return true;
          if (meet(ax, ay, bx, by, x, y, x1, y) || meet(ax, ay, bx, by, x1, y, x1, y1) || meet(ax, ay, bx, by, x, y1, x1, y1) || meet(ax, ay, bx, by, x, y, x, y1)) return true;
        }
      }
    }
    return false;
  }
}

/** Whether two straight lines, a to b and c to d, cross (or touch). */
function meet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0);
}

export class Terrain {
  /** Metres above the lowest point, at each grid point. */
  private readonly z: Float32Array;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** Where its first point is, cells from the map's corner (a region of the map's). */
  private readonly i0: number;
  private readonly j0: number;

  /** Map px per metre. */
  readonly px: number;

  /** The ledges, and which of the grid's cells one runs through. */
  private readonly cuts: Cuts;
  private readonly cut: Uint8Array;

  /** The lie of the land (`later`: its heights not read yet, see `build`). */
  constructor(data: TerrainData | undefined, px: number, ledges?: Ledge[], later = false) {
    this.px = px;
    this.cell = data?.cell ?? 64;
    this.cols = data?.cols ?? 1;
    this.rows = data?.rows ?? 1;
    this.i0 = data?.i0 ?? 0;
    this.j0 = data?.j0 ?? 0;
    this.z = new Float32Array(this.cols * this.rows);
    this.cuts = new Cuts(ledges);
    this.cut = new Uint8Array(this.cols * this.rows);
    if (data && !later) drain(this.build(data, ledges));
  }

  /** Reads its heights, and finds where the ledges cut across the grid, a little at a time (see work.ts). */
  *build(data: TerrainData, ledges?: Ledge[]): Work {
    const binary = atob(data.heights);
    for (let k = 0; k < this.z.length; k++) {
      if ((k & 65535) === 65535) yield;
      this.z[k] = (binary.charCodeAt(k * 2) | (binary.charCodeAt(k * 2 + 1) << 8)) / 10;
    }
    // The squares each ledge runs through (only those round it are looked at).
    const c = this.cell;
    const [i0, j0] = [this.i0, this.j0];
    for (const [n, l] of (ledges ?? []).entries()) {
      if (n % 40 === 39) yield;
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const [ax, ay, bx, by] = [l.pts[k], l.pts[k + 1], l.pts[k + 2], l.pts[k + 3]];
        for (let j = Math.max(0, Math.floor(Math.min(ay, by) / c) - 1 - j0); j <= Math.min(this.rows - 2, Math.floor(Math.max(ay, by) / c) - j0); j++) {
          for (let i = Math.max(0, Math.floor(Math.min(ax, bx) / c) - 1 - i0); i <= Math.min(this.cols - 2, Math.floor(Math.max(ax, bx) / c) - i0); i++) {
            if (!this.cut[j * this.cols + i] && this.cuts.inSquare((i + i0) * c, (j + j0) * c, c)) this.cut[j * this.cols + i] = 1;
          }
        }
      }
    }
  }

  /** The ground's height at (x, y), metres above the map's lowest point: between the grid's points round it on the same side of any ledge. */
  at(x: number, y: number): number {
    if (this.cols < 2 || this.rows < 2) return 0;
    const gx = Math.max(0, Math.min(this.cols - 1.001, x / this.cell - this.i0));
    const gy = Math.max(0, Math.min(this.rows - 1.001, y / this.cell - this.j0));
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const k = j * this.cols + i;
    const z = this.z;
    if (!this.cut[k]) return (z[k] * (1 - fx) + z[k + 1] * fx) * (1 - fy) + (z[k + this.cols] * (1 - fx) + z[k + this.cols + 1] * fx) * fy;
    // A ledge runs through: only the corners on this side of it.
    const c = this.cell;
    const [px, py] = [(gx + this.i0) * c, (gy + this.j0) * c];
    let [sum, weight] = [0, 0];
    const corner = (ci: number, cj: number, w: number) => {
      if (w <= 0 || this.cuts.crosses(px, py, (ci + this.i0) * c, (cj + this.j0) * c)) return;
      sum += z[cj * this.cols + ci] * w;
      weight += w;
    };
    corner(i, j, (1 - fx) * (1 - fy));
    corner(i + 1, j, fx * (1 - fy));
    corner(i, j + 1, (1 - fx) * fy);
    corner(i + 1, j + 1, fx * fy);
    if (weight > 1e-6) return sum / weight;
    return (z[k] * (1 - fx) + z[k + 1] * fx) * (1 - fy) + (z[k + this.cols] * (1 - fx) + z[k + this.cols + 1] * fx) * fy;
  }

  /** How steep the ground is at (x, y): its rise per metre east and per metre south (not measured across a ledge). */
  slope(x: number, y: number): [number, number] {
    const d = this.cell / 2;
    const run = (2 * d) / this.px;
    if (this.cuts.none) return [(this.at(x + d, y) - this.at(x - d, y)) / run, (this.at(x, y + d) - this.at(x, y - d)) / run];
    const here = this.at(x, y);
    const way = (dx: number, dy: number) => {
      const fore = this.cuts.crosses(x, y, x + dx, y + dy) ? null : this.at(x + dx, y + dy);
      const back = this.cuts.crosses(x, y, x - dx, y - dy) ? null : this.at(x - dx, y - dy);
      if (fore !== null && back !== null) return (fore - back) / run;
      if (fore !== null) return (fore - here) / (run / 2);
      if (back !== null) return (here - back) / (run / 2);
      return 0;
    };
    return [way(d, 0), way(0, d)];
  }

  /** Whether a ledge runs through the square from (x, y), `size` px across: the ground's not smooth across it. */
  cutAcross(x: number, y: number, size: number): boolean {
    return !this.cuts.none && this.cuts.inSquare(x, y, size);
  }
}
