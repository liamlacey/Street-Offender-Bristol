import { describe, expect, it } from 'vitest';
import mapData from '../map/bristol.json';
import { BOAT_SIZE, Water, findBerths } from '../map/berths';
import type { Area, GameMap } from '../map/osm';
import { Boats, WaterGrid } from './boats';

const map = mapData as unknown as GameMap;
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe('berths', () => {
  // A basin 100 m square with a pontoon 40 m long, 3 m wide, down the middle of it.
  const m = 8;
  const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1].map((v) => v * m);
  const areas: Area[] = [
    { kind: 'water', rings: [square(0, 0, 100, 100)] },
    { kind: 'pontoon', rings: [square(30, 48.5, 70, 51.5)] },
  ];
  const water = new Water(areas);

  it('lines boats up along both sides of a pontoon, on the water, not overlapping', () => {
    const berths = findBerths([{ pts: square(30, 48.5, 70, 51.5), closed: true, mooring: 'guest' }], water, m);
    expect(berths.length).toBeGreaterThanOrEqual(4);
    expect(berths.some((b) => b.y < 48.5 * m)).toBe(true);
    expect(berths.some((b) => b.y > 51.5 * m)).toBe(true);
    for (const b of berths) {
      const [L, W] = BOAT_SIZE[b.kind].map((v) => v * m);
      expect(water.fits(b.x, b.y, b.angle, L, W)).toBe(true);
      // Alongside: lying along the pontoon, just off it.
      expect(Math.abs(Math.sin(b.angle))).toBeLessThan(0.01);
      expect(Math.abs(Math.abs(b.y - 50 * m) - (1.5 * m + W / 2 + 0.4 * m))).toBeLessThan(1);
    }
  });
});

describe('boats', () => {
  it('has berths and ferry routes in Bristol', () => {
    expect(map.berths!.length).toBeGreaterThan(50);
    expect(map.ferries!.length).toBeGreaterThan(0);
  });

  it('finds a way across the harbour, under the bridges, and keeps off the land', () => {
    const grid = new WaterGrid(map, map.berths);
    const [a, b] = [map.ferries![0].stops, map.ferries![map.ferries!.length - 1].stops];
    const from = grid.open(a[0], a[1], 12 * 8)!;
    const to = grid.open(b[b.length - 3], b[b.length - 2], 12 * 8)!;
    const way = grid.way(from[0], from[1], to[0], to[1])!;
    expect(way).not.toBeNull();
    for (let i = 0; i + 3 < way.length; i += 2) expect(grid.sees(way[i], way[i + 1], way[i + 2], way[i + 3])).toBe(true);
  });

  it('casts off, crosses the water and comes alongside; the ferries call at their stops', () => {
    const boats = new Boats(map, { rand: seeded(11) });
    const ferries = boats.boats.filter((b) => b.ferry);
    expect(ferries.length).toBe(map.ferries!.length);
    const calls = new Set<string>();
    for (let t = 0; t < 600; t += 1 / 20) {
      boats.update(1 / 20);
      for (const b of boats.boats) {
        if (b.mode === 'underway') expect(boats.grid.at(b.x, b.y)).toBeGreaterThan(0);
        if (b.ferry && b.mode === 'moored') calls.add(`${b.ferry.route}:${b.ferry.stop}`);
      }
    }
    expect(boats.arrivals).toBeGreaterThan(3);
    expect(calls.size).toBeGreaterThanOrEqual(3);
    // No two boats moored at the same berth.
    const at = boats.boats.filter((b) => b.mode === 'moored' && !b.ferry).map((b) => b.berth);
    expect(new Set(at).size).toBe(at.length);
  });
});
