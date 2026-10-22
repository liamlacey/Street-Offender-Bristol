import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import bristol from '../test/bristol';
import type { GameMap } from './osm';
import { TILE, assemble, splitMap, tilesFor } from './regions';

const map = bristol as unknown as GameMap;
const { index, tiles } = splitMap(map);

describe('the map in tiles', () => {
  it('put back together whole is the whole map', () => {
    const all = assemble(index, [...tiles.values()], { x0: 0, y0: 0, x1: map.width, y1: map.height });
    for (const list of ['roads', 'areas', 'lines', 'buildings', 'props', 'crossings', 'signals', 'paint', 'ledges', 'services', 'busStations', 'trees', 'treeSpecies', 'busRoutes'] as const) {
      expect(all[list], list).toEqual(map[list]);
    }
    // (The points by place, the same ones.)
    for (const list of ['banks', 'venues', 'solar', 'dropped'] as const) expect([...(all[list] ?? [])].sort((a, b) => a - b), list).toEqual([...(map[list] ?? [])].sort((a, b) => a - b));
    expect(all.berths?.length).toBe(map.berths?.length);
    // The lie of the land: the same heights everywhere.
    const [whole, put] = [new Terrain(map.terrain, map.pxPerMetre, map.ledges), new Terrain(all.terrain, map.pxPerMetre, all.ledges)];
    for (let k = 0; k < 400; k++) {
      const [x, y] = [((k * 7919) % 997) / 997 * map.width, ((k * 104729) % 991) / 991 * map.height];
      expect(put.at(x, y)).toBeCloseTo(whole.at(x, y), 4);
    }
  });

  it('a region is what reaches into it, numbered its own way, each thing knowing its id in the whole map', () => {
    const [x0, y0] = [TILE * 3, TILE * 3];
    const [x1, y1] = [x0 + TILE * 4, y0 + TILE * 4];
    const region = assemble(index, tilesFor(index, x0, y0, x1, y1).map((k) => tiles.get(k)!), { x0, y0, x1, y1 });
    expect(region.roads.length).toBeGreaterThan(100);
    expect(region.roads.length).toBeLessThan(map.roads.length / 3);
    region.roads.forEach((r, i) => expect(r).toBe(map.roads[region.ids.roads[i]]));
    region.buildings.forEach((b, i) => expect(b).toBe(map.buildings[region.ids.buildings[i]]));
    for (let i = 0; i < region.trees.length / 4; i++) expect(region.trees.slice(i * 4, i * 4 + 4)).toEqual(map.trees.slice(region.ids.trees[i] * 4, region.ids.trees[i] * 4 + 4));
    // Every road that comes into it is in it.
    const inside = (pts: number[]) => pts.some((v, k) => (k % 2 ? v >= y0 && v < y1 : v >= x0 && v < x1) && (k % 2 ? pts[k - 1] >= x0 && pts[k - 1] < x1 : pts[k + 1] >= y0 && pts[k + 1] < y1));
    const want = map.roads.map((r, i) => (inside(r.pts) ? i : -1)).filter((i) => i >= 0);
    for (const id of want) expect(region.ids.roads).toContain(id);
    // Crossings' roads, the bus routes' legs, by the region's numbering.
    region.crossings.forEach((c, i) => c.road !== undefined && expect(region.roads[c.road]).toBe(map.roads[map.crossings[region.ids.crossings[i]].road!]));
    for (const [r, route] of region.busRoutes!.entries()) {
      route.legs.forEach((leg, k) => {
        const whole = map.busRoutes![r].legs[k];
        if (leg >= 0) expect(region.roads[leg >> 1]).toBe(map.roads[whole >> 1]);
        else if (whole >= 0) expect(region.ids.roads).not.toContain(whole >> 1);
      });
    }
    // The heights, the same as the whole map's, in it.
    const [whole, part] = [new Terrain(map.terrain, map.pxPerMetre, map.ledges), new Terrain(region.terrain, map.pxPerMetre, region.ledges)];
    for (let k = 0; k < 200; k++) {
      const [x, y] = [x0 + ((k * 7919) % 997) / 997 * (x1 - x0), y0 + ((k * 104729) % 991) / 991 * (y1 - y0)];
      expect(part.at(x, y)).toBeCloseTo(whole.at(x, y), 4);
    }
  });

  it('are small: each a fraction of the whole', () => {
    const sizes = [...tiles.values()].map((t) => JSON.stringify(t).length);
    const whole = JSON.stringify(map).length;
    expect(Math.max(...sizes)).toBeLessThan(whole / 10);
    expect(JSON.stringify(index).length).toBeLessThan(whole / 20);
  });
});
