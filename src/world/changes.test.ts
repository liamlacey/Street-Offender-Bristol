import { describe, expect, it } from 'vitest';
import { CircleGrid, SegmentGrid } from '../physics/collisions';
import { Changes } from './changes';
import type { Post } from './world';

describe('what\'s broken', () => {
  it('leaves a statue\'s plinth and a fountain\'s basin standing, broken, in the next region; a lamp post gone', () => {
    const made = (): Post[] => [
      { x: 100, y: 100, r: 10, thing: 'statue', index: 0 },
      { x: 300, y: 100, r: 14, thing: 'fountain', index: 1 },
      { x: 500, y: 100, r: 3, thing: 'lamp', index: 2 },
    ];
    const changes = new Changes();
    for (const p of made()) changes.postGone(p, 0);
    // The next region's own posts, the same ones.
    const posts = made();
    const grids = [new CircleGrid(posts), new CircleGrid([]), new CircleGrid([])] as [CircleGrid, CircleGrid, CircleGrid];
    const walls = [new SegmentGrid([]), new SegmentGrid([]), new SegmentGrid([])] as [SegmentGrid, SegmentGrid, SegmentGrid];
    const down = changes.apply(walls, grids, { x0: 0, y0: 0, x1: 1000, y1: 1000 });
    expect(down).toHaveLength(3);
    expect(posts.map((p) => [p.thing, !!p.gone, !!p.broken])).toEqual([
      ['statue', false, true],
      ['fountain', false, true],
      ['lamp', true, false],
    ]);
  });
});
