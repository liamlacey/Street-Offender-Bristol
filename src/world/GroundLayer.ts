import * as Phaser from 'phaser';
import type { Palette } from './ground';
import { artPalette } from './groundArt';
import { PIECE, BLEED, paintPiece } from './groundPiece';
import type { FromWorker, ToWorker } from './groundWorker';
import type { Perspective } from './perspective';
import { drawGround, surfacePalette } from './ground';
import { SurfaceGrid } from './surface';
import type { Terrain } from './terrain';
import { TerrainSheet } from './TerrainSheet';
import { CHUNK, type ChunkIndex, type World, chunkKey } from './world';

/** How many pieces of ground are kept drawn at once (each is 1 MB of texture). */
const KEEP = 48;
/** Draw pieces this far beyond the view, px, so they're ready before they come into it. */
const MARGIN = 320;
/** Pieces drawn per frame once the game's running, when they're drawn here (with no worker to draw them), so drawing never holds a frame up for long. */
const PER_FRAME = 1;
/** Pieces asked of the worker at once (nearest first). */
const IN_HAND = 3;

/**
 * The ground, drawn a 512 px square at a time as the view nears it (the
 * whole map would be far too big a texture for a phone), shaded by the lie
 * of the land and laid over the hills, and forgotten again once it's well
 * out of sight. The pieces are painted in a worker (groundWorker.ts), so
 * painting one never holds a frame up; where there's no worker to be had,
 * here, a piece a frame.
 */
export class GroundLayer {
  private readonly pieces = new Map<string, { sheet: TerrainSheet; key: string; used: number }>();
  private palette: Palette | null = null;
  private frame = 0;
  private painted = 0;
  private worker: Worker | null = null;
  /** The pieces the worker's painting (by chunk): which request's the latest for each. */
  private readonly asked = new Map<string, number>();
  private requests = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly terrain: Terrain,
    private readonly depth: number,
  ) {
    try {
      if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined') {
        this.worker = new Worker(new URL('./groundWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.painted_(e.data);
        // If it can't paint after all, the pieces are painted here.
        this.worker.onerror = () => this.noWorker();
        this.tell({ type: 'map', map: world.map });
      }
    } catch {
      this.noWorker();
    }
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
    if (all || !this.worker) {
      for (const [i, j] of all ? missing : missing.slice(0, PER_FRAME)) this.draw(i, j).update(perspective);
    } else {
      for (const [i, j] of missing) {
        if (this.asked.size >= IN_HAND) break;
        if (!this.asked.has(chunkKey(i, j))) this.ask(i, j);
      }
    }
    for (const piece of this.pieces.values()) piece.sheet.setVisible(piece.used === this.frame);
    if (this.pieces.size > KEEP) {
      const old = [...this.pieces.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [key, piece] of old.slice(0, this.pieces.size - KEEP)) {
        if (piece.used === this.frame) break;
        this.forget(key);
      }
    }
  }

  /** Paints a piece here and now. */
  private draw(i: number, j: number): TerrainSheet {
    this.palette ??= artPalette(document.createElement('canvas').getContext('2d')!);
    return this.place(i, j, (ctx) => paintPiece(ctx, this.world, this.terrain, this.palette!, i, j));
  }

  /** A piece's picture made into a texture, laid over the hills. */
  private place(i: number, j: number, paint: (ctx: CanvasRenderingContext2D) => void): TerrainSheet {
    // A new name each time it's painted: a texture made under an old one's name can come out as the old one.
    const key = `ground:${i},${j}:${this.painted++}`;
    const texture = this.scene.textures.createCanvas(key, PIECE, PIECE)!;
    paint(texture.context);
    texture.refresh();
    const [x0, y0] = [i * CHUNK - BLEED, j * CHUNK - BLEED];
    const sheet = new TerrainSheet(this.scene, key, x0, y0, PIECE, PIECE, this.depth, (x, y) => this.terrain.at(x, y) * this.terrain.px);
    // In place of the one it's painted again over, if it is.
    const old = this.pieces.get(chunkKey(i, j));
    if (old) this.forget(chunkKey(i, j));
    this.pieces.set(chunkKey(i, j), { sheet, key, used: old?.used ?? this.frame });
    return sheet;
  }

  private tell(m: ToWorker): void {
    this.worker?.postMessage(m);
  }

  /** Asks the worker to paint a piece. */
  private ask(i: number, j: number): void {
    const id = ++this.requests;
    this.asked.set(chunkKey(i, j), id);
    this.tell({ type: 'paint', i, j, id });
  }

  /** The worker's painted a piece: in it goes (unless it's been asked for again since, or it's no longer wanted). */
  private painted_({ id, i, j, picture }: FromWorker): void {
    const key = chunkKey(i, j);
    if (this.asked.get(key) !== id) {
      picture.close();
      return;
    }
    this.asked.delete(key);
    this.place(i, j, (ctx) => ctx.drawImage(picture, 0, 0)).setVisible(false);
    picture.close();
  }

  /** No worker after all: the pieces are painted here. */
  private noWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.asked.clear();
  }

  /** Paints again the pieces of ground within `reach` px of (x, y) that are in use: something on them has changed (a tree's fallen). */
  repaint(x: number, y: number, reach: number): void {
    if (this.worker) this.tell({ type: 'trees', trees: this.world.map.trees });
    for (let i = Math.floor((x - reach) / CHUNK); i <= Math.floor((x + reach) / CHUNK); i++) {
      for (let j = Math.floor((y - reach) / CHUNK); j <= Math.floor((y + reach) / CHUNK); j++) {
        if (!this.pieces.has(chunkKey(i, j))) continue;
        // The old picture stays till the new one's ready.
        if (this.worker) this.ask(i, j);
        else this.draw(i, j);
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
    this.noWorker();
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
    paint: [],
    banks: [],
  };
  drawGround(ctx, map, all, surfacePalette(), 0, 0, map.width, map.height, 1 / cell);
  const grid = SurfaceGrid.fromPixels(ctx.getImageData(0, 0, cols, rows).data, cols, rows, cell);
  canvas.width = canvas.height = 0;
  return grid;
}
