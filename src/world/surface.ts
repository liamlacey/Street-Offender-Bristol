/**
 * What's underfoot everywhere on the map, a metre square at a time: tarmac,
 * paving, grass, soil, shallow pools or the harbour's deep water. The grid is
 * painted by the ground drawing (in flat colours, one per surface) and read
 * back; looking a point up is then just an array lookup.
 */

import type { SurfaceKind } from '../car/CarPhysics';

export const Surface = {
  Pavement: 0,
  Road: 1,
  Grass: 2,
  Mud: 3,
  Dirt: 4,
  Pool: 5,
  /** The harbour, too deep to drive through: the car sinks. */
  Deep: 6,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** How each surface handles. */
export const SURFACE_KIND: Record<Surface, SurfaceKind> = {
  [Surface.Pavement]: 'pavement',
  [Surface.Road]: 'road',
  [Surface.Grass]: 'grass',
  [Surface.Mud]: 'mud',
  [Surface.Dirt]: 'dirt',
  [Surface.Pool]: 'water',
  [Surface.Deep]: 'water',
};

/** The red level each surface is painted in, when drawing the grid: spread out so blended edges read back as one or the other. */
export const SURFACE_PAINT_STEP = 36;

export function surfacePaint(s: Surface): string {
  return `rgb(${s * SURFACE_PAINT_STEP},0,0)`;
}

export class SurfaceGrid {
  constructor(
    readonly cells: Uint8Array,
    readonly cols: number,
    readonly rows: number,
    /** px per cell. */
    readonly cell: number,
  ) {}

  /** Reads the grid back from painted RGBA pixels (one per cell). */
  static fromPixels(rgba: Uint8ClampedArray, cols: number, rows: number, cell: number): SurfaceGrid {
    const cells = new Uint8Array(cols * rows);
    for (let i = 0; i < cells.length; i++) cells[i] = Math.min(Surface.Deep, Math.round(rgba[i * 4] / SURFACE_PAINT_STEP));
    return new SurfaceGrid(cells, cols, rows, cell);
  }

  at(x: number, y: number): Surface {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return Surface.Pavement;
    return this.cells[cy * this.cols + cx] as Surface;
  }
}
