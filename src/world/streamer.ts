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
import { type Work, runFor } from './work.ts';
import type { World } from './world';

/** A region's side, in tiles (2 km). */
export const REGION_TILES = 4;
/** How far from the middle of the region you can go (either way), px, before the next is made ready (with room to spare: there's 2 tiles each way). */
const MOVE_ON = 0.6 * TILE;

type Painter = (world: World, bounds: Region['map']['region']) => Work<SurfaceGrid>;

export class Streamer {
  /** The middle of the region in use, px (a corner of the tiles). */
  private centre: { x: number; y: number } | null = null;
  /** The next, being made ready: where, its tiles, and the work (or the tiles still on their way). */
  private next: { x: number; y: number; keys: string[]; work: Work<Region> | null } | null = null;
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
    return new Streamer(base, await TileStore.open(base), paint, ids);
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
  private *make(tiles: Tile[], b: Region['map']['region'], progress: Progress, underway?: number): Work<Region> {
    Object.assign(progress, { done: 0, label: 'Reading the map' });
    const map = yield* assembleWork(this.index, tiles, b);
    return yield* regionWork(map, this.ids(), this.paint, progress, underway);
  }

  /**
   * Call once a frame, with where you are: makes the next region ready (for
   * about `ms` milliseconds) if you've gone far enough for it; once it is,
   * it's returned (and from then on it's the region in use), to take over.
   */
  update(x: number, y: number, ms: number): Region | null {
    if (!this.centre) return null;
    if (!this.next) {
      if (this.inside(x, y)) return null;
      const c = this.corner(x, y);
      if (c.x === this.centre.x && c.y === this.centre.y) return null;
      const b = this.bounds(c);
      const keys = tilesFor(this.index, b.x0, b.y0, b.x1, b.y1);
      const next: NonNullable<Streamer['next']> = { ...c, keys, work: null };
      this.next = next;
      this.store.get(keys).then(
        (tiles) => {
          if (this.next !== next) return;
          next.work = this.make(tiles, b, this.making, 0);
        },
        (e) => {
          // (The phone's lost its connection: tried again, once you've moved on a bit.)
          console.error('map:', e);
          if (this.next === next) this.next = null;
        },
      );
      return null;
    }
    if (!this.next.work) return null;
    const r = runFor(this.next.work, ms);
    if (!r.done) return null;
    this.centre = { x: this.next.x, y: this.next.y };
    // Only the tiles of the region in use are kept.
    this.store.keep(this.next.keys);
    this.next = null;
    return r.value;
  }
}
