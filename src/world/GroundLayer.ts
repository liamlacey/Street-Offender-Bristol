import * as Phaser from 'phaser';
import { drawGround, surfacePalette, type Palette } from './ground';
import { artPalette } from './groundArt';
import type { Perspective } from './perspective';
import { SurfaceGrid } from './surface';
import type { Terrain } from './terrain';
import { TerrainSheet } from './TerrainSheet';
import { CHUNK, type ChunkIndex, type World, chunkKey } from './world';

/** How many pieces of ground are kept drawn at once (each is 1 MB of texture). */
const KEEP = 40;
/** Draw pieces this far beyond the view, px, so they're ready before they come into it. */
const MARGIN = 320;
/** Pieces drawn per frame once the game's running, so drawing never holds a frame up for long. */
const PER_FRAME = 1;
/** Each piece reaches this far into its neighbours, px. */
const BLEED = 1;

const EMPTY: ChunkIndex = { areas: [], roads: [], lines: [], buildings: [], crossings: [], signals: [], trees: [] };

/** Where the light comes from, for shading the hills: the top left of the map (north-west), as for the shadows. */
const SUN = { x: -0.45, y: -0.6, z: 0.66 };
/** How much the hills' slopes are darkened or lit. */
const HILL_SHADE = 1.2;

/**
 * The ground, drawn a 512 px square at a time as the view nears it (the
 * whole map would be far too big a texture for a phone), shaded by the lie
 * of the land and laid over the hills, and forgotten again once it's well
 * out of sight.
 */
export class GroundLayer {
  private readonly pieces = new Map<string, { sheet: TerrainSheet; key: string; used: number }>();
  private readonly palette: Palette;
  private readonly scratch: CanvasRenderingContext2D;
  private frame = 0;
  private painted = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
    private readonly depth: number,
  ) {
    const probe = document.createElement('canvas').getContext('2d')!;
    this.palette = artPalette(probe);
    const scratch = document.createElement('canvas');
    scratch.width = CHUNK + BLEED * 2;
    scratch.height = CHUNK + BLEED * 2;
    this.scratch = scratch.getContext('2d')!;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Call once a frame: draws what's coming into view (all of it at once if
   * `all`), lays what's in view over the hills, and forgets what's long gone.
   */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, all = false): void {
    this.frame++;
    const { width, height } = this.world.map;
    const x0 = Math.max(0, Math.floor((view.left - MARGIN) / CHUNK));
    const y0 = Math.max(0, Math.floor((view.top - MARGIN) / CHUNK));
    const x1 = Math.min(Math.ceil(width / CHUNK) - 1, Math.floor((view.right + MARGIN) / CHUNK));
    const y1 = Math.min(Math.ceil(height / CHUNK) - 1, Math.floor((view.bottom + MARGIN) / CHUNK));
    const missing: [number, number, number][] = [];
    const cx = view.centerX / CHUNK - 0.5;
    const cy = view.centerY / CHUNK - 0.5;
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const piece = this.pieces.get(chunkKey(i, j));
        if (piece) {
          piece.used = this.frame;
          piece.sheet.update(perspective);
        } else {
          missing.push([i, j, Math.hypot(i - cx, j - cy)]);
        }
      }
    }
    // Nearest first.
    missing.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of all ? missing : missing.slice(0, PER_FRAME)) this.draw(i, j).update(perspective);
    for (const piece of this.pieces.values()) piece.sheet.setVisible(piece.used === this.frame);
    if (this.pieces.size > KEEP) {
      const old = [...this.pieces.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [key, piece] of old.slice(0, this.pieces.size - KEEP)) {
        if (piece.used === this.frame) break;
        this.forget(key);
      }
    }
  }

  private draw(i: number, j: number): TerrainSheet {
    // A new name each time it's painted: a texture made under an old one's name can come out as the old one.
    const key = `ground:${i},${j}:${this.painted++}`;
    // A pixel more all round, overlapping the next piece, so no seam shows between them.
    const size = CHUNK + BLEED * 2;
    const texture = this.scene.textures.createCanvas(key, size, size)!;
    const ctx = texture.context;
    const index = this.world.chunks.get(chunkKey(i, j)) ?? EMPTY;
    const [x0, y0] = [i * CHUNK - BLEED, j * CHUNK - BLEED];
    drawGround(ctx, this.world.map, index, this.palette, x0, y0, size, size, 1, this.scratch);
    this.shadeHills(ctx, x0, y0, size);
    texture.refresh();
    const sheet = new TerrainSheet(this.scene, key, x0, y0, size, size, this.depth, (x, y) => this.terrain.at(x, y) * this.terrain.px);
    this.pieces.set(chunkKey(i, j), { sheet, key, used: this.frame });
    return sheet;
  }

  /** Darkens the slopes facing away from the sun and lights those facing it, a couple of metres at a time, blended smooth. */
  private shadeHills(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
    const step = 2 * this.terrain.px;
    const n = Math.ceil(size / step) + 1;
    const shade = this.shadeCanvas(n);
    const sctx = shade.getContext('2d')!;
    const image = sctx.createImageData(n, n);
    const flat = SUN.z;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [gx, gy] = this.terrain.slope(x0 + i * step, y0 + j * step);
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

  private shade: HTMLCanvasElement | null = null;

  private shadeCanvas(n: number): HTMLCanvasElement {
    if (!this.shade || this.shade.width !== n) {
      this.shade = document.createElement('canvas');
      this.shade.width = this.shade.height = n;
    }
    return this.shade;
  }

  /** Paints again, straight away, the pieces of ground within `reach` px of (x, y) that are in use: something on them has changed. */
  repaint(x: number, y: number, reach: number): void {
    for (let i = Math.floor((x - reach) / CHUNK); i <= Math.floor((x + reach) / CHUNK); i++) {
      for (let j = Math.floor((y - reach) / CHUNK); j <= Math.floor((y + reach) / CHUNK); j++) {
        const piece = this.pieces.get(chunkKey(i, j));
        if (!piece) continue;
        const used = piece.used;
        this.forget(chunkKey(i, j));
        this.draw(i, j);
        this.pieces.get(chunkKey(i, j))!.used = used;
      }
    }
  }

  private forget(chunk: string): void {
    const piece = this.pieces.get(chunk);
    if (!piece) return;
    piece.sheet.destroy();
    this.scene.textures.remove(piece.key);
    this.pieces.delete(chunk);
  }

  private destroy(): void {
    for (const key of [...this.pieces.keys()]) this.forget(key);
  }
}

/** Paints the whole map in its surfaces' flat colours, a metre to a pixel, and reads it back as the surface grid. */
export function paintSurfaces(world: World): SurfaceGrid {
  const { map } = world;
  const cell = map.pxPerMetre;
  const cols = Math.ceil(map.width / cell);
  const rows = Math.ceil(map.height / cell);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const all: ChunkIndex = {
    areas: map.areas.map((_, i) => i),
    roads: map.roads.map((_, i) => i),
    lines: [],
    buildings: [],
    crossings: [],
    signals: [],
    trees: [],
  };
  drawGround(ctx, map, all, surfacePalette(), 0, 0, map.width, map.height, 1 / cell);
  const grid = SurfaceGrid.fromPixels(ctx.getImageData(0, 0, cols, rows).data, cols, rows, cell);
  canvas.width = canvas.height = 0;
  return grid;
}
