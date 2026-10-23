/**
 * The map round you, and only that: a REGION (REGION_TILES tiles square, see
 * regions.ts) of the map, centred on a corner of the tiles near you. When
 * you've gone far enough from its middle (MOVE_ON), the next one, centred on
 * the corner nearest you, is made ready (its tiles fetched, put together and
 * made into everything the game needs: see region.ts), a few milliseconds a
 * frame as you drive, and handed to the scene to take over from this one
 * (see GameScene's `enter`). Its tiles are kept; the rest are let go. So the
 * game holds two regions at most, however big the map.
 */

import { type MapIndex, TILE, type Tile, assembleWork, tilesFor } from '../map/regions';
import { TileStore, fetchJson } from '../map/tileStore';
import type { Overview } from './overview';
import { type FirstIds, type Progress, type Region, regionWork } from './region';
import type { SurfaceGrid } from './surface';
import { type Layout, useLayout } from './layout';
import type { FromLayout, ToLayout } from './layoutWorker';
import { type Work, runFor } from './work.ts';
import type { World } from './world';

/** A region's side, in tiles (2 km). */
export const REGION_TILES = 4;
/** How far from the middle of the region you can go (either way), px, before the next is made ready (with room to spare: there's 2 tiles each way). */
const MOVE_ON = 0.6 * TILE;
/**
 * Where you'll be this far ahead, s, says when the next region's made ready and round where (so at speed it's begun in good
 * time); no further ahead than a tile.
 */
const AHEAD = 6;
/** With the edge of the region in use this near, s (at the speed you're going), the next is made faster: more of each frame. */
const HURRY = 9;
const RUSH = 4;
/** And this near, s, it's finished at once: a moment's pause, rather than driving off the edge of what's there (or seeing it). */
const NOW = 2.5;

type Painter = (world: World, bounds: Region['map']['region']) => Work<SurfaceGrid>;

export class Streamer {
  /** The middle of the region in use, px (a corner of the tiles). */
  private centre: { x: number; y: number } | null = null;
  /**
   * The next, being made ready: where, its tiles (once they're here), its layout from the worker (null: none to be had;
   * undefined: still coming), and the work (once it's begun: when they're both here, or time's short).
   */
  private next: { x: number; y: number; prepared?: number; keys: string[]; bounds: Region['map']['region']; tiles: Tile[] | null; layout: Layout | null | undefined; work: Work<Region> | null } | null = null;
  /** The layout worker (see layoutWorker.ts), if there's one; what's been asked of it, by request. */
  private layouts: Worker | null = null;
  private readonly asked = new Map<number, (layout: Layout | null) => void>();
  private requests = 0;
  /** Told of the next region as soon as it's chosen (its tiles and where it is), to make ready elsewhere too: by what id it's to be known (on the Region). */
  prepare: ((keys: string[], bounds: Region['map']['region']) => number | undefined) | null = null;
  /** How far along making the next one is. */
  readonly making: Progress = { done: 0, label: '' };

  private constructor(
    private readonly base: string,
    readonly store: TileStore,
    private readonly paint: Painter,
    private readonly ids: () => FirstIds,
  ) {}

  /** The map's index, fetched; a streamer for it. */
  static async open(paint: Painter, ids: () => FirstIds, base = 'map/'): Promise<Streamer> {
    const streamer = new Streamer(base, await TileStore.open(base), paint, ids);
    try {
      if (typeof Worker !== 'undefined' && typeof location !== 'undefined') {
        const worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<FromLayout>) => {
          streamer.asked.get(e.data.id)?.(e.data.layout);
          streamer.asked.delete(e.data.id);
        };
        // (If it can't, the game lays each region out itself.)
        worker.onerror = () => {
          streamer.layouts = null;
          for (const done of streamer.asked.values()) done(null);
          streamer.asked.clear();
        };
        streamer.layouts = worker;
      }
    } catch {
      streamer.layouts = null;
    }
    return streamer;
  }

  /** A region's layout, from the worker (null, if there's no worker or it couldn't). */
  private layout(keys: string[], bounds: Region['map']['region']): Promise<Layout | null> {
    const worker = this.layouts;
    if (!worker) return Promise.resolve(null);
    const id = ++this.requests;
    return new Promise((done) => {
      this.asked.set(id, done);
      const m: ToLayout = { id, base: new URL(this.base, location.href).href, keys, bounds };
      worker.postMessage(m);
    });
  }

  get index(): MapIndex {
    return this.store.index;
  }

  /** What the pause menu's map of the whole map is drawn from (see overview.ts): fetched when it's wanted. */
  overview(): Promise<Overview> {
    return fetchJson<Overview>(`${this.base}overview.json`);
  }

  /** The region's middle for (x, y): the corner of the tiles nearest it. */
  private corner(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(x / TILE) * TILE, y: Math.round(y / TILE) * TILE };
  }

  private bounds(c: { x: number; y: number }) {
    const half = (REGION_TILES / 2) * TILE;
    return { x0: c.x - half, y0: c.y - half, x1: c.x + half, y1: c.y + half };
  }

  /** Whether (x, y) is well inside the region in use (somewhere you could be put down without a new one). */
  inside(x: number, y: number): boolean {
    return !!this.centre && Math.abs(x - this.centre.x) < MOVE_ON && Math.abs(y - this.centre.y) < MOVE_ON;
  }

  /**
   * The region round (x, y), made at once (for the start, and a jump): `progress`
   * kept up to date, and a frame let go by (`frame`) every so often, for a
   * loading screen.
   */
  async load(x: number, y: number, progress: Progress, frame: () => Promise<void>): Promise<Region> {
    this.next = null;
    const c = this.corner(x, y);
    const b = this.bounds(c);
    const keys = tilesFor(this.index, b.x0, b.y0, b.x1, b.y1);
    Object.assign(progress, { done: 0, label: 'Reading the map' });
    const tiles = await this.store.get(keys);
    const work = this.make(tiles, b, progress);
    for (;;) {
      const r = runFor(work, 40);
      if (r.done) {
        this.centre = c;
        this.store.keep(keys);
        return r.value;
      }
      await frame();
    }
  }

  /** A region from its tiles, a little at a time. */
  private *make(tiles: Tile[], b: Region['map']['region'], progress: Progress, underway?: number, layout?: Layout | null): Work<Region> {
    Object.assign(progress, { done: 0, label: 'Reading the map' });
    const map = yield* assembleWork(this.index, tiles, b);
    // (Laid out already, in the worker: taken as it is.)
    if (layout) useLayout(map, layout);
    return yield* regionWork(map, this.ids(), this.paint, progress, underway);
  }

  /**
   * Call once a frame, with where you are: makes the next region ready (for
   * about `ms` milliseconds) if you've gone far enough for it; once it is,
   * it's returned (and from then on it's the region in use), to take over.
   */
  update(x: number, y: number, ms: number, vx = 0, vy = 0): Region | null {
    if (!this.centre) return null;
    if (!this.next) {
      // Where you'll be in a few seconds (no more than a tile on).
      const speed = Math.hypot(vx, vy);
      const lead = Math.min(AHEAD * speed, TILE) / (speed || 1);
      const [px, py] = [x + vx * lead, y + vy * lead];
      if (this.inside(x, y) && this.inside(px, py)) return null;
      const c = this.corner(px, py);
      if (c.x === this.centre.x && c.y === this.centre.y) return null;
      const b = this.bounds(c);
      const keys = tilesFor(this.index, b.x0, b.y0, b.x1, b.y1);
      const next: NonNullable<Streamer['next']> = { ...c, keys, bounds: b, tiles: null, layout: undefined, work: null };
      this.next = next;
      next.prepared = this.prepare?.(keys, b);
      // Laid out in the worker meanwhile.
      this.layout(keys, b).then((layout) => {
        if (this.next === next) next.layout = layout;
      });
      this.store.get(keys).then(
        (tiles) => {
          if (this.next !== next) return;
          next.tiles = tiles;
        },
        (e) => {
          // (The phone's lost its connection: tried again, once you've moved on a bit.)
          console.error('map:', e);
          if (this.next === next) this.next = null;
        },
      );
      return null;
    }
    // Nearing the edge of the region in use (at the speed you're going): more of each frame; about to go off it, all of it.
    const half = (REGION_TILES / 2) * TILE;
    const left = (v: number, at: number, mid: number) => (v > 0 ? (mid + half - at) / v : v < 0 ? (at - (mid - half)) / -v : Infinity);
    const time = Math.min(left(vx, x, this.centre.x), left(vy, y, this.centre.y));
    const n = this.next;
    // Begun once its tiles are here and its layout (or that there's none to be had); or now, without it, if time's short.
    if (!n.work && n.tiles && (n.layout !== undefined || time < HURRY)) n.work = this.make(n.tiles, n.bounds, this.making, 0, n.layout);
    if (!n.work) return null;
    const budget = time < NOW ? Infinity : time < RUSH ? ms * 6 : time < HURRY ? ms * 2.5 : ms;
    const r = runFor(n.work, budget);
    if (!r.done) return null;
    this.centre = { x: this.next.x, y: this.next.y };
    r.value.prepared = this.next.prepared;
    // Only the tiles of the region in use are kept.
    this.store.keep(this.next.keys);
    this.next = null;
    return r.value;
  }
}
