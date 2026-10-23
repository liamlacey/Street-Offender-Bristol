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
import { type Work, drain } from './work.ts';
import { softTexture } from './canvas';

/** How many pieces of ground are kept drawn at once (each is 1 MB of texture). */
const KEEP = 48;
/** Draw pieces this far beyond the view, px, so they're ready before they come into it. */
const MARGIN = 320;
/** Pieces drawn per frame once the game's running, when they're drawn here (with no worker to draw them), so drawing never holds a frame up for long. */
const PER_FRAME = 1;
/** How far ahead, s, the way you're going, pieces are painted (before they come into view). */
const AHEAD = 1.2;
/** Pieces asked of the worker at once (nearest first). */
const IN_HAND = 4;

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
    private world: World,
    private terrain: Terrain,
    private readonly depth: number,
  ) {
    try {
      if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined') {
        this.worker = new Worker(new URL('./groundWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          if (m.type === 'painted') this.painted_(m);
          // (It couldn't make the region ready itself: it's sent.)
          else this.tell({ type: 'map', map: this.world.map, chunks: this.world.chunks });
        };
        // If it can't paint after all, the pieces are painted here.
        this.worker.onerror = () => this.noWorker();
        this.tell({ type: 'map', map: world.map, chunks: world.chunks });
      }
    } catch {
      this.noWorker();
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * The next region of the map (see streamer.ts). The pieces already drawn are
   * kept: they're the same (they're only ever round the view, well inside both).
   */
  use(world: World, terrain: Terrain, prepared?: number): void {
    this.world = world;
    this.terrain = terrain;
    if (prepared === undefined) {
      this.tell({ type: 'map', map: world.map, chunks: world.chunks });
      return;
    }
    // Made ready in the worker already (see `prepare`): only the trees felled (their shadows gone) told it.
    this.tell({ type: 'use', id: prepared });
    const trees = world.map.trees;
    const felled: number[] = [];
    for (let i = 0; i < trees.length; i += 4) if (trees[i + 2] === 0) felled.push(i / 4);
    if (felled.length) this.tell({ type: 'felled', felled });
    // And the huts knocked down (see world.ts's `ruin`).
    const ruined: number[] = [];
    world.map.buildings.forEach((b, k) => {
      if (b.ruined) ruined.push(k);
    });
    if (ruined.length) this.tell({ type: 'ruined', ruined });
  }

  /** A hut's been knocked down (the map's building `k`): what's under its shadow, round (x, y), painted again. */
  ruined(k: number, x: number, y: number, reach: number): void {
    this.tell({ type: 'ruined', ruined: [k] });
    this.again(x, y, reach);
  }

  /**
   * The next region (its tiles, by `keys`, and where it is), made ready in the worker ahead of being moved into: its id, to
   * `use` it by (or undefined: there's no worker, and it's sent).
   */
  prepare(keys: string[], bounds: { x0: number; y0: number; x1: number; y1: number }): number | undefined {
    if (!this.worker) return undefined;
    const id = ++this.requests;
    this.tell({ type: 'prepare', id, base: new URL('map/', location.href).href, keys, bounds });
    return id;
  }

  /**
   * Call once a frame: draws what's coming into view (all of it at once if
   * `all`), lays what's in view over the hills, and forgets what's long gone.
   */
  update(view: Phaser.Geom.Rectangle, perspective: Perspective, all = false, vx = 0, vy = 0): void {
    this.frame++;
    const { width, height } = this.world.map;
    // (Out ahead too, the way you're going: where the view will be in a moment.)
    const [ax, ay] = [vx * AHEAD, vy * AHEAD];
    const x0 = Math.max(0, Math.floor((Math.min(view.left, view.left + ax) - MARGIN) / CHUNK));
    const y0 = Math.max(0, Math.floor((Math.min(view.top, view.top + ay) - MARGIN) / CHUNK));
    const x1 = Math.min(Math.ceil(width / CHUNK) - 1, Math.floor((Math.max(view.right, view.right + ax) + MARGIN) / CHUNK));
    const y1 = Math.min(Math.ceil(height / CHUNK) - 1, Math.floor((Math.max(view.bottom, view.bottom + ay) + MARGIN) / CHUNK));
    const missing: [number, number, number][] = [];
    // (Nearest first: to a little ahead of the middle of the view.)
    const cx = (view.centerX + ax * 0.3) / CHUNK - 0.5;
    const cy = (view.centerY + ay * 0.3) / CHUNK - 0.5;
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
      // Any in sight the worker's not got to (it's behind, at speed, or busy with a new region's map): painted here, now
      // (a moment's pause, rather than the road not there); the worker's, when it comes, let go.
      // (Two at most a frame: a row of them coming into sight at once.)
      const seen = missing.filter(([i, j]) => (i + 1) * CHUNK > view.left && i * CHUNK < view.right && (j + 1) * CHUNK > view.top && j * CHUNK < view.bottom);
      for (const [i, j] of seen.slice(0, 2)) {
        this.asked.delete(chunkKey(i, j));
        this.draw(i, j).update(perspective);
      }
      for (const [i, j] of missing) {
        if (this.asked.size >= IN_HAND) break;
        if (!this.asked.has(chunkKey(i, j)) && !this.pieces.has(chunkKey(i, j))) this.ask(i, j);
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
    const texture = softTexture(this.scene, key, PIECE, PIECE);
    paint(texture.context);
    texture.refresh();
    const [x0, y0] = [i * CHUNK - BLEED, j * CHUNK - BLEED];
    const sheet = new TerrainSheet(this.scene, key, x0, y0, PIECE, PIECE, this.depth, (x, y) => this.terrain.at(x, y) * this.terrain.px, (x, y, size) => this.terrain.cutAcross(x, y, size));
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
  private painted_({ id, i, j, picture }: Extract<FromWorker, { type: 'painted' }>): void {
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
    this.again(x, y, reach);
  }

  /** Paints again the pieces in use within `reach` px of (x, y). */
  private again(x: number, y: number, reach: number): void {
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

/** Rows of the surface grid painted at a time (see `surfacesWork`). */
const STRIP = 64;

/** Paints the map (or the part of it from (x0, y0) to (x1, y1), px) in its surfaces' flat colours, a metre to a pixel, and reads it back as the surface grid. */
export function paintSurfaces(world: World, bounds?: { x0: number; y0: number; x1: number; y1: number }): SurfaceGrid {
  return drain(surfacesWork(world, bounds));
}

/** The same, a strip at a time (see work.ts): only what reaches into each strip is drawn on it. */
export function* surfacesWork(world: World, bounds?: { x0: number; y0: number; x1: number; y1: number }): Work<SurfaceGrid> {
  const { map } = world;
  const cell = map.pxPerMetre;
  const b = bounds ?? { x0: 0, y0: 0, x1: map.width, y1: map.height };
  const [ox, oy] = [Math.floor(Math.max(0, b.x0) / cell) * cell, Math.floor(Math.max(0, b.y0) / cell) * cell];
  const cols = Math.ceil((Math.min(map.width, b.x1) - ox) / cell);
  const rows = Math.ceil((Math.min(map.height, b.y1) - oy) / cell);
  const cells = new Uint8Array(cols * rows);
  // What reaches how far down: each area's and road's top and bottom.
  const span = (rings: number[][]): [number, number] => {
    let [lo, hi] = [Infinity, -Infinity];
    for (const r of rings) for (let k = 1; k < r.length; k += 2) [lo, hi] = [Math.min(lo, r[k]), Math.max(hi, r[k])];
    return [lo, hi];
  };
  const areas = map.areas.map((a) => span(a.rings));
  const roads = map.roads.map((r) => {
    const [lo, hi] = span([r.pts]);
    return [lo - r.width * 2, hi + r.width * 2] as [number, number];
  });
  yield;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = Math.min(rows, STRIP);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const palette = surfacePalette();
  for (let r0 = 0; r0 < rows; r0 += STRIP) {
    const n = Math.min(STRIP, rows - r0);
    const [top, bottom] = [oy + r0 * cell, oy + (r0 + n) * cell];
    const index: ChunkIndex = {
      areas: areas.flatMap(([lo, hi], i) => (hi >= top && lo <= bottom ? [i] : [])),
      roads: roads.flatMap(([lo, hi], i) => (hi >= top && lo <= bottom ? [i] : [])),
      lines: [],
      buildings: [],
      crossings: [],
      signals: [],
      trees: [],
      paint: [],
      banks: [],
    };
    drawGround(ctx, map, index, palette, ox, top, cols * cell, n * cell, 1 / cell);
    const strip = SurfaceGrid.fromPixels(ctx.getImageData(0, 0, cols, n).data, cols, n, cell);
    cells.set(strip.cells, r0 * cols);
    yield;
  }
  canvas.width = canvas.height = 0;
  return new SurfaceGrid(cells, cols, rows, cell, ox, oy);
}
