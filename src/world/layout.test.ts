import { describe, expect, it } from 'vitest';
import type { GameMap } from '../map/osm';
import { TILE, assemble, splitMap, tilesFor } from '../map/regions';
import bristol from '../test/bristol';
import { layOut, useLayout } from './layout';
import { buildWorld } from './world';

describe('the layout, worked out elsewhere', () => {
  it('makes the same world as working it out here', () => {
    const map = bristol as unknown as GameMap;
    const { index, tiles } = splitMap(map);
    const [cx, cy] = [Math.round(map.spawn.x / TILE) * TILE, Math.round(map.spawn.y / TILE) * TILE];
    const b = { x0: cx - 2 * TILE, y0: cy - 2 * TILE, x1: cx + 2 * TILE, y1: cy + 2 * TILE };
    // (Each from its own copy of the tiles, as the worker has: fetched afresh.)
    const region = () => assemble(index, structuredClone(tilesFor(index, b.x0, b.y0, b.x1, b.y1).map((k) => tiles.get(k)!)), b);
    // Laid out in one (the worker's), handed over as a message would be, and taken for another.
    const layout = structuredClone(layOut(region()));
    const given = region();
    useLayout(given, layout);
    const there = buildWorld(given);
    const here = buildWorld(region());
    expect(there.map.areas).toEqual(here.map.areas);
    expect(there.loose).toEqual(here.loose);
    expect(there.walls).toEqual(here.walls);
    expect(there.fixed).toEqual(here.fixed);
  }, 300_000);
});
