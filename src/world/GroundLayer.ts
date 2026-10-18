import * as Phaser from 'phaser';
import { drawGround, surfacePalette, type Palette } from './ground';
import { artPalette } from './groundArt';
import { SurfaceGrid } from './surface';
import { CHUNK, type ChunkIndex, type World, chunkKey } from './world';

/** How many pieces of ground are kept drawn at once (each is 1 MB of texture). */
const KEEP = 40;
/** Draw pieces this far beyond the view, px, so they're ready before they come into it. */
const MARGIN = 220;
/** Pieces drawn per frame once the game's running, so drawing never holds a frame up for long. */
const PER_FRAME = 1;
/** Each piece reaches this far into its neighbours, px. */
const BLEED = 1;

const EMPTY: ChunkIndex = { areas: [], roads: [], lines: [], buildings: [], crossings: [], trees: [] };

/**
 * The ground, drawn a 512 px square at a time as the view nears it (the
 * whole map would be far too big a texture for a phone), and forgotten
 * again once it's well out of sight.
 */
export class GroundLayer {
  private readonly pieces = new Map<string, { image: Phaser.GameObjects.Image; key: string; used: number }>();
  private readonly palette: Palette;
  private readonly scratch: CanvasRenderingContext2D;
  private frame = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
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

  /** Call once a frame: draws what's coming into view (all of it at once if `all`) and forgets what's long gone. */
  update(view: Phaser.Geom.Rectangle, all = false): void {
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
        if (piece) piece.used = this.frame;
        else missing.push([i, j, Math.hypot(i - cx, j - cy)]);
      }
    }
    // Nearest first.
    missing.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of all ? missing : missing.slice(0, PER_FRAME)) this.draw(i, j);
    if (this.pieces.size > KEEP) {
      const old = [...this.pieces.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [key, piece] of old.slice(0, this.pieces.size - KEEP)) {
        if (piece.used === this.frame) break;
        this.forget(key);
      }
    }
  }

  private draw(i: number, j: number): void {
    const key = `ground:${i},${j}`;
    // A pixel more all round, overlapping the next piece, so no seam shows between them.
    const size = CHUNK + BLEED * 2;
    const texture = this.scene.textures.createCanvas(key, size, size)!;
    const ctx = texture.context;
    const index = this.world.chunks.get(chunkKey(i, j)) ?? EMPTY;
    drawGround(ctx, this.world.map, index, this.palette, i * CHUNK - BLEED, j * CHUNK - BLEED, size, size, 1, this.scratch);
    texture.refresh();
    const image = this.scene.add.image(i * CHUNK - BLEED, j * CHUNK - BLEED, key).setOrigin(0, 0).setDepth(this.depth);
    this.pieces.set(chunkKey(i, j), { image, key, used: this.frame });
  }

  private forget(chunk: string): void {
    const piece = this.pieces.get(chunk);
    if (!piece) return;
    piece.image.destroy();
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
    trees: [],
  };
  drawGround(ctx, map, all, surfacePalette(), 0, 0, map.width, map.height, 1 / cell);
  const grid = SurfaceGrid.fromPixels(ctx.getImageData(0, 0, cols, rows).data, cols, rows, cell);
  canvas.width = canvas.height = 0;
  return grid;
}
