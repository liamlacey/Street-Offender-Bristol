/**
 * The lie of the land: the ground's height anywhere on the map, smoothly
 * between the grid's points, and how steep it is there. Pure, so it's tested.
 */

import type { TerrainData } from '../map/osm';

export class Terrain {
  /** Metres above the lowest point, at each grid point. */
  private readonly z: Float32Array;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;

  /** Map px per metre. */
  readonly px: number;

  constructor(data: TerrainData | undefined, px: number) {
    this.px = px;
    this.cell = data?.cell ?? 64;
    this.cols = data?.cols ?? 1;
    this.rows = data?.rows ?? 1;
    this.z = new Float32Array(this.cols * this.rows);
    if (!data) return;
    const binary = atob(data.heights);
    for (let k = 0; k < this.z.length; k++) this.z[k] = (binary.charCodeAt(k * 2) | (binary.charCodeAt(k * 2 + 1) << 8)) / 10;
  }

  /** The ground's height at (x, y), metres above the map's lowest point. */
  at(x: number, y: number): number {
    if (this.cols < 2 || this.rows < 2) return 0;
    const gx = Math.max(0, Math.min(this.cols - 1.001, x / this.cell));
    const gy = Math.max(0, Math.min(this.rows - 1.001, y / this.cell));
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const k = j * this.cols + i;
    const z = this.z;
    return (z[k] * (1 - fx) + z[k + 1] * fx) * (1 - fy) + (z[k + this.cols] * (1 - fx) + z[k + this.cols + 1] * fx) * fy;
  }

  /** How steep the ground is at (x, y): its rise per metre east and per metre south. */
  slope(x: number, y: number): [number, number] {
    const d = this.cell / 2;
    const run = (2 * d) / this.px;
    return [(this.at(x + d, y) - this.at(x - d, y)) / run, (this.at(x, y + d) - this.at(x, y - d)) / run];
  }
}
