/**
 * Paints one piece of the ground (a CHUNK px square, a pixel more all round so
 * no seam shows between pieces), shaded by the lie of the land: on the page,
 * or in the ground worker (groundWorker.ts), so painting never holds a frame up.
 */

import { newCanvas } from './canvas';
import { type Palette, drawGround } from './ground';
import type { Terrain } from './terrain';
import { CHUNK, type ChunkIndex, type World, chunkKey } from './world';

/** Each piece reaches this far into its neighbours, px. */
export const BLEED = 1;
/** A piece's picture's size, px. */
export const PIECE = CHUNK + BLEED * 2;

const EMPTY: ChunkIndex = { areas: [], roads: [], lines: [], buildings: [], crossings: [], signals: [], trees: [], paint: [], banks: [] };

/** Where the light comes from, for shading the hills: the top left of the map (north-west), as for the shadows. */
const SUN = { x: -0.45, y: -0.6, z: 0.66 };
/** How much the hills' slopes are darkened or lit. */
const HILL_SHADE = 1.2;

let scratch: CanvasRenderingContext2D | null = null;
let shade: HTMLCanvasElement | null = null;

/** Paints piece (i, j) onto `ctx` (PIECE px square). */
export function paintPiece(ctx: CanvasRenderingContext2D, world: World, terrain: Terrain, palette: Palette, i: number, j: number): void {
  scratch ??= newCanvas(PIECE, PIECE).getContext('2d')!;
  const index = world.chunks.get(chunkKey(i, j)) ?? EMPTY;
  const [x0, y0] = [i * CHUNK - BLEED, j * CHUNK - BLEED];
  drawGround(ctx, world.map, index, palette, x0, y0, PIECE, PIECE, 1, scratch);
  shadeHills(ctx, terrain, x0, y0, PIECE);
}

/** Darkens the slopes facing away from the sun and lights those facing it, a couple of metres at a time, blended smooth. */
function shadeHills(ctx: CanvasRenderingContext2D, terrain: Terrain, x0: number, y0: number, size: number): void {
  const step = 2 * terrain.px;
  const n = Math.ceil(size / step) + 1;
  if (!shade || shade.width !== n) shade = newCanvas(n, n);
  const sctx = shade.getContext('2d')!;
  const image = sctx.createImageData(n, n);
  const flat = SUN.z;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [gx, gy] = terrain.slope(x0 + i * step, y0 + j * step);
      // The ground's normal, against the sun's direction.
      const len = Math.hypot(gx * HILL_SHADE, gy * HILL_SHADE, 1);
      const light = (-gx * HILL_SHADE * SUN.x - gy * HILL_SHADE * SUN.y + SUN.z) / len - flat;
      const k = (j * n + i) * 4;
      const lit = light > 0;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = lit ? 255 : 0;
      image.data[k + 3] = Math.min(90, Math.abs(light) * (lit ? 200 : 320));
    }
  }
  sctx.putImageData(image, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shade, 0, 0, n, n, 0, 0, n * step, n * step);
  ctx.restore();
}
