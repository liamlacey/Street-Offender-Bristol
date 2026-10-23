import { describe, expect, it } from 'vitest';
import { CircleGrid, SegmentGrid } from '../physics/collisions';
import { Changes } from './changes';
import type { GameMap } from '../map/osm';
import { type Post, buildWorld } from './world';

describe('what\'s broken', () => {
  it('leaves a statue\'s plinth and a fountain\'s basin there, broken, in the next region (gone, knocked again); a lamp post gone', () => {
    const made = (): Post[] => [
      { x: 100, y: 100, r: 10, thing: 'statue', index: 0 },
      { x: 300, y: 100, r: 14, thing: 'fountain', index: 1 },
      { x: 500, y: 100, r: 3, thing: 'lamp', index: 2 },
    ];
    const changes = new Changes();
    for (const p of made()) changes.postGone(p, 0);
    // (The fountain's basin, knocked again.)
    changes.postGone(made()[1], 0);
    // The next region's own posts, the same ones.
    const posts = made();
    const grids = [new CircleGrid(posts), new CircleGrid([]), new CircleGrid([])] as [CircleGrid, CircleGrid, CircleGrid];
    const walls = [new SegmentGrid([]), new SegmentGrid([]), new SegmentGrid([])] as [SegmentGrid, SegmentGrid, SegmentGrid];
    const down = changes.apply(walls, grids, { x0: 0, y0: 0, x1: 1000, y1: 1000 });
    expect(down).toHaveLength(4);
    expect(posts.map((p) => [p.thing, !!p.gone, !!p.broken])).toEqual([
      ['statue', false, true],
      ['fountain', true, true],
      ['lamp', true, false],
    ]);
  });
});

describe('huts', () => {
  const M = 8;
  const box = (x: number, y: number, w: number, d: number) => [x, y, x + w, y, x + w, y + d, x, y + d];
  const building = (id: number, kind: string, x: number, w: number) => ({ id, kind, rings: [box(x * M, 100 * M, w * M, w * M)], top: 3 * M, bottom: 0, solid: true, drawn: true });
  const map = () =>
    ({
      attribution: '', pxPerMetre: M, width: 400 * M, height: 400 * M, origin: { lat: 0, lon: 0 }, spawn: { x: 0, y: 0, heading: 0 },
      // A shed (4 m square), a house as small, a warehouse (10 m square), and a stair tower inside it (on its roof).
      buildings: [building(1, 'shed', 50, 4), building(2, 'house', 100, 4), building(3, 'warehouse', 150, 10), { ...building(4, 'yes', 152, 3), rings: [box(152 * M, 102 * M, 3 * M, 3 * M)] }],
      areas: [], roads: [], lines: [], props: [], crossings: [], signals: [], controllers: [], trees: [],
    }) as unknown as GameMap;

  it('are the small buildings (not homes, nor part of a bigger one): their walls can be knocked down, and stay down', () => {
    const world = buildWorld(map());
    const huts = new Set(world.walls[0].filter((w) => w.hut !== undefined).map((w) => w.hut));
    expect([...huts]).toEqual([0]);
    const changes = new Changes();
    changes.hutGone(0, 52 * M, 102 * M, 4 * M);
    // The next region's own walls and map, the same.
    const again = buildWorld(map());
    const grids = again.walls.map((ws) => new SegmentGrid(ws)) as [SegmentGrid, SegmentGrid, SegmentGrid];
    expect(changes.ruins(again.map, grids)).toEqual([0]);
    expect(again.walls[0].filter((w) => w.hut === 0).every((w) => w.gone)).toBe(true);
    expect(again.walls[0].filter((w) => w.hut === undefined).some((w) => w.gone)).toBe(false);
    expect(again.map.buildings[0].top).toBeLessThan(M);
  });
});
