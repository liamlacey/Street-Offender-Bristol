/**
 * What's been broken: the walls knocked through (and what's left of them),
 * the posts knocked down, the trees felled (where their crowns lie). Kept
 * apart from the region of the map round you, so that the next region (see
 * streamer.ts) is made broken as this one was: what's broken stays broken,
 * wherever you go and whenever you come back. It grows only with what you
 * break, not with the size of the map. Pure, so it's tested.
 */

import { REMAINS } from './damage';
import type { CircleGrid, SegmentGrid } from '../physics/collisions';
import type { GameMap } from '../map/osm';
import { type Post, type Wall, ruin } from './world';

/** A fallen tree: where its crown is, how high it is (px), how big, which way it lies, whether it's been torn up. */
export interface Felled {
  x: number;
  y: number;
  h: number;
  /** Its crown's radius, px (its shadow's gone from the map's trees: see GameScene). */
  r?: number;
  turn?: number;
  gone?: boolean;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Changes {
  /** The map's walls knocked through, by where they were. */
  private readonly walls: Wall[] = [];
  /** What's been put in the way since: what's left of the broken walls, the fallen trees' trunks (gone, once they're broken in turn). */
  private readonly added: Wall[] = [];
  /** The map's posts knocked down (lamps, lights, trees), by what they were and where, and their level. */
  private readonly posts: { thing: Post['thing']; x: number; y: number; level: number }[] = [];
  /** The fallen trees, by their ids in the whole map. */
  readonly trees = new Map<number, Felled>();
  /** The huts knocked down, by their ids in the whole map (and where, and how far their walls reach from there, px). */
  private readonly huts = new Map<number, { x: number; y: number; reach: number }>();

  /** A hut's been knocked down (see world.ts's `isHut`). */
  hutGone(id: number, x: number, y: number, reach: number): void {
    this.huts.set(id, { x, y, reach });
  }

  /**
   * Knocks down a region's huts as they've been knocked down: their walls gone, and what's left of them (see world.ts's `ruin`)
   * in its map. Which of its map's buildings they are.
   */
  ruins(map: GameMap, walls: [SegmentGrid, SegmentGrid, SegmentGrid]): number[] {
    if (!this.huts.size) return [];
    const ids = (map as GameMap & { ids?: { buildings: number[] } }).ids?.buildings;
    const out: number[] = [];
    map.buildings.forEach((b, k) => {
      const id = ids?.[k] ?? k;
      if (!this.huts.has(id)) return;
      ruin(b);
      out.push(k);
    });
    for (const [id, { x, y, reach }] of this.huts) {
      for (const grid of walls) for (const w of grid.near(x, y, reach) as Wall[]) if (w.hut === id) w.gone = true;
    }
    return out;
  }

  /** A wall's been knocked through (one of the map's: what's been added since keeps its own `gone`). */
  wallGone(w: Wall): void {
    if (!w.added) this.walls.push({ ax: w.ax, ay: w.ay, bx: w.bx, by: w.by, r: w.r, level: w.level });
  }

  /** Something's been put in the way (on its level). */
  wallAdded(w: Wall): void {
    w.added = true;
    this.added.push(w);
  }

  /** A post's been knocked down. */
  postGone(p: Post, level: number): void {
    this.posts.push({ thing: p.thing, x: p.x, y: p.y, level });
  }

  /**
   * Breaks a region's walls and posts as they've been broken (those in
   * `bounds`), and puts in what's been added: the posts it's knocked down
   * there, for the scene to take away what showed them.
   */
  apply(walls: [SegmentGrid, SegmentGrid, SegmentGrid], posts: [CircleGrid, CircleGrid, CircleGrid], bounds: Bounds): { post: Post; level: number }[] {
    const inside = (x: number, y: number) => x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
    for (const w of this.walls) {
      const [mx, my] = [(w.ax + w.bx) / 2, (w.ay + w.by) / 2];
      if (!inside(mx, my) && !inside(w.ax, w.ay) && !inside(w.bx, w.by)) continue;
      const same = (walls[w.level].near(mx, my, Math.hypot(w.bx - w.ax, w.by - w.ay) / 2 + 1) as Wall[]).find((s) => !s.added && s.ax === w.ax && s.ay === w.ay && s.bx === w.bx && s.by === w.by);
      if (same) same.gone = true;
    }
    for (const w of this.added) {
      if (w.gone || (!inside(w.ax, w.ay) && !inside(w.bx, w.by))) continue;
      walls[w.level].add(w);
    }
    const down: { post: Post; level: number }[] = [];
    for (const p of this.posts) {
      if (!inside(p.x, p.y)) continue;
      const same = (posts[p.level].near(p.x, p.y, 1) as Post[]).find((q) => q.thing === p.thing && q.x === p.x && q.y === p.y);
      if (!same) continue;
      // (A statue's plinth, a fountain's basin: still there, broken, the first time it's knocked; smashed, the second.)
      if (REMAINS.has(same.thing) && !same.broken) same.broken = true;
      else same.gone = true;
      down.push({ post: same, level: p.level });
    }
    return down;
  }
}
